import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const scripts = ["scripts/install.sh", "scripts/bootstrap.sh", "scripts/update.sh"];

describe("Linux installer shell wrappers", () => {
  it("use strict Bash mode", () => {
    for (const script of scripts) {
      const text = readFileSync(script, "utf8");
      expect(text).toMatch(/^#!\/usr\/bin\/env bash\nset -euo pipefail\n/);
    }
  });

  it("pass bash syntax checks when bash is available", () => {
    const bashCheck = spawnSync("bash", ["--version"], { encoding: "utf8" });
    if (bashCheck.error || bashCheck.status !== 0) return;

    for (const script of scripts) {
      const result = spawnSync("bash", ["-n", script], { cwd: process.cwd(), encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    }
  });

  it("passes ShellCheck on Linux CI when shellcheck is installed", () => {
    if (process.platform === "win32") return;
    const shellcheck = spawnSync("shellcheck", ["--version"], { encoding: "utf8" });
    expect(shellcheck.error, "Install shellcheck in Linux CI to enforce installer shell hygiene.").toBeUndefined();

    const result = spawnSync("shellcheck", scripts, { cwd: process.cwd(), encoding: "utf8" });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("includes concrete Node 20 install hints", () => {
    const text = readFileSync("scripts/install.sh", "utf8");
    expect(text).toContain("https://deb.nodesource.com/setup_20.x");
    expect(text).toContain("nvm install 20");
    expect(text).toContain("fnm install 20");
  });

  it("keeps Linux credential prompts visible for pasted secrets", () => {
    const text = readFileSync("scripts/installer/run.mjs", "utf8");
    expect(text).toContain("Input is visible while you type");
    expect(text).not.toContain("Input is hidden while you type");
  });
});
