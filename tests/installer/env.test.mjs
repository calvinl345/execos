import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertSameDevice,
  backupExistingEnv,
  envFileText,
  readEnvFile,
  validatedStepsFrom,
  writeEnvFile,
  writeEnvFileAtomically,
} from "../../scripts/installer/env.mjs";

describe("installer env helpers", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "execos-installer-env-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes LF env files that round-trip through the repo parser rules", () => {
    const path = join(dir, ".env.production.local");
    writeEnvFile(path, {
      EXECOS_DB_ENV: "production",
      SUPABASE_URL: "https://abc.supabase.co",
      SUPABASE_PROJECT_NAME: "Jordan Production",
      DATABASE_URL: "postgresql://postgres.abc:p@ss#word?x@aws-1-us-west-2.pooler.supabase.com:6543/postgres",
      OPENAI_API_KEY: 'sk-a\\b"c',
    });

    const raw = readFileSync(path, "utf8");
    expect(raw).not.toContain("\r\n");
    expect(readEnvFile(path)).toMatchObject({
      SUPABASE_PROJECT_NAME: "Jordan Production",
      DATABASE_URL: "postgresql://postgres.abc:p@ss#word?x@aws-1-us-west-2.pooler.supabase.com:6543/postgres",
      OPENAI_API_KEY: 'sk-a\\b"c',
    });
  });

  it("writes final env files through a same-directory atomic temp path", () => {
    const path = join(dir, ".env.development.local");
    writeEnvFileAtomically(path, { EXECOS_DB_ENV: "development" });

    expect(readEnvFile(path).EXECOS_DB_ENV).toBe("development");
    assertSameDevice(path, dir);
  });

  it("backs up existing env files with a timestamp", () => {
    const path = join(dir, ".env.production.local");
    writeEnvFile(path, { EXECOS_DB_ENV: "production" });

    const backup = backupExistingEnv(path, new Date("2026-05-05T12:34:56"));

    expect(backup).toBe(`${path}.backup-20260505-123456`);
    expect(readEnvFile(backup).EXECOS_DB_ENV).toBe("production");
  });

  it("serializes validated retry-cache state as an env value", () => {
    const text = envFileText({ EXECOS_INSTALL_VALIDATED_STEPS: "openai,supabase" });

    expect(text).toContain('EXECOS_INSTALL_VALIDATED_STEPS="openai,supabase"');
    expect([...validatedStepsFrom({ EXECOS_INSTALL_VALIDATED_STEPS: "openai,supabase" })]).toEqual([
      "openai",
      "supabase",
    ]);
  });
});
