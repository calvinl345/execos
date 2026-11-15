/**
 * Memory policy math: cosine similarity, scope-prefix matching, dedup
 * suggestion bands, dual-embedding retrieval scoring.
 *
 * This module is the pure-math layer for memory operations. The CLI
 * layers retrieval, dedup UX, and DB I/O on top. Live embedding
 * generation is wired in alongside the embedding provider integration;
 * this module only consumes pre-computed vectors.
 *
 * Sources:
 *   - Appendix A.5 (memory scope path convention; slash-delimited
 *     hierarchy with segment-aligned prefix queries)
 *   - Appendix E (embedding policy; provider-agnostic vector ops)
 *   - AC-016 (save-time dedup at cosine > 0.85 configurable)
 *   - AC-017 (retrieval scores `max(content_sim, applicability_sim)`)
 *
 * Note on dedup bands (AC-016; evidence tiers, renamed per decision 006):
 *   - similarity >= 0.92            -> near_identical
 *   - threshold <= similarity < 0.92 -> similar
 *   - similarity < threshold        -> no_match (proceed with new save)
 *   Bands describe evidence strength; the consuming agent owns the
 *   keep/merge decision.
 *
 *   `threshold` is `Settings.intake_checklist.dedup.similarity_threshold`
 *   (default 0.85 per Appendix C.7 / D.8).
 *
 * Pure functions only. No DB calls, no I/O. Tested by
 * tests/domain/memory-policy.test.ts.
 */

import type { Settings } from "./validation.js";

// ---------------------------------------------------------------------------
// Cosine similarity.
// ---------------------------------------------------------------------------

/**
 * Standard cosine similarity in [-1, 1].
 *
 * Guards:
 *   - Returns 0 if either vector is zero-norm (avoids NaN; matches the
 *     intuition that an empty embedding is uninformative, not maximally
 *     similar to itself).
 *   - Throws if vector lengths differ (this is a programming error,
 *     not a data error; surface it loudly so the wiring layer fixes it
 *     rather than silently scoring miscalibrated pairs).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: dimension mismatch (a=${a.length}, b=${b.length}). ` +
        `Both vectors must come from the same embedding provider.`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// Scope-prefix matching.
// ---------------------------------------------------------------------------

/**
 * Returns true iff `memoryScope` falls under `queryScope` per the
 * segment-aligned prefix rule in Appendix A.5.
 *
 * Rules:
 *   - Exact match counts:                "clients/larkspur" matches "clients/larkspur".
 *   - Deeper paths count:                "clients/larkspur/billing" matches "clients/larkspur".
 *   - Non-segment prefixes do NOT count: "clients/larkspur" does NOT match "clients/dat".
 *   - Empty queryScope is a programming error and throws (call sites
 *     that want "all" should not call this function at all).
 *
 * The function does NOT accept `clients/larkspur/*` wildcard form;
 * wildcard parsing is a CLI concern. Strip the trailing `/*` before
 * calling.
 */
export function matchesScopePrefix(
  memoryScope: string,
  queryScope: string,
): boolean {
  if (queryScope.length === 0) {
    throw new Error("matchesScopePrefix: queryScope must not be empty");
  }
  if (memoryScope === queryScope) return true;
  return memoryScope.startsWith(queryScope + "/");
}

// ---------------------------------------------------------------------------
// Dedup suggestion bands.
// ---------------------------------------------------------------------------

/**
 * The hard upper band: similarities at or above this value are
 * considered "obviously the same". Hard-coded because it is a policy
 * invariant, not a tuning knob (the threshold knob is the LOWER band).
 */
export const DEDUP_NEAR_IDENTICAL_THRESHOLD = 0.92;

/**
 * Similarity-derived evidence tiers (decision 006). Bands describe
 * evidence strength only — the agent owns the decision. The task
 * duplicate gate layers an additional `exact` band on top for
 * normalized exact title/description matches (see
 * src/services/task-operations.ts DedupBand).
 */
export type DedupSuggestion =
  | "near_identical"
  | "similar"
  | "no_match";

/**
 * Classifies a similarity score into one of three evidence tiers.
 *
 * Threshold semantics:
 *   - score >= 0.92 (DEDUP_NEAR_IDENTICAL_THRESHOLD): near_identical.
 *   - score >= settings...similarity_threshold (default 0.85): similar.
 *   - else: no_match.
 *
 * `score` is expected to be in [-1, 1] but practically in [0, 1] for
 * embedding pairs from the same provider. Negative scores collapse to
 * `no_match` because a sub-zero similarity is never a match candidate.
 */
export function dedupSuggestion(
  score: number,
  settings: Settings,
): DedupSuggestion {
  if (score >= DEDUP_NEAR_IDENTICAL_THRESHOLD) return "near_identical";
  if (score >= settings.intake_checklist.dedup.similarity_threshold) {
    return "similar";
  }
  return "no_match";
}

// ---------------------------------------------------------------------------
// Dual-embedding retrieval score.
// ---------------------------------------------------------------------------

export interface DualEmbeddingPair {
  /** Vector embedding of the content text. */
  content: number[];
  /** Vector embedding of the applicability text. */
  applicability: number[];
}

/**
 * Scores a memory against a query using two embedding channels.
 *
 * Per AC-017: the score is `max(content_sim, applicability_sim)`.
 * Rationale: a memory's "content" describes what the memory says;
 * its "applicability" describes when it should be retrieved. A query
 * that semantically matches EITHER channel should surface the memory.
 *
 * NOT a weighted combine (a previous design draft used weights; the
 * scope acceptance criterion is explicit about max-of-two).
 *
 * Returns a number in [-1, 1] (practically [0, 1] for OpenAI
 * embeddings, but we do not clamp because the math should be
 * inspectable for diagnostics).
 */
export function dualEmbeddingScore(
  query: DualEmbeddingPair,
  memory: DualEmbeddingPair,
): number {
  const contentSim = cosineSimilarity(query.content, memory.content);
  const applicabilitySim = cosineSimilarity(
    query.applicability,
    memory.applicability,
  );
  return Math.max(contentSim, applicabilitySim);
}

/**
 * Convenience: pair a memory id with its score so callers can
 * top-K sort without an external map. The memory retrieval CLI uses
 * this shape directly.
 */
export interface ScoredMemory {
  id: string;
  score: number;
}

/**
 * Top-K selection by score (descending). Stable sort: equal scores
 * preserve the input order. Does NOT mutate the input array.
 *
 * Default K = 5 per AC-017.
 */
export function topK(scored: ScoredMemory[], k = 5): ScoredMemory[] {
  if (k <= 0) return [];
  // Decorate-sort-undecorate to make the stable sort explicit and
  // readable. Array.prototype.sort is stable in V8/Node 20+, so this
  // is also correct without the indices, but the explicit form
  // documents intent for reviewers.
  return scored
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      if (b.m.score !== a.m.score) return b.m.score - a.m.score;
      return a.i - b.i;
    })
    .slice(0, k)
    .map((x) => x.m);
}
