import { dualEmbeddingScore, matchesScopePrefix, topK } from "./memory-policy.js";

export interface RetrievalMemory {
  id: string;
  scope: string;
  content: string;
  applicability: string;
  contentEmbedding: number[];
  applicabilityEmbedding: number[];
}

export interface RetrievedMemory extends RetrievalMemory {
  score: number;
}

export function retrieveMemories<T extends RetrievalMemory>(args: {
  queryContentEmbedding: number[];
  queryApplicabilityEmbedding: number[];
  memories: T[];
  scopePrefix?: string;
  k?: number;
}): Array<T & { score: number }> {
  let scoped = args.memories;
  if (args.scopePrefix !== undefined) {
    const scopePrefix = args.scopePrefix;
    scoped = args.memories.filter((memory) =>
      matchesScopePrefix(memory.scope, scopePrefix),
    );
  }
  const scored = scoped.map((memory) => ({
    ...memory,
    score: dualEmbeddingScore(
      {
        content: args.queryContentEmbedding,
        applicability: args.queryApplicabilityEmbedding,
      },
      {
        content: memory.contentEmbedding,
        applicability: memory.applicabilityEmbedding,
      },
    ),
  }));
  const winners = topK(scored, args.k ?? 5);
  return winners.map((winner) => {
    const memory = scored.find((candidate) => candidate.id === winner.id);
    if (!memory) throw new Error(`retrieveMemories: missing scored row ${winner.id}`);
    return memory;
  });
}
