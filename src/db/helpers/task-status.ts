/**
 * Atomic task status change (replaces tasks_status_change_trigger per
 * ADR-006).
 *
 *   updateTaskStatus(taskId, newStatus, by?): wraps the UPDATE on tasks
 *     and the INSERT on task_notes (a status_change audit row) in a
 *     single Drizzle transaction. Per AC-074, both writes succeed or
 *     both roll back. Per Appendix G.3.1, the audit row's content is
 *     JSON-encoded `{from, to, by, at}`.
 *
 * Side effects mirroring the original PL/pgSQL trigger:
 *   - bumps last_status_change_at to now()
 *   - sets completed_at = now() iff newStatus = 'done'
 *   - sets cancelled_at = now() iff newStatus = 'cancelled'
 *   - sets last_unblocked_at = now() iff oldStatus = 'blocked'
 *     and newStatus is anything else
 *   - clears needs_attention metadata when newStatus is terminal
 *
 * Transition matrix enforcement (Appendix A.1.1) is NOT performed here.
 * The CLI calls the canTransition() pure-function check before invoking
 * this helper. updateTaskStatus is the atomic-write primitive;
 * canTransition is the policy check.
 *
 * P0 WIP cap enforcement (Appendix A.6 #5) lives in
 * enforcePZeroWipCap() and is called by callers that may set or
 * change priority to P0 (task create / update). Not invoked here
 * because status change alone does not increase the P0 count; it only
 * ever decreases it (e.g., P0 done).
 */

import { eq, sql } from "drizzle-orm";
import { db, tasks } from "../index.js";
import type { TaskStatus, TaskNoteCreatedBy, TaskActivitySource } from "../schema.js";
import { TaskNotFoundError } from "../errors.js";
import { formatStatusChangeNote } from "./formatters.js";
import { appendTaskNote } from "./append-task-note.js";
import { recordTaskStatusChanged } from "./append-task-activity.js";
import type { TaskWriteClient } from "./types.js";

export interface UpdateTaskStatusResult {
  taskId: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  noteId: string;
  activityId: string;
  changedAt: Date;
}

export async function updateTaskStatus(
  taskId: string,
  newStatus: TaskStatus,
  by: TaskNoteCreatedBy = "agent",
  opts: { tx?: TaskWriteClient; source?: TaskActivitySource } = {},
): Promise<UpdateTaskStatusResult> {
  const run = async (tx: TaskWriteClient) => {
    // Read current status (with FOR UPDATE row lock).
    const current = await tx.execute<{ status: TaskStatus } & Record<string, unknown>>(
      sql`SELECT status FROM tasks WHERE id = ${taskId} FOR UPDATE`,
    );
    const currentRows = current as unknown as Array<{ status: TaskStatus }>;
    if (currentRows.length === 0) {
      throw new TaskNotFoundError(taskId);
    }
    const fromStatus = currentRows[0].status;

    if (fromStatus === newStatus) {
      // No-op: same status. Do not write an audit row for a non-change.
      return {
        taskId,
        fromStatus,
        toStatus: newStatus,
        noteId: "",
        activityId: "",
        changedAt: new Date(),
      };
    }

    const now = new Date();

    // Compose the UPDATE patch with all conditional side effects.
    const patch: Record<string, unknown> = {
      status: newStatus,
      lastStatusChangeAt: now,
    };
    if (newStatus === "done") {
      patch.completedAt = now;
    }
    if (newStatus === "cancelled") {
      patch.cancelledAt = now;
    }
    // Leaving a terminal status (e.g. reopen done -> backlog) must clear the
    // terminal timestamp, keyed on the FROM status. Otherwise an open task can
    // still carry a stale completedAt/cancelledAt, violating the invariant.
    if (fromStatus === "done") {
      patch.completedAt = null;
    }
    if (fromStatus === "cancelled") {
      patch.cancelledAt = null;
    }
    if (newStatus === "done" || newStatus === "cancelled") {
      patch.needsAttention = false;
      patch.needsAttentionSetAt = null;
      patch.needsAttentionReason = null;
    }
    if (fromStatus === "blocked") {
      patch.lastUnblockedAt = now;
    }

    await tx
      .update(tasks)
      .set(patch)
      .where(eq(tasks.id, taskId));

    const { noteId } = await appendTaskNote(tx, {
      taskId,
      noteType: "status_change",
      content: formatStatusChangeNote(fromStatus, newStatus, by, now),
      createdBy: by,
    });
    const { activityId } = await recordTaskStatusChanged(tx, {
      taskId,
      fromStatus,
      toStatus: newStatus,
      by,
      occurredAt: now,
      source: opts.source,
    });

    return {
      taskId,
      fromStatus,
      toStatus: newStatus,
      noteId,
      activityId,
      changedAt: now,
    };
  };

  return opts.tx ? run(opts.tx) : db.transaction(run);
}
