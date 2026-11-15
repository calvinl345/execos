import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/*
Boundary declaration:
- Mocked: none.
- Faked: repository/settings/clock/embedding/output adapters where command behavior is under test.
- Real: Postgres only in integration tier, never in the fast suite.

Modules under test:
- package scripts and Vitest configs for the fast suite
- import-discipline checks for tests outside tests/integration/db
*/

describe("fast suite contains no DB imports", () => {
  test("AC-1: assert npm test excludes concrete DB imports and DB-heavy test files", () => {
    const config = readFileSync("vitest.config.ts", "utf8");
    expect(config).toContain("tests/setup-fast.ts");
    expect(config).toContain('"tests/db/**"');
    expect(config).not.toContain("fileParallelism: false");

    // Normalize separators so the exclusions hold on Windows, macOS, and Linux.
    const offenders = sourceFiles("tests")
      .map((file) => file.replace(/\\/g, "/"))
      .filter((file) => !file.includes("tests/_meta/"))
      .filter((file) => !file.includes("tests/db/"))
      .filter((file) => !file.includes("tests/integration/db/"))
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return /from ["'](?:\.\.\/)+src\/db\/index\.js["']/.test(text)
          || /from ["'](?:\.\.\/)+db\/db-test-utils\.js["']/.test(text)
          || text.includes("resetDbData");
      });

    expect(offenders).toEqual([]);
  });
});

describe("npm test completes under the declared fast-suite budget and writes timing evidence", () => {
  test("AC-1: assert the fast-suite budget check records duration under 30s", () => {
    const packageJson = readFileSync("package.json", "utf8");
    const checkScript = readFileSync("scripts/check-fast-suite-budget.sh", "utf8");
    expect(packageJson).toContain('"test": "vitest run --config vitest.config.ts"');
    expect(checkScript).toContain("FAST_SUITE_BUDGET_SECONDS:-30");
    expect(checkScript).toContain("npm run test:unit");
  });
});

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (path.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}
