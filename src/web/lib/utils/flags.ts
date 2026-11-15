/**
 * Status-flag derivation for the dashboard.
 *
 * Dashboard attention flags are derived from raw task fields, not stored
 * separately. This module is pure and
 * fast-tier testable.
 */

import { normalizedOwner } from "../../../domain/follow-ups.js";
import { daysOverdue, daysSince, isBeforeLocalDay } from "./dates.js";
import type { DashboardTask, TaskPriority } from "../types.js";

const STALE_THRESHOLD_DAYS = 14;

export type TaskFlag = "overdue" | "due_today" | "stale" | "blocked";

export const TASK_PRIORITY_META: Record<
  TaskPriority,
  {
    label: TaskPriority;
    description: string;
    /** Tinted circle colors for PriorityIndicator; opacity-based so they hold up in dark mode. */
    chipClass: string;
  }
> = {
  P0: {
    label: "P0",
    description: "critical",
    chipClass: "bg-red-500/15 text-red-700 ring-red-500/30 dark:text-red-300",
  },
  P1: {
    label: "P1",
    description: "high",
    chipClass: "bg-orange-500/15 text-orange-700 ring-orange-500/30 dark:text-orange-300",
  },
  P2: {
    label: "P2",
    description: "normal",
    chipClass: "bg-blue-500/15 text-blue-700 ring-blue-500/30 dark:text-blue-300",
  },
  P3: {
    label: "P3",
    description: "low",
    chipClass: "bg-neutral-500/15 text-neutral-600 ring-neutral-500/40 dark:text-neutral-300",
  },
};

export const TASK_PRIORITY_ORDER: readonly TaskPriority[] = ["P0", "P1", "P2", "P3"];

export const TASK_FLAG_ORDER: readonly TaskFlag[] = [
  "overdue",
  "due_today",
  "stale",
  "blocked",
];

export const TASK_FLAG_META: Record<
  TaskFlag,
  {
    label: string;
    description: string;
    dotClass: string;
    pillClass: string;
  }
> = {
  overdue: {
    label: "Overdue",
    description: "past due date",
    dotClass: "bg-orange-500",
    pillClass:
      "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30",
  },
  due_today: {
    label: "Due today",
    description: "due before tomorrow",
    dotClass: "bg-amber-400",
    pillClass:
      "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
  },
  stale: {
    label: "Stale",
    description: "no activity 14+ days",
    dotClass: "bg-sky-500",
    pillClass:
      "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30",
  },
  blocked: {
    label: "Blocked",
    description: "waiting on a dependency",
    dotClass: "bg-violet-500",
    pillClass:
      "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30",
  },
};

export function flagsFor(
  task: Pick<DashboardTask, "due_date" | "follow_up_date" | "owner" | "priority" | "status" | "updated_at">,
  now: Date = new Date(),
): TaskFlag[] {
  const out: TaskFlag[] = [];
  if (task.status === "done" || task.status === "cancelled") return out;
  const actionableDate = normalizedOwner(task.owner) === "me" ? task.due_date : task.follow_up_date;
  if (isBeforeLocalDay(actionableDate, now)) out.push("overdue");
  else if (isDueToday(actionableDate, now)) out.push("due_today");
  if (daysSince(task.updated_at, now) >= STALE_THRESHOLD_DAYS) out.push("stale");
  if (task.status === "blocked") out.push("blocked");
  return out;
}

export function staleDays(
  task: { updated_at: string | null },
  now: Date = new Date(),
): number {
  return daysSince(task.updated_at, now);
}

export function overdueDays(
  task: Pick<DashboardTask, "due_date">,
  now: Date = new Date(),
): number {
  return daysOverdue(task.due_date, now);
}

function isDueToday(due: Date | string | null, now: Date): boolean {
  if (!due) return false;
  const d = typeof due === "string" ? new Date(due) : due;
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
