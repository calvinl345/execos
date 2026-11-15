import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, closeDb } from "../../src/db/index.js";

export { db, closeDb };

const DESTRUCTIVE_TEST_ACK =
  "I_UNDERSTAND_THIS_WIPES_AN_ISOLATED_LOCAL_TEST_DATABASE";

function assertIsolatedLocalTestDatabase(): void {
  if (process.env.EXECOS_ALLOW_DESTRUCTIVE_DB_TESTS !== DESTRUCTIVE_TEST_ACK) {
    throw new Error(
      [
        "Refusing destructive DB test reset.",
        "resetDbData()/clearData() truncate application tables and are disabled",
        "unless EXECOS_ALLOW_DESTRUCTIVE_DB_TESTS explicitly acknowledges an",
        "isolated local test database.",
      ].join(" "),
    );
  }

  if (process.env.EXECOS_DB_ENV !== "test") {
    throw new Error("Refusing destructive DB test reset: EXECOS_DB_ENV must be 'test'.");
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("Refusing destructive DB test reset: DATABASE_URL is not set.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Refusing destructive DB test reset: DATABASE_URL is invalid.");
  }

  const host = parsed.hostname.toLowerCase();
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]";
  if (!isLocal) {
    throw new Error(
      [
        "Refusing destructive DB test reset: DATABASE_URL is not local.",
        `Host '${parsed.hostname}' could be a shared Supabase/project database.`,
        "Use a disposable local Postgres/Supabase database for destructive tests.",
      ].join(" "),
    );
  }
}

export function testId(prefix = "T"): string {
  return `${prefix}-${nanoid(8)}`;
}

export interface PgErrorLike {
  code?: string;
  message?: string;
}

function findPgCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const maybe = err as PgErrorLike & { cause?: unknown };
  return maybe.code ?? findPgCode(maybe.cause);
}

export function expectPgCode(err: unknown, code: string): void {
  const actual = findPgCode(err);
  const maybe = err as PgErrorLike;
  if (actual !== code) {
    throw new Error(
      `Expected Postgres error code ${code}, got ${actual ?? "<none>"}: ${maybe.message ?? String(err)}`,
    );
  }
}

export async function clearData(): Promise<void> {
  assertIsolatedLocalTestDatabase();
  await db.execute(sql`TRUNCATE TABLE
    triage_items,
    triage_sessions,
    document_tasks,
    documents,
    memories,
    task_dependencies,
    task_activities,
    task_notes,
    tasks,
    goals,
    team
    CASCADE`);
}

export async function seedSettings(): Promise<void> {
  // Use the same flat (key, value, description) row set the install
  // seed writes, derived from DEFAULT_SETTINGS, so tests exercise the
  // same shape as production install.
  const { DEFAULT_SEED_ROWS } = await import("../../src/cli/seed-rows.js");
  for (const row of DEFAULT_SEED_ROWS) {
    await db.execute(sql`
      INSERT INTO app_settings (key, value, description)
      VALUES (${row.key}, ${row.value}, ${row.description})
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        description = EXCLUDED.description
    `);
  }
}

export async function resetDbData(): Promise<void> {
  await clearData();
  await seedSettings();
}

export async function insertGoal(id = testId("G")): Promise<string> {
  await db.execute(sql`
    INSERT INTO goals (id, title, description, quarter)
    VALUES (${id}, 'Test Goal', 'A valid goal description', '2026-Q2')
  `);
  return id;
}

export async function insertTask(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = String(overrides.id ?? testId("KS"));
  const title = String(overrides.title ?? "Test Task");
  const description = String(overrides.description ?? "A valid task description");
  const status = String(overrides.status ?? "triage");
  const priority = overrides.priority === undefined ? null : overrides.priority;
  const category = String(overrides.category ?? "client");
  const owner = String(overrides.owner ?? "me");
  const dueDate = dateParam(overrides.dueDate);
  const followUpDate = dateParam(overrides.followUpDate);
  const snoozedUntil = dateParam(overrides.snoozedUntil);
  const goalId = overrides.goalId === undefined ? null : overrides.goalId;
  const needsAttention = Boolean(overrides.needsAttention ?? false);
  const needsAttentionReason = overrides.needsAttentionReason ?? null;

  await db.execute(sql`
    INSERT INTO tasks (
      id, title, description, status, priority, category, owner,
      due_date, follow_up_date, snoozed_until, goal_id, needs_attention, needs_attention_reason
    ) VALUES (
      ${id}, ${title}, ${description}, ${status}, ${priority}, ${category}, ${owner},
      ${dueDate}, ${followUpDate}, ${snoozedUntil}, ${goalId}, ${needsAttention}, ${needsAttentionReason}
    )
  `);
  return id;
}

function dateParam(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function insertMemory(id = testId("M")): Promise<string> {
  const embedding = `[${Array.from({ length: 3072 }, () => "0").join(",")}]`;
  await db.execute(sql`
    INSERT INTO memories (
      id, scope, content, applicability, content_embedding, applicability_embedding
    ) VALUES (
      ${id}, 'global', 'A valid memory', 'When testing', ${embedding}::vector, ${embedding}::vector
    )
  `);
  return id;
}
