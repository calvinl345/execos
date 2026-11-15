import { describe, it, expect } from "vitest";
import { toSessionPoolerUrl } from "../../scripts/lib/supabase-cli.mjs";

describe("toSessionPoolerUrl", () => {
  it("switches the Supabase transaction pooler (6543) to session mode (5432)", () => {
    const tx = "postgresql://postgres.abc:pw@aws-1-us-west-2.pooler.supabase.com:6543/postgres";
    expect(toSessionPoolerUrl(tx)).toBe(
      "postgresql://postgres.abc:pw@aws-1-us-west-2.pooler.supabase.com:5432/postgres",
    );
  });

  it("leaves an already-session pooler URL unchanged", () => {
    const sess = "postgresql://postgres.abc:pw@aws-1-us-west-2.pooler.supabase.com:5432/postgres";
    expect(toSessionPoolerUrl(sess)).toBe(sess);
  });

  it("leaves a non-Supabase URL unchanged", () => {
    const local = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
    expect(toSessionPoolerUrl(local)).toBe(local);
  });

  it("returns the input unchanged when it is not a valid URL", () => {
    expect(toSessionPoolerUrl("not a url")).toBe("not a url");
  });
});
