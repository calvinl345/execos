import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildEnvInfo,
  normalizeActiveProfile,
  readMaterializedActiveProfile,
  supabaseProjectFromUrl,
} from "../../src/web/lib/server/env-info.js";

describe("dashboard environment info", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "execos-env-info-"));
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("reads the active profile from the materialized marker instead of the database environment", () => {
    writeMarker("developer");

    const envInfo = buildEnvInfo(
      {
        EXECOS_DB_ENV: "production",
        EXECOS_ENV_KIND: "development",
        EXECOS_ENV_FILE: ".env.production.local",
        SUPABASE_PROJECT_NAME: "execos-dev",
      },
      repo,
    );

    expect(envInfo.activeProfile).toBe("developer");
    expect(envInfo.kind).toBe("development");
    expect(envInfo.envFile).toBe(".env.production.local");
    expect(envInfo.supabaseProjectName).toBe("execos-dev");
  });

  it("infers the active profile from materialized developer skills when no marker exists", () => {
    writeSkill("dashboard-dev");

    expect(readMaterializedActiveProfile(repo)).toBe("developer");
    expect(buildEnvInfo({ EXECOS_DB_ENV: "production" }, repo).activeProfile).toBe("developer");
  });

  it("infers the active profile from materialized production skills when no marker exists", () => {
    writeSkill("dashboard-prod");

    expect(readMaterializedActiveProfile(repo)).toBe("production");
  });

  it("lets an explicit active profile env var override local materialized state", () => {
    writeMarker("developer");

    expect(buildEnvInfo({ EXECOS_ACTIVE_PROFILE: "production" }, repo).activeProfile).toBe("production");
  });

  it("does not treat EXECOS_DB_ENV as a profile fallback", () => {
    expect(buildEnvInfo({ EXECOS_DB_ENV: "production" }, repo).activeProfile).toBe("");
  });

  it("normalizes valid profile labels and ignores unknown values", () => {
    expect(normalizeActiveProfile("Developer")).toBe("developer");
    expect(normalizeActiveProfile(" production ")).toBe("production");
    expect(normalizeActiveProfile("development")).toBeNull();
  });

  it("extracts the Supabase project name from the URL when no explicit name exists", () => {
    expect(supabaseProjectFromUrl("https://abc123.supabase.co")).toBe("abc123");
    expect(supabaseProjectFromUrl("not a url")).toBeNull();
  });

  function writeMarker(profile: string): void {
    mkdirSync(join(repo, ".execos"), { recursive: true });
    writeFileSync(join(repo, ".execos", "active-profile.json"), `${JSON.stringify({ profile })}\n`);
  }

  function writeSkill(skill: string): void {
    mkdirSync(join(repo, ".agents", "skills", skill), { recursive: true });
    writeFileSync(join(repo, ".agents", "skills", skill, "SKILL.md"), `${skill}\n`);
  }
});
