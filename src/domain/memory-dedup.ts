import type { Settings } from "./validation.js";
import {
  DEDUP_NEAR_IDENTICAL_THRESHOLD,
  cosineSimilarity,
  dedupSuggestion,
  type DedupSuggestion,
} from "./memory-policy.js";

export interface MemoryDedupCandidate {
  id: string;
  scope: string;
  content: string;
  contentEmbedding: number[];
}

export interface MemoryDedupMatch extends MemoryDedupCandidate {
  similarity: number;
  band: DedupSuggestion;
}

export type MemoryDedupAction = "merge" | "replace" | "keep-both";

export function findMemoryDedupMatches(args: {
  scope: string;
  contentEmbedding: number[];
  candidates: MemoryDedupCandidate[];
  settings: Settings;
}): MemoryDedupMatch[] {
  return args.candidates
    .filter((candidate) => candidate.scope === args.scope)
    .map((candidate) => {
      const similarity = cosineSimilarity(
        args.contentEmbedding,
        candidate.contentEmbedding,
      );
      return {
        ...candidate,
        similarity,
        band: dedupSuggestion(similarity, args.settings),
      };
    })
    .filter((candidate) => candidate.band !== "no_match")
    .sort((a, b) => b.similarity - a.similarity);
}

export function allowedDedupActions(match: MemoryDedupMatch): MemoryDedupAction[] {
  if (match.similarity >= DEDUP_NEAR_IDENTICAL_THRESHOLD) {
    return ["merge", "replace"];
  }
  return ["merge", "replace", "keep-both"];
}
