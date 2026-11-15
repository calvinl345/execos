/**
 * Pure formatting helpers for db-layer side effects.
 *
 * This file intentionally imports no DB client and reads no environment
 * variables, so it is safe to unit-test without DATABASE_URL.
 */

import type { TaskNoteCreatedBy, TaskStatus } from "../schema.js";
import { AppSettingMissingError } from "../errors.js";

const TASK_ID_PREFIX_KEY = "task_id_prefix";

export interface StatusChangeNoteContent {
  from: TaskStatus;
  to: TaskStatus;
  by: TaskNoteCreatedBy;
  at: string; // ISO 8601 UTC
}

export function formatTaskId(prefix: string, sequenceValue: number): string {
  if (!/^[A-Z]{1,4}$/.test(prefix)) {
    throw new AppSettingMissingError(
      `${TASK_ID_PREFIX_KEY} (value '${prefix}' fails regex ^[A-Z]{1,4}$)`,
    );
  }
  if (!Number.isInteger(sequenceValue) || sequenceValue < 1) {
    throw new Error(
      `Task id sequence value must be a positive integer (got ${sequenceValue}).`,
    );
  }
  return `${prefix}-${sequenceValue.toString().padStart(3, "0")}`;
}

export function formatGoalId(sequenceValue: number): string {
  if (!Number.isInteger(sequenceValue) || sequenceValue < 1) {
    throw new Error(
      `Goal id sequence value must be a positive integer (got ${sequenceValue}).`,
    );
  }
  return `G-${sequenceValue.toString().padStart(3, "0")}`;
}

export function formatStatusChangeNote(
  from: TaskStatus,
  to: TaskStatus,
  by: TaskNoteCreatedBy,
  at: Date,
): string {
  const content: StatusChangeNoteContent = {
    from,
    to,
    by,
    at: at.toISOString(),
  };
  return JSON.stringify(content);
}

export interface TaskFieldDiff {
  changes: Record<string, { from: unknown; to: unknown }>;
}

export function computeTaskFieldDiff(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): TaskFieldDiff {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const key of Object.keys(patch)) {
    const valBefore = before[key];
    const valAfter = patch[key];

    // Treat null and undefined as equal to each other
    if ((valBefore === null || valBefore === undefined) && (valAfter === null || valAfter === undefined)) {
      continue;
    }

    // Date comparison
    if (valBefore instanceof Date && valAfter instanceof Date) {
      if (valBefore.getTime() === valAfter.getTime()) {
        continue;
      }
    }

    // General comparison
    if (valBefore !== valAfter) {
      const fromVal = valBefore instanceof Date ? valBefore.toISOString() : valBefore;
      const toVal = valAfter instanceof Date ? valAfter.toISOString() : valAfter;
      changes[key] = { from: fromVal, to: toVal };
    }
  }

  return { changes };
}

export function formatTaskFieldUpdateNote(
  diff: TaskFieldDiff,
  by: TaskNoteCreatedBy,
  at: Date,
): string {
  return JSON.stringify({
    type: "task_fields_updated",
    changes: diff.changes,
    by,
    at: at.toISOString(),
  });
}

export function formatGoalLinkNote(
  goalId: string,
  by: TaskNoteCreatedBy,
  at: Date,
): string {
  return JSON.stringify({
    type: "task_goal_linked",
    goalId,
    by,
    at: at.toISOString(),
  });
}

export function formatGoalUnlinkNote(
  fromGoalId: string,
  by: TaskNoteCreatedBy,
  at: Date,
): string {
  return JSON.stringify({
    type: "task_goal_unlinked",
    from: fromGoalId,
    by,
    at: at.toISOString(),
  });
}

export function formatAttentionFlaggedNote(
  reason: string | null | undefined,
  by: TaskNoteCreatedBy,
  at: Date,
): string {
  return JSON.stringify({
    type: "task_attention_flagged",
    reason: reason === undefined ? null : reason,
    by,
    at: at.toISOString(),
  });
}

export function formatAttentionClearedNote(
  by: TaskNoteCreatedBy,
  at: Date,
): string {
  return JSON.stringify({
    type: "task_attention_cleared",
    by,
    at: at.toISOString(),
  });
}

