// Vitest global setup. Per-test environment overrides happen via
// /** @vitest-environment jsdom */ comments in test files.
//
// Node 20+ supports env files for scripts, but Vitest does not load them
// automatically. Keep local integration tests self-contained by loading the
// selected EXECOS_ENV_FILE when present. This file is git-safe: it loads
// secrets at runtime from gitignored env files and never prints them.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), process.env.EXECOS_ENV_FILE ?? ".env");

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
}

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = unquoteEnvValue(trimmed.slice(eq + 1));
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

process.env.EXECOS_TEST_EMBEDDINGS = "1";
