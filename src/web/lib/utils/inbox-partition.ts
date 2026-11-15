import type { DashboardTask, InboxSections } from "../types.js";
import { normalizedOwner } from "../../../domain/follow-ups.js";
import { compareTasks, type TaskInput } from "../../../domain/prioritization.js";

function parseOptionalDate(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseRequiredDate(value: string): Date {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function toTaskInput(task: DashboardTask): TaskInput {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    description: task.description,
    dueAt: parseOptionalDate(task.due_date),
    followUpDate: parseOptionalDate(task.follow_up_date),
    snoozedUntil: parseOptionalDate(task.snoozed_until),
    createdAt: parseRequiredDate(task.created_at),
    updatedAt: parseRequiredDate(task.updated_at),
    lastUnblockedAt: null,
    goalId: task.goal_id,
    hardDeadline: task.hard_deadline,
  };
}

export function compareDashboardTasks(
  a: DashboardTask,
  b: DashboardTask,
  now: Date,
): number {
  return compareTasks(toTaskInput(a), toTaskInput(b), now);
}

/**
 * Partitions dashboard tasks into Follow-ups (delegated tasks) and Tasks (own tasks) sections.
 *
 * Nothing is ever hidden by date (S16): future follow-up rows always render and
 * are dimmed by the presentation layer. Terminal handling: cancelled tasks are
 * always excluded; done tasks are excluded unless `completed_at` is after
 * `doneVisibleSince` (S20 done persistence). `doneVisibleSince` null/absent
 * means "exclude all done" (SSR and pre-hydration); epoch 0 means "show every
 * recentlyDone row" — see the page pipeline's three-state watermark model.
 *
 * Follow-ups sort by follow_up_date ascending (nulls last) — the date their
 * cards display (S13); own tasks stay in deterministic engine order.
 * Search/dropdown filtering is the caller's job (applyFilters).
 */
export function partitionInbox(
  tasks: DashboardTask[],
  opts: { now: Date; doneVisibleSince?: Date | null },
): InboxSections {
  const { now } = opts;
  const doneVisibleSince = opts.doneVisibleSince ?? null;
  const isOwn = (t: DashboardTask) => normalizedOwner(t.owner) === "me";

  const isVisible = (t: DashboardTask) => {
    if (t.status === "cancelled") return false;
    if (t.status === "done") {
      if (doneVisibleSince === null) return false;
      const completedAt = parseOptionalDate(t.completed_at);
      return completedAt !== null && completedAt.getTime() > doneVisibleSince.getTime();
    }
    return true;
  };

  const visible = tasks.filter(isVisible);
  const followUps = visible.filter((t) => !isOwn(t));
  const ownTasks = visible.filter(isOwn);

  const followUpMs = (t: DashboardTask): number | null => {
    const d = parseOptionalDate(t.follow_up_date);
    return d === null ? null : d.getTime();
  };
  followUps.sort((a, b) => {
    const fa = followUpMs(a);
    const fb = followUpMs(b);
    if (fa !== null && fb === null) return -1;
    if (fa === null && fb !== null) return 1;
    if (fa !== null && fb !== null && fa !== fb) return fa - fb;
    return compareDashboardTasks(a, b, now);
  });
  ownTasks.sort((a, b) => compareDashboardTasks(a, b, now));

  return {
    followUps,
    tasks: ownTasks,
  };
}
