/**
 * CLI Settings loader.
 *
 * Reads `app_settings` rows once per CLI process, projects them into a
 * Settings object, validates with parseSettings, and falls back to
 * DEFAULT_SETTINGS for missing keys with a one-line warning.
 *
 * Why memoize per process: the CLI may run several commands inside a
 * single shell invocation (composed by skills) and re-querying the
 * same rows each time wastes round-trips. The settings change rarely
 * enough that a single load per process is correct.
 *
 * Domain modules and db helpers never read app_settings. The wiring
 * layer (this file) is the only place that touches the table; domain
 * functions and db helpers accept resolved values as parameters.
 *
 * Storage shape in app_settings: each row is { key: string, value: string }.
 * For nested settings (prioritization.priority_weights.P0 etc.), we use
 * dotted keys, e.g. `prioritization.priority_weights.P0`. The known set
 * of keys is fixed and listed below; unknown rows generate a warning.
 *
 * Legacy flat keys (`task_id_prefix`, `p0_wip_cap`, `embedding_dimension`,
 * `signed_url_ttl_seconds`) are accepted and routed into the typed
 * Settings tree under `infrastructure.*`. If both a legacy flat key AND
 * its typed-path equivalent are present, the loader emits a duplicate
 * warning so the operator can clean up the stale row.
 *
 * Keyword-list values (`intake_checklist.category_keywords.<cat>`,
 * `intake_checklist.priority_keywords.<pri>`) are JSON-encoded arrays
 * of strings.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  DEFAULT_SETTINGS,
  parseSettings,
  type Settings,
} from "../domain/validation.js";

interface SettingRow {
  key: string;
  value: string;
}

interface LoadResult {
  settings: Settings;
  warnings: string[];
}

let cached: LoadResult | undefined;

/**
 * Load and validate settings. Returns the cached value on subsequent
 * calls within the same process unless `force` is true.
 *
 * Failure mode: if validation fails after merging app_settings rows
 * over DEFAULT_SETTINGS, the function logs a warning and returns
 * DEFAULT_SETTINGS so the CLI can still operate.
 */
export async function loadSettings(force = false): Promise<LoadResult> {
  if (!force && cached !== undefined) {
    return cached;
  }

  const warnings: string[] = [];
  const overrides = await fetchAppSettingsRows(warnings);
  const merged = applyOverrides(DEFAULT_SETTINGS, overrides, warnings);

  let settings: Settings;
  try {
    settings = parseSettings(merged);
  } catch (err) {
    warnings.push(
      `app_settings produced an invalid Settings object; falling back to DEFAULT_SETTINGS. ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    settings = structuredClone(DEFAULT_SETTINGS) as Settings;
  }

  cached = { settings, warnings };
  return cached;
}

/**
 * Reset the in-process cache. Used by tests; the CLI itself does not
 * call this.
 */
export function resetSettingsCache(): void {
  cached = undefined;
}

async function fetchAppSettingsRows(warnings: string[]): Promise<SettingRow[]> {
  try {
    const rows = await db.execute<SettingRow & Record<string, unknown>>(
      sql`SELECT key, value FROM app_settings`,
    );
    return rows as unknown as SettingRow[];
  } catch (err) {
    warnings.push(
      `Failed to read app_settings; falling back to DEFAULT_SETTINGS. ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

interface PathSpec {
  /** Dotted path inside Settings. */
  path: string;
  /** Coercion target. */
  type: "int" | "number" | "string" | "json";
}

const TASK_CATEGORIES = [
  "client",
  "business",
  "product",
  "house",
  "personal",
] as const;

const TASK_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;

const KNOWN_KEYS: ReadonlyArray<PathSpec> = [
  { path: "prioritization.priority_weights.P0", type: "int" },
  { path: "prioritization.priority_weights.P1", type: "int" },
  { path: "prioritization.priority_weights.P2", type: "int" },
  { path: "prioritization.priority_weights.P3", type: "int" },
  { path: "prioritization.overdue.base", type: "number" },
  { path: "prioritization.overdue.daily_multiplier", type: "number" },
  { path: "prioritization.overdue.max", type: "number" },
  { path: "prioritization.goal_alignment.current_quarter_active", type: "number" },
  { path: "prioritization.goal_alignment.past_quarter_active", type: "number" },
  { path: "prioritization.calendar_proximity.within_24h", type: "number" },
  { path: "prioritization.calendar_proximity.within_7d", type: "number" },
  { path: "prioritization.staleness.days_per_penalty", type: "int" },
  { path: "prioritization.staleness.max_penalty", type: "int" },
  { path: "prioritization.wip_caps.P0_in_progress_max", type: "int" },
  { path: "prioritization.risk_windows.commitment_days", type: "int" },
  { path: "prioritization.risk_windows.goal_days", type: "int" },
  { path: "intake_checklist.dedup.similarity_threshold", type: "number" },
  { path: "intake_checklist.dedup.lookback_days", type: "int" },
  { path: "intake_checklist.complexity.word_count_threshold", type: "int" },
  { path: "intake_checklist.complexity.multi_objective_pattern", type: "string" },
  { path: "intake_checklist.dependency.lookback_days_recent_completions", type: "int" },
  { path: "intake_checklist.field_assignment.priority_inference_confidence_min", type: "number" },
  ...TASK_CATEGORIES.map(
    (c): PathSpec => ({
      path: `intake_checklist.category_keywords.${c}`,
      type: "json",
    }),
  ),
  ...TASK_PRIORITIES.map(
    (p): PathSpec => ({
      path: `intake_checklist.priority_keywords.${p}`,
      type: "json",
    }),
  ),
  { path: "needs_attention.staleness_days_threshold", type: "int" },
  { path: "infrastructure.task_id_prefix", type: "string" },
  { path: "infrastructure.p0_wip_cap", type: "int" },
  { path: "infrastructure.embedding_dimension", type: "int" },
  { path: "infrastructure.signed_url_ttl_seconds", type: "int" },
];

const KNOWN_KEY_SET: ReadonlySet<string> = new Set(KNOWN_KEYS.map((k) => k.path));

/**
 * Legacy flat keys preserved for back-compat with the V1 install seed
 * shape. The loader projects each legacy row into its typed-path
 * equivalent so an upgraded DB that still carries the old shape keeps
 * working. When BOTH a legacy row AND its typed counterpart appear in
 * app_settings the typed row wins, and the loader emits a duplicate-
 * detection warning telling the operator to delete the stale legacy
 * row. The pair `dedup_similarity_threshold` and `staleness_max_penalty`
 * map to typed paths under `intake_checklist.dedup.similarity_threshold`
 * and `prioritization.staleness.max_penalty` and are projected the same
 * way; the canonical home for both values is the typed path.
 */
const LEGACY_TO_TYPED: ReadonlyMap<string, string> = new Map([
  ["task_id_prefix", "infrastructure.task_id_prefix"],
  ["p0_wip_cap", "infrastructure.p0_wip_cap"],
  ["embedding_dimension", "infrastructure.embedding_dimension"],
  ["signed_url_ttl_seconds", "infrastructure.signed_url_ttl_seconds"],
  [
    "dedup_similarity_threshold",
    "intake_checklist.dedup.similarity_threshold",
  ],
  ["staleness_max_penalty", "prioritization.staleness.max_penalty"],
]);

function applyOverrides(
  base: Readonly<Settings>,
  rows: SettingRow[],
  warnings: string[],
): unknown {
  const out = structuredClone(base) as unknown as Record<string, unknown>;

  // Index known specs by path for O(1) lookup.
  const specByPath = new Map(KNOWN_KEYS.map((s) => [s.path, s] as const));

  // Detect legacy/typed duplicates before applying so the warning fires
  // exactly once per duplicate pair regardless of row order.
  const presentKeys = new Set(rows.map((r) => r.key));
  for (const [legacy, typed] of LEGACY_TO_TYPED) {
    if (presentKeys.has(legacy) && presentKeys.has(typed)) {
      warnings.push(
        `app_settings has both legacy key '${legacy}' and typed key '${typed}'. The typed key wins; remove the legacy row.`,
      );
    }
  }

  // Two-pass apply: legacy keys first, typed keys second, so that when
  // both are present the typed value overwrites the legacy projection.
  const legacyRows: SettingRow[] = [];
  const typedRows: SettingRow[] = [];
  for (const row of rows) {
    if (LEGACY_TO_TYPED.has(row.key)) legacyRows.push(row);
    else typedRows.push(row);
  }

  for (const row of legacyRows) {
    const typedPath = LEGACY_TO_TYPED.get(row.key);
    if (!typedPath) continue;
    const spec = specByPath.get(typedPath);
    if (!spec) continue;
    const coerced = coerceValue(row.value, spec.type, warnings, row.key);
    if (coerced === undefined) continue;
    setByPath(out, spec.path, coerced);
  }

  for (const row of typedRows) {
    if (!KNOWN_KEY_SET.has(row.key)) {
      warnings.push(
        `app_settings key '${row.key}' is not a known Settings path; ignoring.`,
      );
      continue;
    }
    const spec = specByPath.get(row.key);
    if (!spec) continue;
    const coerced = coerceValue(row.value, spec.type, warnings, row.key);
    if (coerced === undefined) continue;
    setByPath(out, spec.path, coerced);
  }

  return out;
}

function coerceValue(
  raw: string,
  type: PathSpec["type"],
  warnings: string[],
  key: string,
): unknown {
  if (type === "string") return raw;
  if (type === "int") {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || String(n) !== raw.trim()) {
      warnings.push(
        `app_settings key '${key}' value '${raw}' is not an integer; ignoring.`,
      );
      return undefined;
    }
    return n;
  }
  if (type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      warnings.push(
        `app_settings key '${key}' value '${raw}' is not a finite number; ignoring.`,
      );
      return undefined;
    }
    return n;
  }
  // type === "json"
  try {
    return JSON.parse(raw);
  } catch (err) {
    warnings.push(
      `app_settings key '${key}' value '${raw}' is not valid JSON; ignoring. ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return undefined;
  }
}

function setByPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = cursor[part];
    if (typeof next !== "object" || next === null) {
      const fresh: Record<string, unknown> = {};
      cursor[part] = fresh;
      cursor = fresh;
    } else {
      cursor = next as Record<string, unknown>;
    }
  }
  cursor[parts[parts.length - 1]] = value;
}
