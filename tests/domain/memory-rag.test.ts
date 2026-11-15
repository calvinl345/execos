import { describe, expect, it } from "vitest";
import {
  allowedDedupActions,
  findMemoryDedupMatches,
} from "../../src/domain/memory-dedup.js";
import { detectDecisionCapture } from "../../src/domain/decisions-heuristic.js";
import { retrieveMemories } from "../../src/domain/memory-retrieval.js";
import { DEFAULT_SETTINGS } from "../../src/domain/validation.js";

describe("memory RAG domain helpers", () => {
  it("scores recall with scope-prefix filtering and dual-embedding max", () => {
    const results = retrieveMemories({
      scopePrefix: "clients/larkspur",
      queryContentEmbedding: [1, 0],
      queryApplicabilityEmbedding: [0, 1],
      memories: [
        {
          id: "M-1",
          scope: "clients/larkspur/billing",
          content: "billing memory",
          applicability: "when billing",
          contentEmbedding: [0.1, 0.9],
          applicabilityEmbedding: [0, 1],
        },
        {
          id: "M-2",
          scope: "clients/other",
          content: "wrong scope",
          applicability: "wrong scope",
          contentEmbedding: [1, 0],
          applicabilityEmbedding: [1, 0],
        },
      ],
      k: 5,
    });

    expect(results.map((r) => r.id)).toEqual(["M-1"]);
    expect(results[0].score).toBeCloseTo(1);
  });

  it("recalls across all scopes when no scope prefix is supplied", () => {
    const results = retrieveMemories({
      queryContentEmbedding: [1, 0],
      queryApplicabilityEmbedding: [1, 0],
      memories: [
        {
          id: "M-1",
          scope: "clients/larkspur/billing",
          content: "billing memory",
          applicability: "when billing",
          contentEmbedding: [1, 0],
          applicabilityEmbedding: [0.8, 0.2],
        },
        {
          id: "M-2",
          scope: "personal/health",
          content: "personal memory",
          applicability: "when planning",
          contentEmbedding: [0.9, 0.1],
          applicabilityEmbedding: [0.7, 0.3],
        },
      ],
      k: 5,
    });

    expect(results.map((r) => r.id)).toEqual(["M-1", "M-2"]);
  });

  it("classifies exact, near, false-positive, and scope-isolated dedup scenarios", () => {
    const matches = findMemoryDedupMatches({
      scope: "clients/larkspur",
      contentEmbedding: [1, 0],
      settings: DEFAULT_SETTINGS,
      candidates: [
        {
          id: "exact",
          scope: "clients/larkspur",
          content: "same",
          contentEmbedding: [1, 0],
        },
        {
          id: "near",
          scope: "clients/larkspur",
          content: "near",
          contentEmbedding: [0.88, 0.475],
        },
        {
          id: "false-positive",
          scope: "clients/larkspur",
          content: "different",
          contentEmbedding: [0, 1],
        },
        {
          id: "scope-isolated",
          scope: "clients/other",
          content: "same other scope",
          contentEmbedding: [1, 0],
        },
      ],
    });

    expect(matches.map((m) => m.id)).toEqual(["exact", "near"]);
    expect(matches[0].band).toBe("near_identical");
    expect(allowedDedupActions(matches[0])).toEqual(["merge", "replace"]);
    expect(matches[1].band).toBe("similar");
    expect(allowedDedupActions(matches[1])).toEqual([
      "merge",
      "replace",
      "keep-both",
    ]);
  });

  it("captures explicit decisions and rejects speculative wording", () => {
    const positive = detectDecisionCapture(
      "Going with OpenAI over Voyage for the memory chunk.",
    );
    expect(positive.shouldCapture).toBe(true);
    expect(positive.scope).toBe("decisions/general");
    expect(positive.matchedPattern).toBe("going_with_over");

    const negative = detectDecisionCapture("Can you compare OpenAI and Voyage options?");
    expect(negative.shouldCapture).toBe(false);
  });
});
