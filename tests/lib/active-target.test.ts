import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { envKind, readTarget } from "../../scripts/lib/active-target.mjs";

describe("active-target envKind", () => {
  it.each([
    [
      "production",
      { live: "production", sandbox: { active: false, source: null, clonedAt: null } },
      "production",
    ],
    [
      "development",
      { live: "development", sandbox: { active: false, source: null, clonedAt: null } },
      "development",
    ],
    [
      "production sandbox",
      {
        live: "production",
        sandbox: { active: true, source: "production", clonedAt: "2026-06-08T12:00:00.000Z" },
      },
      "production-sandbox",
    ],
    [
      "development sandbox",
      {
        live: "development",
        sandbox: { active: true, source: "development", clonedAt: "2026-06-08T12:00:00.000Z" },
      },
      "development-sandbox",
    ],
  ] as const)("returns %s kind", (_label, state, expected) => {
    expect(envKind(state)).toBe(expected);
  });

  it("defaults missing target state to production", () => {
    const root = mkdtempSync(path.join(tmpdir(), "execos-active-target-"));

    expect(readTarget(root)).toEqual({
      live: "production",
      sandbox: { active: false, source: null, clonedAt: null },
    });
    expect(envKind(readTarget(root))).toBe("production");
  });
});
