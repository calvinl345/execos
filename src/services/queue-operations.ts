import { eq } from "drizzle-orm";
import { db, tasks } from "../db/index.js";
import { TaskNotFoundError } from "../db/errors.js";
import {
  setQueue,
  type SetQueueEntry,
  type SetQueueOptions,
} from "../db/helpers/index.js";
import { normalizedOwner } from "../domain/follow-ups.js";
import type { TaskActivitySource, GateEventSurface } from "../db/schema.js";

export type TaskRow = typeof tasks.$inferSelect;

export interface QueueReceipt {
  operation: "re-rank";
  rankedAt: Date;
  entries: Array<{
    taskId: string;
    title: string;
    rank: number;
    rationale: string;
  }>;
  cleared: string[];
}

export interface QueueOperationDeps {
  now(): Date;
  findTask(taskId: string): Promise<TaskRow | null>;
  setQueue(
    entries: SetQueueEntry[],
    rankedAt: Date,
    opts?: SetQueueOptions,
  ): Promise<{ set: string[]; cleared: string[]; activityIds: string[] }>;
}

export const productionQueueOperationDeps: QueueOperationDeps = {
  now: () => new Date(),
  async findTask(taskId) {
    const rows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    return rows[0] ?? null;
  },
  setQueue,
};

export class QueueServiceError extends Error {
  constructor(
    public readonly code: "validation" | "terminal_task" | "delegated_owner" | "snoozed_task",
    message: string,
  ) {
    super(message);
    this.name = "QueueServiceError";
  }
}

/**
 * Funnel operation to replace or clear the agent queue of open tasks.
 * Validates eligibility constraints inside the operation before writing.
 */
export async function queueOperation(
  input: {
    entries: Array<{ taskId: string; why: string }>;
    clear?: boolean;
    surface?: GateEventSurface;
    source?: TaskActivitySource;
  },
  deps: QueueOperationDeps = productionQueueOperationDeps,
): Promise<QueueReceipt> {
  const clear = input.clear ?? false;
  const entriesInput = input.entries;

  // 1. Validate conflicting clear vs entries intent
  if (clear && entriesInput.length > 0) {
    throw new QueueServiceError(
      "validation",
      "Cannot clear queue while providing entries.",
    );
  }
  if (!clear && entriesInput.length === 0) {
    throw new QueueServiceError(
      "validation",
      "Cannot set queue with empty entries without the clear flag.",
    );
  }

  // 2. Validate count limit
  if (entriesInput.length > 5) {
    throw new QueueServiceError(
      "validation",
      "The queue cannot have more than 5 entries.",
    );
  }

  // 3. Validate distinct IDs
  const taskIds = entriesInput.map((e) => e.taskId);
  const distinctIds = new Set(taskIds);
  if (distinctIds.size !== taskIds.length) {
    throw new QueueServiceError(
      "validation",
      "Duplicate task IDs are not allowed in the queue entries.",
    );
  }

  const entriesToSet: SetQueueEntry[] = [];
  const entriesReceipt: QueueReceipt["entries"] = [];
  const rankedAt = deps.now();

  // 4. Validate each task and its rationale
  for (let i = 0; i < entriesInput.length; i++) {
    const entry = entriesInput[i];
    const rank = i + 1; // 1-based rank based on appearance order
    const rationale = entry.why.trim();

    if (rationale === "") {
      throw new QueueServiceError(
        "validation",
        `Rationale for task ${entry.taskId} cannot be empty.`,
      );
    }
    if (rationale.length > 200) {
      throw new QueueServiceError(
        "validation",
        `Rationale for task ${entry.taskId} exceeds 200 characters.`,
      );
    }

    const task = await deps.findTask(entry.taskId);
    if (!task) {
      throw new TaskNotFoundError(entry.taskId);
    }

    // Status must be non-terminal
    if (task.status === "done" || task.status === "cancelled") {
      throw new QueueServiceError(
        "terminal_task",
        `Task ${entry.taskId} is already terminal (${task.status}).`,
      );
    }

    // Must be self-owned
    if (normalizedOwner(task.owner) !== "me") {
      throw new QueueServiceError(
        "delegated_owner",
        `Task ${entry.taskId} is delegated to ${task.owner} and cannot be queued.`,
      );
    }

    // Must not be future-snoozed: a snoozed task is excluded from
    // prioritization until its snooze expires, so it cannot be ranked even by
    // direct id. Reuse the single rankedAt clock read for the comparison.
    if (task.snoozedUntil && task.snoozedUntil.getTime() > rankedAt.getTime()) {
      throw new QueueServiceError(
        "snoozed_task",
        `Task ${entry.taskId} is snoozed until ${task.snoozedUntil.toISOString()} and cannot be queued. Un-snooze it first.`,
      );
    }

    entriesToSet.push({
      taskId: entry.taskId,
      rank,
      rationale,
    });

    entriesReceipt.push({
      taskId: entry.taskId,
      title: task.title,
      rank,
      rationale,
    });
  }

  // 5. Call db helper to set/clear the queue
  const result = await deps.setQueue(entriesToSet, rankedAt, {
    source: input.source,
    by: "agent",
  });

  return {
    operation: "re-rank",
    rankedAt,
    entries: entriesReceipt,
    cleared: result.cleared,
  };
}
