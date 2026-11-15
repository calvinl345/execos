/**
 * Behavioral golden — constitution R27 (decisions/021-due-date-required.md):
 * every task carries a due date. createTaskOperation refuses to store a task
 * without one and updateTaskOperation refuses to clear one, both with
 * TaskServiceError("due_required"). Enforcement is service-layer by Calvin's
 * decision (change-009 S19); the schema column stays nullable for legacy
 * rows, so this golden is the regression net.
 *
 * Construction notes (the order of guards matters):
 * - createTaskOperation calls deps.settings() BEFORE its dueAt check, so the
 *   stub must provide settings or the test throws the wrong error and pins
 *   nothing.
 * - updateTaskOperation's due check sits AFTER requireOpenTask and the
 *   status-transition block, so the stub must return an existing OPEN task
 *   from findTask, and the input must not carry `status` (which would route
 *   into the transition guards first).
 * Every dep that the due_required paths must never reach throws loudly.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../../src/domain/validation.js";
import {
  TaskServiceError,
  createTaskOperation,
  updateTaskOperation,
  type TaskOperationDeps,
  type TaskRow,
} from "../../../src/services/task-operations.js";

const FIXED_NOW = new Date("2026-06-11T12:00:00.000Z");

const OPEN_TASK: TaskRow = {
  id: "KS-901",
  title: "Open task with a due date",
  description: "Fixture for the due-date-required golden",
  status: "in_progress",
  priority: null,
  category: "client",
  owner: "me",
  dueDate: new Date("2026-06-30T12:00:00.000Z"),
  followUpDate: null,
  snoozedUntil: null,
  handoffState: "not_applicable",
  handoffCopiedAt: null,
  handoffLastCopiedAt: null,
  handoffLastNudgeCopiedAt: null,
  goalId: null,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
  completedAt: null,
  cancelledAt: null,
  lastStatusChangeAt: FIXED_NOW,
  lastUnblockedAt: null,
  needsAttention: false,
  needsAttentionSetAt: null,
  needsAttentionReason: null,
  embedding: null,
  hardDeadline: false,
  effort: null,
  queueRank: null,
  queueRationale: null,
  queueRankedAt: null,
};

function unreached(name: string): never {
  throw new Error(
    `deps.${name} must not be reached: due_required has to refuse before any further work (R27)`,
  );
}

function makeDeps(): TaskOperationDeps {
  return {
    now: () => FIXED_NOW,
    embed: () => unreached("embed"),
    findTask: (taskId) =>
      Promise.resolve(taskId === OPEN_TASK.id ? OPEN_TASK : null),
    listActiveTasks: () => unreached("listActiveTasks"),
    goalExists: () => unreached("goalExists"),
    nearestTasks: () => unreached("nearestTasks"),
    findExactMatches: () => unreached("findExactMatches"),
    findPreviousReopenStatus: () => unreached("findPreviousReopenStatus"),
    settings: () => Promise.resolve(DEFAULT_SETTINGS),
    runInTransaction: () => unreached("runInTransaction"),
    recordGateEvent: () => unreached("recordGateEvent"),
    insertTask: (() => unreached("insertTask")) as TaskOperationDeps["insertTask"],
    composeTaskId: (() => unreached("composeTaskId")) as TaskOperationDeps["composeTaskId"],
    enforcePZeroWipCap: (() => unreached("enforcePZeroWipCap")) as TaskOperationDeps["enforcePZeroWipCap"],
    updateTaskStatus: (() => unreached("updateTaskStatus")) as TaskOperationDeps["updateTaskStatus"],
    updateTaskFields: (() => unreached("updateTaskFields")) as TaskOperationDeps["updateTaskFields"],
    setTaskEmbedding: (() => unreached("setTaskEmbedding")) as TaskOperationDeps["setTaskEmbedding"],
    appendTaskNote: (() => unreached("appendTaskNote")) as TaskOperationDeps["appendTaskNote"],
    recordTaskCreated: (() => unreached("recordTaskCreated")) as TaskOperationDeps["recordTaskCreated"],
    recordTaskGoalLinked: (() => unreached("recordTaskGoalLinked")) as TaskOperationDeps["recordTaskGoalLinked"],
    recordTaskGoalUnlinked: (() => unreached("recordTaskGoalUnlinked")) as TaskOperationDeps["recordTaskGoalUnlinked"],
    recordTaskStatusChanged: (() => unreached("recordTaskStatusChanged")) as TaskOperationDeps["recordTaskStatusChanged"],
  };
}

async function expectDueRequired(run: Promise<unknown>): Promise<void> {
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "operation must refuse, not succeed").not.toBeNull();
  expect(err).toBeInstanceOf(TaskServiceError);
  expect((err as TaskServiceError).code).toBe("due_required");
}

describe("behaviors: due-date-required", () => {
  it("create refuses a task with no due date (dueAt omitted)", async () => {
    await expectDueRequired(
      createTaskOperation(
        {
          title: "Task without a due date",
          description: "Must be refused",
          category: "client",
          dueAt: undefined as unknown as Date,
        },
        makeDeps(),
      ),
    );
  });

  it("create refuses a task with a null due date", async () => {
    await expectDueRequired(
      createTaskOperation(
        {
          title: "Task with a null due date",
          description: "Must be refused",
          category: "client",
          dueAt: null as unknown as Date,
        },
        makeDeps(),
      ),
    );
  });

  it("update refuses to clear an existing task's due date (dueAt: null)", async () => {
    await expectDueRequired(
      updateTaskOperation({ taskId: OPEN_TASK.id, dueAt: null }, makeDeps()),
    );
  });
});
