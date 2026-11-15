import { describe, expect, it } from "vitest";
import { TaskNotFoundError } from "../../src/db/errors.js";
import {
  FollowUpServiceError,
  deferOperation,
  clearSnoozeOperation,
  delegationMessageOperation,
  delegateOperation,
  recordFollowUpOperation,
  type FollowUpOperationDeps,
  type FollowUpTaskRow,
} from "../../src/services/follow-up-operations.js";

function makeTask(partial: Partial<FollowUpTaskRow> & Pick<FollowUpTaskRow, "id">): FollowUpTaskRow {
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

function makeDeps(seed: FollowUpTaskRow[]): FollowUpOperationDeps & {
  tasksById: Map<string, FollowUpTaskRow>;
  gateEvents: Array<{ gate: string; operation: string; outcome: string; surface: string }>;
  sourcesCaptured: Array<{ operation: string; source?: string }>;
} {
  const tasksById = new Map(seed.map((task) => [task.id, task]));
  const gateEvents: Array<{ gate: string; operation: string; outcome: string; surface: string }> = [];
  const sourcesCaptured: Array<{ operation: string; source?: string }> = [];
  return {
    tasksById,
    gateEvents,
    sourcesCaptured,
    async recordGateEvent(input) {
      gateEvents.push({
        gate: input.gate,
        operation: input.operation,
        outcome: input.outcome,
        surface: input.surface,
      });
      return { gateEventId: `gate-${gateEvents.length}`, warning: null };
    },
    now: () => new Date("2026-06-07T12:00:00.000Z"),
    async findTask(taskId) {
      return tasksById.get(taskId) ?? null;
    },
    async listTeam() {
      return [
        { slug: "noah", displayName: "Noah Brooks" },
        { slug: "elena", displayName: "Elena Torres" },
      ];
    },
    async listOwnerOpenTasks(ownerSlug) {
      return [...tasksById.values()].filter(
        (task) => task.owner === ownerSlug && task.status !== "done" && task.status !== "cancelled",
      );
    },
    async delegateTask(input) {
      sourcesCaptured.push({ operation: "delegateTask", source: input.source });
      const current = tasksById.get(input.taskId)!;
      const updated = {
        ...current,
        owner: input.owner,
        followUpDate: input.followUpDate,
        snoozedUntil: null,
        handoffState: "pending" as const,
        handoffCopiedAt: null,
        handoffLastCopiedAt: null,
        handoffLastNudgeCopiedAt: null,
        dueDate: input.dueDate === undefined ? current.dueDate : input.dueDate,
        // Delegation removes the task from the do-next queue (ISS-006).
        queueRank: null,
        queueRationale: null,
        queueRankedAt: null,
      };
      tasksById.set(input.taskId, updated);
      return { task: updated, noteId: input.note ? "note-delegate" : null, activityId: "ACT-delegate" };
    },
    async recordFollowUp(input) {
      sourcesCaptured.push({ operation: "recordFollowUp", source: input.source });
      const current = tasksById.get(input.taskId)!;
      const updated = {
        ...current,
        followUpDate: input.nextFollowUpDate,
        dueDate: input.dueDate === undefined ? current.dueDate : input.dueDate,
        status: input.status ?? current.status,
      };
      tasksById.set(input.taskId, updated);
      return { task: updated, noteId: "note-follow-up", activityId: "ACT-follow-up" };
    },
    async deferTask(input) {
      sourcesCaptured.push({ operation: "deferTask", source: input.source });
      const current = tasksById.get(input.taskId)!;
      const updated = { ...current, snoozedUntil: input.until };
      tasksById.set(input.taskId, updated);
      return { task: updated, activityId: "ACT-defer" };
    },
    async clearTaskSnooze(input) {
      sourcesCaptured.push({ operation: "clearTaskSnooze", source: input.source });
      const current = tasksById.get(input.taskId)!;
      const hadSnooze = current.snoozedUntil !== null;
      const updated = { ...current, snoozedUntil: null };
      tasksById.set(input.taskId, updated);
      return { task: updated, activityId: hadSnooze ? "ACT-clear-snooze" : null };
    },
    async updateTaskStatus(taskId, status, _by, opts) {
      sourcesCaptured.push({ operation: "updateTaskStatus", source: opts?.source });
      const current = tasksById.get(taskId)!;
      const updated = { ...current, status };
      tasksById.set(taskId, updated);
      return { task: updated, noteId: "note-status", activityId: "ACT-status" };
    },
    async updateTaskFields(taskId, patch, opts) {
      sourcesCaptured.push({ operation: "updateTaskFields", source: opts?.source });
      const current = tasksById.get(taskId)!;
      const updated = { ...current, ...patch } as FollowUpTaskRow;
      tasksById.set(taskId, updated);
      return { task: updated, noteId: "note-fields", activityIds: ["ACT-fields"] };
    },
    async undelegateTask(taskId, opts) {
      sourcesCaptured.push({ operation: "undelegateTask", source: opts?.source });
      const current = tasksById.get(taskId)!;
      const updated = {
        ...current,
        owner: null,
        followUpDate: null,
        handoffState: "not_applicable" as const,
        handoffCopiedAt: null,
        handoffLastCopiedAt: null,
        handoffLastNudgeCopiedAt: null,
      };
      tasksById.set(taskId, updated);
      return { task: updated, noteId: "note-undelegate", activityIds: ["ACT-fields"] };
    },
    async appendTaskNote(_input) {
      return { noteId: "note-appended" };
    },
  };
}

describe("follow-up operation services", () => {
  it("delegates to a resolved team slug and returns owner open-task summary", async () => {
    const task = makeTask({
      id: "KS-001",
      dueDate: new Date("2026-06-30T12:00:00.000Z"),
      snoozedUntil: new Date("2026-06-10T12:00:00.000Z"),
    });
    const existing = makeTask({ id: "KS-002", owner: "noah" });
    const deps = makeDeps([task, existing]);

    const result = await delegateOperation(
      {
        taskId: "KS-001",
        ownerText: "Noah",
        followUpDate: new Date("2026-06-14T12:00:00.000Z"),
        note: "Noah owns this now.",
      },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected delegate success");
    expect(result.receipt.ownerSlug).toBe("noah");
    expect(result.receipt.task.owner).toBe("noah");
    expect(result.receipt.task.snoozedUntil).toBeNull();
    expect(result.receipt.task.handoffState).toBe("pending");
    expect(result.receipt.task.handoffCopiedAt).toBeNull();
    expect(result.receipt.ownerOpenTasks.map((item) => item.id)).toEqual(["KS-001", "KS-002"]);
    expect(result.receipt.defaultFollowUpApplied).toBe(false);
  });

  it("clears the queue rank when delegating a ranked task (ISS-006)", async () => {
    const task = makeTask({
      id: "KS-001",
      queueRank: 1,
      queueRationale: "Do this first",
      queueRankedAt: new Date("2026-06-07T09:00:00.000Z"),
    });
    const deps = makeDeps([task]);

    const result = await delegateOperation(
      {
        taskId: "KS-001",
        ownerText: "Noah",
        followUpDate: new Date("2026-06-14T12:00:00.000Z"),
      },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected delegate success");
    expect(result.receipt.task.owner).toBe("noah");
    expect(result.receipt.task.queueRank).toBeNull();
    expect(result.receipt.task.queueRationale).toBeNull();
    expect(result.receipt.task.queueRankedAt).toBeNull();
  });

  it("returns an ask-owner outcome for unresolved owners", async () => {
    const deps = makeDeps([makeTask({ id: "KS-001" })]);

    const result = await delegateOperation(
      { taskId: "KS-001", ownerText: "Unknown Person" },
      deps,
    );

    expect(result).toEqual({
      ok: false,
      outcome: "ask_owner",
      resolution: { status: "unresolved", input: "Unknown Person" },
    });
  });

  it("chooses default follow-up cadence when delegate input omits a follow-up date", async () => {
    const deps = makeDeps([
      makeTask({
        id: "KS-001",
        dueDate: new Date("2026-06-21T12:00:00.000Z"),
      }),
    ]);

    const result = await delegateOperation({ taskId: "KS-001", ownerText: "noah" }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected delegate success");
    expect(result.receipt.followUpDate.toISOString()).toBe("2026-06-14T12:00:00.000Z");
    expect(result.receipt.defaultFollowUpApplied).toBe(true);
  });

  it("surfaces follow-up-after-due warnings", async () => {
    const deps = makeDeps([
      makeTask({
        id: "KS-001",
        dueDate: new Date("2026-06-10T12:00:00.000Z"),
      }),
    ]);

    const result = await delegateOperation(
      {
        taskId: "KS-001",
        ownerText: "noah",
        followUpDate: new Date("2026-06-14T12:00:00.000Z"),
      },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected delegate success");
    expect(result.receipt.warnings[0]).toContain("after the task due date");
  });

  it("records follow-up results with next date, due date, and status", async () => {
    const deps = makeDeps([makeTask({ id: "KS-001", owner: "elena" })]);

    const receipt = await recordFollowUpOperation(
      {
        taskId: "KS-001",
        update: "Elena is blocked on client access.",
        nextFollowUpDate: new Date("2026-06-09T12:00:00.000Z"),
        dueDate: new Date("2026-06-30T12:00:00.000Z"),
        status: "blocked",
      },
      deps,
    );

    expect(receipt.noteId).toBe("note-follow-up");
    expect(receipt.task.status).toBe("blocked");
    expect(receipt.task.followUpDate?.toISOString()).toBe("2026-06-09T12:00:00.000Z");
  });

  it("defers self-owned open tasks through the snoozed-until field", async () => {
    const deps = makeDeps([makeTask({ id: "KS-001", owner: "me" })]);

    const receipt = await deferOperation(
      { taskId: "KS-001", until: new Date("2026-06-20T12:00:00.000Z") },
      deps,
    );

    expect(receipt.operation).toBe("defer");
    expect(receipt.task.owner).toBe("me");
    expect(receipt.task.followUpDate).toBeNull();
    expect(receipt.task.snoozedUntil?.toISOString()).toBe("2026-06-20T12:00:00.000Z");
  });

  it("rejects snoozing delegated tasks because their date is a follow-up date", async () => {
    const deps = makeDeps([makeTask({ id: "KS-001", owner: "elena" })]);

    await expect(
      deferOperation({ taskId: "KS-001", until: new Date("2026-06-20T12:00:00.000Z") }, deps),
    ).rejects.toMatchObject({
      code: "delegated_task",
    });
  });

  it("copies a handoff message and marks delegated task handoff as copied", async () => {
    const deps = makeDeps([
      makeTask({
        id: "KS-001",
        owner: "elena",
        handoffState: "pending",
      }),
    ]);

    const receipt = await delegationMessageOperation(
      {
        taskId: "KS-001",
        kind: "handoff",
        followUpDate: new Date("2026-06-15T12:00:00.000Z"),
        source: "dashboard",
      },
      deps,
    );

    expect(receipt.operation).toBe("delegation-message");
    expect(receipt.kind).toBe("handoff");
    expect(receipt.task.handoffState).toBe("copied");
    expect(receipt.task.handoffCopiedAt?.toISOString()).toBe("2026-06-07T12:00:00.000Z");
    expect(receipt.task.followUpDate?.toISOString()).toBe("2026-06-15T12:00:00.000Z");
    expect(receipt.message).toContain("can you take this on");
  });

  it("deduplicates consecutive nudge messages within 5 minutes if follow-up date is unchanged", async () => {
    const lastNudge = new Date("2026-06-07T11:58:00.000Z"); // 2 minutes ago relative to now (12:00)
    const followUpDate = new Date("2026-06-15T12:00:00.000Z");
    const deps = makeDeps([
      makeTask({
        id: "KS-001",
        owner: "elena",
        handoffState: "copied",
        handoffLastNudgeCopiedAt: lastNudge,
        followUpDate,
      }),
    ]);

    const receipt = await delegationMessageOperation(
      {
        taskId: "KS-001",
        kind: "nudge",
        followUpDate,
        source: "dashboard",
      },
      deps,
    );

    expect(receipt.operation).toBe("delegation-message");
    expect(receipt.kind).toBe("nudge");
    expect(receipt.activityId).toBe("");
    expect(deps.sourcesCaptured).not.toContainEqual(expect.objectContaining({ operation: "updateTaskFields" }));
  });

  it("does not deduplicate nudge messages if follow-up date changes", async () => {
    const lastNudge = new Date("2026-06-07T11:58:00.000Z");
    const oldFollowUpDate = new Date("2026-06-15T12:00:00.000Z");
    const newFollowUpDate = new Date("2026-06-18T12:00:00.000Z");
    const deps = makeDeps([
      makeTask({
        id: "KS-001",
        owner: "elena",
        handoffState: "copied",
        handoffLastNudgeCopiedAt: lastNudge,
        followUpDate: oldFollowUpDate,
      }),
    ]);

    const receipt = await delegationMessageOperation(
      {
        taskId: "KS-001",
        kind: "nudge",
        followUpDate: newFollowUpDate,
        source: "dashboard",
      },
      deps,
    );

    expect(receipt.operation).toBe("delegation-message");
    expect(receipt.kind).toBe("nudge");
    expect(receipt.activityId).toBe("ACT-fields");
    expect(deps.sourcesCaptured).toContainEqual(expect.objectContaining({ operation: "updateTaskFields" }));
  });

  it("deduplicates consecutive handoff messages within 5 minutes if state is already copied and follow-up date is unchanged", async () => {
    const lastHandoff = new Date("2026-06-07T11:57:00.000Z"); // 3 minutes ago
    const followUpDate = new Date("2026-06-15T12:00:00.000Z");
    const deps = makeDeps([
      makeTask({
        id: "KS-001",
        owner: "elena",
        handoffState: "copied",
        handoffLastCopiedAt: lastHandoff,
        followUpDate,
      }),
    ]);

    const receipt = await delegationMessageOperation(
      {
        taskId: "KS-001",
        kind: "handoff",
        followUpDate,
        source: "dashboard",
      },
      deps,
    );

    expect(receipt.operation).toBe("delegation-message");
    expect(receipt.kind).toBe("handoff");
    expect(receipt.activityId).toBe("");
    expect(deps.sourcesCaptured).not.toContainEqual(expect.objectContaining({ operation: "updateTaskFields" }));
  });

  it("rejects terminal source tasks before mutation", async () => {
    const deps = makeDeps([makeTask({ id: "KS-001", status: "done" })]);

    await expect(
      deferOperation({ taskId: "KS-001", until: new Date("2026-06-20T12:00:00.000Z") }, deps),
    ).rejects.toBeInstanceOf(FollowUpServiceError);
  });

  it("throws TaskNotFoundError for missing tasks", async () => {
    const deps = makeDeps([]);

    await expect(
      deferOperation({ taskId: "KS-404", until: new Date("2026-06-20T12:00:00.000Z") }, deps),
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  it("clears a self-owned snooze and returns a clear-snooze receipt", async () => {
    const deps = makeDeps([
      makeTask({
        id: "KS-001",
        owner: "me",
        snoozedUntil: new Date("2026-06-20T12:00:00.000Z"),
      }),
    ]);

    const receipt = await clearSnoozeOperation({ taskId: "KS-001" }, deps);

    expect(receipt.operation).toBe("clear-snooze");
    expect(receipt.task.snoozedUntil).toBeNull();
    expect(receipt.activityId).toBe("ACT-clear-snooze");
  });

  it("refuses to clear snooze on a delegated task", async () => {
    const deps = makeDeps([makeTask({ id: "KS-001", owner: "elena" })]);

    await expect(
      clearSnoozeOperation({ taskId: "KS-001" }, deps),
    ).rejects.toMatchObject({ code: "delegated_task" });
  });

  it("threads the source parameter down to clearTaskSnooze", async () => {
    const deps = makeDeps([
      makeTask({
        id: "KS-001",
        owner: "me",
        snoozedUntil: new Date("2026-06-20T12:00:00.000Z"),
      }),
    ]);

    await clearSnoozeOperation({ taskId: "KS-001", source: "dashboard" }, deps);

    expect(deps.sourcesCaptured).toContainEqual({
      operation: "clearTaskSnooze",
      source: "dashboard",
    });
  });
});

// ---------------------------------------------------------------------------
// Gate-decision telemetry (W5 gate_events instrumentation). Blocked events
// insert standalone on the refusal path; clean operations log nothing.
// ---------------------------------------------------------------------------

describe("gate event instrumentation (delegate / complete)", () => {
  it("an unresolved owner logs a blocked owner_resolution event and still returns ask_owner", async () => {
    const deps = makeDeps([makeTask({ id: "KS-001" })]);

    const result = await delegateOperation(
      { taskId: "KS-001", ownerText: "nobody-on-roster" },
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ask_owner refusal");
    expect(result.outcome).toBe("ask_owner");
    expect(deps.gateEvents).toEqual([
      {
        gate: "owner_resolution",
        operation: "delegate",
        outcome: "blocked",
        surface: "cli",
      },
    ]);
  });

  it("a resolved delegation logs NO gate event", async () => {
    const deps = makeDeps([
      makeTask({ id: "KS-001", dueDate: new Date("2026-06-30T12:00:00.000Z") }),
    ]);

    const result = await delegateOperation(
      {
        taskId: "KS-001",
        ownerText: "Noah",
        followUpDate: new Date("2026-06-14T12:00:00.000Z"),
      },
      deps,
    );

    expect(result.ok).toBe(true);
    expect(deps.gateEvents).toEqual([]);
  });

  it("the dispatcher-threaded surface is stamped onto the event", async () => {
    const deps = makeDeps([makeTask({ id: "KS-001" })]);

    await delegateOperation(
      { taskId: "KS-001", ownerText: "nobody-on-roster", surface: "web" },
      deps,
    );

    expect(deps.gateEvents).toHaveLength(1);
    expect(deps.gateEvents[0].surface).toBe("web");
  });

  it("threads the optional source parameter down to the delegateTask, recordFollowUp, and deferTask dependency calls", async () => {
    const task = makeTask({ id: "KS-001", owner: "elena" });
    const selfOwned = makeTask({ id: "KS-002", owner: "me" });
    const deps = makeDeps([task, selfOwned]);

    await delegateOperation(
      {
        taskId: "KS-001",
        ownerText: "Noah",
        followUpDate: new Date("2026-06-14T12:00:00.000Z"),
        source: "dashboard",
      },
      deps,
    );
    expect(deps.sourcesCaptured).toContainEqual({ operation: "delegateTask", source: "dashboard" });

    await recordFollowUpOperation(
      {
        taskId: "KS-002",
        update: "some update",
        nextFollowUpDate: new Date("2026-06-14T12:00:00.000Z"),
        source: "dashboard",
      },
      deps,
    );
    expect(deps.sourcesCaptured).toContainEqual({ operation: "recordFollowUp", source: "dashboard" });

    await deferOperation(
      {
        taskId: "KS-002",
        until: new Date("2026-06-14T12:00:00.000Z"),
        source: "dashboard",
      },
      deps,
    );
    expect(deps.sourcesCaptured).toContainEqual({ operation: "deferTask", source: "dashboard" });
  });
});
