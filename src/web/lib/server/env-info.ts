import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EnvInfo, EnvKind } from "../types.js";

export type ActiveProfile = "developer" | "production";

const ENV_KINDS = new Set<EnvKind>([
  "production",
  "development",
  "production-sandbox",
  "development-sandbox",
]);

export function parseEnvKind(value: string | undefined): EnvKind {
  return value && ENV_KINDS.has(value as EnvKind) ? (value as EnvKind) : "production";
}

function nullableEnv(value: string | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

export function supabaseProjectFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname.endsWith(".supabase.co")) {
      return url.hostname.slice(0, -".supabase.co".length) || null;
    }
    return url.hostname || null;
  } catch {
    return null;
  }
}

export function normalizeActiveProfile(value: unknown): ActiveProfile | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "developer" || normalized === "production" ? normalized : null;
}

export function readMaterializedActiveProfile(repoRoot = process.cwd()): ActiveProfile | null {
  const markerProfile = readActiveProfileMarker(repoRoot);
  if (markerProfile) return markerProfile;

  const inferredProfile = inferProfileFromMaterializedSkills(repoRoot);
  if (inferredProfile) return inferredProfile;

  return null;
}

export function buildEnvInfo(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
): EnvInfo {
  const activeProfile =
    normalizeActiveProfile(env.EXECOS_ACTIVE_PROFILE) ?? readMaterializedActiveProfile(repoRoot) ?? "";

  return {
    kind: parseEnvKind(env.EXECOS_ENV_KIND),
    envFile: env.EXECOS_ENV_FILE ?? "",
    activeProfile,
    supabaseProjectName: nullableEnv(env.SUPABASE_PROJECT_NAME) ?? supabaseProjectFromUrl(env.SUPABASE_URL),
    sandboxSource: nullableEnv(env.EXECOS_SANDBOX_SOURCE),
    clonedAt: nullableEnv(env.EXECOS_SANDBOX_CLONED_AT),
  };
}

function readActiveProfileMarker(repoRoot: string): ActiveProfile | null {
  try {
    const raw = readFileSync(join(repoRoot, ".execos", "active-profile.json"), "utf8");
    const parsed = JSON.parse(raw) as { profile?: unknown };
    return normalizeActiveProfile(parsed.profile);
  } catch {
    return null;
  }
}

function inferProfileFromMaterializedSkills(repoRoot: string): ActiveProfile | null {
  const skillsRoot = join(repoRoot, ".agents", "skills");
  const hasDeveloperSkill = existsSync(join(skillsRoot, "dashboard-dev", "SKILL.md"));
  const hasProductionSkill = existsSync(join(skillsRoot, "dashboard-prod", "SKILL.md"));

  if (hasDeveloperSkill && !hasProductionSkill) return "developer";
  if (hasProductionSkill && !hasDeveloperSkill) return "production";
  return null;
}
