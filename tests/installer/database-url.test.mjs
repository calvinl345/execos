import {
  convertDatabaseUrlInput,
  postgresFailureKind,
  supabaseProjectInputToProjectId,
  supabaseProjectInputToUrl,
} from "../../scripts/installer/database-url.mjs";

describe("installer database URL helpers", () => {
  it("accepts project IDs and Supabase project URLs", () => {
    expect(supabaseProjectInputToProjectId("abc123")).toBe("abc123");
    expect(supabaseProjectInputToProjectId("https://abc123.supabase.co/rest/v1")).toBe("abc123");
    expect(supabaseProjectInputToUrl("abc123")).toBe("https://abc123.supabase.co");
  });

  it("preserves valid Supabase ORM Drizzle DATABASE_URL values", () => {
    const pasted = "postgresql://postgres.abc123:p%23@aws-1-us-west-2.pooler.supabase.com:6543/postgres";
    expect(convertDatabaseUrlInput(pasted)).toBe(pasted);
  });

  it("normalizes pasted .env lines and quoted URLs", () => {
    const url = "postgresql://postgres.abc123:p%23@aws-1-us-west-2.pooler.supabase.com:6543/postgres";
    expect(convertDatabaseUrlInput(`DATABASE_URL="${url}"`)).toBe(url);
    expect(convertDatabaseUrlInput(`DATABASE_URL='${url}'`)).toBe(url);
    expect(convertDatabaseUrlInput(`"${url}"`)).toBe(url);
  });

  it("repairs pasted URLs with a raw # in the password", () => {
    expect(
      convertDatabaseUrlInput(
        "postgresql://postgres.abc123:p#word@aws-1-us-west-2.pooler.supabase.com:6543/postgres",
      ),
    ).toBe("postgresql://postgres.abc123:p%23word@aws-1-us-west-2.pooler.supabase.com:6543/postgres");
  });

  it("rejects raw passwords", () => {
    expect(() => convertDatabaseUrlInput("p@ss#word?")).toThrow("full Postgres URI");
  });

  it("rejects unreplaced Supabase password placeholders", () => {
    expect(() => convertDatabaseUrlInput("[YOUR-PASSWORD]")).toThrow("DATABASE_URL");
    expect(() =>
      convertDatabaseUrlInput(
        "postgresql://postgres.abc123:[YOUR-PASSWORD]@aws-1-us-west-2.pooler.supabase.com:6543/postgres",
      ),
    ).toThrow("[YOUR-PASSWORD]");
  });

  it("classifies retryable Postgres failure categories", () => {
    expect(postgresFailureKind("vector: MISSING")).toBe("missing-extensions");
    expect(postgresFailureKind("ECONNREFUSED check pooler region")).toBe("host-or-region");
    expect(postgresFailureKind("28P01 password authentication failed")).toBe("other");
  });
});
