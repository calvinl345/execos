import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * Structural enforcement of the unified task write funnel (change-008, A7/A13).
 *
 * Layering rule:
 *   - Row-level writes to the `tasks` table belong to src/db/helpers/** only.
 *     No `.insert(tasks)` / `.update(tasks)` / `.delete(tasks)` may appear
 *     anywhere else under src/ (src/db/schema.ts is exempt: it declares the
 *     table, it does not write to it).
 *   - Commands parse input, call ONE service operation, and format its
 *     receipt. They never open transactions: `db.transaction(` is forbidden
 *     anywhere under src/cli/commands/**.
 *
 * Mirrors the append-only scan mechanics (tests/db/append-only-scan.test.ts):
 * a regex grep over every src/**\/*.ts file with a named exemption list.
 * This test is a LOCKED gate; do not weaken it to make it pass.
 */

const TASK_TABLE_WRITE_PATTERN =
  /\.insert\(\s*tasks\s*\)|insert\(\s*tasks\s*\)|\.update\(\s*tasks\s*\)|update\(\s*tasks\s*\)|\.delete\(\s*tasks\s*\)|delete\(\s*tasks\s*\)/;

const COMMAND_TRANSACTION_PATTERN = /db\.transaction\s*\(/;

/**
 * Pre-existing transaction call sites in command families whose write paths
 * are explicitly OUT of change-008's scope (S7 boundary: goal, memory, and
 * resource writes stay on their current paths until goalops/memoryops).
 * This list is a ratchet: it may only shrink. Task-surface commands
 * (task.ts, taskops.ts, review.ts) must never appear here.
 */
const PREEXISTING_TRANSACTION_EXEMPTIONS = new Set([
  join("src", "cli", "commands", "goal.ts"),
  join("src", "cli", "commands", "memory.ts"),
  join("src", "cli", "commands", "resource.ts"),
]);

describe("task write funnel guard", () => {
  it("no .insert(tasks)/.update(tasks)/.delete(tasks) outside src/db/helpers", () => {
    const srcDir = join(process.cwd(), "src");
    if (!existsSync(srcDir)) {
      expect([]).toEqual([]);
      return;
    }

    const helpersDir = `${join("src", "db", "helpers")}${sep}`;
    const files = collectTsFiles(srcDir).filter(
      (file) =>
        !file.includes(helpersDir) &&
        !file.endsWith(join("src", "db", "schema.ts")),
    );

    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (TASK_TABLE_WRITE_PATTERN.test(content)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("no db.transaction( anywhere in src/cli/commands", () => {
    const commandsDir = join(process.cwd(), "src", "cli", "commands");
    if (!existsSync(commandsDir)) {
      expect([]).toEqual([]);
      return;
    }

    const files = collectTsFiles(commandsDir).filter(
      (file) =>
        ![...PREEXISTING_TRANSACTION_EXEMPTIONS].some((exempt) =>
          file.endsWith(exempt),
        ),
    );

    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (COMMAND_TRANSACTION_PATTERN.test(content)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});

function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectTsFiles(full));
    if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}
