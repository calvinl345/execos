import { eq } from "drizzle-orm";

export const EMBEDDING_PROVIDER = "openai" as const;
export const EMBEDDING_MODEL = "text-embedding-3-large" as const;
export const EMBEDDING_DIMENSION = 3072;

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const DIMENSION_CHECK_INPUT = "daily embedding dimension verification";
const OPENAI_EMBEDDING_TIMEOUT_MS = 10_000;

export class EmbeddingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingConfigurationError";
  }
}

export class EmbeddingDimensionMismatchError extends Error {
  constructor(codeDimension: number, dbDimension: number) {
    super(
      `Embedding dimension mismatch: code expects ${codeDimension}, DB has ${dbDimension}. ` +
        "This indicates a provider switch without migration. Run `execos migrate-embeddings` or revert provider.",
    );
    this.name = "EmbeddingDimensionMismatchError";
  }
}

export interface EmbedOptions {
  fetchFn?: typeof fetch;
  apiKey?: string;
  timeoutMs?: number;
}

export interface VerifyDimensionOptions {
  readDbDimension?: () => Promise<number>;
  probeEmbed?: () => Promise<number[]>;
  force?: boolean;
}

let verificationPromise: Promise<void> | null = null;

export async function embed(
  text: string,
  options: EmbedOptions = {},
): Promise<number[]> {
  const input = text.trim();
  if (!input) {
    throw new EmbeddingConfigurationError("Embedding input must not be empty.");
  }

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (process.env.EXECOS_TEST_EMBEDDINGS === "1") {
      return deterministicTestEmbedding(input);
    }
    throw new EmbeddingConfigurationError(
      "OPENAI_API_KEY is not set. Add it to .env before using memory or intake dedup.",
    );
  }

  const fetchFn = options.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new EmbeddingConfigurationError(
      "No fetch implementation is available for OpenAI embeddings.",
    );
  }

  const timeoutMs = options.timeoutMs ?? OPENAI_EMBEDDING_TIMEOUT_MS;
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetchFn(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input,
      }),
      signal: abortController.signal,
    });
  } catch (err) {
    if (timedOut || isAbortError(err)) {
      throw new Error(`OpenAI embedding request timed out after ${timeoutMs}ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `OpenAI embedding request failed (${response.status}): ${body || response.statusText}`,
    );
  }

  const payload = await response.json() as {
    data?: Array<{ embedding?: unknown }>;
  };
  const vector = payload.data?.[0]?.embedding;
  if (!Array.isArray(vector)) {
    throw new Error("OpenAI embedding response did not include an embedding vector.");
  }

  return validateEmbeddingVector(vector);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function deterministicTestEmbedding(input: string): number[] {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const vector = Array.from({ length: EMBEDDING_DIMENSION }, (_, i) => {
    const shifted = (hash + Math.imul(i + 1, 2654435761)) >>> 0;
    return ((shifted % 2000) - 1000) / 1000;
  });
  vector[0] = 1;
  return vector;
}

export async function verifyDimensionAtBoot(
  options: VerifyDimensionOptions = {},
): Promise<void> {
  if (verificationPromise && !options.force) return verificationPromise;

  verificationPromise = doVerifyDimensionAtBoot(options).catch((err) => {
    verificationPromise = null;
    throw err;
  });
  return verificationPromise;
}

export function resetDimensionVerificationForTest(): void {
  verificationPromise = null;
}

function validateEmbeddingVector(value: unknown[]): number[] {
  const vector = value.map((v) => Number(v));
  if (vector.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Embedding dimension mismatch: provider returned ${vector.length}, code expects ${EMBEDDING_DIMENSION}.`,
    );
  }
  if (vector.some((v) => !Number.isFinite(v))) {
    throw new Error("Embedding response contained a non-finite vector value.");
  }
  if (vector.every((v) => v === 0)) {
    throw new Error("Embedding response contained a zero-norm vector.");
  }
  return vector;
}

async function doVerifyDimensionAtBoot(
  options: VerifyDimensionOptions,
): Promise<void> {
  const readDbDimension = options.readDbDimension ?? readDbDimensionFromSettings;
  const dbDimension = await readDbDimension();
  if (dbDimension !== EMBEDDING_DIMENSION) {
    throw new EmbeddingDimensionMismatchError(EMBEDDING_DIMENSION, dbDimension);
  }

  if (process.env.OPENAI_API_KEY || options.probeEmbed) {
    const probeEmbed = options.probeEmbed ?? (() => embed(DIMENSION_CHECK_INPUT));
    const vector = await probeEmbed();
    if (vector.length !== EMBEDDING_DIMENSION) {
      throw new Error(
        `Embedding dimension mismatch: provider returned ${vector.length}, code expects ${EMBEDDING_DIMENSION}.`,
      );
    }
  }
}

async function readDbDimensionFromSettings(): Promise<number> {
  const { appSettings, db } = await import("../db/index.js");
  const rows = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "infrastructure.embedding_dimension"))
    .limit(1);

  const raw = rows[0]?.value;
  const value = Number(raw);
  if (!raw || !Number.isInteger(value) || value <= 0) {
    throw new EmbeddingConfigurationError(
      "app_settings.infrastructure.embedding_dimension is missing or invalid.",
    );
  }
  return value;
}
