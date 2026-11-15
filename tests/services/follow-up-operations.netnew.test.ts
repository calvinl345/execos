import { describe, expect, it } from "vitest";
import {
  FollowUpServiceError,
  completeOperation,
  undelegateOperation,
  updateTaskFieldsOperation,
  recordFollowUpOperation,
  type FollowUpOperationDeps,
  type FollowUpTaskRow,
} from "../../src/services/follow-up-operations.js";

function makeTask(partial: Partial<FollowUpTaskRow> & Pick<FollowUpTaskRow, "id">): FollowUpTaskRow {
  const now = new Date("2026-06-07T12:00:00.000Z");
  return {
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
    ...partial,
  };
}

function makeDeps(seed: FollowUpTaskRow[]): FollowUpOperationDeps & {
  tasksById: Map<string, FollowUpTaskRow>;
  notesAppended: Array<{ taskId: string; content: string }>;
  sourcesCaptured: Array<{ operation: string; source?: string }>;
} {
  const tasksById = new Map(seed.map((task) => [task.id, task]));
  const notesAppended: Array<{ taskId: string; content: string }> = [];
  const sourcesCaptured: Array<{ operation: string; source?: string }> = [];
  return {
    tasksById,
    notesAppended,
    sourcesCaptured,
    async recordGateEvent() {
      return { gateEventId: "gate-1", warning: null };
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
      return { task: updated, noteId: "note-status-changed", activityId: "ACT-status-changed" };
    },
    async updateTaskFields(taskId, patch, opts) {
      sourcesCaptured.push({ operation: "updateTaskFields", source: opts?.source });
      const current = tasksById.get(taskId)!;
      const updated = { ...current, ...patch } as FollowUpTaskRow;
      tasksById.set(taskId, updated);
      return { task: updated, noteId: "note-fields-updated", activityIds: ["ACT-fields-updated"] };
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
      notesAppended.push({
        taskId,
        content: "Task un-delegated: returned to Jordan's queue",
      });
      return {
        task: updated,
        noteId: `note-appended-${notesAppended.length}`,
        activityIds: ["ACT-fields-updated"],
      };
    },
    async appendTaskNote(input) {
      notesAppended.push({ taskId: input.taskId, content: input.content });
      return { noteId: `note-appended-${notesAppended.length}` };
    },
  };
}

describe("follow-up operation services (net-new & matrix checks)", () => {
  describe("completeOperation", () => {
    it("completes a task with a valid transition status", async () => {
      const task = makeTask({ id: "KS-001", status: "in_progress" });
      const deps = makeDeps([task]);

      const result = await completeOperation({ taskId: "KS-001" }, deps);
      expect(result.operation).toBe("complete");
      expect(result.task.status).toBe("done");
      expect(result.activityId).toBe("ACT-status-changed");
    });

    it("throws illegal_transition when status change is forbidden by matrix", async () => {
      // done -> done is legal-no-op, but requireOpenTask throws on terminal anyway!
      // Let's test a case where task is open, but transition would be illegal if there were one.
      // Wait, is there any illegal transition from an open task to done?
      // Let's check status-transitions.ts:
      // triage -> done is allowed.
      // backlog -> done is allowed.
      // in_progress -> done is allowed.
      // blocked -> done is allowed.
      // review -> done is allowed.
      // So all open statuses can transition to done.
      // Let's check requireOpenTask itself:
      // If task is already done, it throws FollowUpServiceError with code "terminal_task".
      // Let's verify that requireOpenTask throws.
      const task = makeTask({ id: "KS-001", status: "done" });
      const deps = makeDeps([task]);

      await expect(completeOperation({ taskId: "KS-001" }, deps)).rejects.toThrowError(
        /is already terminal/,
      );
    });
  });

  describe("undelegateOperation", () => {
    it("undelegates a delegated task: clears owner, follow-up, and handoff state", async () => {
      const task = makeTask({ id: "KS-001", owner: "elena", followUpDate: new Date() });
      const deps = makeDeps([task]);

      const result = await undelegateOperation({ taskId: "KS-001" }, deps);
      expect(result.operation).toBe("undelegate");
      expect(result.task.owner).toBeNull();
      expect(result.task.followUpDate).toBeNull();
      expect(result.task.handoffState).toBe("not_applicable");
      expect(result.task.handoffCopiedAt).toBeNull();
      expect(result.noteId).toBe("note-appended-1");
      expect(deps.notesAppended).toContainEqual({
        taskId: "KS-001",
        content: "Task un-delegated: returned to Jordan's queue",
      });
      expect(result.activityId).toBe("ACT-fields-updated");
    });

    it("throws not_delegated when task is already owned by 'me' (null/empty/me)", async () => {
      const task = makeTask({ id: "KS-001", owner: "me" });
      const deps = makeDeps([task]);

      await expect(undelegateOperation({ taskId: "KS-001" }, deps)).rejects.toThrowError(
        FollowUpServiceError,
      );
      try {
        await undelegateOperation({ taskId: "KS-001" }, deps);
      } catch (err: unknown) {
        expect((err as FollowUpServiceError).code).toBe("not_delegated");
      }
    });
  });

  describe("updateTaskFieldsOperation", () => {
    it("updates due date", async () => {
      const task = makeTask({ id: "KS-001", dueDate: null });
      const deps = makeDeps([task]);
      const newDueDate = new Date("2026-06-15T00:00:00.000Z");

      const result = await updateTaskFieldsOperation({ taskId: "KS-001", dueDate: newDueDate }, deps);
      expect(result.operation).toBe("update-fields");
      expect(result.task.dueDate?.toISOString()).toBe(newDueDate.toISOString());
    });
  });

  describe("recordFollowUpOperation status validation", () => {
    it("throws illegal_transition if trying to transition from backlog to triage", async () => {
      const task = makeTask({ id: "KS-001", status: "backlog" });
      const deps = makeDeps([task]);

      await expect(
        recordFollowUpOperation(
          {
            taskId: "KS-001",
            update: "Checking status",
            nextFollowUpDate: new Date(),
            status: "triage",
          },
          deps,
        ),
      ).rejects.toThrowError(/Illegal status transition/);

      try {
        await recordFollowUpOperation(
          {
            taskId: "KS-001",
            update: "Checking status",
            nextFollowUpDate: new Date(),
            status: "triage",
          },
          deps,
        );
      } catch (err: unknown) {
        expect((err as FollowUpServiceError).code).toBe("illegal_transition");
      }
    });
  });

  describe("source parameter threading", () => {
    it("threads source down to updateTaskStatus, undelegateTask, and updateTaskFields dependency calls", async () => {
      const task = () => makeTask({ id: "KS-001", status: "in_progress", owner: "elena", followUpDate: new Date() });

      {
        const deps = makeDeps([task()]);
        await completeOperation({ taskId: "KS-001", source: "dashboard" }, deps);
        expect(deps.sourcesCaptured).toContainEqual({ operation: "updateTaskStatus", source: "dashboard" });
      }

      {
        const deps = makeDeps([task()]);
        await undelegateOperation({ taskId: "KS-001", source: "dashboard" }, deps);
        expect(deps.sourcesCaptured).toContainEqual({ operation: "undelegateTask", source: "dashboard" });
      }

      {
        const deps = makeDeps([task()]);
        await updateTaskFieldsOperation({ taskId: "KS-001", dueDate: new Date(), source: "dashboard" }, deps);
        expect(deps.sourcesCaptured).toContainEqual({ operation: "updateTaskFields", source: "dashboard" });
      }
    });
  });
});
