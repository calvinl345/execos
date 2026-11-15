import { eq } from "drizzle-orm";
import { db, tasks } from "../index.js";
import type { TaskNoteCreatedBy, TaskStatus, TaskActivitySource } from "../schema.js";
import { TaskNotFoundError } from "../errors.js";
import { appendTaskNote } from "./append-task-note.js";
import {
  recordTaskDeferred,
  recordTaskDelegationUpdated,
  recordTaskFollowedUp,
  recordTaskQueueChanged,
  recordTaskSnoozeCleared,
} from "./append-task-activity.js";
import { updateTaskStatus } from "./task-status.js";
import type { TaskWriteClient } from "./types.js";

type TaskRow = typeof tasks.$inferSelect;

export interface DelegateTaskInput {
  taskId: string;
  owner: string;
  followUpDate: Date;
  dueDate?: Date | null;
  note?: string | null;
  by?: TaskNoteCreatedBy;
  tx?: TaskWriteClient;
  source?: TaskActivitySource;
}

export interface DelegateTaskResult {
  task: TaskRow;
  noteId: string | null;
  activityId: string;
}

export interface RecordFollowUpInput {
  taskId: string;
  update: string;
  nextFollowUpDate: Date;
  dueDate?: Date | null;
  status?: TaskStatus | null;
  by?: TaskNoteCreatedBy;
  tx?: TaskWriteClient;
  source?: TaskActivitySource;
}

export interface RecordFollowUpResult {
  task: TaskRow;
  noteId: string;
  activityId: string;
}

export interface DeferTaskInput {
  taskId: string;
  until: Date;
  by?: TaskNoteCreatedBy;
  tx?: TaskWriteClient;
  source?: TaskActivitySource;
}

export interface DeferTaskResult {
  task: TaskRow;
  activityId: string;
}

export interface ClearSnoozeInput {
  taskId: string;
  by?: TaskNoteCreatedBy;
  tx?: TaskWriteClient;
  source?: TaskActivitySource;
}

export interface ClearSnoozeResult {
  task: TaskRow;
  /** null when the task carried no snooze, so nothing was written. */
  activityId: string | null;
}

export async function delegateTask(input: DelegateTaskInput): Promise<DelegateTaskResult> {
  const run = async (tx: TaskWriteClient): Promise<DelegateTaskResult> => {
    const before = await fetchTask(tx, input.taskId);
    const previousQueueRank = before.queueRank;

    // A delegated task is no longer Jordan's to do: it is now owned by a
    // teammate with the handoff pending, so it must leave the do-next queue.
    // Clear any existing rank in the same write that sets the new owner, mirroring
    // deferTask's queue-clearing pattern (the follow-up is tracked separately and
    // is not itself a queue task).
    const patch: Partial<typeof tasks.$inferInsert> = {
      owner: input.owner,
      followUpDate: input.followUpDate,
      snoozedUntil: null,
      handoffState: "pending",
      handoffCopiedAt: null,
      handoffLastCopiedAt: null,
      handoffLastNudgeCopiedAt: null,
      queueRank: null,
      queueRationale: null,
      queueRankedAt: null,
    };
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;

    await tx.update(tasks).set(patch).where(eq(tasks.id, input.taskId));

    let noteId: string | null = null;
    const note = input.note?.trim();
    if (note) {
      const noteResult = await appendTaskNote(tx, {
        taskId: input.taskId,
        noteType: "manual",
        content: note,
        createdBy: input.by ?? "agent",
      });
      noteId = noteResult.noteId;
    }

    const { activityId } = await recordTaskDelegationUpdated(tx, {
      taskId: input.taskId,
      fromOwner: before.owner,
      toOwner: input.owner,
      followUpDate: input.followUpDate,
      dueDate: input.dueDate === undefined ? before.dueDate : input.dueDate,
      noteId,
      by: input.by ?? "agent",
      source: input.source,
    });

    // R12: when a ranked task is delegated, record the queue exit in the same
    // transaction so the activity timeline reads coherently (delegated, then
    // left the queue). Unranked tasks record only the delegation activity.
    if (previousQueueRank !== null) {
      await recordTaskQueueChanged(tx, {
        taskId: input.taskId,
        rank: null,
        previousRank: previousQueueRank,
        rationale: null,
        by: input.by ?? "agent",
        source: input.source,
      });
    }

    return {
      task: await fetchTask(tx, input.taskId),
      noteId,
      activityId,
    };
  };

  return input.tx ? run(input.tx) : db.transaction(run);
}

export async function recordFollowUp(input: RecordFollowUpInput): Promise<RecordFollowUpResult> {
  const run = async (tx: TaskWriteClient): Promise<RecordFollowUpResult> => {
    const before = await fetchTask(tx, input.taskId);
    const note = input.update.trim();
    const { noteId } = await appendTaskNote(tx, {
      taskId: input.taskId,
      noteType: "manual",
      content: note,
      createdBy: input.by ?? "agent",
    });

    const patch: Partial<typeof tasks.$inferInsert> = {
      followUpDate: input.nextFollowUpDate,
    };
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
    await tx.update(tasks).set(patch).where(eq(tasks.id, input.taskId));

    if (input.status) {
      await updateTaskStatus(input.taskId, input.status, input.by ?? "agent", { tx, source: input.source });
    }

    const { activityId } = await recordTaskFollowedUp(tx, {
      taskId: input.taskId,
      updateNoteId: noteId,
      previousFollowUpDate: before.followUpDate,
      nextFollowUpDate: input.nextFollowUpDate,
      dueDate: input.dueDate === undefined ? before.dueDate : input.dueDate,
      status: input.status ?? null,
      by: input.by ?? "agent",
      source: input.source,
    });

    return {
      task: await fetchTask(tx, input.taskId),
      noteId,
      activityId,
    };
  };

  return input.tx ? run(input.tx) : db.transaction(run);
}

export async function deferTask(input: DeferTaskInput): Promise<DeferTaskResult> {
  const run = async (tx: TaskWriteClient): Promise<DeferTaskResult> => {
    const before = await fetchTask(tx, input.taskId);
    const previousQueueRank = before.queueRank;

    // Snooze and queue rank are mutually exclusive states: a future-snoozed
    // task is removed from prioritization entirely until the snooze expires, so
    // it must carry no rank. Clear any existing rank in the same write that sets
    // snoozed_until. updatedAt is allowed to bump as it does for any defer; the
    // task leaves the queue band, so the queue-staleness pin (ISS-001) that
    // forces updatedAt to itself in setQueue does not apply here.
    await tx
      .update(tasks)
      .set({
        snoozedUntil: input.until,
        queueRank: null,
        queueRationale: null,
        queueRankedAt: null,
      })
      .where(eq(tasks.id, input.taskId));

    const { activityId } = await recordTaskDeferred(tx, {
      taskId: input.taskId,
      fromSnoozedUntil: before.snoozedUntil,
      until: input.until,
      by: input.by ?? "agent",
      source: input.source,
    });

    // R12: when a ranked task is snoozed, record the queue exit in the same
    // transaction so the activity timeline reads coherently (deferred, then
    // left the queue). Unranked tasks record only the deferred activity.
    if (previousQueueRank !== null) {
      await recordTaskQueueChanged(tx, {
        taskId: input.taskId,
        rank: null,
        previousRank: previousQueueRank,
        rationale: null,
        by: input.by ?? "agent",
        source: input.source,
      });
    }

    return {
      task: await fetchTask(tx, input.taskId),
      activityId,
    };
  };

  return input.tx ? run(input.tx) : db.transaction(run);
}

export async function clearTaskSnooze(input: ClearSnoozeInput): Promise<ClearSnoozeResult> {
  const run = async (tx: TaskWriteClient): Promise<ClearSnoozeResult> => {
    const before = await fetchTask(tx, input.taskId);
    if (before.snoozedUntil === null) {
      // Already awake: nothing to clear, so no write and no activity (R12 only
      // records user-meaningful changes; this is a no-op).
      return { task: before, activityId: null };
    }

    await tx
      .update(tasks)
      .set({ snoozedUntil: null })
      .where(eq(tasks.id, input.taskId));

    const { activityId } = await recordTaskSnoozeCleared(tx, {
      taskId: input.taskId,
      fromSnoozedUntil: before.snoozedUntil,
      by: input.by ?? "agent",
      source: input.source,
    });

    return {
      task: await fetchTask(tx, input.taskId),
      activityId,
    };
  };

  return input.tx ? run(input.tx) : db.transaction(run);
}

async function fetchTask(tx: TaskWriteClient, taskId: string): Promise<TaskRow> {
  const rows = await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const row = rows[0];
  if (!row) throw new TaskNotFoundError(taskId);
  return row;
}
