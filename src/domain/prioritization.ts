/**
 * Task prioritization.
 *
 * Pure, settings-free ordering for "what should I work on?" surfaces.
 * The domain layer owns eligibility and ordering, while callers project
 * DB rows into these minimal input shapes.
 */

import type { TaskPriority, TaskStatus } from "../db/schema.js";

export interface TaskInput {
  id: string;
  title?: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  description: string;
  dueAt: Date | null;
  followUpDate: Date | null;
  snoozedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastUnblockedAt: Date | null;
  goalId: string | null;
  // Deliberately no effort field: effort is an estimate, never an
  // ordering signal. hardDeadline only breaks ties between equal due
  // dates within the same priority tier.
  hardDeadline: boolean;
}

export interface PrioritizationInput {
  task: TaskInput;
}

export interface TaskReasons {
  tier: TaskPriority | null;
  overdue: boolean;
  dueToday: boolean;
  goalLinked: boolean;
}

export interface RankedTask {
  taskId: string;
  title?: string;
  reasons: TaskReasons;
}

const NEWLY_UNBLOCKED_WINDOW_MS = 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = Object.freeze({
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
});

export function isEligible(task: TaskInput, referenceTime: Date): boolean {
  switch (task.status) {
    case "triage":
    case "backlog":
    case "in_progress":
      return true;
    case "blocked":
      return isNewlyUnblocked(task, referenceTime);
    case "review":
    case "done":
    case "cancelled":
      return false;
  }
}

function isNewlyUnblocked(task: TaskInput, referenceTime: Date): boolean {
  if (task.lastUnblockedAt === null) return false;
  const ms = referenceTime.getTime() - task.lastUnblockedAt.getTime();
  return ms >= 0 && ms <= NEWLY_UNBLOCKED_WINDOW_MS;
}

export function compareTasks(
  a: TaskInput,
  b: TaskInput,
  referenceTime: Date,
): number {
  const snoozeDiff =
    Number(isSnoozed(a, referenceTime)) - Number(isSnoozed(b, referenceTime));
  if (snoozeDiff !== 0) return snoozeDiff;

  const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
  if (priorityDiff !== 0) return priorityDiff;

  const dueDiff = compareDueAt(a.dueAt, b.dueAt);
  if (dueDiff !== 0) return dueDiff;

  // Hard-first tie-break only between equal real due dates. A hard flag
  // without a date carries no commitment date, so it never reorders.
  if (a.dueAt !== null && b.dueAt !== null) {
    const hardDiff = Number(b.hardDeadline) - Number(a.hardDeadline);
    if (hardDiff !== 0) return hardDiff;
  }

  const goalDiff =
    Number(b.goalId !== null) - Number(a.goalId !== null);
  if (goalDiff !== 0) return goalDiff;

  const updatedDiff = b.updatedAt.getTime() - a.updatedAt.getTime();
  if (updatedDiff !== 0) return updatedDiff;

  const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
  if (createdDiff !== 0) return createdDiff;

  return a.id.localeCompare(b.id);
}

function isSnoozed(task: TaskInput, referenceTime: Date): boolean {
  return (
    task.snoozedUntil !== null &&
    task.snoozedUntil.getTime() > referenceTime.getTime()
  );
}

function priorityRank(priority: TaskPriority | null): number {
  return priority === null ? 4 : PRIORITY_RANK[priority];
}

function compareDueAt(a: Date | null, b: Date | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.getTime() - b.getTime();
}

export function taskReasons(
  task: TaskInput,
  referenceTime: Date,
): TaskReasons {
  return {
    tier: task.priority,
    overdue: isOverdue(task, referenceTime),
    dueToday: isDueToday(task.dueAt, referenceTime),
    goalLinked: task.goalId !== null,
  };
}

export function isOverdue(task: TaskInput, referenceTime: Date): boolean {
  if (task.dueAt === null) return false;
  return task.dueAt.getTime() < startOfUtcDay(referenceTime).getTime();
}

function isDueToday(dueAt: Date | null, referenceTime: Date): boolean {
  if (dueAt === null) return false;
  const start = startOfUtcDay(referenceTime).getTime();
  const end = start + MS_PER_DAY;
  const due = dueAt.getTime();
  return due >= start && due < end;
}

export function isStale(
  updatedAt: Date,
  referenceTime: Date,
  thresholdDays: number,
): boolean {
  if (thresholdDays <= 0) return true;
  const diffMs = referenceTime.getTime() - updatedAt.getTime();
  return diffMs >= thresholdDays * MS_PER_DAY;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function rankTasks(
  inputs: PrioritizationInput[],
  referenceTime: Date,
): RankedTask[] {
  return inputs
    .filter(({ task }) => isEligible(task, referenceTime))
    .sort((a, b) => compareTasks(a.task, b.task, referenceTime))
    .map(({ task }) => ({
      taskId: task.id,
      title: task.title,
      reasons: taskReasons(task, referenceTime),
    }));
}
