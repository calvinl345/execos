import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  matchesScopePrefix,
  dedupSuggestion,
  DEDUP_NEAR_IDENTICAL_THRESHOLD,
  dualEmbeddingScore,
  topK,
} from "../../src/domain/memory-policy.js";
import { DEFAULT_SETTINGS } from "../../src/domain/validation.js";

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

describe("domain/memory-policy cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 2, 3, 4];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 10);
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("computes a known value for representative pair", () => {
    // a . b = 1*4 + 2*5 + 3*6 = 32; |a|=sqrt(14); |b|=sqrt(77).
    // cos = 32 / sqrt(14*77) = 32 / sqrt(1078) ~= 0.97463...
    const got = cosineSimilarity([1, 2, 3], [4, 5, 6]);
    expect(got).toBeCloseTo(0.97463184619707, 10);
  });

  it("returns 0 when either vector is zero-norm", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("throws on dimension mismatch", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/dimension/);
    expect(() => cosineSimilarity([], [1])).toThrow(/dimension/);
  });

  it("is symmetric: cos(a, b) == cos(b, a)", () => {
    const a = [0.1, 0.2, 0.3, 0.4, 0.5];
    const b = [0.5, 0.4, 0.3, 0.2, 0.1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 12);
  });

  it("is scale-invariant: cos(a, k*b) == cos(a, b) for k>0", () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    expect(cosineSimilarity(a, b)).toBeCloseTo(
      cosineSimilarity(
        a,
        b.map((x) => x * 7),
      ),
      12,
    );
  });
});

// ---------------------------------------------------------------------------
// matchesScopePrefix
// ---------------------------------------------------------------------------

describe("domain/memory-policy matchesScopePrefix", () => {
  it("matches exact equality", () => {
    expect(matchesScopePrefix("clients/larkspur", "clients/larkspur")).toBe(
      true,
    );
    expect(matchesScopePrefix("global", "global")).toBe(true);
  });

  it("matches deeper paths under the prefix", () => {
    expect(
      matchesScopePrefix("clients/larkspur/billing", "clients/larkspur"),
    ).toBe(true);
    expect(
      matchesScopePrefix(
        "clients/larkspur/billing/q3",
        "clients/larkspur",
      ),
    ).toBe(true);
    expect(
      matchesScopePrefix("clients/larkspur/billing", "clients"),
    ).toBe(true);
  });

  it("does NOT match non-segment-aligned prefixes", () => {
    // 'clients/dat' is a string prefix but not a segment prefix.
    expect(matchesScopePrefix("clients/larkspur", "clients/dat")).toBe(false);
    expect(
      matchesScopePrefix("clients/larkspursomething", "clients/larkspur"),
    ).toBe(false);
    expect(matchesScopePrefix("decisions", "decision")).toBe(false);
  });

  it("does NOT match unrelated scopes", () => {
    expect(
      matchesScopePrefix("clients/acme/billing", "clients/larkspur"),
    ).toBe(false);
    expect(matchesScopePrefix("personal", "clients")).toBe(false);
    expect(matchesScopePrefix("decisions/strategic", "policies")).toBe(false);
  });

  it("does NOT match shorter memoryScope than queryScope", () => {
    expect(
      matchesScopePrefix("clients", "clients/larkspur"),
    ).toBe(false);
  });

  it("throws on empty queryScope", () => {
    expect(() => matchesScopePrefix("clients", "")).toThrow();
  });

  it("handles top-level scopes per Appendix A.5", () => {
    for (const root of [
      "clients",
      "team",
      "policies",
      "decisions",
      "people",
      "personal",
    ]) {
      expect(matchesScopePrefix(root, root)).toBe(true);
      expect(matchesScopePrefix(`${root}/anything`, root)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// dedupSuggestion
// ---------------------------------------------------------------------------

describe("domain/memory-policy dedupSuggestion", () => {
  it("returns near_identical at or above 0.92", () => {
    expect(dedupSuggestion(0.92, DEFAULT_SETTINGS)).toBe("near_identical");
    expect(dedupSuggestion(0.95, DEFAULT_SETTINGS)).toBe("near_identical");
    expect(dedupSuggestion(0.99, DEFAULT_SETTINGS)).toBe("near_identical");
    expect(dedupSuggestion(1.0, DEFAULT_SETTINGS)).toBe("near_identical");
  });

  it("returns similar in [threshold, 0.92)", () => {
    expect(dedupSuggestion(0.85, DEFAULT_SETTINGS)).toBe("similar");
    expect(dedupSuggestion(0.88, DEFAULT_SETTINGS)).toBe("similar");
    expect(dedupSuggestion(0.9199999, DEFAULT_SETTINGS)).toBe("similar");
  });

  it("returns no_match below threshold", () => {
    expect(dedupSuggestion(0.84, DEFAULT_SETTINGS)).toBe("no_match");
    expect(dedupSuggestion(0.7, DEFAULT_SETTINGS)).toBe("no_match");
    expect(dedupSuggestion(0, DEFAULT_SETTINGS)).toBe("no_match");
    expect(dedupSuggestion(-0.5, DEFAULT_SETTINGS)).toBe("no_match");
  });

  it("respects a custom threshold via Settings", () => {
    const custom = structuredClone(DEFAULT_SETTINGS) as typeof DEFAULT_SETTINGS;
    (
      custom.intake_checklist.dedup as { similarity_threshold: number }
    ).similarity_threshold = 0.7;
    expect(dedupSuggestion(0.75, custom)).toBe("similar");
    expect(dedupSuggestion(0.65, custom)).toBe("no_match");
    // Upper band stays fixed at 0.92 regardless of threshold.
    expect(dedupSuggestion(0.93, custom)).toBe("near_identical");
  });

  it("DEDUP_NEAR_IDENTICAL_THRESHOLD constant is exposed and equals 0.92", () => {
    expect(DEDUP_NEAR_IDENTICAL_THRESHOLD).toBe(0.92);
  });
});

// ---------------------------------------------------------------------------
// dualEmbeddingScore (AC-017: max-of-two channels)
// ---------------------------------------------------------------------------

describe("domain/memory-policy dualEmbeddingScore", () => {
  it("returns the max of content_sim and applicability_sim", () => {
    // Content channel: identical vectors -> sim = 1.
    // Applicability: orthogonal vectors -> sim = 0.
    // max = 1.
    const score = dualEmbeddingScore(
      { content: [1, 0, 0], applicability: [1, 0, 0] },
      { content: [1, 0, 0], applicability: [0, 1, 0] },
    );
    expect(score).toBe(1);
  });

  it("favors applicability when content is dissimilar but applicability matches", () => {
    const score = dualEmbeddingScore(
      { content: [1, 0, 0], applicability: [0, 1, 0] },
      { content: [0, 1, 0], applicability: [0, 1, 0] },
    );
    // content_sim = 0; applicability_sim = 1. max = 1.
    expect(score).toBe(1);
  });

  it("returns the lower channel score when both are identical at that level", () => {
    // Both channels yield 0.5 cosine.
    const a = [1, 0, 0];
    const b = [Math.SQRT1_2, Math.SQRT1_2, 0]; // 45 degrees -> cos = sqrt(1/2)
    const score = dualEmbeddingScore(
      { content: a, applicability: a },
      { content: b, applicability: b },
    );
    expect(score).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("propagates dimension errors from cosineSimilarity", () => {
    expect(() =>
      dualEmbeddingScore(
        { content: [1, 0], applicability: [1, 0] },
        { content: [1, 0, 0], applicability: [1, 0] },
      ),
    ).toThrow(/dimension/);
  });

  it("is NOT a weighted average (sanity check vs. the design alternative)", () => {
    // If we accidentally implemented weighted-sum, both channels
    // contributing 0.5 would produce 0.5 (matches max). So pick
    // asymmetric channels to disambiguate: content=1, applicability=0.
    // max -> 1; weighted-avg with 0.5/0.5 weights -> 0.5.
    const score = dualEmbeddingScore(
      { content: [1, 0], applicability: [1, 0] },
      { content: [1, 0], applicability: [0, 1] },
    );
    expect(score).toBe(1);
    expect(score).not.toBeCloseTo(0.5, 5);
  });
});

// ---------------------------------------------------------------------------
// topK
// ---------------------------------------------------------------------------

describe("domain/memory-policy topK", () => {
  const scored = [
    { id: "a", score: 0.5 },
    { id: "b", score: 0.9 },
    { id: "c", score: 0.7 },
    { id: "d", score: 0.95 },
    { id: "e", score: 0.6 },
    { id: "f", score: 0.85 },
  ];

  it("returns top 5 in descending score order by default", () => {
    const got = topK(scored);
    expect(got.map((x) => x.id)).toEqual(["d", "b", "f", "c", "e"]);
  });

  it("respects custom k", () => {
    expect(topK(scored, 1).map((x) => x.id)).toEqual(["d"]);
    expect(topK(scored, 3).map((x) => x.id)).toEqual(["d", "b", "f"]);
  });

  it("returns [] for k <= 0", () => {
    expect(topK(scored, 0)).toEqual([]);
    expect(topK(scored, -1)).toEqual([]);
  });

  it("does not mutate the input", () => {
    const before = scored.map((x) => ({ ...x }));
    void topK(scored, 3);
    expect(scored).toEqual(before);
  });

  it("is a stable sort for equal scores (input order preserved)", () => {
    const tied = [
      { id: "x1", score: 0.5 },
      { id: "x2", score: 0.5 },
      { id: "x3", score: 0.9 },
      { id: "x4", score: 0.5 },
    ];
    expect(topK(tied, 4).map((x) => x.id)).toEqual(["x3", "x1", "x2", "x4"]);
  });

  it("returns all elements when k > length", () => {
    expect(topK(scored, 100)).toHaveLength(scored.length);
  });
});
