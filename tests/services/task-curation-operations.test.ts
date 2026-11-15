/**
 * Behavioral goldens for src/services/task-curation-operations.ts
 * (change-008, T5/A13c, design A10).
 *
 * EXPECTED RED until the implementation task (T6) lands: the operation bodies
 * in src/services/task-curation-operations.ts are skeletons that throw
 * `new Error("not implemented")`. These tests are LOCKED enforcement goldens
 * written against the skeleton signatures; the build agent must satisfy
 * them, never edit them.
 *
 * Pattern: tests/services/follow-up-operations.test.ts — fully fake deps with
 * in-memory state and spy-style recorders. No DB.
 */

import { describe, expect, it } from "vitest";
import { TaskDependencyCycleError } from "../../src/db/errors.js";
import type { TaskRow } from "../../src/services/task-operations.js";
import {
  CurationServiceError,
  dependencyAddOperation,
  dependencyRemoveOperation,
  flagAttentionOperation,
  unflagAttentionOperation,
  type CurationOperationDeps,
  type CurationWriteClient,
  type TaskDependencyInsertRow,
  type TaskDependencyRow,
} from "../../src/services/task-curation-operations.js";

const FIXED_NOW = new Date("2026-06-09T12:00:00.000Z");

function makeTask(partial: Partial<TaskRow> & Pick<TaskRow, "id">): TaskRow {
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
    createdAt: partial.createdAt ?? FIXED_NOW,
    updatedAt: partial.updatedAt ?? FIXED_NOW,
    completedAt: partial.completedAt ?? null,
    cancelledAt: partial.cancelledAt ?? null,
    lastStatusChangeAt: partial.lastStatusChangeAt ?? FIXED_NOW,
    lastUnblockedAt: partial.lastUnblockedAt ?? null,
    needsAttention: partial.needsAttention ?? false,
    needsAttentionSetAt: partial.needsAttentionSetAt ?? null,
    needsAttentionReason: partial.needsAttentionReason ?? null,
    embedding: partial.embedding ?? null,
    hardDeadline: partial.hardDeadline ?? false,
    effort: partial.effort ?? null,
    queueRank: null,
    queueRationale: null,
    queueRankedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Fake deps: in-memory edge store + spy recorders.
// ---------------------------------------------------------------------------

interface RecordedCall {
  name: string;
  tx?: unknown;
}

interface CurationFakeState {
  tasksById: Map<string, TaskRow>;
  dependencies: TaskDependencyRow[];
  inserted: Array<{ tx: unknown; row: TaskDependencyInsertRow }>;
  deleted: Array<{ tx: unknown; blockerTaskId: string; blockedTaskId: string }>;
  notes: Array<{ tx: unknown; taskId: string; noteType: string; content: string }>;
  activities: Array<{ tx: unknown; kind: string; input: Record<string, unknown> }>;
  cycleChecks: Array<{ blockerTaskId: string; blockedTaskId: string }>;
  flagCalls: Array<{ taskId: string; reason: string | null | undefined; silent: boolean | undefined }>;
  unflagCalls: Array<{ taskId: string; silent: boolean | undefined }>;
  callLog: RecordedCall[];
  txs: unknown[];
  gateEvents: Array<{ gate: string; operation: string; outcome: string; surface: string; taskId: string | null | undefined }>;
}

interface MakeDepsOptions {
  tasks?: TaskRow[];
  dependencies?: TaskDependencyRow[];
  cycleError?: Error;
}

function makeDeps(opts: MakeDepsOptions = {}): {
  deps: CurationOperationDeps;
  state: CurationFakeState;
} {
  const state: CurationFakeState = {
    tasksById: new Map((opts.tasks ?? []).map((task) => [task.id, task])),
    dependencies: [...(opts.dependencies ?? [])],
    inserted: [],
    deleted: [],
    notes: [],
    activities: [],
    cycleChecks: [],
    flagCalls: [],
    unflagCalls: [],
    callLog: [],
    txs: [],
    gateEvents: [],
  };
  let txSeq = 0;
  let noteSeq = 0;

  const deps: CurationOperationDeps = {
    now: () => FIXED_NOW,
    async findTask(taskId) {
      return state.tasksById.get(taskId) ?? null;
    },
    async findDependency(blockerTaskId, blockedTaskId) {
      return (
        state.dependencies.find(
          (d) => d.blockerTaskId === blockerTaskId && d.blockedTaskId === blockedTaskId,
        ) ?? null
      );
    },
    async insertDependency(tx, row) {
      state.callLog.push({ name: "insertDependency", tx });
      state.inserted.push({ tx, row });
      state.dependencies.push({
        id: row.id,
        blockerTaskId: row.blockerTaskId,
        blockedTaskId: row.blockedTaskId,
        createdAt: row.createdAt ?? FIXED_NOW,
      });
    },
    async deleteDependency(tx, blockerTaskId, blockedTaskId) {
      state.callLog.push({ name: "deleteDependency", tx });
      state.deleted.push({ tx, blockerTaskId, blockedTaskId });
      state.dependencies = state.dependencies.filter(
        (d) => !(d.blockerTaskId === blockerTaskId && d.blockedTaskId === blockedTaskId),
      );
    },
    async runInTransaction<T>(fn: (tx: CurationWriteClient) => Promise<T>): Promise<T> {
      txSeq += 1;
      const tx = { __fakeTx: txSeq } as unknown as CurationWriteClient;
      state.txs.push(tx);
      state.callLog.push({ name: "tx:begin", tx });
      return fn(tx);
    },
    async recordGateEvent(input) {
      state.callLog.push({ name: "recordGateEvent" });
      state.gateEvents.push({
        gate: input.gate,
        operation: input.operation,
        outcome: input.outcome,
        surface: input.surface,
        taskId: input.taskId,
      });
      return { gateEventId: `gate-${state.gateEvents.length}`, warning: null };
    },
    async assertNoCycle(blockerTaskId, blockedTaskId) {
      state.callLog.push({ name: "assertNoCycle" });
      state.cycleChecks.push({ blockerTaskId, blockedTaskId });
      if (opts.cycleError) throw opts.cycleError;
    },
    async appendTaskNote(tx, input) {
      noteSeq += 1;
      state.callLog.push({ name: "appendTaskNote", tx });
      state.notes.push({
        tx,
        taskId: input.taskId,
        noteType: input.noteType,
        content: input.content,
      });
      return { noteId: `note-${input.taskId}-${noteSeq}` };
    },
    async recordTaskDependencyAdded(tx, input) {
      state.callLog.push({ name: "recordTaskDependencyAdded", tx });
      state.activities.push({
        tx,
        kind: "task_dependency_added",
        input: input as unknown as Record<string, unknown>,
      });
      return { activityId: `ACT-dep-added-${input.taskId}` };
    },
    async recordTaskDependencyRemoved(tx, input) {
      state.callLog.push({ name: "recordTaskDependencyRemoved", tx });
      state.activities.push({
        tx,
        kind: "task_dependency_removed",
        input: input as unknown as Record<string, unknown>,
      });
      return { activityId: `ACT-dep-removed-${input.taskId}` };
    },
    async flagAttention(taskId, reason, flagOpts = {}) {
      state.callLog.push({ name: "flagAttention" });
      state.flagCalls.push({ taskId, reason, silent: flagOpts.silent });
      const current = state.tasksById.get(taskId);
      const wasFlagged = current?.needsAttention ?? false;
      if (current) {
        state.tasksById.set(taskId, {
          ...current,
          needsAttention: true,
          needsAttentionSetAt: current.needsAttention
            ? current.needsAttentionSetAt
            : FIXED_NOW,
          needsAttentionReason: reason ?? null,
        });
      }
      // Mirrors the real helper: an activity is written only when the flag
      // state changed AND the write is not silent.
      const activityId =
        !wasFlagged && !flagOpts.silent ? `ACT-flag-${taskId}` : null;
      return { wasFlagged, activityId };
    },
    async unflagAttention(taskId, unflagOpts = {}) {
      state.callLog.push({ name: "unflagAttention" });
      state.unflagCalls.push({ taskId, silent: unflagOpts.silent });
      const current = state.tasksById.get(taskId);
      const wasFlagged = current?.needsAttention ?? false;
      if (current) {
        state.tasksById.set(taskId, {
          ...current,
          needsAttention: false,
          needsAttentionSetAt: null,
          needsAttentionReason: null,
        });
      }
      const activityId =
        wasFlagged && !unflagOpts.silent ? `ACT-unflag-${taskId}` : null;
      return { wasFlagged, activityId };
    },
  };

  return { deps, state };
}

function callIndex(state: CurationFakeState, name: string): number {
  return state.callLog.findIndex((call) => call.name === name);
}

function makeEdge(partial: Partial<TaskDependencyRow> = {}): TaskDependencyRow {
  return {
    id: partial.id ?? "DEP-1",
    blockerTaskId: partial.blockerTaskId ?? "KS-B",
    blockedTaskId: partial.blockedTaskId ?? "KS-A",
    createdAt: partial.createdAt ?? FIXED_NOW,
  };
}

// ---------------------------------------------------------------------------
// dependencyAddOperation
// ---------------------------------------------------------------------------

describe("dependencyAddOperation", () => {
  it("checks for cycles before inserting, then audits BOTH tasks in one transaction", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-A" }), makeTask({ id: "KS-B" })],
    });

    const receipt = await dependencyAddOperation(
      { blockedTaskId: "KS-A", blockerTaskId: "KS-B" },
      deps,
    );

    // assertNoCycle runs with the edge's blocker/blocked pair, BEFORE the insert.
    expect(state.cycleChecks).toEqual([{ blockerTaskId: "KS-B", blockedTaskId: "KS-A" }]);
    expect(callIndex(state, "assertNoCycle")).toBeLessThan(
      callIndex(state, "insertDependency"),
    );

    // One edge insert inside the transaction.
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].row.blockerTaskId).toBe("KS-B");
    expect(state.inserted[0].row.blockedTaskId).toBe("KS-A");
    expect(state.txs).toHaveLength(1);
    expect(state.inserted[0].tx).toBe(state.txs[0]);

    // System notes on BOTH tasks, same transaction.
    expect(state.notes).toHaveLength(2);
    expect(new Set(state.notes.map((n) => n.taskId))).toEqual(new Set(["KS-A", "KS-B"]));
    for (const note of state.notes) {
      expect(note.noteType).toBe("system");
      expect(note.tx).toBe(state.txs[0]);
    }

    // recordTaskDependencyAdded on BOTH tasks with the full edge payload.
    const added = state.activities.filter((a) => a.kind === "task_dependency_added");
    expect(added).toHaveLength(2);
    expect(new Set(added.map((a) => a.input.taskId))).toEqual(new Set(["KS-A", "KS-B"]));
    for (const activity of added) {
      expect(activity.input.blockerTaskId).toBe("KS-B");
      expect(activity.input.blockedTaskId).toBe("KS-A");
      expect(activity.tx).toBe(state.txs[0]);
    }

    // Receipt shape: base refers to the BLOCKED task; audit ids in
    // [blocked, blocker] order.
    expect(receipt.operation).toBe("dependency-add");
    expect(receipt.taskId).toBe("KS-A");
    expect(receipt.task.id).toBe("KS-A");
    expect(receipt.blockerTaskId).toBe("KS-B");
    expect(receipt.blockedTaskId).toBe("KS-A");
    expect(receipt.created).toBe(true);
    expect(typeof receipt.dependencyId).toBe("string");
    expect(receipt.dependencyId.length).toBeGreaterThan(0);
    expect(receipt.noteIds).toHaveLength(2);
    expect(receipt.noteIds[0]).toContain("KS-A");
    expect(receipt.noteIds[1]).toContain("KS-B");
    expect(receipt.activityIds).toEqual(["ACT-dep-added-KS-A", "ACT-dep-added-KS-B"]);
    expect(Array.isArray(receipt.warnings)).toBe(true);
    // Base activityId echoes the blocked task's activity (activityIds[0]).
    expect(receipt.activityId).toBe("ACT-dep-added-KS-A");
  });

  it("is an idempotent no-op for an existing edge (created: false, no writes)", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-A" }), makeTask({ id: "KS-B" })],
      dependencies: [makeEdge({ id: "DEP-1", blockerTaskId: "KS-B", blockedTaskId: "KS-A" })],
    });

    const receipt = await dependencyAddOperation(
      { blockedTaskId: "KS-A", blockerTaskId: "KS-B" },
      deps,
    );

    expect(receipt.created).toBe(false);
    expect(receipt.dependencyId).toBe("DEP-1");
    expect(receipt.noteIds).toEqual([]);
    expect(receipt.activityIds).toEqual([]);
    expect(receipt.activityId).toBeNull();
    expect(state.inserted).toHaveLength(0);
    expect(state.notes).toHaveLength(0);
    expect(state.activities).toHaveLength(0);
  });

  it("propagates TaskDependencyCycleError without inserting or auditing", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-A" }), makeTask({ id: "KS-B" })],
      cycleError: new TaskDependencyCycleError("KS-B", "KS-A"),
    });

    await expect(
      dependencyAddOperation({ blockedTaskId: "KS-A", blockerTaskId: "KS-B" }, deps),
    ).rejects.toBeInstanceOf(TaskDependencyCycleError);
    expect(state.inserted).toHaveLength(0);
    expect(state.notes).toHaveLength(0);
    expect(state.activities).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// dependencyRemoveOperation
// ---------------------------------------------------------------------------

describe("dependencyRemoveOperation", () => {
  it("removes the edge and mirrors the note/activity pair on BOTH tasks", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-A" }), makeTask({ id: "KS-B" })],
      dependencies: [makeEdge({ id: "DEP-1", blockerTaskId: "KS-B", blockedTaskId: "KS-A" })],
    });

    const receipt = await dependencyRemoveOperation(
      { blockedTaskId: "KS-A", blockerTaskId: "KS-B" },
      deps,
    );

    expect(state.deleted).toHaveLength(1);
    expect(state.deleted[0].blockerTaskId).toBe("KS-B");
    expect(state.deleted[0].blockedTaskId).toBe("KS-A");
    expect(state.txs).toHaveLength(1);
    expect(state.deleted[0].tx).toBe(state.txs[0]);

    expect(state.notes).toHaveLength(2);
    expect(new Set(state.notes.map((n) => n.taskId))).toEqual(new Set(["KS-A", "KS-B"]));
    for (const note of state.notes) {
      expect(note.noteType).toBe("system");
      expect(note.tx).toBe(state.txs[0]);
    }

    const removed = state.activities.filter((a) => a.kind === "task_dependency_removed");
    expect(removed).toHaveLength(2);
    expect(new Set(removed.map((a) => a.input.taskId))).toEqual(new Set(["KS-A", "KS-B"]));
    for (const activity of removed) {
      expect(activity.input.blockerTaskId).toBe("KS-B");
      expect(activity.input.blockedTaskId).toBe("KS-A");
    }

    expect(receipt.operation).toBe("dependency-remove");
    expect(receipt.taskId).toBe("KS-A");
    expect(receipt.task.id).toBe("KS-A");
    expect(receipt.blockerTaskId).toBe("KS-B");
    expect(receipt.blockedTaskId).toBe("KS-A");
    expect(receipt.noteIds).toHaveLength(2);
    expect(receipt.noteIds[0]).toContain("KS-A");
    expect(receipt.noteIds[1]).toContain("KS-B");
    expect(receipt.activityIds).toEqual(["ACT-dep-removed-KS-A", "ACT-dep-removed-KS-B"]);
    expect(Array.isArray(receipt.warnings)).toBe(true);
    // Base activityId echoes the blocked task's activity (activityIds[0]).
    expect(receipt.activityId).toBe("ACT-dep-removed-KS-A");
  });

  it("throws CurationServiceError('dependency_not_found') for a missing edge", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-A" }), makeTask({ id: "KS-B" })],
    });

    const err: unknown = await dependencyRemoveOperation(
      { blockedTaskId: "KS-A", blockerTaskId: "KS-B" },
      deps,
    ).then(
      () => {
        throw new Error("removing a missing edge must reject");
      },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(CurationServiceError);
    expect((err as CurationServiceError).code).toBe("dependency_not_found");
    expect(state.deleted).toHaveLength(0);
    expect(state.notes).toHaveLength(0);
    expect(state.activities).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// flagAttentionOperation / unflagAttentionOperation
// ---------------------------------------------------------------------------

describe("flagAttentionOperation", () => {
  it("wraps the flagAttention helper with audit ON by default", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-A", needsAttention: false })],
    });

    const receipt = await flagAttentionOperation(
      { taskId: "KS-A", reason: "Client escalation" },
      deps,
    );

    expect(state.flagCalls).toHaveLength(1);
    expect(state.flagCalls[0].taskId).toBe("KS-A");
    expect(state.flagCalls[0].reason).toBe("Client escalation");
    // Audit ON: the helper must NOT be called with silent true.
    expect(state.flagCalls[0].silent ?? false).toBe(false);

    expect(receipt.operation).toBe("flag-attention");
    expect(receipt.taskId).toBe("KS-A");
    expect(receipt.task.id).toBe("KS-A");
    expect(receipt.reason).toBe("Client escalation");
    expect(receipt.alreadyFlagged).toBe(false);
    expect(receipt.silent).toBe(false);
    expect(Array.isArray(receipt.warnings)).toBe(true);
    // The receipt must carry the REAL activity id from the helper's audit
    // write (AttentionWriteResult), not a synthesized value.
    expect(receipt.activityId).toBe("ACT-flag-KS-A");
  });

  it("honors the silent option: helper called with silent true, receipt echoes it", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-A", needsAttention: false })],
    });

    const receipt = await flagAttentionOperation(
      { taskId: "KS-A", reason: "refresh sweep", silent: true },
      deps,
    );

    expect(state.flagCalls).toHaveLength(1);
    expect(state.flagCalls[0].silent).toBe(true);
    expect(receipt.silent).toBe(true);
    // Silent writes produce no activity; the receipt must say so honestly.
    expect(receipt.activityId).toBeNull();
  });

  it("reports alreadyFlagged for a task that is already flagged", async () => {
    const { deps } = makeDeps({
      tasks: [
        makeTask({
          id: "KS-A",
          needsAttention: true,
          needsAttentionSetAt: new Date("2026-06-01T12:00:00.000Z"),
          needsAttentionReason: "old reason",
        }),
      ],
    });

    const receipt = await flagAttentionOperation({ taskId: "KS-A", reason: "new reason" }, deps);

    expect(receipt.alreadyFlagged).toBe(true);
  });
});

describe("unflagAttentionOperation", () => {
  it("wraps the unflagAttention helper with audit ON by default", async () => {
    const { deps, state } = makeDeps({
      tasks: [
        makeTask({
          id: "KS-A",
          needsAttention: true,
          needsAttentionSetAt: FIXED_NOW,
          needsAttentionReason: "stuck",
        }),
      ],
    });

    const receipt = await unflagAttentionOperation({ taskId: "KS-A" }, deps);

    expect(state.unflagCalls).toHaveLength(1);
    expect(state.unflagCalls[0].taskId).toBe("KS-A");
    expect(state.unflagCalls[0].silent ?? false).toBe(false);

    expect(receipt.operation).toBe("unflag-attention");
    expect(receipt.taskId).toBe("KS-A");
    expect(receipt.task.id).toBe("KS-A");
    expect(receipt.alreadyClear).toBe(false);
    expect(receipt.silent).toBe(false);
    expect(Array.isArray(receipt.warnings)).toBe(true);
    // The receipt must carry the REAL activity id from the helper's audit
    // write (AttentionWriteResult), not a synthesized value.
    expect(receipt.activityId).toBe("ACT-unflag-KS-A");
  });

  it("honors the silent option: helper called with silent true, receipt echoes it", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-A", needsAttention: true, needsAttentionSetAt: FIXED_NOW })],
    });

    const receipt = await unflagAttentionOperation({ taskId: "KS-A", silent: true }, deps);

    expect(state.unflagCalls).toHaveLength(1);
    expect(state.unflagCalls[0].silent).toBe(true);
    expect(receipt.silent).toBe(true);
    // Silent writes produce no activity; the receipt must say so honestly.
    expect(receipt.activityId).toBeNull();
  });

  it("reports alreadyClear for a task that was not flagged", async () => {
    const { deps } = makeDeps({
      tasks: [makeTask({ id: "KS-A", needsAttention: false })],
    });

    const receipt = await unflagAttentionOperation({ taskId: "KS-A" }, deps);

    expect(receipt.alreadyClear).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gate-decision telemetry (W5 gate_events instrumentation).
// ---------------------------------------------------------------------------

describe("gate event instrumentation (dependency-add)", () => {
  it("a dependency cycle logs a blocked dependency_cycle event and still throws", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-A" }), makeTask({ id: "KS-B" })],
      cycleError: new TaskDependencyCycleError("KS-B", "KS-A"),
    });

    await expect(
      dependencyAddOperation({ blockedTaskId: "KS-A", blockerTaskId: "KS-B" }, deps),
    ).rejects.toBeInstanceOf(TaskDependencyCycleError);

    expect(state.gateEvents).toEqual([
      {
        gate: "dependency_cycle",
        operation: "dependency-add",
        outcome: "blocked",
        surface: "cli",
        taskId: "KS-A",
      },
    ]);
    // The refusal wrote no edge, notes, or activities.
    expect(state.inserted).toHaveLength(0);
    expect(state.notes).toHaveLength(0);
  });

  it("a clean dependency-add logs NO gate event", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-A" }), makeTask({ id: "KS-B" })],
    });

    await dependencyAddOperation({ blockedTaskId: "KS-A", blockerTaskId: "KS-B" }, deps);

    expect(state.gateEvents).toEqual([]);
  });
});
