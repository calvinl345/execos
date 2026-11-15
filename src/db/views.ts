/**
 * Typed wrappers for the two derived database views.
 *
 * The views `v_eligible_for_prioritization` and `v_recent_wins` are
 * defined in `src/db/schema.ts` as `pgView` over the `tasks` table. This
 * file owns the typed contract: every row returned from the views must
 * match `EligibleForPrioritizationRow` / `RecentWinRow` exactly. If the
 * underlying view definition is reshaped (column added, removed, renamed,
 * or retyped), the typed wrappers below stop compiling for any consumer
 * that depends on the dropped/renamed column. The DB-level contract test
 * at `tests/db/views.test.ts` enforces the same invariant at runtime.
 *
 * Pattern:
 *   - Define an explicit Row type per view. The Row type is the contract.
 *   - Export a typed `selectXxx()` query helper that reads the view and
 *     maps the raw row (snake_case columns from postgres-js + Drizzle's
 *     mapping) into the Row type's camelCase shape.
 *   - Consumers (CLI commands, tests, the local dashboard's loaders)
 *     import the helper, NEVER the raw `pgView` definition. This keeps
 *     the trust boundary at this file.
 *
 * Why this matters: re-exporting `pgView` references is too weak. A
 * re-export does not stop a consumer from using a column that vanished
 * in a view-definition refactor; only an explicit Row type that the
 * compiler checks at every call site does. Future views inherit this
 * pattern.
 */

import { db, vEligibleForPrioritization, vRecentWins } from "./index.js";
import type {
  TaskStatus,
  TaskPriority,
  TaskCategory,
  TaskEffort,
  TaskHandoffState,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Typed row contracts.
//
// Both views are SELECT * FROM tasks WHERE <filter>, so the Row type
// mirrors the task row shape (all 18 task columns). Listing each column
// explicitly is intentional: it is the type-level enforcement of the
// view column contract. If `tasks` ever drops or renames a column, every
// consumer of the typed wrapper that referenced the dropped/renamed
// column fails to compile, surfacing the breakage at type-check time
// before runtime hits.
// ---------------------------------------------------------------------------

export interface EligibleForPrioritizationRow {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  category: TaskCategory;
  owner: string | null;
  dueDate: Date | null;
  followUpDate: Date | null;
  snoozedUntil: Date | null;
  handoffState: TaskHandoffState;
  handoffCopiedAt: Date | null;
  handoffLastCopiedAt: Date | null;
  handoffLastNudgeCopiedAt: Date | null;
  goalId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  lastStatusChangeAt: Date;
  lastUnblockedAt: Date | null;
  needsAttention: boolean;
  needsAttentionSetAt: Date | null;
  needsAttentionReason: string | null;
  hardDeadline: boolean;
  effort: TaskEffort | null;
}

export type RecentWinRow = EligibleForPrioritizationRow;

// ---------------------------------------------------------------------------
// Typed query helpers. Consumers route reads through these, never through
// raw `pgView` references.
// ---------------------------------------------------------------------------

/**
 * Read all currently eligible tasks per Appendix C.1.
 *
 * Returns the explicit `EligibleForPrioritizationRow` shape. The view's
 * filter (`status IN ('triage','backlog','in_progress') OR (status='blocked'
 * AND last_unblocked_at >= now() - 24h)`) is enforced inside the view; the
 * helper does NOT re-apply it.
 */
export async function selectEligibleForPrioritization(): Promise<
  EligibleForPrioritizationRow[]
> {
  const rows = await db.select().from(vEligibleForPrioritization);
  return rows.map(toEligibleRow);
}

/**
 * Read tasks completed within the last 7 days per Appendix G.13.
 *
 * Returns the explicit `RecentWinRow` shape (column-identical to
 * `EligibleForPrioritizationRow`; aliased for consumer-side semantic clarity).
 */
export async function selectRecentWins(): Promise<RecentWinRow[]> {
  const rows = await db.select().from(vRecentWins);
  return rows.map(toEligibleRow);
}

// ---------------------------------------------------------------------------
// Internal mapper. Drizzle returns rows with TypeScript field names
// matching the `tasks` table definition (camelCase via Drizzle column
// names). We construct the Row explicitly so any drift in the underlying
// `tasks` schema (renamed field, dropped field, retyped field) is caught
// at compile time at THIS line, not buried inside consumer code paths.
// ---------------------------------------------------------------------------

interface RawViewRow {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  category: TaskCategory;
  owner: string | null;
  dueDate: Date | null;
  followUpDate: Date | null;
  snoozedUntil: Date | null;
  handoffState: TaskHandoffState;
  handoffCopiedAt: Date | null;
  handoffLastCopiedAt: Date | null;
  handoffLastNudgeCopiedAt: Date | null;
  goalId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  lastStatusChangeAt: Date;
  lastUnblockedAt: Date | null;
  needsAttention: boolean;
  needsAttentionSetAt: Date | null;
  needsAttentionReason: string | null;
  hardDeadline: boolean;
  effort: TaskEffort | null;
}

function toEligibleRow(raw: RawViewRow): EligibleForPrioritizationRow {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    status: raw.status,
    priority: raw.priority,
    category: raw.category,
    owner: raw.owner,
    dueDate: raw.dueDate,
    followUpDate: raw.followUpDate,
    snoozedUntil: raw.snoozedUntil,
    handoffState: raw.handoffState,
    handoffCopiedAt: raw.handoffCopiedAt,
    handoffLastCopiedAt: raw.handoffLastCopiedAt,
    handoffLastNudgeCopiedAt: raw.handoffLastNudgeCopiedAt,
    goalId: raw.goalId,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    completedAt: raw.completedAt,
    cancelledAt: raw.cancelledAt,
    lastStatusChangeAt: raw.lastStatusChangeAt,
    lastUnblockedAt: raw.lastUnblockedAt,
    needsAttention: raw.needsAttention,
    needsAttentionSetAt: raw.needsAttentionSetAt,
    needsAttentionReason: raw.needsAttentionReason,
    hardDeadline: raw.hardDeadline,
    effort: raw.effort,
  };
}
