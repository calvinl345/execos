#!/usr/bin/env node
/**
 * Stop hook — architecture enforcement backstop (plan §7.3).
 * Shared by Claude Code (.claude/settings.json) and Codex
 * (.codex/hooks.json); both harnesses use the same Stop event, stdin
 * JSON, and {"decision":"block"} contract.
 *
 * When a turn ends with uncommitted modifications under src/, architecture/,
 * or tests/, run `npm run arch:check`. On failure, block the stop with the
 * failing output so the agent must fix before finishing (never by weakening
 * a rule or check — escalate to Calvin instead).
 *
 * Loop guard: after MAX_BLOCKS consecutive red blocks in one session the
 * hook lets the stop through with a loud escalation message, so an agent
 * that cannot fix the violation does not spin forever.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_BLOCKS = 3;

function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const input = readStdinJson();
// Claude Code sets CLAUDE_PROJECT_DIR; Codex passes cwd on stdin.
const projectDir =
  process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

function relevantChanges() {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: projectDir,
    encoding: "utf8",
  });
  if (result.status !== 0) return true; // cannot tell — err on checking
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .some((line) => {
      const path = line.slice(3).split(" -> ").pop() ?? "";
      return (
        path.startsWith("src/") ||
        path.startsWith("architecture/") ||
        path.startsWith("tests/")
      );
    });
}

const counterFile = join(
  tmpdir(),
  `execos-arch-stop-${input.session_id ?? "default"}.count`,
);

function readCount() {
  try {
    return Number.parseInt(readFileSync(counterFile, "utf8"), 10) || 0;
  } catch {
    return 0;
  }
}

function clearCount() {
  try {
    if (existsSync(counterFile)) unlinkSync(counterFile);
  } catch {
    /* ignore */
  }
}

if (!relevantChanges()) {
  clearCount();
  process.exit(0);
}

const check = spawnSync("npm", ["run", "arch:check"], {
  cwd: projectDir,
  encoding: "utf8",
  shell: true,
  timeout: 540_000,
});

if (check.status === 0) {
  clearCount();
  process.exit(0);
}

const count = readCount() + 1;
try {
  mkdirSync(tmpdir(), { recursive: true });
  writeFileSync(counterFile, String(count), "utf8");
} catch {
  /* ignore */
}

const tail = `${check.stdout ?? ""}\n${check.stderr ?? ""}`.trim().slice(-3000);

if (count >= MAX_BLOCKS) {
  clearCount();
  console.error(
    `arch:check is STILL RED after ${MAX_BLOCKS} blocked attempts. ` +
      "Allowing the stop, but this work violates the architecture constitution. " +
      "ESCALATE TO CALVIN — do not weaken, disable, or delete any rule, check, or exception.\n\n" +
      tail,
  );
  process.exit(0);
}

console.log(
  JSON.stringify({
    decision: "block",
    reason:
      `npm run arch:check failed (blocked stop ${count}/${MAX_BLOCKS}). ` +
      "Fix the work so the architecture checks pass. If you believe a rule itself is wrong, " +
      "stop and escalate to Calvin — never weaken, disable, or delete a rule, check, or exception. " +
      `Failing output:\n${tail}`,
  }),
);
process.exit(0);
