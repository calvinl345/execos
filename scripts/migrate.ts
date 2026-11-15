/**
 * Drizzle migrate runner.
 *
 * Usage (from repo root):
 *
 *   # Apply pending migrations (production / dev path)
 *   npm run db:migrate:prod
 *   npm run db:migrate:dev
 *
 *   # Roll back the most recent migration
 *   npm run db:rollback:prod
 *   npm run db:rollback:dev
 *
 *   # Roll back to a specific migration tag
 *   node scripts/run-with-env.cjs .env.production.local node --import=tsx scripts/migrate.ts down --to 0000_init
 *
 * "down" support is required by AC-070 / AC-071. Drizzle's official
 * migrate runner only supports forward migrations; reverse migrations
 * are intentionally limited because most schema changes are not
 * trivially reversible. For the v1 schema we only need a one-way
 * round-trip test (apply 0000_init -> drop everything it created), so
 * "down" here implements that simple case: parse 0000_init.sql, find
 * every CREATE statement, emit corresponding DROP statements in reverse
 * order, and execute them.
 *
 * The migration reversibility test in tests/db/migrate-roundtrip.test.ts
 * runs `up` then `down` against a transient schema and asserts the
 * database is empty afterwards.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { db, sqlClient, closeDb } from "../src/db/index.js";
import { scanMigrationsForDestructive } from "./lib/migration-safety.mjs";
import { createPreMigrationBackup } from "./lib/db-backup.mjs";

type Verb = "up" | "down";

const ROLLBACK_ACK = "I_UNDERSTAND_THIS_DROPS_EXECOS_SCHEMA";
const PRODUCTION_MIGRATE_ACK = "I_UNDERSTAND_THIS_MUTATES_PRODUCTION";

function parseArgs(argv: string[]): { verb: Verb; toTag?: string } {
  const args = argv.slice(2);
  if (args.length === 0) {
    return { verb: "up" };
  }
  const verb = args[0];
  if (verb !== "up" && verb !== "down") {
    throw new Error(`Unknown verb: ${verb}. Expected "up" or "down".`);
  }
  let toTag: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--to" && args[i + 1]) {
      toTag = args[i + 1];
      i++;
    }
  }
  return { verb, toTag };
}

function repoRootFromHere(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * Apply-time destructive firewall. The same scan runs in CI and the
 * pre-commit hook, but this is the last line of defense: it runs on the
 * machine actually mutating the database (including the ExecOS installer),
 * so an unacknowledged destructive migration is refused even if it somehow
 * slipped past the earlier gates.
 */
function assertMigrationsSafe(repoRoot: string): void {
  const migrationsDir = path.join(repoRoot, "src", "db", "migrations");
  const { violations } = scanMigrationsForDestructive(migrationsDir);
  if (violations.length === 0) return;

  console.error("[migrate] Refusing to apply: unacknowledged destructive migration(s) detected.");
  for (const violation of violations) {
    console.error(`  ${violation.file}`);
    for (const statement of violation.statements) {
      console.error(`    - ${statement.rule}: ${statement.statement}`);
    }
  }
  console.error(
    "[migrate] Add the matching .destructive.md acknowledgment file (see scripts/check-migration-safety.mjs) or revise the migration.",
  );
  throw new Error("Unacknowledged destructive migration blocked.");
}

type DbEnv = "test" | "development" | "production" | "unknown";

/**
 * Classify the migration target so we require backups where data is
 * irreplaceable (production) without blocking the developer's disposable
 * dev database. Prefers an explicit EXECOS_DB_ENV (set by the installer);
 * falls back to the env file name passed by scripts/run-with-env.cjs
 * (.env.development.local / .env.production.local). An unrecognized target
 * is treated as production for safety.
 */
function resolveDbEnv(): DbEnv {
  const explicit = process.env.EXECOS_DB_ENV;
  if (explicit === "test" || explicit === "development" || explicit === "production") {
    return explicit;
  }
  const file = (process.env.EXECOS_ENV_FILE ?? "").toLowerCase();
  if (file.includes("development")) return "development";
  if (file.includes("production")) return "production";
  return "unknown";
}

/**
 * Take a fresh backup before applying anything.
 *
 * When `required` (production, or an unrecognized target), backup failure
 * ABORTS the migration unless EXECOS_ALLOW_UNSAFE_MIGRATE=1. For the
 * developer's disposable dev database it is best-effort: a backup failure
 * logs a warning and proceeds, so day-to-day dev work is never blocked by
 * production-grade safety requirements.
 */
async function backupBeforeApply(repoRoot: string, required: boolean): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  try {
    const result = await createPreMigrationBackup({ databaseUrl, repoRoot });
    console.log(`[migrate] pre-migration backup written via ${result.tool}:`);
    for (const p of result.paths) {
      console.log(`  ${p}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!required) {
      console.warn(
        `[migrate] WARNING: no pre-migration backup for this non-production target (${message}). ` +
          "Proceeding because the dev database is disposable.",
      );
      return;
    }
    if (process.env.EXECOS_ALLOW_UNSAFE_MIGRATE === "1") {
      console.warn(
        `[migrate] WARNING: pre-migration backup failed but EXECOS_ALLOW_UNSAFE_MIGRATE=1 is set; proceeding WITHOUT a backup. (${message})`,
      );
      return;
    }
    throw new Error(
      `Refusing to migrate: pre-migration backup failed (${message}). ` +
        "Ensure DATABASE_URL can read ExecOS app data, install pg_dump or Docker-backed Supabase CLI for a full backup, " +
        "or set EXECOS_ALLOW_UNSAFE_MIGRATE=1 to override.",
    );
  }
}

function assertProductionMigrationAllowed(dbEnv: DbEnv): void {
  if (dbEnv === "test" || dbEnv === "development") {
    return;
  }

  if (process.env.EXECOS_ALLOW_PRODUCTION_MIGRATE === PRODUCTION_MIGRATE_ACK) {
    return;
  }

  throw new Error(
    [
      "Refusing to migrate a production or unknown database target without explicit acknowledgement.",
      `Set EXECOS_ALLOW_PRODUCTION_MIGRATE=${PRODUCTION_MIGRATE_ACK} only after clone verification has passed.`,
      "For credential capture or clone rehearsal, use the installer with database steps skipped.",
    ].join(" "),
  );
}

async function runUp(): Promise<void> {
  const repoRoot = repoRootFromHere();
  const dbEnv = resolveDbEnv();

  // Guard 1: never apply an unacknowledged destructive migration.
  assertMigrationsSafe(repoRoot);

  // Guard 2: production writes require a deliberate operator acknowledgement.
  assertProductionMigrationAllowed(dbEnv);

  // Guard 3: take a fresh restore point before mutating real data.
  // Mandatory for production (and any unrecognized target); best-effort for
  // the developer's disposable dev DB; skipped for the local test DB used
  // by the migration roundtrip suite.
  if (dbEnv !== "test") {
    await backupBeforeApply(repoRoot, dbEnv !== "development");
  }

  console.log("[migrate] applying pending migrations...");
  const start = Date.now();
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  await runPostMigrationBackfills();
  console.log(`[migrate] up complete (${Date.now() - start}ms)`);
}

async function runPostMigrationBackfills(): Promise<void> {
  await db.execute(sql`
    UPDATE tasks
    SET
      snoozed_until = follow_up_date,
      follow_up_date = NULL,
      handoff_state = 'not_applicable',
      handoff_copied_at = NULL,
      handoff_last_copied_at = NULL,
      handoff_last_nudge_copied_at = NULL
    WHERE
      follow_up_date IS NOT NULL
      AND snoozed_until IS NULL
      AND (
        owner IS NULL
        OR btrim(owner) = ''
        OR lower(btrim(owner)) = 'me'
      )
  `);

  await db.execute(sql`
    UPDATE tasks
    SET
      handoff_state = CASE
        WHEN follow_up_date IS NULL THEN 'pending'
        ELSE 'copied'
      END,
      handoff_copied_at = CASE
        WHEN follow_up_date IS NULL THEN NULL
        ELSE COALESCE(handoff_copied_at, updated_at)
      END,
      handoff_last_copied_at = CASE
        WHEN follow_up_date IS NULL THEN NULL
        ELSE COALESCE(handoff_last_copied_at, updated_at)
      END
    WHERE
      NOT (
        owner IS NULL
        OR btrim(owner) = ''
        OR lower(btrim(owner)) = 'me'
      )
      AND handoff_state = 'not_applicable'
  `);

  await db.execute(sql`
    UPDATE tasks
    SET
      queue_rank = NULL,
      queue_rationale = NULL,
      queue_ranked_at = NULL
    WHERE
      queue_rank IS NOT NULL
      AND NOT (
        owner IS NULL
        OR btrim(owner) = ''
        OR lower(btrim(owner)) = 'me'
      )
  `);
}

/**
 * Reverse the most recent applied migration. Used only for the
 * roundtrip test. NOT a general-purpose down migration.
 *
 * Strategy: query the drizzle migrations table to know what was
 * applied, then drop everything in dependency-safe order using CASCADE.
 * For the v1 schema (one migration: 0000_init), this is sufficient.
 */
async function runDown(toTag?: string): Promise<void> {
  assertRollbackAllowed();

  console.log(
    `[migrate] rolling back ${
      toTag ? `to tag '${toTag}'` : "the most recent migration"
    }...`,
  );

  const start = Date.now();

  // Drop views first (depend on tables)
  await db.execute(sql`DROP VIEW IF EXISTS public.v_recent_wins CASCADE`);
  await db.execute(
    sql`DROP VIEW IF EXISTS public.v_eligible_for_prioritization CASCADE`,
  );

  // Drop tables (CASCADE handles FK + index + policy + RLS dependencies)
  const tables = [
    "triage_items",
    "triage_sessions",
    "document_tasks",
    "documents",
    "memories",
    "task_dependencies",
    "task_activities",
    "task_notes",
    "tasks",
    "goals",
    "team",
    "app_settings",
  ] as const;

  for (const t of tables) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS public.${t} CASCADE`));
  }

  // Drop sequences
  await db.execute(sql`DROP SEQUENCE IF EXISTS public.task_id_sequence`);
  await db.execute(sql`DROP SEQUENCE IF EXISTS public.goal_id_sequence`);

  // Drop drizzle's own bookkeeping table so a subsequent `up` re-applies
  // from scratch (this is what makes the roundtrip clean).
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);

  console.log(`[migrate] down complete (${Date.now() - start}ms)`);
}

function assertRollbackAllowed(): void {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("Refusing rollback: DATABASE_URL is not set.");
  }

  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";

  if (process.env.EXECOS_DB_ENV === "test" && isLocal) {
    return;
  }

  if (process.env.EXECOS_ALLOW_SCHEMA_ROLLBACK === ROLLBACK_ACK) {
    return;
  }

  throw new Error(
    [
      "Refusing rollback: migrate down drops ExecOS tables, views, sequences, and migration history.",
      "It runs automatically only for EXECOS_DB_ENV=test on localhost.",
      `For an intentional non-test rollback, set EXECOS_ALLOW_SCHEMA_ROLLBACK=${ROLLBACK_ACK}.`,
    ].join(" "),
  );
}

async function main(): Promise<void> {
  const { verb, toTag } = parseArgs(process.argv);

  if (verb === "up") {
    assertProductionMigrationAllowed(resolveDbEnv());
  }

  // Defensive: confirm we have a connection before doing anything
  // disruptive. A bad DATABASE_URL should fail loud, not silently.
  await sqlClient`SELECT 1`;

  if (verb === "up") {
    await runUp();
  } else {
    await runDown(toTag);
  }
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[migrate] FAILED");
    console.error(err);
    await closeDb().catch(() => {
      /* ignore close errors during failure */
    });
    process.exit(1);
  });
