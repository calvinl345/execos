import {
  isOverdue,
  isStale,
  type TaskReasons,
} from "../../domain/prioritization.js";
import type {
  ReviewAnomalies,
  ReviewCandidateRow,
} from "../../domain/taskops-hydration.js";
import { normalizedOwner } from "../../domain/follow-ups.js";
import type { RankedRow } from "./rank-eligible.js";

export interface ReviewCandidatePartitions extends ReviewAnomalies {
  doNext: ReviewCandidateRow[];
  overdue: ReviewCandidateRow[];
  stale: ReviewCandidateRow[];
  newTriage: ReviewCandidateRow[];
  arrivedSnooze: ReviewCandidateRow[];
}

const DEFAULT_DO_NEXT_LIMIT = 5;

export function partitionReviewCandidates(
  ranked: RankedRow[],
  referenceTime: Date,
  stalenessThresholdDays: number,
): ReviewCandidatePartitions {
  const ownRows = ranked.filter((row) => normalizedOwner(row.task.owner) === "me");
  const visibleRows = ownRows.filter(
    (row) => !isFutureSnoozed(row, referenceTime),
  );

  return {
    doNext: visibleRows.slice(0, DEFAULT_DO_NEXT_LIMIT).map(toReviewCandidateRow),
    overdue: visibleRows
      .filter((row) => isOverdue(row.taskInput, referenceTime))
      .map(toReviewCandidateRow),
    stale: visibleRows
      .filter((row) =>
        isStale(row.taskInput.updatedAt, referenceTime, stalenessThresholdDays),
      )
      .map(toReviewCandidateRow),
    newTriage: visibleRows
      .filter((row) => row.task.status === "triage")
      .map(toReviewCandidateRow),
    arrivedSnooze: visibleRows
      .filter((row) => isArrivedSnooze(row, referenceTime))
      .map(toReviewCandidateRow),
  };
}

export function toReviewCandidateRow(row: RankedRow): ReviewCandidateRow {
  return {
    id: row.ranking.taskId,
    title: row.title,
    status: row.task.status,
    priority: row.task.priority,
    owner: row.task.owner,
    dueDate: row.taskInput.dueAt,
    followUpDate: row.taskInput.followUpDate,
    snoozedUntil: row.taskInput.snoozedUntil,
    goalId: row.task.goalId,
    effort: row.effort,
    why: formatReasons(row.ranking.reasons),
  };
}

function isArrivedSnooze(row: RankedRow, referenceTime: Date): boolean {
  return (
    row.taskInput.snoozedUntil !== null &&
    row.taskInput.snoozedUntil.getTime() <= referenceTime.getTime()
  );
}

function isFutureSnoozed(row: RankedRow, referenceTime: Date): boolean {
  return (
    row.taskInput.snoozedUntil !== null &&
    row.taskInput.snoozedUntil.getTime() > referenceTime.getTime()
  );
}

function formatReasons(reasons: TaskReasons): string {
  const parts: string[] = [];
  if (reasons.tier !== null) parts.push(reasons.tier);
  if (reasons.overdue) parts.push("overdue");
  else if (reasons.dueToday) parts.push("due today");
  if (reasons.goalLinked) parts.push("goal-linked");
  return parts.join(", ");
}
