#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readEnvFile } from "./installer/env.mjs";
import {
  readTarget,
  activeEnvFile,
  describeTarget,
  envKind,
  assertSandboxEnvIsLocal,
} from "./lib/active-target.mjs";

const launcherPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(launcherPath), "..");

function banner(state) {
  const label = describeTarget(state);
  const color = state.sandbox.active
    ? "\x1b[42m\x1b[30m" // green bg: sandbox = safe
    : state.live === "production"
      ? "\x1b[41m\x1b[37m" // red bg: live production = careful
      : "\x1b[100m\x1b[37m"; // grey bg: live dev
  return `${color} ${label} \x1b[0m`;
}

export async function runExecosLauncher(argv = process.argv.slice(2), root = repoRoot) {
  const state = readTarget(root);
  const envFileName = activeEnvFile(state);
  const envPath = resolve(root, envFileName);
  // Help needs no database, so it works on a fresh clone with no env file yet.
  const helpOnly = argv.length === 0 || argv.includes("--help") || argv.includes("-h");
  if (!existsSync(envPath) && helpOnly) {
    process.stderr.write(
      `No environment file yet (${envFileName}); showing help only. Run the installer to configure ExecOS.\n`,
    );
    return runCli(argv, root);
  }
  if (!existsSync(envPath)) {
    throw new Error(
      `Environment file not found: ${envFileName}. ` +
        (state.sandbox.active
          ? "Run `npm run sandbox` to (re)create the sandbox."
          : "Run the installer, or switch target with `npm run target:prod` / `npm run target:dev`."),
    );
  }

  Object.assign(process.env, readEnvFile(envPath), {
    EXECOS_ENV_FILE: envFileName,
    EXECOS_ENV_KIND: envKind(state),
  });

  if (state.sandbox.active) {
    process.env.EXECOS_SANDBOX_SOURCE = state.sandbox.source ?? "";
    process.env.EXECOS_SANDBOX_CLONED_AT = state.sandbox.clonedAt ?? "";
    assertSandboxEnvIsLocal(process.env); // cannot run against a remote in sandbox mode
  }

  process.env.EXECOS_TARGET_LABEL = describeTarget(state);
  // EXECOS_DEMO_MODE=1 hides the target banner for clean screenshots and recordings.
  if (process.env.EXECOS_DEMO_MODE !== "1") process.stderr.write(`${banner(state)}\n`);

  return runCli(argv, root);
}

async function runCli(argv, root) {
  await import("tsx/esm");
  const entrypoint = resolve(root, "src", "cli", "index.ts");
  if (!existsSync(entrypoint)) {
    throw new Error(`CLI entrypoint not found: ${entrypoint}`);
  }
  const { main } = await import(pathToFileURL(entrypoint).href);
  if (typeof main !== "function") {
    throw new Error(`CLI entrypoint does not export main(): ${entrypoint}`);
  }
  return main([process.execPath, "execos", ...argv]);
}

export function isDirectInvocation(metaUrl = import.meta.url) {
  const current = resolve(fileURLToPath(metaUrl));
  const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
  return current === invoked;
}
