import { describe, expect, it } from "vitest";
import {
  composeStoragePath,
  inferMimeType,
  sanitizeStorageFilename,
} from "../../src/cli/commands/resource.js";

describe("resource command helpers", () => {
  it("sanitizes filenames for stable Supabase storage paths", () => {
    expect(sanitizeStorageFilename("My Contract v1.final.pdf")).toBe(
      "My-Contract-v1.final.pdf",
    );
    expect(sanitizeStorageFilename("???")).toBe("document");
  });

  it("composes category/date/document based storage paths", () => {
    expect(
      composeStoragePath(
        "client",
        "DOC-abc123",
        "MSA draft.pdf",
        new Date("2026-04-30T12:00:00.000Z"),
      ),
    ).toBe("client/2026-04-30/DOC-abc123-MSA-draft.pdf");
  });

  it("infers common document MIME types", () => {
    expect(inferMimeType("notes.txt")).toBe("text/plain");
    expect(inferMimeType("contract.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(inferMimeType("archive.bin")).toBeNull();
  });
});
