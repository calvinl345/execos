import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const TARGET_FILE = ".execos-target.json";
export const LIVE_ENV_FILES = {
  development: ".env.development.local",
  production: ".env.production.local",
};
export const SANDBOX_ENV_FILE = ".env.local.local";

function freshState() {
  return { live: "production", sandbox: { active: false, source: null, clonedAt: null } };
}

export function targetPath(repoRoot) {
  return path.join(repoRoot, TARGET_FILE);
}

export function readTarget(repoRoot) {
  const p = targetPath(repoRoot);
  if (!existsSync(p)) return freshState();
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return {
      live: parsed.live === "development" ? "development" : "production",
      sandbox: {
        active: Boolean(parsed.sandbox?.active),
        source: parsed.sandbox?.source ?? null,
        clonedAt: parsed.sandbox?.clonedAt ?? null,
      },
    };
  } catch {
    return freshState();
  }
}

export function writeTarget(repoRoot, state) {
  writeFileSync(targetPath(repoRoot), `${JSON.stringify(state, null, 2)}\n`);
}

export function activeEnvFile(state) {
  return state.sandbox.active ? SANDBOX_ENV_FILE : LIVE_ENV_FILES[state.live];
}

/**
 * @param {{ live: "production" | "development", sandbox: { active: boolean } }} state
 * @returns {"production" | "development" | "production-sandbox" | "development-sandbox"}
 */
export function envKind(state) {
  if (state.sandbox.active) {
    return state.live === "production" ? "production-sandbox" : "development-sandbox";
  }
  return state.live;
}

export function describeTarget(state) {
  if (state.sandbox.active) {
    const when = state.sandbox.clonedAt ? `, cloned ${state.sandbox.clonedAt}` : "";
    return `SANDBOX (clone of ${state.sandbox.source ?? "?"}${when})`;
  }
  return state.live === "production" ? "LIVE PRODUCTION" : "LIVE development";
}

export function isLocalUrl(url) {
  try {
    const u = new URL(url);
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

// Foolproof guard: when sandbox is active the loaded env MUST be localhost.
export function assertSandboxEnvIsLocal(env) {
  for (const key of ["DATABASE_URL", "SUPABASE_URL"]) {
    const value = env[key];
    if (!value || !isLocalUrl(value)) {
      throw new Error(
        `Sandbox guard: ${key} must point at localhost, got '${value ?? "(unset)"}'. Refusing to run.`,
      );
    }
  }
}
