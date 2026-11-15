#!/usr/bin/env node
/**
 * Clone a source database into the local Supabase stack (Phase 2 staging).
 *
 * Source is whatever DATABASE_URL points at, so:
 *   node scripts/run-with-env.cjs .env.development.local node scripts/clone-to-local.mjs
 * clones DEV -> local. The exact same command with .env.production.local
 * clones PROD -> local once you have prod access (a one-line re-point).
 *
 * Flow:
 *   1. Discover the local stack (DB URL + Postgres container).
 *   2. Dump the source schema and data (public + drizzle, so the Drizzle
 *      migration history travels with it and a later `migrate up` applies
 *      only genuinely-pending migrations).
 *   3. Reset the local public/drizzle schemas.
 *   4. Load schema then data into local via psql inside the container.
 *   5. Verify fidelity: per-table row counts in local must match source.
 *      This doubles as the backup-to-restore drill (clone == dump + restore).
 *
 * The local stack is disposable; this script only ever WRITES to local and
 * only READS from the source.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, mkdirSync } from "node:fs";
import postgres from "postgres";
import {
  runSupabase,
  getLocalStatus,
  getLocalDbContainer,
  loadSqlIntoLocal,
  toSessionPoolerUrl,
} from "./lib/supabase-cli.mjs";
import { snapshotPublic } from "./lib/db-introspect.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`[clone] ERROR: ${message}`);
  process.exit(1);
}

function isLocalUrl(url) {
  try {
    const u = new URL(url);
    return (
      (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.port === "54322"
    );
  } catch {
    return false;
  }
}

async function schemaExists(connectionString, name) {
  const sql = postgres(connectionString, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const rows = await sql`SELECT 1 FROM information_schema.schemata WHERE schema_name = ${name}`;
    return rows.length > 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function resetLocal(localUrl) {
  const sql = postgres(localUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    // Drop the app schemas, then ensure the extensions the source dump
    // references (Supabase qualifies the embedding type as
    // "extensions"."vector") exist in the "extensions" schema before load.
    await sql.unsafe(
      [
        "DROP SCHEMA IF EXISTS public CASCADE;",
        "DROP SCHEMA IF EXISTS drizzle CASCADE;",
        "CREATE SCHEMA public;",
        "CREATE SCHEMA IF NOT EXISTS extensions;",
        "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;",
        "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;",
      ].join("\n"),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const source = process.env.DATABASE_URL;
  if (!source) fail("DATABASE_URL is not set. Run via scripts/run-with-env.cjs with an env file.");
  if (isLocalUrl(source)) fail("DATABASE_URL points at the local stack; refusing to clone local into itself.");

  // Dumps must use the session pooler (5432), not the transaction pooler (6543).
  const dumpSource = toSessionPoolerUrl(source);
  if (dumpSource !== source) console.log("[clone] using session pooler (5432) for the dump.");

  console.log("[clone] discovering local Supabase stack...");
  const localUrl = getLocalStatus(repoRoot).DB_URL;
  if (!localUrl) fail("Could not read the local DB URL from `supabase status`.");
  const container = getLocalDbContainer();
  console.log(`[clone] local DB: ${localUrl}`);
  console.log(`[clone] local container: ${container}`);

  // Dump public, and the drizzle migration-history schema if the source has
  // one (so a later verify applies only genuinely-pending migrations).
  const schemas = ["public"];
  if (await schemaExists(dumpSource, "drizzle")) schemas.push("drizzle");
  const schemaArgs = schemas.flatMap((s) => ["--schema", s]);
  console.log(`[clone] schemas to clone: ${schemas.join(", ")}`);

  const outDir = path.join(repoRoot, "backups");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const schemaPath = path.join(outDir, `clone-${stamp}.schema.sql`);
  const dataPath = path.join(outDir, `clone-${stamp}.data.sql`);

  console.log("[clone] dumping source schema...");
  if (runSupabase(repoRoot, ["db", "dump", "--db-url", dumpSource, ...schemaArgs, "-f", schemaPath]).status !== 0) {
    fail("source schema dump failed.");
  }
  console.log("[clone] dumping source data...");
  if (runSupabase(repoRoot, ["db", "dump", "--db-url", dumpSource, "--data-only", ...schemaArgs, "-f", dataPath]).status !== 0) {
    fail("source data dump failed.");
  }

  // 2. Reset local and load schema then data.
  console.log("[clone] resetting local schemas...");
  await resetLocal(localUrl);

  console.log("[clone] loading schema into local...");
  if (loadSqlIntoLocal(container, readFileSync(schemaPath, "utf8")).status !== 0) {
    fail("loading schema into local failed.");
  }
  console.log("[clone] loading data into local...");
  // Disable FK/trigger enforcement during the COPY so table load order and
  // circular references cannot fail the import (pg_dump --data-only hints at
  // this). Requires superuser, which the local postgres role is.
  const dataSql = `SET session_replication_role = replica;\n${readFileSync(dataPath, "utf8")}`;
  if (loadSqlIntoLocal(container, dataSql).status !== 0) {
    fail("loading data into local failed.");
  }

  // 3. Verify fidelity (and serve as the restore drill).
  console.log("[clone] verifying row counts (source vs local)...");
  const sourceSnap = await snapshotPublic(dumpSource);
  const localSnap = await snapshotPublic(localUrl);

  const tables = [...new Set([...Object.keys(sourceSnap), ...Object.keys(localSnap)])].sort();
  let mismatches = 0;
  console.log("");
  console.log("  table                         source     local");
  for (const t of tables) {
    const s = sourceSnap[t]?.rows ?? "-";
    const l = localSnap[t]?.rows ?? "-";
    const flag = s !== l ? "  <-- MISMATCH" : "";
    if (s !== l) mismatches += 1;
    console.log(`  ${t.padEnd(28)} ${String(s).padStart(7)} ${String(l).padStart(9)}${flag}`);
  }
  console.log("");

  if (mismatches > 0) {
    fail(`${mismatches} table(s) did not match between source and local clone. The clone is not faithful.`);
  }

  console.log("[clone] OK: local is a faithful clone of the source.");
  console.log(`[clone] Studio: http://127.0.0.1:54323`);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
