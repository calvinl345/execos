import { eq, sql } from "drizzle-orm";
import { db, tasks } from "../index.js";
import type { TaskNoteCreatedBy, TaskActivitySource } from "../schema.js";
import { TaskNotFoundError } from "../errors.js";
import { appendTaskNote } from "./append-task-note.js";
import {
  recordTaskDelegationUpdated,
  recordTaskFieldsUpdated,
} from "./append-task-activity.js";
import { computeTaskFieldDiff, formatTaskFieldUpdateNote, type TaskFieldDiff } from "./formatters.js";
import type { TaskWriteClient } from "./types.js";

export interface UpdateTaskFieldsOptions {
  by?: TaskNoteCreatedBy;
  tx?: TaskWriteClient;
  source?: TaskActivitySource;
}

export interface UpdateTaskFieldsResult {
  taskId: string;
  diff: TaskFieldDiff;
  noteId: string;
  activityIds: string[];
  changed: boolean;
}

export interface SetTaskEmbeddingOptions {
  tx?: TaskWriteClient;
}

export async function updateTaskFields(
  taskId: string,
  patch: Record<string, unknown>,
  opts: UpdateTaskFieldsOptions = {},
): Promise<UpdateTaskFieldsResult> {
  const by = opts.by ?? "agent";

  const run = async (tx: TaskWriteClient) => {
    const rows = await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (rows.length === 0) {
      throw new TaskNotFoundError(taskId);
    }
    const before = rows[0] as Record<string, unknown>;

    const diff = computeTaskFieldDiff(before, patch);

    if (Object.keys(diff.changes).length === 0) {
      return {
        taskId,
        diff,
        noteId: "",
        activityIds: [],
        changed: false,
      };
    }

    // Apply UPDATE
    await tx
      .update(tasks)
      .set(patch)
      .where(eq(tasks.id, taskId));

    // Append system note
    const content = formatTaskFieldUpdateNote(diff, by, new Date());
    const { noteId } = await appendTaskNote(tx, {
      taskId,
      noteType: "system",
      content,
      createdBy: by,
    });
    const activityIds: string[] = [];
    const now = new Date();
    if (Object.prototype.hasOwnProperty.call(diff.changes, "owner")) {
      const ownerChange = diff.changes.owner;
      const { activityId } = await recordTaskDelegationUpdated(tx, {
        taskId,
        fromOwner: ownerChange.from,
        toOwner: ownerChange.to,
        by,
        occurredAt: now,
        source: opts.source,
      });
      activityIds.push(activityId);
    }
    const fieldsActivity = await recordTaskFieldsUpdated(tx, {
      taskId,
      diff,
      by,
      occurredAt: now,
      source: opts.source,
    });
    if (fieldsActivity) activityIds.push(fieldsActivity.activityId);

    return {
      taskId,
      diff,
      noteId,
      activityIds,
      changed: true,
    };
  };

  return opts.tx ? run(opts.tx) : db.transaction(run);
}

/**
 * Set the stored dedup embedding on a task (change-008 / A9).
 *
 * Bare vector write: no system note, no activity row — the embedding is
 * derived data, not a user-visible field change. Lives in src/db/helpers so
 * the structural scan rule (no `.update(tasks)` outside helpers) stays
 * exception-free; callers (backfill script, create/update services) must
 * route through this helper.
 */
export async function setTaskEmbedding(
  taskId: string,
  vector: number[],
  opts: SetTaskEmbeddingOptions = {},
): Promise<void> {
  const tx = opts.tx ?? db;
  const rows = await tx
    .update(tasks)
    .set({
      embedding: vector,
      updatedAt: sql`${tasks.updatedAt}`,
    })
    .where(eq(tasks.id, taskId))
    .returning({ id: tasks.id });
  if (rows.length === 0) {
    throw new TaskNotFoundError(taskId);
  }
}
