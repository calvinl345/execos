import { describe, expect, it } from "vitest";
import { TaskNotFoundError } from "../../src/db/errors.js";
import {
  queueOperation,
  QueueServiceError,
  type QueueOperationDeps,
  type TaskRow,
} from "../../src/services/queue-operations.js";

function makeTask(partial: Partial<TaskRow> & Pick<TaskRow, "id">): TaskRow {
  const now = new Date("2026-06-07T12:00:00.000Z");
  return {
    id: partial.id,
    title: partial.title ?? `Task ${partial.id}`,
    description: partial.description ?? "A valid test task description",
    status: partial.status ?? "in_progress",
    priority: partial.priority ?? null,
    category: partial.category ?? "client",
    owner: partial.owner ?? "me",
    dueDate: partial.dueDate ?? null,
    followUpDate: partial.followUpDate ?? null,
    snoozedUntil: partial.snoozedUntil ?? null,
    handoffState: partial.handoffState ?? "not_applicable",
    handoffCopiedAt: partial.handoffCopiedAt ?? null,
    handoffLastCopiedAt: partial.handoffLastCopiedAt ?? null,
    handoffLastNudgeCopiedAt: partial.handoffLastNudgeCopiedAt ?? null,
    goalId: partial.goalId ?? null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    completedAt: partial.completedAt ?? null,
    cancelledAt: partial.cancelledAt ?? null,
    lastStatusChangeAt: partial.lastStatusChangeAt ?? now,
    lastUnblockedAt: partial.lastUnblockedAt ?? null,
    needsAttention: partial.needsAttention ?? false,
    needsAttentionSetAt: partial.needsAttentionSetAt ?? null,
    needsAttentionReason: partial.needsAttentionReason ?? null,
    embedding: partial.embedding ?? null,
    hardDeadline: partial.hardDeadline ?? false,
    effort: partial.effort ?? null,
    queueRank: partial.queueRank ?? null,
    queueRationale: partial.queueRationale ?? null,
    queueRankedAt: partial.queueRankedAt ?? null,
  };
}

interface SetQueueCall {
  entries: Array<{ taskId: string; rank: number; rationale: string }>;
  rankedAt: Date;
  opts?: { source?: string; by?: string };
}

function makeDeps(seed: TaskRow[]): QueueOperationDeps & {
  tasksById: Map<string, TaskRow>;
  calls: SetQueueCall[];
} {
  const tasksById = new Map(seed.map((t) => [t.id, t]));
  const calls: SetQueueCall[] = [];
  return {
    tasksById,
    calls,
    now: () => new Date("2026-06-07T12:00:00.000Z"),
    async findTask(taskId) {
      return tasksById.get(taskId) ?? null;
    },
    async setQueue(entries, rankedAt, opts) {
      calls.push({ entries, rankedAt, opts });
      // Simulate setQueue DB helper by updating our in-memory tasks
      // 1. Clear all queued fields on seed tasks
      for (const t of tasksById.values()) {
        t.queueRank = null;
        t.queueRationale = null;
        t.queueRankedAt = null;
      }
      // 2. Set new entries
      for (const entry of entries) {
        const t = tasksById.get(entry.taskId);
        if (t) {
          t.queueRank = entry.rank;
          t.queueRationale = entry.rationale;
          t.queueRankedAt = rankedAt;
        }
      }
      return {
        set: entries.map((e) => e.taskId),
        cleared: seed
          .filter((t) => t.queueRank === null && entries.every((e) => e.taskId !== t.id))
          .map((t) => t.id),
        activityIds: entries.map((e) => `act-${e.taskId}`),
      };
    },
  };
}

describe("queueOperation service", () => {
  it("happy path: 5 entries assigns correct ranks, timestamps, and receipt shape", async () => {
    const seed = [
      makeTask({ id: "KS-001" }),
      makeTask({ id: "KS-002" }),
      makeTask({ id: "KS-003" }),
      makeTask({ id: "KS-004" }),
      makeTask({ id: "KS-005" }),
    ];
    const deps = makeDeps(seed);

    const input = {
      entries: [
        { taskId: "KS-001", why: "Priority 1" },
        { taskId: "KS-002", why: "Priority 2" },
        { taskId: "KS-003", why: "Priority 3" },
        { taskId: "KS-004", why: "Priority 4" },
        { taskId: "KS-005", why: "Priority 5" },
      ],
      source: "cli" as const,
    };

    const receipt = await queueOperation(input, deps);

    expect(deps.calls.length).toBe(1);
    expect(deps.calls[0].entries).toEqual([
      { taskId: "KS-001", rank: 1, rationale: "Priority 1" },
      { taskId: "KS-002", rank: 2, rationale: "Priority 2" },
      { taskId: "KS-003", rank: 3, rationale: "Priority 3" },
      { taskId: "KS-004", rank: 4, rationale: "Priority 4" },
      { taskId: "KS-005", rank: 5, rationale: "Priority 5" },
    ]);
    expect(deps.calls[0].opts).toEqual({ source: "cli", by: "agent" });

    expect(receipt).toEqual({
      operation: "re-rank",
      rankedAt: deps.now(),
      entries: [
        { taskId: "KS-001", title: "Task KS-001", rank: 1, rationale: "Priority 1" },
        { taskId: "KS-002", title: "Task KS-002", rank: 2, rationale: "Priority 2" },
        { taskId: "KS-003", title: "Task KS-003", rank: 3, rationale: "Priority 3" },
        { taskId: "KS-004", title: "Task KS-004", rank: 4, rationale: "Priority 4" },
        { taskId: "KS-005", title: "Task KS-005", rank: 5, rationale: "Priority 5" },
      ],
      cleared: expect.any(Array),
    });
  });

  it("happy path: 1 entry", async () => {
    const seed = [makeTask({ id: "KS-001" })];
    const deps = makeDeps(seed);

    const input = {
      entries: [{ taskId: "KS-001", why: "Standalone task" }],
    };

    const receipt = await queueOperation(input, deps);
    expect(receipt.entries.length).toBe(1);
    expect(receipt.entries[0].rank).toBe(1);
  });

  it("happy path: clear queue", async () => {
    const seed = [
      makeTask({ id: "KS-001", queueRank: 1, queueRationale: "Old" }),
    ];
    const deps = makeDeps(seed);

    const input = {
      entries: [],
      clear: true,
    };

    const receipt = await queueOperation(input, deps);
    expect(receipt.entries).toEqual([]);
    expect(deps.calls[0].entries).toEqual([]);
  });

  it("happy path: an arrived-snooze task (past snoozed_until) is queueable", async () => {
    const deps = makeDeps([
      makeTask({ id: "KS-001", snoozedUntil: new Date("2026-06-06T12:00:00.000Z") }),
    ]);

    const receipt = await queueOperation(
      { entries: [{ taskId: "KS-001", why: "Snooze elapsed; do it now" }] },
      deps,
    );
    expect(receipt.entries[0].rank).toBe(1);
    expect(deps.calls.length).toBe(1);
  });

  describe("guards and validation failures (throws before writing)", () => {
    it("0 entries without clear flag throws", async () => {
      const deps = makeDeps([]);
      await expect(queueOperation({ entries: [] }, deps)).rejects.toThrowError(
        new QueueServiceError("validation", "Cannot set queue with empty entries without the clear flag."),
      );
      expect(deps.calls.length).toBe(0);
    });

    it("6 entries throws validation error", async () => {
      const seed = Array.from({ length: 6 }, (_, i) => makeTask({ id: `KS-00${i + 1}` }));
      const deps = makeDeps(seed);

      const entries = seed.map((t) => ({ taskId: t.id, why: "Why" }));
      await expect(queueOperation({ entries }, deps)).rejects.toThrowError(
        new QueueServiceError("validation", "The queue cannot have more than 5 entries."),
      );
      expect(deps.calls.length).toBe(0);
    });

    it("duplicate task IDs throws validation error", async () => {
      const deps = makeDeps([makeTask({ id: "KS-001" })]);
      await expect(
        queueOperation(
          {
            entries: [
              { taskId: "KS-001", why: "A" },
              { taskId: "KS-001", why: "B" },
            ],
          },
          deps,
        ),
      ).rejects.toThrowError(
        new QueueServiceError("validation", "Duplicate task IDs are not allowed in the queue entries."),
      );
      expect(deps.calls.length).toBe(0);
    });

    it("unknown task ID throws TaskNotFoundError", async () => {
      const deps = makeDeps([]);
      await expect(
        queueOperation({ entries: [{ taskId: "KS-999", why: "Help" }] }, deps),
      ).rejects.toThrowError(new TaskNotFoundError("KS-999"));
      expect(deps.calls.length).toBe(0);
    });

    it("terminal status done throws terminal task error", async () => {
      const deps = makeDeps([makeTask({ id: "KS-001", status: "done" })]);
      await expect(
        queueOperation({ entries: [{ taskId: "KS-001", why: "Help" }] }, deps),
      ).rejects.toThrowError(
        new QueueServiceError("terminal_task", "Task KS-001 is already terminal (done)."),
      );
      expect(deps.calls.length).toBe(0);
    });

    it("terminal status cancelled throws terminal task error", async () => {
      const deps = makeDeps([makeTask({ id: "KS-001", status: "cancelled" })]);
      await expect(
        queueOperation({ entries: [{ taskId: "KS-001", why: "Help" }] }, deps),
      ).rejects.toThrowError(
        new QueueServiceError("terminal_task", "Task KS-001 is already terminal (cancelled)."),
      );
      expect(deps.calls.length).toBe(0);
    });

    it("delegated owner throws delegated owner error", async () => {
      const deps = makeDeps([makeTask({ id: "KS-001", owner: "noah" })]);
      await expect(
        queueOperation({ entries: [{ taskId: "KS-001", why: "Help" }] }, deps),
      ).rejects.toThrowError(
        new QueueServiceError("delegated_owner", "Task KS-001 is delegated to noah and cannot be queued."),
      );
      expect(deps.calls.length).toBe(0);
    });

    it("future-snoozed task throws snoozed_task error", async () => {
      const deps = makeDeps([
        makeTask({ id: "KS-001", snoozedUntil: new Date("2026-06-08T12:00:00.000Z") }),
      ]);
      await expect(
        queueOperation({ entries: [{ taskId: "KS-001", why: "Help" }] }, deps),
      ).rejects.toThrowError(
        new QueueServiceError(
          "snoozed_task",
          "Task KS-001 is snoozed until 2026-06-08T12:00:00.000Z and cannot be queued. Un-snooze it first.",
        ),
      );
      expect(deps.calls.length).toBe(0);
    });

    it("empty rationale throws validation error", async () => {
      const deps = makeDeps([makeTask({ id: "KS-001" })]);
      await expect(
        queueOperation({ entries: [{ taskId: "KS-001", why: "   " }] }, deps),
      ).rejects.toThrowError(
        new QueueServiceError("validation", "Rationale for task KS-001 cannot be empty."),
      );
      expect(deps.calls.length).toBe(0);
    });

    it("201-character rationale throws validation error", async () => {
      const deps = makeDeps([makeTask({ id: "KS-001" })]);
      const why = "a".repeat(201);
      await expect(
        queueOperation({ entries: [{ taskId: "KS-001", why }] }, deps),
      ).rejects.toThrowError(
        new QueueServiceError("validation", "Rationale for task KS-001 exceeds 200 characters."),
      );
      expect(deps.calls.length).toBe(0);
    });

    it("clear flag combined with non-empty entries throws validation error", async () => {
      const deps = makeDeps([makeTask({ id: "KS-001" })]);
      await expect(
        queueOperation(
          {
            entries: [{ taskId: "KS-001", why: "why" }],
            clear: true,
          },
          deps,
        ),
      ).rejects.toThrowError(
        new QueueServiceError("validation", "Cannot clear queue while providing entries."),
      );
      expect(deps.calls.length).toBe(0);
    });
  });
});
