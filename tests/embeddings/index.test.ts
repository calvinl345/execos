import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_DIMENSION,
  EMBEDDING_PROVIDER,
  embed,
  resetDimensionVerificationForTest,
  verifyDimensionAtBoot,
} from "../../src/embeddings/index.js";

describe("embeddings adapter", () => {
  beforeEach(() => {
    resetDimensionVerificationForTest();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports the locked provider and returns validated vectors through the single adapter", async () => {
    expect(EMBEDDING_PROVIDER).toBe("openai");
    const vector = await embed("same text");
    expect(vector).toHaveLength(EMBEDDING_DIMENSION);
    expect(vector.some((v) => v !== 0)).toBe(true);
  });

  it("caches dimension verification once per process", async () => {
    const readDbDimension = vi.fn(async () => EMBEDDING_DIMENSION);
    const probeEmbed = vi.fn(async () => Array.from({ length: EMBEDDING_DIMENSION }, () => 0.1));

    await verifyDimensionAtBoot({ readDbDimension, probeEmbed });
    await verifyDimensionAtBoot({ readDbDimension, probeEmbed });

    expect(readDbDimension).toHaveBeenCalledTimes(1);
    expect(probeEmbed).toHaveBeenCalledTimes(1);
  });

  it("passes an abort signal and reports deterministic embedding timeouts", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    const pending = embed("timeout please", {
      apiKey: "test-key",
      fetchFn: fetchFn as typeof fetch,
      timeoutMs: 25,
    });

    const expectation = expect(pending).rejects.toThrow(
      "OpenAI embedding request timed out after 25ms.",
    );

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(25);
    await expectation;
    expect(signal?.aborted).toBe(true);
  });

  it("fails fast on DB/code dimension mismatch", async () => {
    await expect(
      verifyDimensionAtBoot({
        readDbDimension: async () => 1536,
        probeEmbed: async () => Array.from({ length: EMBEDDING_DIMENSION }, () => 0.1),
        force: true,
      }),
    ).rejects.toThrow(/Embedding dimension mismatch: code expects 3072, DB has 1536/);
  });
});
