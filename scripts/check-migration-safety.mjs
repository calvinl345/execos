#!/usr/bin/env node
/**
 * Destructive-migration firewall (CLI entry point).
 *
 * Fails (exit 1) if any committed migration contains data-destroying SQL
 * without an accompanying `<migration>.destructive.md` acknowledgment file.
 * Run by CI, the husky pre-commit hook, and `npm run db:check-safety`.
 *
 * See scripts/lib/migration-safety.mjs for the rules and rationale.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanMigrationsForDestructive } from "./lib/migration-safety.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(repoRoot, "src", "db", "migrations");

const { violations, acknowledged } = scanMigrationsForDestructive(migrationsDir);

for (const ack of acknowledged) {
  console.log(`[safety] acknowledged destructive migration: ${ack.file} (see ${ack.ackFile})`);
}

if (violations.length === 0) {
  console.log("[safety] OK: no unacknowledged destructive migrations.");
  process.exit(0);
}

console.error("");
console.error("DESTRUCTIVE MIGRATION BLOCKED");
console.error(
  "The following migration(s) contain data-destroying statements with no acknowledgment file:",
);
for (const violation of violations) {
  console.error(`\n  ${violation.file}`);
  for (const statement of violation.statements) {
    console.error(`    - ${statement.rule}: ${statement.statement}`);
  }
  const ackRelative = path.join("src", "db", "migrations", violation.ackFile);
  console.error(
    `    If INTENTIONAL: create ${ackRelative} explaining what data is removed and why, then commit it.`,
  );
  console.error(
    "    If NOT intentional (e.g. a column rename emitted as DROP + ADD): revise schema.ts and regenerate.",
  );
}
console.error("");
process.exit(1);
