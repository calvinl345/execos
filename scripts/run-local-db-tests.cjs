#!/usr/bin/env node

const { existsSync, readFileSync } = require("node:fs");
const { basename, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const DESTRUCTIVE_ACK = "I_UNDERSTAND_THIS_WIPES_AN_ISOLATED_LOCAL_TEST_DATABASE";
const DEFAULT_ENV_FILE = ".env.test.local";
const FORBIDDEN_ENV_FILES = new Set([
  ".env",
  ".env.local",
  ".env.development.local",
  ".env.production.local",
]);

function unquoteEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
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
    const value = unquoteEnvValue(trimmed.slice(eq + 1));
    values[key] = value;
  }
  return values;
}

function isLocalHost(rawUrl) {
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}

function assertLocalTestUrl(env, key) {
  if (!env[key]) return;
  if (!isLocalHost(env[key])) {
    const parsed = new URL(env[key]);
    throw new Error(
      `Refusing destructive DB tests: ${key} host '${parsed.hostname}' is not local.`,
    );
  }
}

function assertSafeEnvFile(envFile) {
  const fileName = basename(envFile).toLowerCase();
  if (FORBIDDEN_ENV_FILES.has(fileName)) {
    throw new Error(
      `Refusing destructive DB tests: ${fileName} is an application env file, not a disposable test env file.`,
    );
  }
}

function assertLocalTestDatabase(env, envFile) {
  assertSafeEnvFile(envFile);

  if (env.EXECOS_DB_ENV !== "test") {
    throw new Error(
      "Refusing destructive DB tests: EXECOS_DB_ENV must be 'test' in .env.test.local.",
    );
  }

  if (!env.DATABASE_URL) {
    throw new Error("Refusing destructive DB tests: DATABASE_URL is not set.");
  }

  if (!isLocalHost(env.DATABASE_URL)) {
    const parsed = new URL(env.DATABASE_URL);
    throw new Error(
      `Refusing destructive DB tests: DATABASE_URL host '${parsed.hostname}' is not local.`,
    );
  }

  assertLocalTestUrl(env, "SUPABASE_URL");
}

function runStep(label, args, env) {
  console.log(`[local-db-tests] ${label}...`);
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

const suite = process.argv[2];
const configBySuite = {
  db: "vitest.db.config.ts",
  migration: "vitest.migration.config.ts",
};

if (!configBySuite[suite]) {
  console.error("Usage: node scripts/run-local-db-tests.cjs <db|migration>");
  process.exit(1);
}

const envFile = process.env.EXECOS_TEST_ENV_FILE || DEFAULT_ENV_FILE;
const envPath = resolve(process.cwd(), envFile);

if (!existsSync(envPath)) {
  console.error(`Refusing destructive DB tests: ${envFile} does not exist.`);
  console.error("Copy .env.test.example to .env.test.local and point it at local test infrastructure.");
  process.exit(1);
}

const env = {
  ...process.env,
  ...readEnvFile(envPath),
  EXECOS_ENV_FILE: envFile,
  EXECOS_ALLOW_DESTRUCTIVE_DB_TESTS: DESTRUCTIVE_ACK,
};

if (suite === "migration") {
  env.EXECOS_RUN_DESTRUCTIVE_DB_TESTS = "1";
}

try {
  assertLocalTestDatabase(env, envFile);
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}

(async () => {
  const postgres = require("postgres");
  const sql = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try {
    await sql`SELECT 1`;
    await sql.end();
  } catch (err) {
    console.error("Local Supabase stack is not running. Start it with `npx supabase start`, then `npm run sandbox` to load data.");
    process.exit(1);
  }

  const vitest = resolve(process.cwd(), "node_modules", "vitest", "vitest.mjs");

  const prepareStatus = runStep(
    "preparing local test database extensions",
    ["--import=tsx", "scripts/prepare-local-test-db.ts"],
    env,
  );
  if (prepareStatus !== 0) {
    process.exit(prepareStatus);
  }

  const migrateStatus = runStep(
    "preparing local test database with migrations",
    ["--import=tsx", "scripts/migrate.ts", "up"],
    env,
  );
  if (migrateStatus !== 0) {
    process.exit(migrateStatus);
  }

  const testStatus = runStep(
    `running ${suite} suite against verified local test database`,
    [vitest, "run", "--config", configBySuite[suite]],
    env,
  );

  const cleanupSteps = [];
  if (suite === "migration") {
    cleanupSteps.push([
      "restoring local test database schema after migration suite",
      ["--import=tsx", "scripts/migrate.ts", "up"],
    ]);
  }
  cleanupSteps.push([
    "cleaning local test data",
    ["--import=tsx", "scripts/reset-local-test-data.ts"],
  ]);

  let cleanupStatus = 0;
  for (const [label, args] of cleanupSteps) {
    const status = runStep(label, args, env);
    if (status !== 0 && cleanupStatus === 0) cleanupStatus = status;
  }

  process.exit(testStatus || cleanupStatus);
})().catch((err) => {
  console.error("Unexpected error in local db tests:", err);
  process.exit(1);
});
