import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  setTextInputRuntimeForTests,
  TextInputResolver,
} from "../../src/cli/text-input.js";

let restoreRuntime: (() => void) | undefined;

afterEach(() => {
  restoreRuntime?.();
  restoreRuntime = undefined;
});

describe("TextInputResolver", () => {
  it("returns inline values unchanged", async () => {
    const resolved = await new TextInputResolver().resolve({
      inline: "  keep leading and trailing spaces  ",
      inlineName: "--description",
    });

    expect(resolved).toBe("  keep leading and trailing spaces  ");
  });

  it("reads file values and strips a UTF-8 BOM", async () => {
    const dir = await mkdtemp(join(tmpdir(), "execos-text-input-"));
    try {
      const path = join(dir, "body.txt");
      await writeFile(path, "\uFEFFFile-backed body", "utf8");

      const resolved = await new TextInputResolver().resolve({
        inline: undefined,
        file: path,
        inlineName: "--description",
        fileName: "--description-file",
      });

      expect(resolved).toBe("File-backed body");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads stdin for dash and trims only trailing newlines", async () => {
    restoreRuntime = setTextInputRuntimeForTests({
      readStdinText: async () => "  first line\n\nsecond line\r\n",
      stdinIsTty: () => false,
    });

    const resolved = await new TextInputResolver().resolve({
      inline: "-",
      inlineName: "--content",
    });

    expect(resolved).toBe("  first line\n\nsecond line");
  });

  it("rejects dash when stdin is a TTY", async () => {
    restoreRuntime = setTextInputRuntimeForTests({
      readStdinText: async () => "never read",
      stdinIsTty: () => true,
    });

    await expect(
      new TextInputResolver().resolve({
        inline: "-",
        inlineName: "--description",
      }),
    ).rejects.toThrow(
      '--description - requires piped input; pass --description "text" for inline use.',
    );
  });

  it("rejects conflicting inline and file flags", async () => {
    await expect(
      new TextInputResolver().resolve({
        inline: "inline",
        file: "body.txt",
        inlineName: "--description",
        fileName: "--description-file",
      }),
    ).rejects.toThrow(
      "Cannot use --description and --description-file together; choose one.",
    );
  });

  it("rejects multiple stdin-backed fields in one command", async () => {
    restoreRuntime = setTextInputRuntimeForTests({
      readStdinText: async () => "shared stdin",
      stdinIsTty: () => false,
    });
    const resolver = new TextInputResolver();

    await resolver.resolve({ inline: "-", inlineName: "--description" });

    await expect(
      resolver.resolve({ inline: "-", inlineName: "--note" }),
    ).rejects.toThrow(
      "Cannot read stdin for both --description and --note; pass one value inline or with a file.",
    );
  });
});
