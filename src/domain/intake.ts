/**
 * Task intake heuristics per Appendix D (6-step checklist).
 *
 * This module encodes the PURE analytical work of the intake checklist:
 * given the raw input text and any context the wiring layer provides
 * (recent tasks for dedup, recent completions for dependency detection,
 * a callable embed function), it returns structured analysis for each
 * step. It does NOT prompt the user, write to the DB, or call Slack.
 * Those are the CLI's job and the integrations layer's job (the
 * embedding provider for embed wiring, the Slack MCP for delegation
 * drafting).
 *
 * Sources:
 *   - Appendix D: 6-step spec, tunables (D.8), audit trail (D.7).
 *   - SC-001: every task creation must produce an `intake_checklist_completed`
 *     note (the audit trail in D.7). This module supplies the structured
 *     content; the CLI persists it.
 *
 * Step ownership in this module:
 *   D.1 dedup        - implemented; embed callable injected.
 *   D.2 complexity   - implemented; pure heuristic.
 *   D.3 dependency   - implemented; pure heuristic.
 *   D.4 fields       - category + priority inference; due-date
 *                       parsing already lives in dates.ts and is
 *                       composed in runIntake.
 *   D.5 delegation   - owner inference + shouldDelegate predicate.
 *                       The Slack draft + send is the Slack
 *                       integration's responsibility; runIntake just
 *                       flags whether delegation is required.
 *   D.6 downstream   - takes a pre-fetched list of impacted tasks
 *                       (the wiring layer queries the dependency
 *                       graph) and ranks them by impact.
 *   D.7 audit trail  - generateAuditTrail composes the structured
 *                       record from step results.
 *
 * Pure functions only. The only async surface is dedupCheck (because
 * the injected embed callable is async); everything else is synchronous.
 *
 * Tested by tests/domain/intake.test.ts.
 */

import { createHash } from "node:crypto";
import type {
  TaskCategory,
  TaskPriority,
} from "../db/schema.js";
import type { Settings } from "./validation.js";
import {
  cosineSimilarity,
  dedupSuggestion,
  type DedupSuggestion,
} from "./memory-policy.js";
import { parseNaturalDate } from "./dates.js";

// ---------------------------------------------------------------------------
// Common types.
// ---------------------------------------------------------------------------

export type EmbedFn = (text: string) => Promise<number[]>;

export interface DedupCandidate {
  /** The existing task's id (e.g. "KS-042"). */
  id: string;
  /** Title + description concatenated, already in the form that was embedded. */
  text: string;
  /** Pre-computed embedding of `text`. If null, dedupCheck embeds it on the fly. */
  embedding: number[] | null;
  /** Free-form status hint surfaced in the prompt UX layer. */
  statusHint?: string;
}

export interface ScoredDedupCandidate {
  id: string;
  similarity: number;
  band: DedupSuggestion;
  statusHint?: string;
}

export interface DedupResult {
  suggestion: DedupSuggestion;
  matches: ScoredDedupCandidate[];
  /** True when the embed callable threw; the step is skipped per D.1 fail-mode. */
  skipped: boolean;
  skipReason?: string;
}

export interface ComplexityResult {
  wordCount: number;
  isMultiObjective: boolean;
  hitsThreshold: boolean;
  suggestSplit: boolean;
}

export interface TaskRef {
  id: string;
  title: string;
  /**
   * Optional completion timestamp. Used in dependency Step 3 to filter
   * "recent completions" and to score recency in the suggestion list.
   */
  completedAt?: Date;
}

export interface DependencyResult {
  /** Explicit references found via the KS-### regex. */
  explicitIds: string[];
  /** Heuristic suggestions: recently-completed tasks whose titles overlap. */
  likelyDependencies: TaskRef[];
  /** Free-text evidence phrases ("after KS-001", "blocked by Y"). */
  evidence: string[];
}

export interface CategoryInferenceResult {
  category: TaskCategory | null;
  confidence: number;
  reasons: string[];
}

export interface PriorityInferenceResult {
  priority: TaskPriority | null;
  confidence: number;
  reasons: string[];
  /**
   * The raw highest confidence the heuristic produced; surfaced even
   * when below threshold so the wiring layer can show "I think P1
   * but I'm not sure" without auto-applying.
   */
  rawConfidence: number;
  rawPriority: TaskPriority | null;
}

export interface OwnerInferenceResult {
  owner: string;
  shouldDelegate: boolean;
  /** Phrase from the input text that triggered the inference. */
  evidence?: string;
}

export interface DownstreamImpact {
  taskId: string;
  title: string;
  reason: string;
  severity: "high" | "medium" | "low";
}

export interface DownstreamRef {
  id: string;
  title: string;
  priority: TaskPriority | null;
  dueAt: Date | null;
}

// ---------------------------------------------------------------------------
// D.1 Dedup.
// ---------------------------------------------------------------------------

/**
 * Embed the draft text and score it against `candidates`. Each
 * candidate carries its own pre-computed embedding (the wiring layer
 * pulls these from the `tasks` table); if `embedding` is null the
 * candidate is embedded on the fly via the same `embed` callable.
 *
 * The function does NOT mutate input. It does NOT throw on embed
 * failure: if the callable rejects, the step is "skipped" per D.0
 * graceful-degradation policy and `result.skipped === true`.
 *
 * Returns the strongest band suggestion (`near_identical` >
 * `similar` > `no_match`) plus the ranked candidate list.
 */
export async function dedupCheck(
  draftText: string,
  candidates: DedupCandidate[],
  embed: EmbedFn,
  settings: Settings,
): Promise<DedupResult> {
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embed(draftText);
  } catch (err) {
    return {
      suggestion: "no_match",
      matches: [],
      skipped: true,
      skipReason: err instanceof Error ? err.message : String(err),
    };
  }

  const scored: ScoredDedupCandidate[] = [];
  for (const cand of candidates) {
    let candEmbedding = cand.embedding;
    if (candEmbedding === null) {
      try {
        candEmbedding = await embed(cand.text);
      } catch {
        // Single-candidate failure does NOT skip the whole step;
        // we just exclude this candidate from the comparison.
        continue;
      }
    }
    const sim = cosineSimilarity(queryEmbedding, candEmbedding);
    const band = dedupSuggestion(sim, settings);
    scored.push({
      id: cand.id,
      similarity: sim,
      band,
      statusHint: cand.statusHint,
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity);

  // Strongest band wins for the top-level suggestion.
  let topBand: DedupSuggestion = "no_match";
  for (const m of scored) {
    if (m.band === "near_identical") {
      topBand = "near_identical";
      break;
    }
    if (m.band === "similar") topBand = "similar";
  }

  return { suggestion: topBand, matches: scored, skipped: false };
}

/**
 * Normalization applied before exact title/description matching in the
 * task duplicate gate (decision 006): casefold, trim, collapse internal
 * whitespace runs. Nothing else — no stemming, no punctuation stripping;
 * substantive edits must always count as different.
 */
export function normalizeForExactMatch(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Stable fingerprint for dedup-gate telemetry (gate_events.input_fingerprint):
 * sha256 hex of the normalized title + "\n" + normalized description, reusing
 * normalizeForExactMatch so fingerprint normalization can never drift from
 * the exact-match gate's. Pure computation (node:crypto hashing, no I/O).
 */
export function dedupInputFingerprint(title: string, description: string): string {
  return createHash("sha256")
    .update(
      `${normalizeForExactMatch(title)}\n${normalizeForExactMatch(description)}`,
      "utf8",
    )
    .digest("hex");
}

/** Which draft field(s) an exact-duplicate candidate matched on. */
export type ExactMatchField = "title" | "description" | "both";

export interface ExactMatchCandidateRow {
  id: string;
  title: string;
  description: string;
}

export interface ExactDuplicateMatch {
  id: string;
  title: string;
  matchedOn: ExactMatchField;
}

/**
 * Exact-duplicate comparison for the create duplicate gate (decision
 * 006). A candidate matches when its normalized title equals the
 * normalized draft title OR its normalized description equals the
 * normalized draft description — strictly per-field (title-vs-title,
 * description-vs-description; never cross-field). Pure; the caller
 * supplies open-task candidate rows.
 */
export function exactDuplicateMatches(
  draft: { title: string; description: string },
  candidates: ExactMatchCandidateRow[],
): ExactDuplicateMatch[] {
  const draftTitle = normalizeForExactMatch(draft.title);
  const draftDescription = normalizeForExactMatch(draft.description);
  const matches: ExactDuplicateMatch[] = [];
  for (const candidate of candidates) {
    const titleHit = normalizeForExactMatch(candidate.title) === draftTitle;
    const descriptionHit =
      normalizeForExactMatch(candidate.description) === draftDescription;
    if (!titleHit && !descriptionHit) continue;
    matches.push({
      id: candidate.id,
      title: candidate.title,
      matchedOn: titleHit && descriptionHit ? "both" : titleHit ? "title" : "description",
    });
  }
  return matches;
}

// ---------------------------------------------------------------------------
// D.2 Complexity.
// ---------------------------------------------------------------------------

/**
 * Heuristic complexity check per Appendix D.2. A task is flagged as
 * "split candidate" if any of:
 *   - description word count exceeds the configured threshold;
 *   - the description matches the multi-objective regex (default
 *     "and.*and", case-insensitive, dot does not match newlines).
 *
 * The function does NOT split the task. It returns a flag the CLI
 * uses to prompt the user; the user remains in control.
 */
export function complexityCheck(
  draftText: string,
  settings: Settings,
): ComplexityResult {
  const wc = settings.intake_checklist.complexity.word_count_threshold;
  const pattern = settings.intake_checklist.complexity.multi_objective_pattern;
  const wordCount = countWords(draftText);
  const isMultiObjective = matchesMultiObjective(draftText, pattern);
  const hitsThreshold = wordCount > wc || isMultiObjective;
  return {
    wordCount,
    isMultiObjective,
    hitsThreshold,
    suggestSplit: hitsThreshold,
  };
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

function matchesMultiObjective(text: string, pattern: string): boolean {
  try {
    const re = new RegExp(pattern, "i");
    return re.test(text);
  } catch {
    // Bad regex in settings: surface the failure as a non-match so
    // we do not misclassify simple inputs. Settings validation should
    // have caught this; this is a defensive belt.
    return false;
  }
}

// ---------------------------------------------------------------------------
// D.3 Dependency.
// ---------------------------------------------------------------------------

const KS_ID_RE = /\bKS-\d{1,6}\b/g;
const DEPENDENCY_PHRASES = [
  /after\s+(?:KS-\d{1,6}|[a-z][a-z\s]{2,30})\s+is\s+done/i,
  /once\s+(?:KS-\d{1,6}|[a-z][a-z\s]{2,30})\s+(?:is\s+)?(?:done|finished|closed)/i,
  /blocked\s+by\s+(?:KS-\d{1,6}|[a-z][a-z\s]{2,30})/i,
  /depends\s+on\s+(?:KS-\d{1,6}|[a-z][a-z\s]{2,30})/i,
  /follow[\s-]?up\s+(?:to|on)\s+(?:KS-\d{1,6}|[a-z][a-z\s]{2,30})/i,
];

/**
 * Dependency Step 3.
 *
 * Scans the draft text for:
 *   - Explicit task IDs (KS-### regex) - these are unambiguous; they
 *     become `explicitIds`.
 *   - Phrases that signal dependency intent ("after X is done",
 *     "blocked by Y", etc.) - these populate `evidence`.
 *
 * Then walks `recentCompletions` (last N days, where N is
 * `settings.intake_checklist.dependency.lookback_days_recent_completions`):
 * any completion whose title shares a meaningful token with the draft
 * is a likely-dependency candidate.
 *
 * "Meaningful token" = word of length >=4 (filters stop-words and
 * short connectors). v1 simple substring match; the agent layer can
 * refine with embeddings later.
 */
export function dependencyCheck(
  draftText: string,
  recentCompletions: TaskRef[],
  settings: Settings,
  referenceTime: Date,
): DependencyResult {
  const explicitIds = Array.from(
    new Set(draftText.match(KS_ID_RE) ?? []),
  );

  const evidence: string[] = [];
  for (const re of DEPENDENCY_PHRASES) {
    const m = draftText.match(re);
    if (m) evidence.push(m[0]);
  }

  const lookbackMs =
    settings.intake_checklist.dependency.lookback_days_recent_completions *
    24 *
    60 *
    60 *
    1000;
  const cutoff = referenceTime.getTime() - lookbackMs;
  const draftTokens = significantTokens(draftText);
  const likely: TaskRef[] = [];
  for (const c of recentCompletions) {
    if (c.completedAt && c.completedAt.getTime() < cutoff) continue;
    if (explicitIds.includes(c.id)) continue; // already named
    const cTokens = significantTokens(c.title);
    if (anyShared(draftTokens, cTokens)) likely.push(c);
  }

  return { explicitIds, likelyDependencies: likely, evidence };
}

const STOPWORDS = new Set<string>([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "into",
  "over",
  "after",
  "before",
  "while",
  "about",
  "task",
  "tasks",
  "todo",
  "thing",
  "stuff",
]);

function significantTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const tok of text.toLowerCase().match(/[a-z0-9-]+/g) ?? []) {
    if (tok.length < 4) continue;
    if (STOPWORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

function anyShared(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (b.has(t)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// D.4 Field assignment - category + priority inference.
//
// Keywords are tunable via Settings.intake_checklist.category_keywords
// and Settings.intake_checklist.priority_keywords. Operators can
// override any list (or a single category/priority) by inserting an
// app_settings row; the wiring layer assembles the resolved Settings
// and passes it here, the same way every other intake tunable flows.
// ---------------------------------------------------------------------------

/**
 * Returns the best-fit category by keyword frequency. Confidence is
 * matched_keywords / max(matched_keywords across categories), so a
 * single match in an otherwise-quiet text yields confidence 1.0
 * (with reasons listing the single matched token).
 *
 * If NO category keyword is found, returns null. The CLI prompts the
 * user in that case rather than guessing wrong.
 */
export function categoryInference(
  text: string,
  settings: Settings,
): CategoryInferenceResult {
  const lower = text.toLowerCase();
  const counts: Record<TaskCategory, { count: number; hits: string[] }> = {
    "client": { count: 0, hits: [] },
    "business": { count: 0, hits: [] },
    product: { count: 0, hits: [] },
    house: { count: 0, hits: [] },
    personal: { count: 0, hits: [] },
  };

  const categoryKeywords = settings.intake_checklist.category_keywords;
  for (const [cat, words] of Object.entries(categoryKeywords) as [
    TaskCategory,
    ReadonlyArray<string>,
  ][]) {
    for (const w of words) {
      const re = new RegExp(`\\b${escapeRe(w)}\\b`, "i");
      if (re.test(lower)) {
        counts[cat].count += 1;
        counts[cat].hits.push(w);
      }
    }
  }

  let topCat: TaskCategory | null = null;
  let topCount = 0;
  let totalHits = 0;
  for (const [cat, c] of Object.entries(counts) as [
    TaskCategory,
    { count: number; hits: string[] },
  ][]) {
    totalHits += c.count;
    if (c.count > topCount) {
      topCount = c.count;
      topCat = cat;
    }
  }

  if (topCat === null || topCount === 0) {
    return { category: null, confidence: 0, reasons: [] };
  }

  const confidence = totalHits === 0 ? 0 : topCount / totalHits;
  return {
    category: topCat,
    confidence,
    reasons: counts[topCat].hits.map((h) => `keyword "${h}"`),
  };
}

/**
 * Returns the best-fit priority by keyword frequency, with confidence
 * normalized by total priority keyword hits. If raw confidence is
 * below `Settings.intake_checklist.field_assignment.priority_inference_confidence_min`,
 * the resolved `priority` is null (the CLI prompts) but the raw
 * inference is still reported so the wiring layer can surface
 * "I think P1 but I'm not confident."
 */
export function priorityInference(
  text: string,
  settings: Settings,
): PriorityInferenceResult {
  const lower = text.toLowerCase();
  const counts: Record<TaskPriority, { count: number; hits: string[] }> = {
    P0: { count: 0, hits: [] },
    P1: { count: 0, hits: [] },
    P2: { count: 0, hits: [] },
    P3: { count: 0, hits: [] },
  };

  const priorityKeywords = settings.intake_checklist.priority_keywords;
  for (const [pri, words] of Object.entries(priorityKeywords) as [
    TaskPriority,
    ReadonlyArray<string>,
  ][]) {
    for (const w of words) {
      // Multi-word phrases need to be matched as substrings, not
      // word-bounded tokens.
      const re = w.includes(" ")
        ? new RegExp(escapeRe(w), "i")
        : new RegExp(`\\b${escapeRe(w)}\\b`, "i");
      if (re.test(lower)) {
        counts[pri].count += 1;
        counts[pri].hits.push(w);
      }
    }
  }

  // Iteration order: P0 first, then P1, P2, P3 (Object.entries
  // preserves insertion order). Ties go to the higher priority
  // (P0 over P1 etc.) which is the safer default for ambiguity:
  // overestimating priority surfaces the task earlier and the user
  // can downgrade; underestimating risks burying urgent work.
  let topPri: TaskPriority | null = null;
  let topCount = 0;
  let totalHits = 0;
  for (const [pri, c] of Object.entries(counts) as [
    TaskPriority,
    { count: number; hits: string[] },
  ][]) {
    totalHits += c.count;
    if (c.count > topCount) {
      topCount = c.count;
      topPri = pri;
    }
  }

  const rawConfidence =
    topCount === 0 || totalHits === 0 ? 0 : topCount / totalHits;
  const minConf =
    settings.intake_checklist.field_assignment.priority_inference_confidence_min;
  const accepted = rawConfidence >= minConf && topPri !== null;

  return {
    priority: accepted ? topPri : null,
    confidence: accepted ? rawConfidence : 0,
    reasons: accepted ? counts[topPri as TaskPriority].hits.map((h) => `keyword "${h}"`) : [],
    rawPriority: topPri,
    rawConfidence,
  };
}

// ---------------------------------------------------------------------------
// D.5 Owner inference.
// ---------------------------------------------------------------------------

// JS regex flags are global - we cannot mix case-insensitive trigger
// words with case-sensitive name capture in one expression. We
// enumerate the case variants of trigger words explicitly so the name
// capture stays anchored on capitalized initials (filters out common
// words like "for", "by", "to" that would otherwise match a-zA-Z+).
const OWNER_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:[Aa]ssign(?:ed)?|[Dd]elegate|[Hh]and(?:ed)?\s*off|[Gg]ive)\s+(?:this\s+)?(?:to\s+)?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/,
  /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:to\s+do|owns?\s+this|to\s+handle)/,
];

/**
 * Looks for an owner reference in the text. Returns the inferred
 * owner string (raw, as it appeared in the text) and a `shouldDelegate`
 * flag (true iff owner is non-empty AND not an alias for "me").
 *
 * If no owner phrase is detected, owner defaults to "me" and
 * shouldDelegate is false. Resolution to a `team` row happens in the
 * CLI per Appendix D.5.1.
 */
export function ownerInference(text: string): OwnerInferenceResult {
  for (const re of OWNER_PATTERNS) {
    const m = text.match(re);
    if (m && m[1]) {
      const owner = m[1].trim();
      const isMe = /^(me|myself|self)$/i.test(owner);
      return {
        owner: isMe ? "me" : owner,
        shouldDelegate: !isMe,
        evidence: m[0],
      };
    }
  }
  return { owner: "me", shouldDelegate: false };
}

// ---------------------------------------------------------------------------
// D.6 Downstream impact.
// ---------------------------------------------------------------------------

/**
 * Given a list of "tasks that depend on this new task," return those
 * with notable impact. Severity rules (v1):
 *   - high:   downstream task is P0 OR due within 48 hours.
 *   - medium: downstream task is P1 OR due within 7 days.
 *   - low:    everything else.
 *
 * Reason strings cite the trigger so the CLI can render readable
 * explanations.
 */
export function downstreamImpact(
  downstream: DownstreamRef[],
  referenceTime: Date,
): DownstreamImpact[] {
  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const out: DownstreamImpact[] = [];
  for (const t of downstream) {
    const dueIn =
      t.dueAt === null ? Infinity : t.dueAt.getTime() - referenceTime.getTime();
    let severity: DownstreamImpact["severity"] = "low";
    let reason: string;
    if (t.priority === "P0" || (dueIn >= 0 && dueIn <= TWO_DAYS_MS)) {
      severity = "high";
      reason = t.priority === "P0"
        ? `${t.id} is P0`
        : `${t.id} is due in <=48 hours`;
    } else if (t.priority === "P1" || (dueIn >= 0 && dueIn <= SEVEN_DAYS_MS)) {
      severity = "medium";
      reason = t.priority === "P1"
        ? `${t.id} is P1`
        : `${t.id} is due in <=7 days`;
    } else {
      reason = "downstream of new task";
    }
    out.push({ taskId: t.id, title: t.title, reason, severity });
  }
  // High severity first, then medium, then low.
  const order: Record<DownstreamImpact["severity"], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  out.sort((a, b) => order[a.severity] - order[b.severity]);
  return out;
}

// ---------------------------------------------------------------------------
// D.7 Audit trail.
// ---------------------------------------------------------------------------

export interface IntakeAuditTrail {
  step_1_dedup: string;
  step_2_complexity: string;
  step_3_dependency: string;
  step_4_field_assignment: string;
  step_5_delegation: string;
  step_6_downstream: string;
  duration_ms: number;
}

/**
 * Composes the structured audit-trail object that is serialized into
 * `task_notes.content` (note_type = `intake_checklist`) by the CLI.
 * The shape mirrors Appendix D.7 verbatim.
 */
export function generateAuditTrail(args: {
  dedup: DedupResult;
  complexity: ComplexityResult;
  dependency: DependencyResult;
  category: CategoryInferenceResult;
  priority: PriorityInferenceResult;
  owner: OwnerInferenceResult;
  downstream: DownstreamImpact[];
  durationMs: number;
}): IntakeAuditTrail {
  return {
    step_1_dedup: serializeDedupStep(args.dedup),
    step_2_complexity: args.complexity.suggestSplit ? "split_suggested" : "kept_single",
    step_3_dependency: serializeDependencyStep(args.dependency),
    step_4_field_assignment: serializeFieldAssignmentStep(
      args.category,
      args.priority,
    ),
    step_5_delegation: args.owner.shouldDelegate
      ? `drafted:to=${args.owner.owner}`
      : "not_delegated",
    step_6_downstream:
      args.downstream.length === 0 ? "noted" : `affects:${args.downstream.length}`,
    duration_ms: args.durationMs,
  };
}

function serializeDedupStep(d: DedupResult): string {
  if (d.skipped) return `skipped:${d.skipReason ?? "embed_failed"}`;
  if (d.suggestion === "near_identical" && d.matches.length > 0) {
    return `merge_candidate:${d.matches[0].id}`;
  }
  if (d.suggestion === "similar" && d.matches.length > 0) {
    return `prompt_user:${d.matches[0].id}`;
  }
  return "passed";
}

function serializeDependencyStep(d: DependencyResult): string {
  const total = d.explicitIds.length + d.likelyDependencies.length;
  if (total === 0) return "passed";
  const parts: string[] = [];
  if (d.explicitIds.length > 0) parts.push(`explicit:${d.explicitIds.join(",")}`);
  if (d.likelyDependencies.length > 0) {
    parts.push(`likely:${d.likelyDependencies.map((l) => l.id).join(",")}`);
  }
  return parts.join(";");
}

function serializeFieldAssignmentStep(
  c: CategoryInferenceResult,
  p: PriorityInferenceResult,
): string {
  const missing: string[] = [];
  if (c.category === null) missing.push("category");
  if (p.priority === null) missing.push("priority");
  if (missing.length === 0) return "complete";
  return `partial:${missing.join(",")}`;
}

// ---------------------------------------------------------------------------
// runIntake orchestrator.
// ---------------------------------------------------------------------------

export interface IntakeContext {
  text: string;
  candidates: DedupCandidate[];
  recentCompletions: TaskRef[];
  downstream: DownstreamRef[];
  embed: EmbedFn;
  settings: Settings;
  referenceTime: Date;
  /**
   * Optional explicit due-date phrase; if absent we attempt to
   * extract one from `text` heuristically (anything inside the
   * substring "due X" through next whitespace boundary).
   */
  duePhrase?: string;
  /**
   * Optional override TZ for due-date parsing. Defaults to the host
   * TZ via dates.parseNaturalDate's own default.
   */
  defaultTimeZone?: string;
}

export interface IntakeResult {
  dedup: DedupResult;
  complexity: ComplexityResult;
  dependency: DependencyResult;
  category: CategoryInferenceResult;
  priority: PriorityInferenceResult;
  owner: OwnerInferenceResult;
  downstream: DownstreamImpact[];
  /** Parsed due Date (UTC), or null if no phrase or parse failed. */
  dueAt: Date | null;
  audit: IntakeAuditTrail;
}

/**
 * Runs all six steps in sequence and assembles the audit trail. The
 * orchestration here is deliberately mechanical; each step is a pure
 * function and the orchestrator just composes them. Failures in any
 * single step degrade gracefully (as documented in Appendix D.0):
 * step 1 catches embed errors and reports `skipped`; the other steps
 * are pure CPU and cannot fail in normal operation.
 */
export async function runIntake(ctx: IntakeContext): Promise<IntakeResult> {
  const dedup = await dedupCheck(
    ctx.text,
    ctx.candidates,
    ctx.embed,
    ctx.settings,
  );

  const complexity = complexityCheck(ctx.text, ctx.settings);
  const dependency = dependencyCheck(
    ctx.text,
    ctx.recentCompletions,
    ctx.settings,
    ctx.referenceTime,
  );
  const category = categoryInference(ctx.text, ctx.settings);
  const priority = priorityInference(ctx.text, ctx.settings);
  const owner = ownerInference(ctx.text);
  const downstream = downstreamImpact(ctx.downstream, ctx.referenceTime);

  const dueAt = extractDueDate(ctx);

  // duration_ms is set to 0 here because runIntake is a pure
  // function: it has no access to a real wall clock that would
  // produce a meaningful elapsed-time number relative to
  // ctx.referenceTime (which can be any pinned past/future moment
  // for testability). The wiring layer (the CLI) wraps this call
  // with its own clock and overwrites audit.duration_ms before
  // persisting the note.
  const audit = generateAuditTrail({
    dedup,
    complexity,
    dependency,
    category,
    priority,
    owner,
    downstream,
    durationMs: 0,
  });

  return {
    dedup,
    complexity,
    dependency,
    category,
    priority,
    owner,
    downstream,
    dueAt,
    audit,
  };
}

function extractDueDate(ctx: IntakeContext): Date | null {
  const phrase = ctx.duePhrase ?? extractDuePhrase(ctx.text);
  if (phrase === null) return null;
  const r = parseNaturalDate(phrase, {
    referenceTime: ctx.referenceTime,
    defaultTimeZone: ctx.defaultTimeZone,
  });
  return r.ok ? r.date : null;
}

function extractDuePhrase(text: string): string | null {
  // Conservative: pick everything after "due " up to the next
  // sentence-ending punctuation. Capture is greedy enough to grab
  // multi-word expressions like "Thursday at 3pm" or "next week".
  const m = text.match(/\bdue\s+(.+?)(?:[.,;!?]|$)/i);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Internal utility.
// ---------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
