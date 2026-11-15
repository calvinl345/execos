/**
 * Pre-migration logical backup (Phase 1 recovery artifact).
 *
 * Takes a complete logical snapshot of the target database immediately
 * before any migration is applied, so there is always a fresh restore
 * point taken seconds before a schema change, independent of the
 * Supabase platform backup tier.
 *
 * Tool preference: use a full logical dump when host tooling allows it,
 * then fall back to a built-in ExecOS app-data JSON backup. The fallback
 * keeps normal installs/updates from requiring Docker or pg_dump, while
 * still producing a local restore artifact before production data changes.
 *
 * Artifacts are written to a gitignored `backups/` folder. They contain
 * real production data and must never be committed to git; see .gitignore.
 */

import { mkdirSync, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { toSessionPoolerUrl } from "./supabase-cli.mjs";

function commandAvailable(cmd) {
  const probe = spawnSync(cmd, ["--version"], { stdio: "ignore", timeout: 5000 });
  return !probe.error && probe.status === 0;
}

function dockerDaemonAvailable() {
  const probe = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 5000 });
  return !probe.error && probe.status === 0;
}

/**
 * Resolve how to invoke the Supabase CLI as an argv array (command +
 * leading args). Prefers the vendored optional dependency, invoked through
 * its Node launcher so it works identically on Windows, macOS, and Linux
 * with no shell; falls back to a `supabase` already on PATH. Returns null
 * when the CLI is not available.
 */
function resolveSupabaseInvoker(repoRoot) {
  const vendored = path.join(repoRoot, "node_modules", "supabase", "dist", "supabase.js");
  if (existsSync(vendored)) return [process.execPath, vendored];
  if (commandAvailable("supabase")) return ["supabase"];
  return null;
}

/**
 * Derive a short, filename-safe label identifying the target database so
 * backups are self-describing (e.g. the Supabase project ref). Never
 * includes the password.
 */
function deriveLabel(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    const supabaseRef = url.username.match(/^postgres\.([a-z0-9-]+)$/i);
    if (supabaseRef) return supabaseRef[1];
    return url.hostname.split(".")[0] || "db";
  } catch {
    return "db";
  }
}

export function describeBackupTarget(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    const username = decodeURIComponent(url.username);
    const supabaseRef = username.match(/^postgres\.([a-z0-9-]+)$/i)?.[1] ?? null;
    return {
      host: url.hostname,
      port: url.port || null,
      database: url.pathname.replace(/^\//, "") || null,
      username,
      supabaseProjectRef: supabaseRef,
    };
  } catch {
    return { host: null, port: null, database: null, username: null, supabaseProjectRef: null };
  }
}

function quoteIdent(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function tableKey(schema, table) {
  return `${schema}.${table}`;
}

function jsonReplacer(_key, value) {
  if (typeof value === "bigint") return value.toString();
  return value;
}

function removeIfExists(filePath) {
  rmSync(filePath, { force: true });
}

function moveCompletedFile(tmpPath, finalPath) {
  if (!existsSync(tmpPath)) {
    throw new Error(`Backup command reported success but did not write ${tmpPath}.`);
  }
  renameSync(tmpPath, finalPath);
}

async function readSequences(sql) {
  try {
    return {
      sequences: await sql`
        SELECT
          schemaname,
          sequencename,
          start_value,
          min_value,
          max_value,
          increment_by,
          cycle,
          cache_size,
          last_value
        FROM pg_sequences
        WHERE schemaname IN ('public', 'drizzle')
        ORDER BY schemaname, sequencename
      `,
      warning: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      sequences: [],
      warning: `Could not read sequence metadata: ${message}`,
    };
  }
}

/**
 * Collect a Docker-free backup of Jordan-owned data. This intentionally
 * avoids Supabase-managed schemas and exports only the app schemas Jordan
 * owns: public tables plus Drizzle migration history when present.
 */
export async function collectAppDataSnapshot(sql, databaseUrl) {
  const tableRows = await sql`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema IN ('public', 'drizzle')
      AND table_type = 'BASE TABLE'
    ORDER BY table_schema, table_name
  `;

  const columnRows = await sql`
    SELECT
      table_schema,
      table_name,
      column_name,
      ordinal_position,
      data_type,
      udt_name,
      is_nullable,
      column_default
    FROM information_schema.columns
    WHERE table_schema IN ('public', 'drizzle')
    ORDER BY table_schema, table_name, ordinal_position
  `;

  const primaryKeyRows = await sql`
    SELECT
      kcu.table_schema,
      kcu.table_name,
      kcu.column_name,
      kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_schema = kcu.constraint_schema
      AND tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      AND tc.table_name = kcu.table_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema IN ('public', 'drizzle')
    ORDER BY kcu.table_schema, kcu.table_name, kcu.ordinal_position
  `;

  const columnsByTable = new Map();
  for (const column of columnRows) {
    const key = tableKey(column.table_schema, column.table_name);
    const columns = columnsByTable.get(key) ?? [];
    columns.push({
      name: column.column_name,
      ordinal: Number(column.ordinal_position),
      dataType: column.data_type,
      udtName: column.udt_name,
      nullable: column.is_nullable === "YES",
      default: column.column_default,
    });
    columnsByTable.set(key, columns);
  }

  const primaryKeysByTable = new Map();
  for (const pk of primaryKeyRows) {
    const key = tableKey(pk.table_schema, pk.table_name);
    const keys = primaryKeysByTable.get(key) ?? [];
    keys.push(pk.column_name);
    primaryKeysByTable.set(key, keys);
  }

  const tables = [];
  for (const table of tableRows) {
    const key = tableKey(table.table_schema, table.table_name);
    const columns = columnsByTable.get(key) ?? [];
    const primaryKey = primaryKeysByTable.get(key) ?? [];
    const orderClause =
      primaryKey.length > 0
        ? ` ORDER BY ${primaryKey.map((column) => quoteIdent(column)).join(", ")}`
        : "";
    const qualified = `${quoteIdent(table.table_schema)}.${quoteIdent(table.table_name)}`;
    const rows = await sql.unsafe(`SELECT * FROM ${qualified}${orderClause}`);
    tables.push({
      schema: table.table_schema,
      name: table.table_name,
      columns,
      primaryKey,
      rowCount: rows.length,
      rows,
    });
  }

  const { sequences, warning } = await readSequences(sql);
  const warnings = warning ? [warning] : [];

  return {
    format: "daily-app-data-backup",
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    target: describeBackupTarget(databaseUrl),
    scope: {
      schemas: ["public", "drizzle"],
      note: "Fallback backup of ExecOS app-owned tables. Supabase-managed schemas are not included.",
    },
    tables,
    sequences,
    warnings,
  };
}

async function createAppDataBackup({ databaseUrl, dumpUrl, backupPath }) {
  const sql = postgres(dumpUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => {},
  });
  const tmpPath = `${backupPath}.partial`;
  try {
    const snapshot = await collectAppDataSnapshot(sql, databaseUrl);
    writeFileSync(tmpPath, `${JSON.stringify(snapshot, jsonReplacer, 2)}\n`, {
      encoding: "utf8",
    });
    moveCompletedFile(tmpPath, backupPath);
    return { tool: "daily-app-data", paths: [backupPath] };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
    removeIfExists(tmpPath);
  }
}

/**
 * Create a pre-migration backup of the database at `databaseUrl`.
 *
 * @param {{ databaseUrl: string | undefined, repoRoot: string }} opts
 * @returns {Promise<{ tool: "pg_dump" | "supabase" | "daily-app-data", paths: string[] }>}
 * @throws if no working backup tool is available or the dump fails.
 */
export async function createPreMigrationBackup({ databaseUrl, repoRoot }) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set; cannot take a pre-migration backup.");
  }

  const outDir = path.join(repoRoot, "backups");
  mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${timestamp}-${deriveLabel(databaseUrl)}`;

  // Dumps must use the session pooler; the transaction pooler (6543) cannot
  // run pg_dump. Same host and credentials, different port.
  const dumpUrl = toSessionPoolerUrl(databaseUrl);

  // 1. Preferred: host pg_dump. It is a true logical backup and does not
  // require Docker, so it is the best full-backup path for end-user machines.
  if (commandAvailable("pg_dump")) {
    const dumpPath = path.join(outDir, `${base}.dump`);
    const tmpPath = `${dumpPath}.partial`;
    removeIfExists(tmpPath);
    const result = spawnSync("pg_dump", [dumpUrl, "-Fc", "-f", tmpPath], {
      stdio: "inherit",
    });
    if (result.status === 0) {
      moveCompletedFile(tmpPath, dumpPath);
      return { tool: "pg_dump", paths: [dumpPath] };
    }
    removeIfExists(tmpPath);
    console.warn("[backup] pg_dump did not complete; trying the next backup method.");
  }

  // 2. Supabase CLI (vendored optional dependency, or on PATH). The CLI
  // runs pg_dump in a container, so only try it when Docker is actually
  // reachable; otherwise we skip straight to the built-in fallback.
  //    Schema and data are dumped separately; together they form a complete
  //    restorable snapshot. Invoked with an argument array (no shell) so the
  //    database URL is never exposed to shell parsing.
  const supabase = resolveSupabaseInvoker(repoRoot);
  if (supabase && dockerDaemonAvailable()) {
    const [cmd, ...lead] = supabase;
    const schemaPath = path.join(outDir, `${base}.schema.sql`);
    const dataPath = path.join(outDir, `${base}.data.sql`);
    const schemaTmpPath = `${schemaPath}.partial`;
    const dataTmpPath = `${dataPath}.partial`;
    removeIfExists(schemaTmpPath);
    removeIfExists(dataTmpPath);
    const schema = spawnSync(
      cmd,
      [...lead, "db", "dump", "--db-url", dumpUrl, "-f", schemaTmpPath],
      { stdio: "inherit" },
    );
    if (schema.status === 0) {
      const data = spawnSync(
        cmd,
        [...lead, "db", "dump", "--db-url", dumpUrl, "--data-only", "-f", dataTmpPath],
        { stdio: "inherit" },
      );
      if (data.status === 0) {
        moveCompletedFile(schemaTmpPath, schemaPath);
        moveCompletedFile(dataTmpPath, dataPath);
        return { tool: "supabase", paths: [schemaPath, dataPath] };
      }
    }
    removeIfExists(schemaTmpPath);
    removeIfExists(dataTmpPath);
    console.warn(
      "[backup] Supabase CLI dump did not complete; using built-in ExecOS app-data backup.",
    );
  } else if (supabase) {
    console.warn(
      "[backup] Supabase CLI backup skipped because Docker is not available; using built-in ExecOS app-data backup.",
    );
  }

  // 3. Built-in fallback: export ExecOS app-owned data through the normal
  // Postgres connection. This is not a full database dump, but it captures
  // the app tables before migration without requiring Docker or pg_dump.
  const appDataPath = path.join(outDir, `${base}.daily-data.json`);
  return createAppDataBackup({ databaseUrl, dumpUrl, backupPath: appDataPath });
}
