import { eq, isNotNull, sql } from "drizzle-orm";
import { db, tasks } from "../index.js";
import type { TaskNoteCreatedBy, TaskActivitySource } from "../schema.js";
import { recordTaskQueueChanged } from "./append-task-activity.js";
import type { TaskWriteClient } from "./types.js";

export interface SetQueueEntry {
  taskId: string;
  rank: number;
  rationale: string;
}

export interface SetQueueOptions {
  tx?: TaskWriteClient;
  source?: TaskActivitySource;
  by?: TaskNoteCreatedBy;
}

/**
 * Atomically replaces the current agent task queue with the new entries.
 * Serializes replacements using a transaction-scoped advisory lock.
 */
export async function setQueue(
  entries: SetQueueEntry[],
  rankedAt: Date,
  opts: SetQueueOptions = {},
) {
  const run = async (tx: TaskWriteClient) => {
    // 0. Take a transaction-scoped advisory lock to serialize concurrent queue replacements
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('daily.tasks.queue'))`,
    );

    // 1. Read currently queued task IDs, ranks, and rationales
    const currentQueued = await tx
      .select({
        id: tasks.id,
        queueRank: tasks.queueRank,
        queueRationale: tasks.queueRationale,
      })
      .from(tasks)
      .where(isNotNull(tasks.queueRank));

    const currentQueueMap = new Map<string, { rank: number; rationale: string | null }>();
    for (const q of currentQueued) {
      if (q.queueRank !== null) {
        currentQueueMap.set(q.id, {
          rank: q.queueRank,
          rationale: q.queueRationale,
        });
      }
    }

    // 2. Identify leaving tasks and clear all queue fields in one update to avoid transient unique constraint violations
    const newEntryIds = new Set(entries.map((e) => e.taskId));
    const leavingIds = currentQueued
      .filter((q) => !newEntryIds.has(q.id))
      .map((q) => q.id);

    // Queue fields are ranking bookkeeping, not content edits: pin updated_at
    // to itself so the $onUpdate hook does not fire. Otherwise every re-rank
    // stamps updated_at after queue_ranked_at and the dashboard staleness
    // marker can never read current (batch-004 ISS-001).
    await tx
      .update(tasks)
      .set({
        queueRank: null,
        queueRationale: null,
        queueRankedAt: null,
        updatedAt: sql`${tasks.updatedAt}`,
      })
      .where(isNotNull(tasks.queueRank));

    // 3. Set queue fields on the new entries
    for (const entry of entries) {
      await tx
        .update(tasks)
        .set({
          queueRank: entry.rank,
          queueRationale: entry.rationale,
          queueRankedAt: rankedAt,
          updatedAt: sql`${tasks.updatedAt}`,
        })
        .where(eq(tasks.id, entry.taskId));
    }

    // 4. Record task activity for every affected task
    const activityIds: string[] = [];
    const source = opts.source ?? "cli";
    const by = opts.by ?? "agent";

    // For tasks leaving the queue
    for (const leavingId of leavingIds) {
      const previousRank = currentQueueMap.get(leavingId)?.rank ?? null;
      const activity = await recordTaskQueueChanged(tx, {
        taskId: leavingId,
        rank: null,
        previousRank,
        rationale: null,
        by,
        source,
        occurredAt: rankedAt,
      });
      activityIds.push(activity.activityId);
    }

    // For tasks entering/moving in the queue
    for (const entry of entries) {
      const previousState = currentQueueMap.get(entry.taskId);
      const previousRank = previousState?.rank ?? null;
      const previousRationale = previousState?.rationale ?? null;

      // Skip activity recording if both rank and rationale are completely unchanged
      if (previousRank === entry.rank && previousRationale === entry.rationale) {
        continue;
      }

      const activity = await recordTaskQueueChanged(tx, {
        taskId: entry.taskId,
        rank: entry.rank,
        previousRank,
        rationale: entry.rationale,
        by,
        source,
        occurredAt: rankedAt,
      });
      activityIds.push(activity.activityId);
    }

    return {
      set: entries.map((e) => e.taskId),
      cleared: leavingIds,
      activityIds,
    };
  };

  return opts.tx ? run(opts.tx) : db.transaction(run);
}



/**
 * Clears the queue entirely. Same as setQueue with zero entries.
 */
export async function clearQueue(rankedAt: Date, opts: SetQueueOptions = {}) {
  return setQueue([], rankedAt, opts);
}
