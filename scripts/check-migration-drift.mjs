#!/usr/bin/env node
/**
 * Migration drift guard (CLI entry point).
 *
 * Catches the failure mode where someone edits src/db/schema.ts but does
 * not generate and commit the corresponding migration, leaving the
 * committed migrations out of sync with the schema. On the next install
 * the database would silently drift from the code.
 *
 * How it works: drizzle-kit generate is offline (it diffs schema.ts
 * against the committed snapshot in src/db/migrations/meta). We snapshot
 * the migrations folder, run generate, and see whether it wanted to write
 * anything. If it did, the schema has uncaptured changes -> drift -> fail.
 * The working tree is restored byte-for-byte afterwards regardless of
 * outcome, so this check never leaves stray generated files behind and is
 * safe to run from a pre-commit hook.
 *
 * Run by CI, the husky pre-commit hook, and `npm run db:check-drift`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(repoRoot, "src", "db", "migrations");

/** Read every file under `dir` into a Map of absolutePath -> Buffer. */
function snapshot(dir) {
  const map = new Map();
  if (!existsSync(dir)) return map;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else map.set(full, readFileSync(full));
    }
  };
  walk(dir);
  return map;
}

/** Restore the migrations folder to its pre-generate state. */
function restore(before, after) {
  for (const [file] of after) {
    if (!before.has(file)) {
      try {
        rmSync(file);
      } catch {
        /* best effort */
      }
    }
  }
  for (const [file, content] of before) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

const before = snapshot(migrationsDir);

// drizzle.config.ts requires DATABASE_URL to be set even though `generate`
// never connects. Supply a harmless placeholder when one is not present
// (e.g. in CI) so config loading does not throw.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    "postgresql://drift-check:drift-check@127.0.0.1:5432/postgres";
}

const generate = spawnSync(
  process.execPath,
  ["node_modules/drizzle-kit/bin.cjs", "generate"],
  {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 120000,
    env: process.env,
  },
);

const after = snapshot(migrationsDir);
restore(before, after);

const changed = [];
for (const [file, content] of after) {
  if (!before.has(file)) changed.push({ file, kind: "new" });
  else if (!before.get(file).equals(content)) changed.push({ file, kind: "modified" });
}
for (const [file] of before) {
  if (!after.has(file)) changed.push({ file, kind: "removed" });
}

if (generate.status !== 0) {
  console.error("[drift] drizzle-kit generate failed; cannot verify migration drift.");
  if (generate.stdout) console.error(generate.stdout);
  if (generate.stderr) console.error(generate.stderr);
  console.error(
    "[drift] If this is an interactive rename prompt, run `npm run db:generate:dev` manually and commit the result.",
  );
  process.exit(1);
}

if (changed.length === 0) {
  console.log("[drift] OK: committed migrations are in sync with schema.ts.");
  process.exit(0);
}

console.error("");
console.error("MIGRATION DRIFT DETECTED");
console.error("schema.ts has changes that are not captured in a committed migration:");
for (const entry of changed) {
  console.error(`  - ${entry.kind}: ${path.relative(repoRoot, entry.file)}`);
}
console.error("");
console.error(
  "Fix: run `npm run db:generate:dev`, review the generated SQL, then commit schema.ts and the new migration together.",
);
process.exit(1);
