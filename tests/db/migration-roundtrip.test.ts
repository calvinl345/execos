import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { db } from "./db-test-utils.js";

const DESTRUCTIVE_TEST_ACK =
  "I_UNDERSTAND_THIS_WIPES_AN_ISOLATED_LOCAL_TEST_DATABASE";

const REQUIRED_TABLES = [
  "app_settings",
  "document_tasks",
  "documents",
  "goals",
  "memories",
  "task_dependencies",
  "task_activities",
  "task_notes",
  "tasks",
  "team",
  "triage_items",
  "triage_sessions",
] as const;

async function existingRequiredTables(): Promise<string[]> {
  const rows = await db.execute<{ table_name: string } & Record<string, unknown>>(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'app_settings',
        'document_tasks',
        'documents',
        'goals',
        'memories',
        'task_dependencies',
        'task_activities',
        'task_notes',
        'tasks',
        'team',
        'triage_items',
        'triage_sessions'
      )
    ORDER BY table_name
  `);
  return (rows as unknown as Array<{ table_name: string }>).map(
    (r) => r.table_name,
  );
}

function assertMigrationTestDatabaseIsLocal(): void {
  if (process.env.EXECOS_ALLOW_DESTRUCTIVE_DB_TESTS !== DESTRUCTIVE_TEST_ACK) {
    throw new Error("Refusing destructive migration test without explicit acknowledgement.");
  }

  if (process.env.EXECOS_DB_ENV !== "test") {
    throw new Error("Refusing destructive migration test: EXECOS_DB_ENV must be 'test'.");
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("Refusing destructive migration test: DATABASE_URL is not set.");

  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]";
  if (!isLocal) {
    throw new Error(
      `Refusing destructive migration test: DATABASE_URL host '${parsed.hostname}' is not local.`,
    );
  }
}

describe("migration roundtrip", () => {
  it("rolls down then up and restores all required tables", async () => {
    assertMigrationTestDatabaseIsLocal();

    const before = await existingRequiredTables();
    expect(before).toEqual([...REQUIRED_TABLES].sort());

    execFileSync("node", ["--import=tsx", "scripts/migrate.ts", "down"], {
      cwd: process.cwd(),
      stdio: "pipe",
      env: process.env,
    });

    const afterDown = await existingRequiredTables();
    expect(afterDown).toEqual([]);

    execFileSync("node", ["--import=tsx", "scripts/migrate.ts", "up"], {
      cwd: process.cwd(),
      stdio: "pipe",
      env: process.env,
    });

    const afterUp = await existingRequiredTables();
    expect(afterUp).toEqual([...REQUIRED_TABLES].sort());
  }, 30_000);
});
