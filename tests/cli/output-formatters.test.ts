import { describe, expect, it } from "vitest";
import {
  emit,
  emitError,
  resolveFormat,
  type FormatterContext,
} from "../../src/cli/output-formatters/index.js";

function captureContext(format: "text" | "json"): {
  ctx: FormatterContext;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    ctx: {
      format,
      out: (chunk) => out.push(chunk),
      err: (chunk) => err.push(chunk),
    },
    out,
    err,
  };
}

describe("resolveFormat", () => {
  it("returns the option value when valid", () => {
    expect(resolveFormat("json", undefined)).toBe("json");
    expect(resolveFormat("text", undefined)).toBe("text");
  });

  it("falls back to env when option is empty/undefined", () => {
    expect(resolveFormat(undefined, "json")).toBe("json");
    expect(resolveFormat("", "json")).toBe("json");
  });

  it("falls back to text when both are missing or unknown", () => {
    expect(resolveFormat(undefined, undefined)).toBe("text");
    expect(resolveFormat("yaml", undefined)).toBe("text");
    expect(resolveFormat(undefined, "weird")).toBe("text");
  });

  it("ignores non-string option values", () => {
    expect(resolveFormat(42 as unknown, "json")).toBe("json");
    expect(resolveFormat(null as unknown, undefined)).toBe("text");
  });
});

describe("emit", () => {
  it("writes the text payload with trailing newline in text mode", () => {
    const cap = captureContext("text");
    emit(cap.ctx, { text: () => "hello world", json: () => ({}) });
    expect(cap.out).toEqual(["hello world\n"]);
  });

  it("writes the JSON payload with trailing newline in json mode", () => {
    const cap = captureContext("json");
    emit(cap.ctx, { text: () => "ignored", json: () => ({ ok: true, n: 1 }) });
    expect(cap.out).toEqual(['{"ok":true,"n":1}\n']);
  });

  it("does not invoke the unused renderer", () => {
    const cap = captureContext("text");
    let jsonInvoked = false;
    emit(cap.ctx, {
      text: () => "ok",
      json: () => {
        jsonInvoked = true;
        return {};
      },
    });
    expect(jsonInvoked).toBe(false);
  });
});

describe("emitError", () => {
  it("writes a structured JSON error envelope in json mode", () => {
    const cap = captureContext("json");
    emitError(cap.ctx, {
      category: "task_not_found",
      message: "Task 'KS-999' was not found.",
      exitCode: 21,
      details: { taskId: "KS-999" },
    });
    expect(cap.err).toHaveLength(1);
    const parsed = JSON.parse(cap.err[0]);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.category).toBe("task_not_found");
    expect(parsed.error.details).toEqual({ taskId: "KS-999" });
  });

  it("writes prefixed lines in text mode and indents detail fields", () => {
    const cap = captureContext("text");
    emitError(cap.ctx, {
      category: "input_validation",
      message: "bad",
      exitCode: 11,
      details: { field: "title", got: "" },
    });
    expect(cap.err.some((c) => c.startsWith("error (input_validation): bad"))).toBe(true);
    expect(cap.err.some((c) => c.includes("field: title"))).toBe(true);
    expect(cap.err.some((c) => c.includes("got:"))).toBe(true);
  });

  it("omits details block when not provided", () => {
    const cap = captureContext("text");
    emitError(cap.ctx, {
      category: "unhandled",
      message: "boom",
      exitCode: 1,
    });
    expect(cap.err.length).toBe(1);
  });
});
