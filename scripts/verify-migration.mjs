#!/usr/bin/env node
/**
 * Verify pending migrations against the local clone (Phase 2).
 *
 * Operates ONLY on the local Supabase stack (discovered via `supabase
 * status`), never a remote target, so it can never touch prod or dev data.
 * It applies the pending migration(s) to the local clone of real-shaped
 * data and reports exactly what changed, failing if any data was lost.
 *
 * Typical flow:
 *   1. clone dev/prod -> local   (npm run db:clone:dev-to-local)
 *   2. generate the candidate    (npm run db:generate:dev)
 *   3. verify                     (npm run db:verify-migration)
 *
 * Catches dropped tables, deleted rows, AND dropped columns (the rename
 * case a row-count check alone would miss). Exits non-zero on any loss.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { getLocalStatus } from "./lib/supabase-cli.mjs";
import { snapshotPublic, diffSnapshots } from "./lib/db-introspect.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function isLocal(url) {
  try {
    const u = new URL(url);
    return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.port === "54322";
  } catch {
    return false;
  }
}

function pad(value, width) {
  return String(value).padStart(width);
}

async function main() {
  const localUrl = getLocalStatus(repoRoot).DB_URL;
  if (!localUrl || !isLocal(localUrl)) {
    console.error("[verify] Could not resolve the local Supabase DB URL. Start it with `npx supabase start`.");
    process.exit(1);
  }
  console.log(`[verify] target (local only): ${localUrl}`);

  console.log("[verify] snapshot before migration...");
  const before = await snapshotPublic(localUrl);

  console.log("[verify] applying pending migrations to local clone...");
  const migrate = spawnSync(process.execPath, ["--import=tsx", "scripts/migrate.ts", "up"], {
    cwd: repoRoot,
    stdio: "inherit",
    // EXECOS_DB_ENV=test marks this as a disposable target: skips the
    // pre-migration backup while still running the destructive firewall.
    env: { ...process.env, DATABASE_URL: localUrl, EXECOS_DB_ENV: "test" },
  });
  if (migrate.status !== 0) {
    console.error("[verify] migration failed against the local clone (see output above).");
    process.exit(1);
  }

  console.log("[verify] snapshot after migration...");
  const after = await snapshotPublic(localUrl);

  const { rows, problems } = diffSnapshots(before, after);

  console.log("");
  console.log("  table                          before      after    change");
  for (const r of rows) {
    if (r.kind === "added") {
      console.log(`  ${r.table.padEnd(28)}       -  ${pad(r.after, 9)}   (new table)`);
    } else if (r.kind === "dropped") {
      console.log(`  ${r.table.padEnd(28)} ${pad(r.before, 7)}        -   DROPPED`);
    } else {
      const change = r.delta >= 0 ? `+${r.delta}` : String(r.delta);
      const note = r.droppedColumns.length > 0 ? `   dropped cols: ${r.droppedColumns.join(", ")}` : "";
      console.log(`  ${r.table.padEnd(28)} ${pad(r.before, 7)} ${pad(r.after, 10)} ${pad(change, 9)}${note}`);
    }
  }
  console.log("");

  if (problems.length > 0) {
    console.error("[verify] DATA LOSS DETECTED on real-shaped data:");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("[verify] Review the migration. Intentional destruction still requires a .destructive.md acknowledgment.");
    process.exit(1);
  }

  console.log("[verify] OK: the pending migration(s) lost no rows, columns, or tables.");
}

main().catch((err) => {
  console.error(`[verify] ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
