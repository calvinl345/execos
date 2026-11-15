import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/*
Boundary declaration:
- Mocked: none.
- Faked: environment variables for gate checks.
- Real: destructive migration bodies only when both explicit gates are set.

Modules under test:
- migration test config
- migration roundtrip script gating
*/

describe("migration suite refuses to run without EXECOS_RUN_DESTRUCTIVE_DB_TESTS=1", () => {
  test("AC-3: assert destructive migration tests refuse to run without explicit opt-in", () => {
    const config = readFileSync("vitest.migration.config.ts", "utf8");
    expect(config).toContain("EXECOS_ALLOW_DESTRUCTIVE_DB_TESTS");
    expect(config).toContain("I_UNDERSTAND_THIS_WIPES_AN_ISOLATED_LOCAL_TEST_DATABASE");
    expect(config).toContain('process.env.EXECOS_RUN_DESTRUCTIVE_DB_TESTS !== "1"');
    expect(config).toContain("Refusing to run destructive migration tests");
    expect(config).toContain("tests/db/migration-roundtrip.test.ts");
  });
});
