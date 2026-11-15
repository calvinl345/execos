/**
 * Validation primitives and Settings schema for the domain layer.
 *
 * This module is the single source of truth for:
 *   - The Settings shape consumed by every domain function
 *     (prioritization, intake, memory-policy, etc.). Settings is
 *     INJECTED into domain functions as a parameter; domain modules
 *     never read app_settings directly. The wiring layer (CLI / web
 *     dashboard) is responsible for loading app_settings
 *     rows + defaults and producing a Settings object that conforms
 *     to SettingsSchema.
 *   - Zod schemas mirroring the canonical enums in src/db/schema.ts
 *     (Appendix A). These are runtime guards for data crossing trust
 *     boundaries (CLI input, MCP payloads, NL agent output).
 *   - Lightweight string-shape validators (scope strings for memory,
 *     quarter codes for goal targeting).
 *
 * Why Zod here (CS-1, CC-004): inputs from the agent, the CLI, and
 * external integrations are not statically typed at the call site.
 * The TS compiler protects internal call paths; Zod protects the
 * boundary. Settings in particular is loaded from the DB at startup
 * and must be validated before being passed into pure functions
 * that assume invariants (e.g. positive multipliers, non-negative
 * caps, threshold in [0, 1]).
 *
 * No DB calls. No file I/O. No clock reads. Pure schema definitions
 * and helpers. Tested by tests/domain/validation.test.ts.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Canonical enum schemas (mirror src/db/schema.ts type unions, Appendix A).
// ---------------------------------------------------------------------------

export const TaskStatusSchema = z.enum([
  "triage",
  "backlog",
  "in_progress",
  "blocked",
  "review",
  "done",
  "cancelled",
]);
export type TaskStatusValue = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(["P0", "P1", "P2", "P3"]);
export type TaskPriorityValue = z.infer<typeof TaskPrioritySchema>;

export const TaskCategorySchema = z.enum([
  "client",
  "business",
  "product",
  "house",
  "personal",
]);
export type TaskCategoryValue = z.infer<typeof TaskCategorySchema>;

export const GoalStatusSchema = z.enum(["active", "achieved", "dropped"]);
export type GoalStatusValue = z.infer<typeof GoalStatusSchema>;

export const MemoryStateSchema = z.enum(["active", "superseded", "pruned"]);
export type MemoryStateValue = z.infer<typeof MemoryStateSchema>;

// ---------------------------------------------------------------------------
// Lightweight string shape validators.
// ---------------------------------------------------------------------------

/**
 * Memory scope string. Hierarchical, slash-delimited path.
 *   Valid:   "global", "clients", "clients/larkspur", "clients/larkspur/billing"
 *   Invalid: "" (empty), "/leading", "trailing/", "double//slash",
 *            "spaces in path", "UPPER" (lowercase enforced for stability).
 *
 * Segments must be [a-z0-9-] and 1-64 chars each. The full path is
 * capped at 256 chars to keep prefix-match queries cheap and to match
 * the schema CHECK in app_settings + memories.
 */
export const MemoryScopeSchema = z
  .string()
  .min(1, "scope must not be empty")
  .max(256, "scope must be at most 256 characters")
  .regex(
    /^[a-z0-9-]+(\/[a-z0-9-]+)*$/,
    "scope must be slash-delimited segments of [a-z0-9-]",
  );

/**
 * Quarter code in the form 2026-Q2 (4-digit year, hyphen, capital Q, 1-4).
 * Matches the goals.quarter CHECK constraint (^[0-9]{4}-Q[1-4]$) per the
 * DB schema and Appendix A.2. Used by the prioritization formula
 * (Appendix C.2: goal_alignment_bonus checks current vs past quarter).
 */
export const QuarterCodeSchema = z
  .string()
  .regex(
    /^\d{4}-Q[1-4]$/,
    "quarter code must match <YYYY>-Q<1-4>, e.g. 2026-Q1",
  );

/**
 * Non-empty trimmed string with a max length cap. Used for titles,
 * names, and other short human inputs. Reject pure whitespace.
 */
export function nonEmptyString(maxLen: number): z.ZodString {
  return z
    .string()
    .min(1)
    .max(maxLen)
    .refine((s) => s.trim().length > 0, {
      message: "must not be empty or whitespace-only",
    });
}

// ---------------------------------------------------------------------------
// Settings schema (mirrors Appendix C.7 prioritization tunables and
// Appendix D intake-checklist tunables).
//
// Domain functions take a Settings object (fully resolved + validated)
// as a parameter. The wiring layer is responsible for assembling it
// from app_settings rows + defaults. SettingsSchema below is the
// contract.
// ---------------------------------------------------------------------------

export const PriorityWeightsSchema = z.object({
  P0: z.number().int().nonnegative(),
  P1: z.number().int().nonnegative(),
  P2: z.number().int().nonnegative(),
  P3: z.number().int().nonnegative(),
});
export type PriorityWeights = z.infer<typeof PriorityWeightsSchema>;

export const OverdueSettingsSchema = z.object({
  base: z.number().nonnegative(),
  daily_multiplier: z.number().nonnegative(),
  max: z.number().nonnegative(),
});
export type OverdueSettings = z.infer<typeof OverdueSettingsSchema>;

export const GoalAlignmentSettingsSchema = z.object({
  current_quarter_active: z.number().nonnegative(),
  past_quarter_active: z.number().nonnegative(),
});
export type GoalAlignmentSettings = z.infer<typeof GoalAlignmentSettingsSchema>;

export const CalendarProximitySettingsSchema = z.object({
  within_24h: z.number().nonnegative(),
  within_7d: z.number().nonnegative(),
});
export type CalendarProximitySettings = z.infer<
  typeof CalendarProximitySettingsSchema
>;

export const StalenessSettingsSchema = z.object({
  days_per_penalty: z.number().int().positive(),
  max_penalty: z.number().int().nonnegative(),
});
export type StalenessSettings = z.infer<typeof StalenessSettingsSchema>;

export const WipCapsSchema = z.object({
  P0_in_progress_max: z.number().int().nonnegative(),
});
export type WipCaps = z.infer<typeof WipCapsSchema>;

/**
 * Risk-window tunables for the change-009 review-packet detectors.
 * commitment_days: a hard-deadline task due within this many days (or
 * overdue) is a commitment at risk. goal_days: an active goal whose
 * quarter end falls within this many days, with open linked tasks, is
 * a goal at risk.
 */
export const RiskWindowsSchema = z.object({
  commitment_days: z.number().int().positive(),
  goal_days: z.number().int().positive(),
});
export type RiskWindows = z.infer<typeof RiskWindowsSchema>;

export const PrioritizationSettingsSchema = z.object({
  priority_weights: PriorityWeightsSchema,
  overdue: OverdueSettingsSchema,
  goal_alignment: GoalAlignmentSettingsSchema,
  calendar_proximity: CalendarProximitySettingsSchema,
  staleness: StalenessSettingsSchema,
  wip_caps: WipCapsSchema,
  risk_windows: RiskWindowsSchema,
});
export type PrioritizationSettings = z.infer<
  typeof PrioritizationSettingsSchema
>;

export const DedupSettingsSchema = z.object({
  similarity_threshold: z.number().min(0).max(1),
  lookback_days: z.number().int().positive(),
});
export type DedupSettings = z.infer<typeof DedupSettingsSchema>;

export const ComplexitySettingsSchema = z.object({
  word_count_threshold: z.number().int().positive(),
  multi_objective_pattern: z.string().min(1),
});
export type ComplexitySettings = z.infer<typeof ComplexitySettingsSchema>;

export const DependencySettingsSchema = z.object({
  lookback_days_recent_completions: z.number().int().positive(),
});
export type DependencySettings = z.infer<typeof DependencySettingsSchema>;

export const FieldAssignmentSettingsSchema = z.object({
  priority_inference_confidence_min: z.number().min(0).max(1),
});
export type FieldAssignmentSettings = z.infer<
  typeof FieldAssignmentSettingsSchema
>;

export const CategoryKeywordsSchema = z.object({
  "client": z.array(z.string().min(1)),
  "business": z.array(z.string().min(1)),
  product: z.array(z.string().min(1)),
  house: z.array(z.string().min(1)),
  personal: z.array(z.string().min(1)),
});
export type CategoryKeywords = z.infer<typeof CategoryKeywordsSchema>;

export const PriorityKeywordsSchema = z.object({
  P0: z.array(z.string().min(1)),
  P1: z.array(z.string().min(1)),
  P2: z.array(z.string().min(1)),
  P3: z.array(z.string().min(1)),
});
export type PriorityKeywords = z.infer<typeof PriorityKeywordsSchema>;

export const IntakeChecklistSettingsSchema = z.object({
  dedup: DedupSettingsSchema,
  complexity: ComplexitySettingsSchema,
  dependency: DependencySettingsSchema,
  field_assignment: FieldAssignmentSettingsSchema,
  category_keywords: CategoryKeywordsSchema,
  priority_keywords: PriorityKeywordsSchema,
});
export type IntakeChecklistSettings = z.infer<
  typeof IntakeChecklistSettingsSchema
>;

export const NeedsAttentionSettingsSchema = z.object({
  staleness_days_threshold: z.number().int().positive(),
});
export type NeedsAttentionSettings = z.infer<typeof NeedsAttentionSettingsSchema>;

/**
 * Infrastructure-tier values consumed by db helpers (compose-id,
 * p0-wip-cap), the embedding wrapper, and the storage signed-URL
 * helper. These used to be flat app_settings rows read directly by the
 * helpers; they now live in the typed Settings tree and are passed
 * through the wiring layer like every other tunable.
 */
export const InfrastructureSettingsSchema = z.object({
  task_id_prefix: z
    .string()
    .regex(/^[A-Z]{1,4}$/, "task_id_prefix must match ^[A-Z]{1,4}$"),
  p0_wip_cap: z.number().int().nonnegative(),
  embedding_dimension: z.number().int().positive(),
  signed_url_ttl_seconds: z.number().int().positive(),
});
export type InfrastructureSettings = z.infer<
  typeof InfrastructureSettingsSchema
>;

export const SettingsSchema = z.object({
  prioritization: PrioritizationSettingsSchema,
  intake_checklist: IntakeChecklistSettingsSchema,
  needs_attention: NeedsAttentionSettingsSchema,
  infrastructure: InfrastructureSettingsSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;

/**
 * Default Settings. Mirrors the seeded values in app_settings (per the
 * schema dictionary) and the explicit numeric constants documented in
 * Appendix C.2 (prioritization formula) and Appendix D (intake checklist).
 *
 * Useful for:
 *   - Tests that need a known Settings baseline.
 *   - The wiring layer's fallback when an app_settings key is missing
 *     (logged as a warning, not a hard failure).
 *   - Documentation: this is the canonical baseline tuning.
 *
 * Callers that need to mutate must clone first
 * (e.g. structuredClone(DEFAULT_SETTINGS)). Frozen at module level so
 * accidental mutation throws in strict mode.
 */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  prioritization: Object.freeze({
    priority_weights: Object.freeze({ P0: 10, P1: 5, P2: 2, P3: 1 }),
    overdue: Object.freeze({ base: 1, daily_multiplier: 2, max: 20 }),
    goal_alignment: Object.freeze({
      current_quarter_active: 3,
      past_quarter_active: 1,
    }),
    calendar_proximity: Object.freeze({ within_24h: 2, within_7d: 1 }),
    staleness: Object.freeze({ days_per_penalty: 7, max_penalty: 3 }),
    wip_caps: Object.freeze({ P0_in_progress_max: 3 }),
    risk_windows: Object.freeze({ commitment_days: 3, goal_days: 14 }),
  }),
  intake_checklist: Object.freeze({
    dedup: Object.freeze({ similarity_threshold: 0.85, lookback_days: 30 }),
    complexity: Object.freeze({
      word_count_threshold: 60,
      multi_objective_pattern: "and.*and",
    }),
    dependency: Object.freeze({ lookback_days_recent_completions: 7 }),
    field_assignment: Object.freeze({
      priority_inference_confidence_min: 0.7,
    }),
    category_keywords: Object.freeze({
      "client": Object.freeze([
        "client",
        "msa",
        "deliverable",
        "transcript",
        "scope",
        "proposal",
        "contract",
      ]) as unknown as string[],
      "business": Object.freeze([
        "northwind",
        "internal",
        "sop",
        "vendor",
        "financial",
        "ops",
        "operations",
      ]) as unknown as string[],
      product: Object.freeze(["product", "roadmap", "beta"]) as unknown as string[],
      house: Object.freeze([
        "house",
        "home",
        "lease",
        "maintenance",
        "utility",
        "rent",
        "landlord",
      ]) as unknown as string[],
      personal: Object.freeze([
        "medical",
        "doctor",
        "personal",
        "family",
        "tax",
        "identity",
        "appointment",
        "dentist",
      ]) as unknown as string[],
    }),
    priority_keywords: Object.freeze({
      P0: Object.freeze([
        "p0",
        "urgent",
        "blocking",
        "drop everything",
        "emergency",
        "critical",
        "fire",
      ]) as unknown as string[],
      P1: Object.freeze([
        "p1",
        "asap",
        "important",
        "high priority",
        "this week",
      ]) as unknown as string[],
      P2: Object.freeze([
        "p2",
        "minor",
        "low priority",
        "nice to have",
        "when you can",
      ]) as unknown as string[],
      P3: Object.freeze([
        "p3",
        "later",
        "someday",
        "backlog",
        "eventually",
      ]) as unknown as string[],
    }),
  }),
  needs_attention: Object.freeze({ staleness_days_threshold: 7 }),
  infrastructure: Object.freeze({
    task_id_prefix: "KS",
    p0_wip_cap: 3,
    embedding_dimension: 3072,
    signed_url_ttl_seconds: 900,
  }),
}) as Readonly<Settings>;

/**
 * Parse + validate a raw Settings object (e.g. from app_settings rows).
 * Throws ZodError on invalid input. Returns a fresh, mutable Settings
 * value (no aliasing to DEFAULT_SETTINGS).
 */
export function parseSettings(raw: unknown): Settings {
  return SettingsSchema.parse(raw);
}

/**
 * Non-throwing variant: returns a discriminated result for callers that
 * want to handle malformed Settings without a try/catch (e.g. CLI bootstrap
 * that wants to log + fall back to DEFAULT_SETTINGS).
 */
export function safeParseSettings(
  raw: unknown,
): { ok: true; value: Settings } | { ok: false; error: z.ZodError } {
  const result = SettingsSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error };
}
