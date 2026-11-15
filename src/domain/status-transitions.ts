/**
 * Status transition policy for tasks and goals.
 *
 * Mirrors the canonical matrices in Appendix A.1.1 (tasks) and
 * Appendix A.2.1 (goals). This module is the single source of truth
 * for the question "is this status change legal?" Both the CLI and
 * the dashboard consult canTransition() BEFORE invoking the atomic
 * write helper in src/db/helpers/task-status.ts
 * (which intentionally does not enforce the matrix per ADR-006).
 *
 * Pure functions only. No DB calls, no I/O, no side effects. Settings
 * is not needed — the matrix is fixed by the spec, not configurable.
 *
 * Same-status moves return ALLOWED. Rationale:
 *   - The atomic write helper treats same-status as a no-op (no row
 *     bumped, no audit note written).
 *   - The matrix asks "is this transition legal?" From a policy view
 *     a no-op move is trivially legal. The DENY case is reserved for
 *     "this would corrupt state" cases (e.g. resurrect a done task).
 *   - Documented explicitly so reviewers don't have to read source.
 *
 * Tested by tests/domain/status-transitions.test.ts. Every cell of
 * both matrices is exercised.
 */

import type { TaskStatus, GoalStatus } from "../db/schema.js";

// ---------------------------------------------------------------------------
// Task status transition matrix (Appendix A.1.1).
// ---------------------------------------------------------------------------

/**
 * Set of legal next statuses keyed by current status. The set EXCLUDES
 * the current status itself; canTransitionTask() handles same-status
 * as ALLOWED-no-op separately.
 *
 * Rules encoded:
 *   - From `triage`: any non-triage status is allowed.
 *   - From `backlog`/`in_progress`/`blocked`/`review`: any other
 *     non-terminal-non-triage state, plus `done` and `cancelled`.
 *     Going back to `triage` is FORBIDDEN.
 *   - From `done` or `cancelled` (terminal): reopen exits are allowed
 *     only to non-terminal-non-triage states. Service operations still
 *     restrict those exits to the explicit reopen operation.
 *
 * `as const` + Readonly types prevent accidental mutation by callers
 * (the table is a singleton; Object.freeze enforced below).
 */
export const TASK_TRANSITIONS: Readonly<
  Record<TaskStatus, ReadonlyArray<TaskStatus>>
> = Object.freeze({
  triage: Object.freeze([
    "backlog",
    "in_progress",
    "blocked",
    "review",
    "done",
    "cancelled",
  ]) as ReadonlyArray<TaskStatus>,
  backlog: Object.freeze([
    "in_progress",
    "blocked",
    "review",
    "done",
    "cancelled",
  ]) as ReadonlyArray<TaskStatus>,
  in_progress: Object.freeze([
    "backlog",
    "blocked",
    "review",
    "done",
    "cancelled",
  ]) as ReadonlyArray<TaskStatus>,
  blocked: Object.freeze([
    "backlog",
    "in_progress",
    "review",
    "done",
    "cancelled",
  ]) as ReadonlyArray<TaskStatus>,
  review: Object.freeze([
    "backlog",
    "in_progress",
    "blocked",
    "done",
    "cancelled",
  ]) as ReadonlyArray<TaskStatus>,
  done: Object.freeze([
    "backlog",
    "in_progress",
    "blocked",
    "review",
  ]) as ReadonlyArray<TaskStatus>,
  cancelled: Object.freeze([
    "backlog",
    "in_progress",
    "blocked",
    "review",
  ]) as ReadonlyArray<TaskStatus>,
});

/**
 * Terminal task statuses for ordinary task operations. Exits from these
 * statuses are allowed only through the explicit reopen operation.
 */
export const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = Object.freeze(
  new Set<TaskStatus>(["done", "cancelled"]),
);

/**
 * Returns true iff `from -> to` is a legal task status transition.
 * Same-status (from === to) is allowed (no-op). Terminal sources can
 * move only to non-terminal-non-triage reopen targets.
 */
export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return TASK_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Goal status transition matrix (Appendix A.2.1).
// ---------------------------------------------------------------------------

/**
 * Goal transitions are simpler: `active` is the only non-terminal
 * state, and it can move to either terminal (`achieved` or `dropped`).
 * Terminals are immutable.
 */
export const GOAL_TRANSITIONS: Readonly<
  Record<GoalStatus, ReadonlyArray<GoalStatus>>
> = Object.freeze({
  active: Object.freeze(["achieved", "dropped"]) as ReadonlyArray<GoalStatus>,
  achieved: Object.freeze([]) as ReadonlyArray<GoalStatus>,
  dropped: Object.freeze([]) as ReadonlyArray<GoalStatus>,
});

/**
 * Terminal goal statuses. Symmetric with TERMINAL_TASK_STATUSES.
 */
export const TERMINAL_GOAL_STATUSES: ReadonlySet<GoalStatus> = Object.freeze(
  new Set<GoalStatus>(["achieved", "dropped"]),
);

/**
 * Returns true iff `from -> to` is a legal goal status transition.
 * Same-status (from === to) is allowed (no-op).
 */
export function canTransitionGoal(from: GoalStatus, to: GoalStatus): boolean {
  if (from === to) return true;
  return GOAL_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Diagnostic helpers for callers that want to surface a clear error
// message rather than a boolean false.
// ---------------------------------------------------------------------------

export interface TransitionDeniedReason {
  reason:
    | "terminal_source"
    | "no_resurrect_to_triage"
    | "not_in_legal_set";
  message: string;
}

/**
 * Explain why a task transition was denied. Returns null if the
 * transition is allowed.
 */
export function explainTaskTransition(
  from: TaskStatus,
  to: TaskStatus,
): TransitionDeniedReason | null {
  if (canTransitionTask(from, to)) return null;
  if (TERMINAL_TASK_STATUSES.has(from)) {
    return {
      reason: "terminal_source",
      message: `Cannot transition from terminal status '${from}' to '${to}'. Use the reopen operation to restore a closed task to backlog, in_progress, blocked, or review.`,
    };
  }
  if (to === "triage") {
    return {
      reason: "no_resurrect_to_triage",
      message: `Cannot move a task back to 'triage' from '${from}'. Once triaged, a task moves forward only.`,
    };
  }
  return {
    reason: "not_in_legal_set",
    message: `Transition '${from}' -> '${to}' is not in the canonical task transition matrix.`,
  };
}

/**
 * Explain why a goal transition was denied. Returns null if allowed.
 */
export function explainGoalTransition(
  from: GoalStatus,
  to: GoalStatus,
): TransitionDeniedReason | null {
  if (canTransitionGoal(from, to)) return null;
  if (TERMINAL_GOAL_STATUSES.has(from)) {
    return {
      reason: "terminal_source",
      message: `Cannot transition from terminal goal status '${from}'. Goals in '${from}' are immutable.`,
    };
  }
  return {
    reason: "not_in_legal_set",
    message: `Goal transition '${from}' -> '${to}' is not in the canonical goal transition matrix.`,
  };
}
