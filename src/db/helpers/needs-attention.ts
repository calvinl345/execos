/**
 * Needs Attention helpers (replaces tasks_needs_attention_trigger per ADR-006).
 *
 *   flagAttention(taskId, reason?): sets needs_attention=true,
 *     needs_attention_set_at=now(), needs_attention_reason=reason
 *     atomically. Idempotent: re-flagging an already-flagged task does
 *     not bump needs_attention_set_at (preserves staleness ordering for
 *     the dashboard panel per AC-079).
 *
 *   unflagAttention(taskId): sets needs_attention=false and clears both
 *     needs_attention_set_at and needs_attention_reason in one UPDATE.
 *
 * Both helpers use the default service-role client. No transaction is
 * needed because each is a single UPDATE.
 */

import { eq, sql } from "drizzle-orm";
import { db, tasks } from "../index.js";
import { TaskNotFoundError } from "../errors.js";
import type { TaskNoteCreatedBy } from "../schema.js";
import { appendTaskNote } from "./append-task-note.js";
import {
  recordTaskAttentionCleared,
  recordTaskAttentionFlagged,
} from "./append-task-activity.js";
import { formatAttentionFlaggedNote, formatAttentionClearedNote } from "./formatters.js";
import type { TaskWriteClient } from "./types.js";

const MAX_REASON_LENGTH = 200;

export interface AttentionWriteResult {
  /** Flag state BEFORE this write (lets callers report already-flagged/clear). */
  wasFlagged: boolean;
  /** Id of the activity written by this call, or null when none was (silent, or no state change). */
  activityId: string | null;
}

export async function flagAttention(
  taskId: string,
  reason?: string | null,
  opts: { tx?: TaskWriteClient; by?: TaskNoteCreatedBy; silent?: boolean } = {},
): Promise<AttentionWriteResult> {
  if (reason !== undefined && reason !== null && reason.length > MAX_REASON_LENGTH) {
    // Mirror the DB CHECK constraint in TS so the caller gets a clean
    // error rather than a Postgres constraint-violation surface.
    throw new Error(
      `needs_attention_reason exceeds ${MAX_REASON_LENGTH} chars (got ${reason.length}).`,
    );
  }

  const by = opts.by ?? "agent";

  const run = async (tx: TaskWriteClient) => {
    const rows = await tx.select({ needsAttention: tasks.needsAttention }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (rows.length === 0) {
      throw new TaskNotFoundError(taskId);
    }
    const wasFlagged = rows[0].needsAttention;

    await tx
      .update(tasks)
      .set({
        needsAttention: true,
        needsAttentionSetAt: sql`CASE WHEN ${tasks.needsAttention} = false THEN now() ELSE ${tasks.needsAttentionSetAt} END`,
        needsAttentionReason: reason ?? null,
      })
      .where(eq(tasks.id, taskId));

    let activityId: string | null = null;
    if (!wasFlagged && !opts.silent) {
      const now = new Date();
      await appendTaskNote(tx, {
        taskId,
        noteType: "system",
        content: formatAttentionFlaggedNote(reason, by, now),
        createdBy: by,
      });
      const activity = await recordTaskAttentionFlagged(tx, {
        taskId,
        reason,
        by,
        occurredAt: now,
      });
      activityId = activity.activityId;
    }
    return { wasFlagged, activityId };
  };

  return opts.tx ? run(opts.tx) : db.transaction(run);
}

export async function unflagAttention(
  taskId: string,
  opts: { tx?: TaskWriteClient; by?: TaskNoteCreatedBy; silent?: boolean } = {},
): Promise<AttentionWriteResult> {
  const by = opts.by ?? "agent";

  const run = async (tx: TaskWriteClient) => {
    const rows = await tx.select({ needsAttention: tasks.needsAttention }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (rows.length === 0) {
      throw new TaskNotFoundError(taskId);
    }
    const wasFlagged = rows[0].needsAttention;

    await tx
      .update(tasks)
      .set({
        needsAttention: false,
        needsAttentionSetAt: null,
        needsAttentionReason: null,
      })
      .where(eq(tasks.id, taskId));

    let activityId: string | null = null;
    if (wasFlagged && !opts.silent) {
      const now = new Date();
      await appendTaskNote(tx, {
        taskId,
        noteType: "system",
        content: formatAttentionClearedNote(by, now),
        createdBy: by,
      });
      const activity = await recordTaskAttentionCleared(tx, {
        taskId,
        by,
        occurredAt: now,
      });
      activityId = activity.activityId;
    }
    return { wasFlagged, activityId };
  };

  return opts.tx ? run(opts.tx) : db.transaction(run);
}
