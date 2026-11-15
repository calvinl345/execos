import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/*
Boundary declaration:
- Mocked: none.
- Faked: source-file assertions only.
- Real: normal automation checks the local DB harness contract without
  connecting to Postgres or running destructive setup.

Modules under test:
- scripts/run-local-db-tests.cjs
- scripts/prepare-local-test-db.ts
- scripts/reset-local-test-data.ts
*/

describe("local DB test harness safety contract", () => {
  test("prepares only a verified local test database before DB suites", () => {
    const script = readFileSync("scripts/run-local-db-tests.cjs", "utf8");

    expect(script).toContain("FORBIDDEN_ENV_FILES");
    expect(script).toContain(".env.production.local");
    expect(script).toContain(".env.development.local");
    expect(script).toContain('env.EXECOS_DB_ENV !== "test"');
    expect(script).toContain("DATABASE_URL host");
    expect(script).toContain("SUPABASE_URL");
    expect(script).toContain("scripts/prepare-local-test-db.ts");
    expect(script).toContain("scripts/migrate.ts");
    expect(script).toContain("preparing local test database with migrations");
    expect(script).toContain("scripts/reset-local-test-data.ts");
  });

  test("prepare step keeps local-only gates before enabling extensions", () => {
    const script = readFileSync("scripts/prepare-local-test-db.ts", "utf8");

    expect(script).toContain("I_UNDERSTAND_THIS_WIPES_AN_ISOLATED_LOCAL_TEST_DATABASE");
    expect(script).toContain('process.env.EXECOS_DB_ENV !== "test"');
    expect(script).toContain("DATABASE_URL host");
    expect(script).toContain("SUPABASE_URL host");
    expect(script).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(script).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  });

  test("cleanup keeps the same local-only destructive-test gates", () => {
    const script = readFileSync("scripts/reset-local-test-data.ts", "utf8");

    expect(script).toContain("I_UNDERSTAND_THIS_WIPES_AN_ISOLATED_LOCAL_TEST_DATABASE");
    expect(script).toContain('process.env.EXECOS_DB_ENV !== "test"');
    expect(script).toContain("DATABASE_URL host");
    expect(script).toContain("SUPABASE_URL host");
    expect(script).toContain("TRUNCATE TABLE");
    expect(script).toContain("seedDefaults");
  });
});
