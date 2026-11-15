/**
 * Seed-row derivation for app_settings.
 *
 * Pure function: given a Settings object (typically DEFAULT_SETTINGS),
 * return the flat (key, value, description) row set the install seed
 * writes to app_settings. Round-trip-able: seeded rows -> loadSettings
 * -> the resolved Settings tree equals the input exactly.
 *
 * Lives in the wiring layer so it has no DB dependencies; the install
 * seed script and the round-trip test both import from here.
 */

import {
  DEFAULT_SETTINGS,
  type Settings,
} from "../domain/validation.js";

export interface SeedRow {
  key: string;
  value: string;
  description: string;
}

export interface DefaultTeamRow {
  id: string;
  slug: string;
  displayName: string;
  role: string;
  notes: string;
}

export const DEFAULT_TEAM_ROWS: ReadonlyArray<DefaultTeamRow> = [
  {
    id: "team-jordan",
    slug: "jordan",
    displayName: "Jordan Avery",
    role: "Founder / CEO",
    notes: "Final decisions, client escalations, and product strategy.",
  },
  {
    id: "team-priya",
    slug: "priya",
    displayName: "Priya Shah",
    role: "Operations Lead",
    notes: "Billing, vendors, hiring logistics, and internal process.",
  },
  {
    id: "team-marcus",
    slug: "marcus",
    displayName: "Marcus Lee",
    role: "Project Manager",
    notes: "Runs the Acme Logistics and Larkspur Health engagements.",
  },
  {
    id: "team-elena",
    slug: "elena",
    displayName: "Elena Torres",
    role: "Engineering Lead",
    notes: "Owns code quality, technical reviews, and estimates.",
  },
  {
    id: "team-sam",
    slug: "sam",
    displayName: "Sam Okafor",
    role: "Sales Director",
    notes: "Pipeline, proposals, and renewals.",
  },
  {
    id: "team-riley",
    slug: "riley",
    displayName: "Riley Chen",
    role: "Product Designer",
    notes: "Design for client work and the Beacon product.",
  },
  {
    id: "team-noah",
    slug: "noah",
    displayName: "Noah Brooks",
    role: "Developer",
    notes: "Full-stack developer on client projects.",
  },
];

const DESCRIPTIONS: Record<string, string> = {
  "infrastructure.task_id_prefix": "Task id prefix; must match ^[A-Z]{1,4}$.",
  "infrastructure.p0_wip_cap":
    "Maximum number of open P0 tasks allowed at once.",
  "infrastructure.embedding_dimension":
    "Active embedding dimension (default OpenAI text-embedding-3-large = 3072).",
  "infrastructure.signed_url_ttl_seconds":
    "Default Supabase Storage signed URL TTL in seconds.",
  "needs_attention.staleness_days_threshold":
    "Days since last update before a non-terminal task surfaces as newly stalled in the EOD review. Independent of the prioritization formula's staleness penalty cadence.",
  "prioritization.priority_weights.P0":
    "Prioritization formula weight for P0 priority.",
  "prioritization.priority_weights.P1":
    "Prioritization formula weight for P1 priority.",
  "prioritization.priority_weights.P2":
    "Prioritization formula weight for P2 priority.",
  "prioritization.priority_weights.P3":
    "Prioritization formula weight for P3 priority.",
  "prioritization.overdue.base":
    "Prioritization formula base bonus for an overdue task.",
  "prioritization.overdue.daily_multiplier":
    "Prioritization formula additional bonus per day overdue.",
  "prioritization.overdue.max":
    "Prioritization formula cap on the overdue bonus.",
  "prioritization.goal_alignment.current_quarter_active":
    "Prioritization bonus when a task is linked to a current-quarter active goal.",
  "prioritization.goal_alignment.past_quarter_active":
    "Prioritization bonus when a task is linked to a past-quarter active goal.",
  "prioritization.calendar_proximity.within_24h":
    "Prioritization bonus for a calendar-proximate task within 24 hours.",
  "prioritization.calendar_proximity.within_7d":
    "Prioritization bonus for a calendar-proximate task within 7 days.",
  "prioritization.staleness.days_per_penalty":
    "Days per staleness penalty point in the prioritization formula.",
  "prioritization.staleness.max_penalty":
    "Maximum staleness penalty points the prioritization formula applies.",
  "prioritization.wip_caps.P0_in_progress_max":
    "Soft WIP guidance for in-progress P0 tasks (informational; the hard cap lives at infrastructure.p0_wip_cap).",
  "prioritization.risk_windows.commitment_days":
    "Days ahead the review packet flags a hard-deadline task as a commitment at risk (overdue always flags).",
  "prioritization.risk_windows.goal_days":
    "Days before quarter end the review packet flags an active goal with open linked tasks as at risk.",
  "intake_checklist.dedup.similarity_threshold":
    "Cosine-similarity threshold for the intake dedup band classifier.",
  "intake_checklist.dedup.lookback_days":
    "Days back the intake dedup step considers candidate tasks.",
  "intake_checklist.complexity.word_count_threshold":
    "Word-count threshold above which the intake complexity step suggests a split.",
  "intake_checklist.complexity.multi_objective_pattern":
    "Regex (case-insensitive) the intake complexity step uses to detect multi-objective phrasing.",
  "intake_checklist.dependency.lookback_days_recent_completions":
    "Days back the intake dependency step searches recent completions for likely-dependency matches.",
  "intake_checklist.field_assignment.priority_inference_confidence_min":
    "Minimum confidence for the intake priority-inference heuristic to commit a value.",
};

function describeKey(key: string): string {
  if (DESCRIPTIONS[key]) return DESCRIPTIONS[key];
  if (key.startsWith("intake_checklist.category_keywords.")) {
    const cat = key.slice("intake_checklist.category_keywords.".length);
    return `Keywords for category '${cat}' (JSON array).`;
  }
  if (key.startsWith("intake_checklist.priority_keywords.")) {
    const pri = key.slice("intake_checklist.priority_keywords.".length);
    return `Keywords for priority '${pri}' (JSON array).`;
  }
  return "";
}

export function deriveSeedRows(settings: Readonly<Settings>): SeedRow[] {
  const rows: SeedRow[] = [];
  walk("", settings as unknown as Record<string, unknown>, rows);
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return rows;
}

function walk(
  prefix: string,
  value: Record<string, unknown>,
  rows: SeedRow[],
): void {
  for (const [k, v] of Object.entries(value)) {
    const key = prefix.length > 0 ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) {
      rows.push({
        key,
        value: JSON.stringify(v),
        description: describeKey(key),
      });
    } else if (v !== null && typeof v === "object") {
      walk(key, v as Record<string, unknown>, rows);
    } else {
      rows.push({
        key,
        value: String(v),
        description: describeKey(key),
      });
    }
  }
}

/** Convenience: rows derived from DEFAULT_SETTINGS. */
export const DEFAULT_SEED_ROWS: ReadonlyArray<SeedRow> =
  deriveSeedRows(DEFAULT_SETTINGS);
