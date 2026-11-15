/**
 * Shared helpers for invoking the vendored Supabase CLI and discovering the
 * local Supabase stack. Used by the Phase 2 clone / verify tooling.
 *
 * The CLI is invoked through its Node launcher with an argument array (no
 * shell) so database URLs are never exposed to shell parsing.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export function commandAvailable(cmd) {
  const probe = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  return !probe.error && probe.status === 0;
}

/**
 * Convert a Supabase connection string to session-pooler mode (port 5432).
 *
 * The "Connect -> ORM" string Supabase hands out is usually the TRANSACTION
 * pooler (port 6543), which is great for the app but cannot run pg_dump or
 * pg_restore: those need session-level state the transaction pooler does not
 * provide. The session pooler uses the same host and credentials on port
 * 5432. Non-Supabase URLs (and already-session URLs) pass through unchanged.
 */
export function toSessionPoolerUrl(connectionString) {
  try {
    const url = new URL(connectionString);
    if (url.hostname.includes("pooler.supabase.com") && url.port === "6543") {
      url.port = "5432";
      return url.toString();
    }
  } catch {
    /* fall through and return the original */
  }
  return connectionString;
}

/** Resolve how to invoke the Supabase CLI as an argv prefix, or null. */
export function resolveSupabaseInvoker(repoRoot) {
  const vendored = path.join(repoRoot, "node_modules", "supabase", "dist", "supabase.js");
  if (existsSync(vendored)) return [process.execPath, vendored];
  if (commandAvailable("supabase")) return ["supabase"];
  return null;
}

/** Run the Supabase CLI. Returns the spawnSync result. */
export function runSupabase(repoRoot, args, opts = {}) {
  const invoker = resolveSupabaseInvoker(repoRoot);
  if (!invoker) {
    throw new Error(
      "Supabase CLI not available. It ships as an optional dependency; run `npm install` to restore it.",
    );
  }
  const [cmd, ...lead] = invoker;
  return spawnSync(cmd, [...lead, ...args], { stdio: "inherit", ...opts });
}

/**
 * Read the local stack's connection info via `supabase status -o env`.
 * Returns a map of the printed KEY=VALUE pairs (e.g. DB_URL). Throws with a
 * clear message if the local stack is not running.
 */
export function getLocalStatus(repoRoot) {
  const result = runSupabase(repoRoot, ["status", "-o", "env"], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      "Local Supabase stack is not running. Start it with `npx supabase start` and retry.",
    );
  }
  const env = {};
  for (const line of String(result.stdout).split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

/**
 * Resolve the local Postgres container name (the stack runs psql inside it,
 * which we use to load dumps without needing psql on the host).
 */
export function getLocalDbContainer() {
  const result = spawnSync(
    "docker",
    ["ps", "--filter", "name=supabase_db_", "--format", "{{.Names}}"],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error("Could not query Docker for the local Supabase database container.");
  }
  const name = String(result.stdout).trim().split(/\r?\n/).filter(Boolean)[0];
  if (!name) {
    throw new Error(
      "No running supabase_db_* container found. Start the local stack with `npx supabase start`.",
    );
  }
  return name;
}

/**
 * Load a SQL file into the local database by piping it through psql running
 * inside the local Postgres container. `stopOnError` controls -v ON_ERROR_STOP.
 */
export function loadSqlIntoLocal(container, sqlText, { stopOnError = true } = {}) {
  const args = ["exec", "-i", container, "psql"];
  // Inside the container the database listens on localhost:5432.
  args.push("postgresql://postgres:postgres@127.0.0.1:5432/postgres");
  if (stopOnError) args.push("-v", "ON_ERROR_STOP=1");
  args.push("-f", "-");
  return spawnSync("docker", args, {
    input: sqlText,
    stdio: ["pipe", "inherit", "inherit"],
  });
}
