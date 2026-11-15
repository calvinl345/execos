export interface DecisionCaptureResult {
  shouldCapture: boolean;
  scope: string;
  content: string;
  applicability: string;
  matchedPattern: string | null;
}

export const DECISION_POSITIVE_EXAMPLES = [
  "We decided to keep the billing workflow manual for v1.",
  "Going with OpenAI over Voyage for this memory chunk.",
  "Settled on process-level caching for dimension verification.",
] as const;

export const DECISION_NEGATIVE_EXAMPLES = [
  "We might decide tomorrow.",
  "OpenAI and Voyage are both possible.",
  "Can you compare the caching options?",
] as const;

const DECISION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "we_decided_to", pattern: /\bwe decided to\b/i },
  { label: "going_with_over", pattern: /\bgoing with\b.+\bover\b/i },
  { label: "settled_on", pattern: /\bsettled on\b/i },
  { label: "decision_is", pattern: /\bthe decision is\b/i },
  { label: "we_are_committing_to", pattern: /\bwe are committing to\b/i },
];

const SPECULATIVE_PATTERNS = [
  /\bmight decide\b/i,
  /\bneed to decide\b/i,
  /\bcan you compare\b/i,
  /\boptions?\b/i,
];

export function detectDecisionCapture(text: string): DecisionCaptureResult {
  const trimmed = text.trim();
  if (!trimmed) return noDecision(trimmed);
  if (SPECULATIVE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return noDecision(trimmed);
  }

  const match = DECISION_PATTERNS.find(({ pattern }) => pattern.test(trimmed));
  if (!match) return noDecision(trimmed);

  return {
    shouldCapture: true,
    scope: "decisions/general",
    content: trimmed,
    applicability: "When reviewing prior strategic decisions and commitments.",
    matchedPattern: match.label,
  };
}

function noDecision(content: string): DecisionCaptureResult {
  return {
    shouldCapture: false,
    scope: "decisions/general",
    content,
    applicability: "",
    matchedPattern: null,
  };
}
