import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("target help menu", () => {
  it("prints the target, sandbox, and profile switching commands", () => {
    const result = spawnSync(process.execPath, ["scripts/execos-target.mjs", "help"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("ExecOS target and profile help");
    expect(result.stdout).toContain("npm run target:prod");
    expect(result.stdout).toContain("npm run target:dev");
    expect(result.stdout).toContain("npm run target:status");
    expect(result.stdout).toContain("npm run sandbox:start");
    expect(result.stdout).toContain("npm run sandbox:stop");
    expect(result.stdout).toContain(".\\scripts\\apply-profile.ps1 -Profile production");
    expect(result.stdout).toContain("Profile switches prompts and skills.");
    expect(result.stdout).toContain("Target switches the database/env file used by execos commands.");
  });

  it("exposes help aliases in package scripts", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

    expect(packageJson.scripts.target).toBe("node scripts/execos-target.mjs help");
    expect(packageJson.scripts["target:help"]).toBe("node scripts/execos-target.mjs help");
    expect(packageJson.scripts["sandbox:start"]).toBe("node scripts/execos-target.mjs sandbox-start");
  });
});
