/**
 * Inbox view engine: pure grouping of the Command Inbox's own-tasks section
 * into ordered bands per the active browse view (change-009, A7/A20).
 *
 * Pure module — no Svelte imports, no I/O; fast-suite testable. View choice is
 * ephemeral presentation state owned by +page.svelte; this module only answers
 * "given these tasks and this view, what bands render in what order?".
 */

import type { DashboardTask, TaskPriority } from "../types.js";
import { isBeforeLocalDay } from "./dates.js";
import { compareDashboardTasks } from "./inbox-partition.js";

export type ViewKey = "agent" | "due" | "priority" | "updated" | "title";

/** Tab cycles forward through this order; Shift+Tab backwards. */
export const VIEW_ORDER: readonly ViewKey[] = ["agent", "due", "priority", "updated", "title"];

/** Volume expander caps (A15). Presentation constants, not app_settings. */
export const FOLLOW_UPS_VISIBLE = 5;
export const TASKS_VISIBLE = 10;
export const REVEAL_STEP = 25;

export interface Band {
  key: string;
  label: string;
  tasks: DashboardTask[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isTerminal(t: DashboardTask): boolean {
  return t.status === "done" || t.status === "cancelled";
}

/**
 * Builds the inbox's candidate task list from the dashboard payload.
 *
 * Drops ALL terminal rows from `activeTasks` — with ?closed=1 the loader
 * includes every closed row ever, which must neither leak into nor duplicate
 * inside the inbox — then appends `recentlyDone`, deduped by id with the
 * recentlyDone copy winning. Done visibility itself is partitionInbox's job
 * (doneVisibleSince watermark).
 */
export function buildInboxCandidates(
  activeTasks: DashboardTask[],
  recentlyDone: DashboardTask[],
): DashboardTask[] {
  const doneIds = new Set(recentlyDone.map((t) => t.id));
  const open = activeTasks.filter((t) => !isTerminal(t) && !doneIds.has(t.id));
  return [...open, ...recentlyDone];
}

function addDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

type DueBandKey = "overdue" | "today" | "week" | "later" | "no-due";

function dueBandKeyFor(task: DashboardTask, now: Date): DueBandKey {
  if (task.due_date === null) return "no-due";
  const due = new Date(task.due_date);
  if (Number.isNaN(due.getTime())) return "no-due";
  if (isBeforeLocalDay(due, now)) return "overdue";
  if (isBeforeLocalDay(due, addDays(now, 1))) return "today";
  if (isBeforeLocalDay(due, addDays(now, 8))) return "week";
  return "later";
}

function dueMs(task: DashboardTask): number | null {
  if (task.due_date === null) return null;
  const ms = new Date(task.due_date).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function updatedMs(task: DashboardTask): number {
  const ms = new Date(task.updated_at).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function band(key: string, label: string, tasks: DashboardTask[]): Band {
  return { key, label, tasks };
}

/** Empty bands usually do not render: drop them before returning. */
function nonEmpty(bands: Band[]): Band[] {
  return bands.filter((b) => b.tasks.length > 0);
}

/**
 * A future-snoozed task is never in the queue, even if a stale queue_rank
 * lingers from before snooze-clears-rank shipped: snooze and queue rank are
 * mutually exclusive. deferTask now
 * clears the rank on new snoozes; this keeps the band correct for any legacy
 * row whose rank predates that change, so a parked task never sits in MY QUEUE.
 */
function isFutureSnoozed(task: DashboardTask, now: Date): boolean {
  if (task.snoozed_until === null) return false;
  const ms = new Date(task.snoozed_until).getTime();
  return !Number.isNaN(ms) && ms > now.getTime();
}

function agentBands(tasks: DashboardTask[], now: Date): Band[] {
  const queued = tasks
    .filter((t) => t.queue_rank !== null && !isFutureSnoozed(t, now))
    .sort((a, b) => (a.queue_rank ?? 0) - (b.queue_rank ?? 0) || a.id.localeCompare(b.id));
  const notQueued = tasks
    .filter((t) => t.queue_rank === null || isFutureSnoozed(t, now))
    .sort((a, b) => compareDashboardTasks(a, b, now));
  if (tasks.length === 0) return [];
  return [
    band("queue", "MY QUEUE", queued),
    ...nonEmpty([band("not-queued", "IN YOUR LIST - NOT QUEUED", notQueued)]),
  ];
}

function dueBands(tasks: DashboardTask[], now: Date): Band[] {
  const buckets: Record<DueBandKey, DashboardTask[]> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
    "no-due": [],
  };
  for (const t of tasks) buckets[dueBandKeyFor(t, now)].push(t);
  const byDueAsc = (a: DashboardTask, b: DashboardTask): number => {
    const da = dueMs(a);
    const db = dueMs(b);
    if (da !== null && db !== null && da !== db) return da - db;
    return compareDashboardTasks(a, b, now);
  };
  for (const key of ["overdue", "today", "week", "later"] as const) {
    buckets[key].sort(byDueAsc);
  }
  buckets["no-due"].sort((a, b) => compareDashboardTasks(a, b, now));
  return nonEmpty([
    band("overdue", "OVERDUE", buckets.overdue),
    band("today", "DUE TODAY", buckets.today),
    band("week", "DUE THIS WEEK", buckets.week),
    band("later", "AFTER THIS WEEK", buckets.later),
    // Defensive fallback only: due dates are required at create/update (S19),
    // so this band exists solely for legacy null-due rows.
    band("no-due", "NO DUE DATE", buckets["no-due"]),
  ]);
}

function priorityBands(tasks: DashboardTask[], now: Date): Band[] {
  const tiers: readonly TaskPriority[] = ["P0", "P1", "P2", "P3"];
  const engineOrder = (a: DashboardTask, b: DashboardTask) => compareDashboardTasks(a, b, now);
  const bands = tiers.map((p) =>
    band(
      p.toLowerCase(),
      p,
      tasks.filter((t) => t.priority === p).sort(engineOrder),
    ),
  );
  bands.push(
    band(
      "no-priority",
      "NO PRIORITY",
      tasks.filter((t) => t.priority === null).sort(engineOrder),
    ),
  );
  return nonEmpty(bands);
}

function singleBand(tasks: DashboardTask[]): Band[] {
  return nonEmpty([band("all", "", tasks)]);
}

/**
 * Groups the own-tasks section for the active view (A7/A20).
 *
 * Queue band membership is "queued tasks present in the input": a delegated
 * queued task never reaches this function (it renders in Follow-ups), so the
 * queue band simply shows the remaining members. Done rows take their natural
 * position in every view; visibility filtering happens upstream.
 */
export function groupTasksForView(
  tasks: DashboardTask[],
  view: ViewKey,
  now: Date,
): Band[] {
  if (view === "agent") return agentBands(tasks, now);
  if (view === "due") return dueBands(tasks, now);
  if (view === "priority") return priorityBands(tasks, now);
  if (view === "updated") {
    const sorted = [...tasks].sort(
      (a, b) => updatedMs(b) - updatedMs(a) || a.id.localeCompare(b.id),
    );
    return singleBand(sorted);
  }
  const sorted = [...tasks].sort((a, b) => {
    const cmp = a.title.trim().toLowerCase().localeCompare(b.title.trim().toLowerCase());
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
  });
  return singleBand(sorted);
}
