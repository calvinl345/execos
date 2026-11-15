import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectDestructiveStatements,
  scanMigrationsForDestructive,
} from "../../scripts/lib/migration-safety.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("detectDestructiveStatements", () => {
  it("flags each data-destroying statement kind", () => {
    const cases = [
      ['DROP TABLE "tasks";', "DROP TABLE"],
      ['ALTER TABLE "tasks" DROP COLUMN "owner";', "DROP COLUMN"],
      ['DROP SCHEMA "public";', "DROP SCHEMA"],
      ['TRUNCATE "tasks";', "TRUNCATE"],
      ['DELETE FROM "tasks";', "DELETE FROM"],
      ['ALTER TABLE "t" ALTER COLUMN "c" SET DATA TYPE text;', "ALTER COLUMN TYPE"],
    ];
    for (const [sql, rule] of cases) {
      const found = detectDestructiveStatements(sql);
      expect(found.map((f) => f.rule)).toContain(rule);
    }
  });

  it("does not flag additive or non-data-bearing statements", () => {
    const safe = [
      'CREATE TABLE "x" ("id" text PRIMARY KEY);',
      'ALTER TABLE "t" ADD COLUMN "c" text;',
      'CREATE VIEW "v" AS (SELECT 1);',
      'DROP VIEW "v";',
      'DROP INDEX "i";',
      'CREATE POLICY "p" ON "t" FOR SELECT TO "anon" USING (true);',
      'ALTER TABLE "t" ENABLE ROW LEVEL SECURITY;',
      'ALTER TABLE "t" ADD CONSTRAINT "c" CHECK (length("x") > 0);',
    ];
    for (const sql of safe) {
      expect(detectDestructiveStatements(sql)).toEqual([]);
    }
  });

  it("ignores destructive keywords inside comments", () => {
    const line = '-- DROP TABLE "tasks";\nCREATE TABLE "y" ("id" text);';
    const block = '/* DROP COLUMN "owner" */ CREATE TABLE "y" ("id" text);';
    expect(detectDestructiveStatements(line)).toEqual([]);
    expect(detectDestructiveStatements(block)).toEqual([]);
  });

  it("detects a destructive statement mixed in with safe ones", () => {
    const sql = [
      'CREATE TABLE "a" ("id" text);--> statement-breakpoint',
      'ALTER TABLE "tasks" DROP COLUMN "owner";--> statement-breakpoint',
      'CREATE INDEX "idx" ON "a" ("id");',
    ].join("\n");
    const found = detectDestructiveStatements(sql);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("DROP COLUMN");
  });
});

describe("scanMigrationsForDestructive", () => {
  let dir;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  function tmpMigrations() {
    dir = mkdtempSync(path.join(tmpdir(), "migsafe-"));
    return dir;
  }

  it("reports a destructive migration with no acknowledgment as a violation", () => {
    const d = tmpMigrations();
    writeFileSync(path.join(d, "0001_drop.sql"), 'ALTER TABLE "tasks" DROP COLUMN "owner";');
    const { violations, acknowledged } = scanMigrationsForDestructive(d);
    expect(acknowledged).toHaveLength(0);
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe("0001_drop.sql");
    expect(violations[0].ackFile).toBe("0001_drop.destructive.md");
  });

  it("treats a non-empty sibling .destructive.md as acknowledgment", () => {
    const d = tmpMigrations();
    writeFileSync(path.join(d, "0001_drop.sql"), 'DROP TABLE "tasks";');
    writeFileSync(path.join(d, "0001_drop.destructive.md"), "Intentional: tasks table retired.");
    const { violations, acknowledged } = scanMigrationsForDestructive(d);
    expect(violations).toHaveLength(0);
    expect(acknowledged).toHaveLength(1);
    expect(acknowledged[0].file).toBe("0001_drop.sql");
  });

  it("does not accept an empty acknowledgment file", () => {
    const d = tmpMigrations();
    writeFileSync(path.join(d, "0001_drop.sql"), 'DROP TABLE "tasks";');
    writeFileSync(path.join(d, "0001_drop.destructive.md"), "   \n  ");
    const { violations } = scanMigrationsForDestructive(d);
    expect(violations).toHaveLength(1);
  });

  it("ignores additive migrations entirely", () => {
    const d = tmpMigrations();
    writeFileSync(path.join(d, "0001_add.sql"), 'ALTER TABLE "tasks" ADD COLUMN "c" text;');
    const { violations, acknowledged } = scanMigrationsForDestructive(d);
    expect(violations).toHaveLength(0);
    expect(acknowledged).toHaveLength(0);
  });

  it("returns empty for a missing migrations directory", () => {
    const { violations, acknowledged } = scanMigrationsForDestructive(
      path.join(tmpdir(), "does-not-exist-migsafe"),
    );
    expect(violations).toEqual([]);
    expect(acknowledged).toEqual([]);
  });

  it("the repo's own committed migrations contain no unacknowledged destruction", () => {
    const migrationsDir = path.resolve(here, "..", "..", "src", "db", "migrations");
    const { violations } = scanMigrationsForDestructive(migrationsDir);
    expect(violations).toEqual([]);
  });
});
