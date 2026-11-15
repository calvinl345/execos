import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readTarget,
  activeEnvFile,
  describeTarget,
  assertSandboxEnvIsLocal,
} from "../../scripts/lib/active-target.mjs";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("execos active-target library", () => {
  it("readTarget returns freshState when no file exists", () => {
    const root = mkdtempSync(join(tmpdir(), "execos-target-"));
    tempRoots.push(root);

    const target = readTarget(root);
    expect(target).toEqual({
      live: "production",
      sandbox: {
        active: false,
        source: null,
        clonedAt: null,
      },
    });
  });

  it("activeEnvFile returns expected file for live prod/dev and active sandbox", () => {
    const stateProd = { live: "production" as const, sandbox: { active: false, source: null, clonedAt: null } };
    const stateDev = { live: "development" as const, sandbox: { active: false, source: null, clonedAt: null } };
    const stateSandbox = { live: "production" as const, sandbox: { active: true, source: "production", clonedAt: "2026-06-05 12:00" } };

    expect(activeEnvFile(stateProd)).toBe(".env.production.local");
    expect(activeEnvFile(stateDev)).toBe(".env.development.local");
    expect(activeEnvFile(stateSandbox)).toBe(".env.local.local");
  });

  it("describeTarget returns expected labels", () => {
    const stateProd = { live: "production" as const, sandbox: { active: false, source: null, clonedAt: null } };
    const stateDev = { live: "development" as const, sandbox: { active: false, source: null, clonedAt: null } };
    const stateSandbox = { live: "production" as const, sandbox: { active: true, source: "production", clonedAt: "2026-06-05 12:00" } };
    const stateSandboxNoDetails = { live: "production" as const, sandbox: { active: true, source: null, clonedAt: null } };

    expect(describeTarget(stateProd)).toBe("LIVE PRODUCTION");
    expect(describeTarget(stateDev)).toBe("LIVE development");
    expect(describeTarget(stateSandbox)).toBe("SANDBOX (clone of production, cloned 2026-06-05 12:00)");
    expect(describeTarget(stateSandboxNoDetails)).toBe("SANDBOX (clone of ?)");
  });

  it("assertSandboxEnvIsLocal checks DATABASE_URL and SUPABASE_URL", () => {
    const validEnv = {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:54322/postgres",
      SUPABASE_URL: "http://127.0.0.1:54321",
    };

    expect(() => assertSandboxEnvIsLocal(validEnv)).not.toThrow();

    const invalidDbEnv = {
      DATABASE_URL: "postgresql://postgres:postgres@remotehost:54322/postgres",
      SUPABASE_URL: "http://127.0.0.1:54321",
    };

    expect(() => assertSandboxEnvIsLocal(invalidDbEnv)).toThrow(/Sandbox guard: DATABASE_URL must point at localhost/);

    const invalidSupaEnv = {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:54322/postgres",
      SUPABASE_URL: "https://abc123.supabase.co",
    };

    expect(() => assertSandboxEnvIsLocal(invalidSupaEnv)).toThrow(/Sandbox guard: SUPABASE_URL must point at localhost/);
  });

  it("package.json only has execos bin", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    expect(packageJson.bin).toEqual({
      execos: "./scripts/execos.mjs",
    });
  });
});
