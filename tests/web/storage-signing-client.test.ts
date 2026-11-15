import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

describe("document storage signed URLs", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.createClient.mockReset();
    mocks.from.mockReset();
    mocks.createSignedUrl.mockReset();

    process.env.SUPABASE_URL = "https://example.supabase.co/rest/v1";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";

    mocks.from.mockReturnValue({ createSignedUrl: mocks.createSignedUrl });
    mocks.createClient.mockReturnValue({ storage: { from: mocks.from } });
  });

  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.restoreAllMocks();
  });

  it("creates private document download URLs with the server service-role client", async () => {
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://example.supabase.co/signed/document.pdf" },
      error: null,
    });

    const { createDocumentSignedUrl } = await import("../../src/db/storage-signing-client.js");
    const signedUrl = await createDocumentSignedUrl(
      "business/2026-05-12/DOC-abc-document.pdf",
      "document.pdf",
      120,
    );

    expect(signedUrl).toBe("https://example.supabase.co/signed/document.pdf");
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-role-secret",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
    expect(mocks.from).toHaveBeenCalledWith("documents");
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(
      "business/2026-05-12/DOC-abc-document.pdf",
      120,
      { download: "document.pdf" },
    );
  });

  it("returns null when Supabase refuses to sign the download", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "row-level security policy denied access" },
    });

    const { createDocumentSignedUrl } = await import("../../src/db/storage-signing-client.js");
    const signedUrl = await createDocumentSignedUrl(
      "personal/2026-05-12/DOC-abc-private.pdf",
      "private.pdf",
    );

    expect(signedUrl).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[resources] could not sign document download: row-level security policy denied access",
    );
  });
});
