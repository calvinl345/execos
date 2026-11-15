import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/*
Boundary declaration:
- Mocked: none.
- Faked: package-script assertions.
- Real: normal automation must not invoke destructive DB reset tests.

Modules under test:
- package.json test:all orchestration
- destructive DB suite exclusion from normal automation
*/

describe("test:all excludes destructive DB reset tests", () => {
  test("assert test:all runs stateless tests and migration gate only", () => {
    const packageJson = readFileSync("package.json", "utf8");
    expect(packageJson).toContain(
      '"test:all": "npm run test && npm run test:migration:gate"',
    );
    expect(packageJson).toContain('"test:db": "node scripts/refuse-db-tests.cjs"');
  });
});
