#!/usr/bin/env node

const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

function unquoteEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function stripInlineComment(rawValue) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < rawValue.length; i += 1) {
    const char = rawValue[i];
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      const escaped = i > 0 && rawValue[i - 1] === "\\";
      if (!escaped) inDouble = !inDouble;
      continue;
    }
    if (char === "#" && !inSingle && !inDouble) {
      const previous = i === 0 ? "" : rawValue[i - 1];
      if (i === 0 || /\s/.test(previous)) {
        return rawValue.slice(0, i).trimEnd();
      }
    }
  }
  return rawValue;
}

function readEnvFile(path) {
  const values = {};
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    values[key] = unquoteEnvValue(stripInlineComment(trimmed.slice(eq + 1)));
  }
  return values;
}

const [envFile, command, ...args] = process.argv.slice(2);

if (!envFile || !command) {
  console.error("Usage: node scripts/run-with-env.cjs <env-file> <command> [...args]");
  process.exit(1);
}

const envPath = resolve(process.cwd(), envFile);
if (!existsSync(envPath)) {
  console.error(`Environment file not found: ${envFile}`);
  process.exit(1);
}

const env = {
  ...process.env,
  ...readEnvFile(envPath),
  EXECOS_ENV_FILE: envFile,
};

const result = spawnSync(command, args, {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
