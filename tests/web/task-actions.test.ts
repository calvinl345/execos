import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { postTaskAction } from "../../src/web/lib/utils/task-actions.js";

describe("postTaskAction client helper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns { ok: true, data } on successful 200 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await postTaskAction("KS-123", { action: "complete" });
    expect(result).toEqual({ ok: true, data: { success: true } });
    expect(fetchMock).toHaveBeenCalledWith("/api/task/KS-123", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ action: "complete" }),
    }));
  });

  it("returns { ok: false, status, message } on non-200 response with JSON message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "Invalid transition" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await postTaskAction("KS-123", { action: "complete" });
    expect(result).toEqual({
      ok: false,
      status: 400,
      message: "Invalid transition",
    });
  });

  it("returns statusText on JSON parsing failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => { throw new Error("not json"); },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await postTaskAction("KS-123", { action: "complete" });
    expect(result).toEqual({
      ok: false,
      status: 500,
      message: "Internal Server Error",
    });
  });
});
