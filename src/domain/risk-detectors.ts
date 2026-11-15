/**
 * Deterministic risk detectors for the review packet (change-009).
 *
 * Architecture: deterministic detection, judgment-based correction,
 * sanctioned writes. These functions only DETECT and carry transparency
 * fields (daysLeft, windowDays, rule) so the agent and Jordan can see
 * exactly why a row fired. They never write, never retier, and never
 * read settings themselves; window sizes are injected by the caller
 * from Settings (prioritization.risk_windows).
 *
 * Input contract: commitmentsAtRisk and newlyUnblocked take ALL open
 * tasks (any status except done/cancelled, any owner), queried directly
 * from the tasks table, NOT the eligibility view. Delegated, snoozed,
 * and review-status tasks with hard deadlines must surface here even
 * though they are excluded from do-next ranking.
 *
 * Pure functions only: no DB imports, no I/O, no Date.now().
 */

import type { TaskPriority, TaskStatus } from "../db/schema.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NEWLY_UNBLOCKED_WINDOW_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Input shapes. Callers project DB rows into these minimal shapes.
// ---------------------------------------------------------------------------

export interface RiskTaskInput {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  owner: string | null;
  dueDate: Date | null;
  hardDeadline: boolean;
  lastUnblockedAt: Date | null;
}

export interface RiskGoalInput {
  id: string;
  title: string;
  quarter: string;
  status: "active" | "achieved" | "dropped";
}

export interface GoalTaskCounts {
  open: number;
  done: number;
}

// ---------------------------------------------------------------------------
// Output rows. Every row carries the numbers that made it fire.
// ---------------------------------------------------------------------------

export interface CommitmentAtRiskRow {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  owner: string | null;
  dueDate: Date;
  /** Calendar days until due; negative when overdue, 0 when due today. */
  daysLeft: number;
  /** The commitment_days window that was in effect. */
  windowDays: number;
  rule: "overdue" | "within-window";
}

export interface GoalAtRiskRow {
  goalId: string;
  title: string;
  quarter: string;
  quarterEnd: Date;
  /** Calendar days until quarter end; negative when the quarter has passed. */
  daysLeft: number;
  /** The goal_days window that was in effect. */
  windowDays: number;
  openCount: number;
  doneCount: number;
}

export interface NewlyUnblockedRow {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  owner: string | null;
  lastUnblockedAt: Date;
}

// ---------------------------------------------------------------------------
// Detectors.
// ---------------------------------------------------------------------------

/**
 * Open hard-deadline tasks that are overdue or due within
 * `commitmentDays` calendar days. Sorted soonest-due first.
 */
export function commitmentsAtRisk(
  tasks: RiskTaskInput[],
  now: Date,
  commitmentDays: number,
): CommitmentAtRiskRow[] {
  const rows: CommitmentAtRiskRow[] = [];
  for (const task of tasks) {
    if (isTerminal(task.status)) continue;
    if (!task.hardDeadline || task.dueDate === null) continue;
    const daysLeft = calendarDaysBetween(now, task.dueDate);
    if (daysLeft > commitmentDays) continue;
    rows.push({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      owner: task.owner,
      dueDate: task.dueDate,
      daysLeft,
      windowDays: commitmentDays,
      rule: daysLeft < 0 ? "overdue" : "within-window",
    });
  }
  rows.sort(
    (a, b) => a.daysLeft - b.daysLeft || a.id.localeCompare(b.id),
  );
  return rows;
}

/**
 * Active goals whose quarter ends within `goalDays` calendar days (or
 * has already ended) and that still have at least one open linked task.
 * Quarterly goals are hard 90-day commitments; the quarter string IS
 * the deadline. Sorted soonest quarter end first.
 */
export function goalsAtRisk(
  goals: RiskGoalInput[],
  openTaskCountsByGoal: ReadonlyMap<string, GoalTaskCounts>,
  now: Date,
  goalDays: number,
): GoalAtRiskRow[] {
  const rows: GoalAtRiskRow[] = [];
  for (const goal of goals) {
    if (goal.status !== "active") continue;
    const counts = openTaskCountsByGoal.get(goal.id) ?? { open: 0, done: 0 };
    if (counts.open < 1) continue;
    const end = quarterEnd(goal.quarter);
    const daysLeft = calendarDaysBetween(now, end);
    if (daysLeft > goalDays) continue;
    rows.push({
      goalId: goal.id,
      title: goal.title,
      quarter: goal.quarter,
      quarterEnd: end,
      daysLeft,
      windowDays: goalDays,
      openCount: counts.open,
      doneCount: counts.done,
    });
  }
  rows.sort(
    (a, b) => a.daysLeft - b.daysLeft || a.goalId.localeCompare(b.goalId),
  );
  return rows;
}

/**
 * Open tasks whose `lastUnblockedAt` falls within the last 24 hours.
 * These just became workable; the review surfaces them so unblocked
 * work does not sit invisible until someone happens to look.
 */
export function newlyUnblocked(
  tasks: RiskTaskInput[],
  now: Date,
): NewlyUnblockedRow[] {
  const rows: NewlyUnblockedRow[] = [];
  for (const task of tasks) {
    if (isTerminal(task.status)) continue;
    if (task.lastUnblockedAt === null) continue;
    const ms = now.getTime() - task.lastUnblockedAt.getTime();
    if (ms < 0 || ms > NEWLY_UNBLOCKED_WINDOW_MS) continue;
    rows.push({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      owner: task.owner,
      lastUnblockedAt: task.lastUnblockedAt,
    });
  }
  rows.sort(
    (a, b) =>
      b.lastUnblockedAt.getTime() - a.lastUnblockedAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * UTC end-of-quarter date (midnight UTC of the quarter's last day) for a
 * quarter code like "2026-Q2". Throws on a malformed code; goals.quarter
 * is CHECK-constrained to this format at the DB layer.
 */
export function quarterEnd(quarter: string): Date {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (match === null) {
    throw new Error(`invalid quarter code: ${quarter}`);
  }
  const year = Number(match[1]);
  const q = Number(match[2]);
  // Day 0 of the month AFTER the quarter's last month = that month's
  // final day (Mar 31, Jun 30, Sep 30, Dec 31).
  return new Date(Date.UTC(year, q * 3, 0));
}

function isTerminal(status: TaskStatus): boolean {
  return status === "done" || status === "cancelled";
}

/**
 * Whole calendar-day difference between `now` and `target` using UTC
 * day boundaries (same convention as prioritization.isOverdue): due
 * yesterday is -1, due today is 0, due tomorrow is 1.
 */
function calendarDaysBetween(now: Date, target: Date): number {
  return Math.round(
    (startOfUtcDay(target).getTime() - startOfUtcDay(now).getTime()) /
      MS_PER_DAY,
  );
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
