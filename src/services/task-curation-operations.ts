/**
 * Task curation services: dependency edges and needs-attention flags
 * (change-008, A10).
 *
 * Pattern: follow-up-operations.ts / task-operations.ts. Injectable
 * `CurationOperationDeps`, typed receipts extending the base
 * `{ taskId, task, warnings, activityId }` shape, and a
 * `productionCurationOperationDeps` default wired to the real db/helpers
 * primitives.
 *
 * Behavior contracts (A10):
 *   - dependencyAddOperation preserves the legacy task.ts behavior: cycle
 *     check first (assertNoCycle), then the edge insert plus a system note
 *     AND recordTaskDependencyAdded on BOTH tasks in one transaction.
 *     Adding an edge that already exists is an idempotent no-op
 *     (created: false), not an error.
 *   - dependencyRemoveOperation removes the edge with the mirrored
 *     note/activity pair on both tasks; removing a missing edge throws
 *     CurationServiceError("dependency_not_found").
 *   - flagAttentionOperation / unflagAttentionOperation wrap the
 *     flagAttention / unflagAttention helpers with audit ON by default and a
 *     `silent` option exposed (review.ts refresh-attention migrates onto
 *     these with silent preserved, S7).
 *
 * The task_dependencies table is NOT the tasks table, so its row-level
 * writes may live in this module's production deps without violating the
 * write-funnel scan (tests/cli/task-write-funnel-scan.test.ts); they are
 * still kept behind dep seams (insertDependency / deleteDependency) so
 * operations stay fake-testable.
 *
 * The type surface and the production deps wiring are the build contract;
 * the behavioral goldens in tests/services/task-curation-operations.test.ts
 * pin the semantics.
 */

import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { db, taskDependencies, tasks } from "../db/index.js";
import type { GateEventSurface } from "../db/schema.js";
import { TaskDependencyCycleError, TaskNotFoundError } from "../db/errors.js";
import {
  appendTaskNote,
  assertNoCycle,
  flagAttention,
  recordGateEvent,
  recordTaskDependencyAdded,
  recordTaskDependencyRemoved,
  unflagAttention,
  type RecordGateEvent,
} from "../db/helpers/index.js";
import type { TaskRow } from "./task-operations.js";

// ---------------------------------------------------------------------------
// Row and client types.
// ---------------------------------------------------------------------------

export type TaskDependencyRow = typeof taskDependencies.$inferSelect;
export type TaskDependencyInsertRow = typeof taskDependencies.$inferInsert;

/**
 * Transaction client for curation writes. Superset of the helpers'
 * TaskWriteClient: dependency removal needs `delete`, which the shared
 * TaskWriteClient pick does not expose. Every db/helpers passthrough accepts
 * this client structurally.
 */
export type CurationWriteClient = Pick<
  typeof db,
  "select" | "insert" | "update" | "delete" | "execute"
>;

// ---------------------------------------------------------------------------
// Deps.
// ---------------------------------------------------------------------------

export interface CurationOperationDeps {
  now(): Date;
  findTask(taskId: string): Promise<TaskRow | null>;
  findDependency(
    blockerTaskId: string,
    blockedTaskId: string,
  ): Promise<TaskDependencyRow | null>;
  /** Row-level edge insert (task_dependencies, not the tasks table). */
  insertDependency(tx: CurationWriteClient, row: TaskDependencyInsertRow): Promise<void>;
  /** Row-level edge delete (task_dependencies, not the tasks table). */
  deleteDependency(
    tx: CurationWriteClient,
    blockerTaskId: string,
    blockedTaskId: string,
  ): Promise<void>;
  /** Transaction runner. Production wraps db.transaction. */
  runInTransaction<T>(fn: (tx: CurationWriteClient) => Promise<T>): Promise<T>;

  /**
   * Gate-decision telemetry seam (W5). Best-effort by contract: never
   * throws. The only event recorded from this module is dependency_cycle
   * blocked, inserted standalone on the refusal path.
   */
  recordGateEvent: RecordGateEvent;

  // db-helper passthroughs (typeof keeps signatures in lockstep with
  // src/db/helpers; fakes implement the same shapes).
  assertNoCycle: typeof assertNoCycle;
  appendTaskNote: typeof appendTaskNote;
  recordTaskDependencyAdded: typeof recordTaskDependencyAdded;
  recordTaskDependencyRemoved: typeof recordTaskDependencyRemoved;
  flagAttention: typeof flagAttention;
  unflagAttention: typeof unflagAttention;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export type CurationServiceErrorCode = "dependency_not_found" | "validation";

export class CurationServiceError extends Error {
  constructor(
    public readonly code: CurationServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CurationServiceError";
  }
}

// ---------------------------------------------------------------------------
// Receipts (base shape mirrors FollowUpReceipt: taskId, task, warnings,
// activityId). For dependency operations the base taskId/task refer to the
// BLOCKED task (the task whose progress is gated); both sides' audit ids are
// carried in noteIds/activityIds.
// ---------------------------------------------------------------------------

export interface CurationReceipt {
  taskId: string;
  task: TaskRow;
  warnings: string[];
  activityId: string;
}

export interface DependencyAddReceipt extends Omit<CurationReceipt, "activityId"> {
  operation: "dependency-add";
  blockerTaskId: string;
  blockedTaskId: string;
  /** Edge id (existing id when created is false). */
  dependencyId: string;
  /** False when the edge already existed (idempotent no-op, no writes). */
  created: boolean;
  /** System note ids on [blocked, blocker] order; empty when created is false. */
  noteIds: string[];
  /** Activity ids on [blocked, blocker] order; empty when created is false. */
  activityIds: string[];
  /** The blocked task's activity id (activityIds[0]); null when created is false. */
  activityId: string | null;
}

export interface DependencyRemoveReceipt extends Omit<CurationReceipt, "activityId"> {
  operation: "dependency-remove";
  blockerTaskId: string;
  blockedTaskId: string;
  /** System note ids on [blocked, blocker] order. */
  noteIds: string[];
  /** Activity ids on [blocked, blocker] order. */
  activityIds: string[];
  /** The blocked task's activity id (activityIds[0]). */
  activityId: string | null;
}

export interface FlagAttentionReceipt extends Omit<CurationReceipt, "activityId"> {
  operation: "flag-attention";
  reason: string | null;
  /** True when the task was already flagged (set-at timestamp preserved). */
  alreadyFlagged: boolean;
  /** Echoes the silent option; when true no note/activity was written. */
  silent: boolean;
  /** Activity id from the helper's audit write; null when silent or already flagged. */
  activityId: string | null;
}

export interface UnflagAttentionReceipt extends Omit<CurationReceipt, "activityId"> {
  operation: "unflag-attention";
  /** True when the task was not flagged to begin with. */
  alreadyClear: boolean;
  /** Echoes the silent option; when true no note/activity was written. */
  silent: boolean;
  /** Activity id from the helper's audit write; null when silent or already clear. */
  activityId: string | null;
}

// ---------------------------------------------------------------------------
// Inputs.
// ---------------------------------------------------------------------------

export interface DependencyAddInput {
  /** The task that is blocked (depends on the blocker). */
  blockedTaskId: string;
  /** The task that blocks. */
  blockerTaskId: string;
  /** Calling surface for gate-decision telemetry (W5). Default "cli". */
  surface?: GateEventSurface;
}

export interface DependencyRemoveInput {
  blockedTaskId: string;
  blockerTaskId: string;
}

export interface FlagAttentionInput {
  taskId: string;
  reason?: string | null;
  /** Suppress the system note + activity (used by review refresh-attention). */
  silent?: boolean;
}

export interface UnflagAttentionInput {
  taskId: string;
  /** Suppress the system note + activity (used by review refresh-attention). */
  silent?: boolean;
}

// ---------------------------------------------------------------------------
// Production deps.
// ---------------------------------------------------------------------------

export const productionCurationOperationDeps: CurationOperationDeps = {
  now: () => new Date(),
  async findTask(taskId) {
    const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    return rows[0] ?? null;
  },
  async findDependency(blockerTaskId, blockedTaskId) {
    const rows = await db
      .select()
      .from(taskDependencies)
      .where(
        and(
          eq(taskDependencies.blockerTaskId, blockerTaskId),
          eq(taskDependencies.blockedTaskId, blockedTaskId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },
  async insertDependency(tx, row) {
    await tx.insert(taskDependencies).values(row);
  },
  async deleteDependency(tx, blockerTaskId, blockedTaskId) {
    await tx
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.blockerTaskId, blockerTaskId),
          eq(taskDependencies.blockedTaskId, blockedTaskId),
        ),
      );
  },
  runInTransaction: (fn) => db.transaction(fn),
  recordGateEvent,
  assertNoCycle,
  appendTaskNote,
  recordTaskDependencyAdded,
  recordTaskDependencyRemoved,
  flagAttention,
  unflagAttention,
};

// ---------------------------------------------------------------------------
// Private helpers.
// ---------------------------------------------------------------------------

async function requireTask(
  deps: CurationOperationDeps,
  taskId: string,
): Promise<TaskRow> {
  const task = await deps.findTask(taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  return task;
}

/**
 * Mirrors the legacy task.ts dependency note payload: one JSON system note
 * written verbatim onto BOTH sides of the edge.
 */
function dependencyNotePayload(
  type: "task_dependency_added" | "task_dependency_removed",
  blockerTaskId: string,
  blockedTaskId: string,
): string {
  return JSON.stringify({
    type,
    blockerTaskId,
    blockedTaskId,
    by: "agent",
  });
}

// ---------------------------------------------------------------------------
// Operations.
// ---------------------------------------------------------------------------

/**
 * Add a dependency edge: assertNoCycle, then one transaction inserting the
 * edge and writing a system note plus recordTaskDependencyAdded on BOTH the
 * blocked and the blocker task (preserves task.ts:864-899 behavior). An
 * existing edge is an idempotent no-op receipt with created: false.
 */
export async function dependencyAddOperation(
  input: DependencyAddInput,
  deps: CurationOperationDeps = productionCurationOperationDeps,
): Promise<DependencyAddReceipt> {
  const blockedTask = await requireTask(deps, input.blockedTaskId);
  await requireTask(deps, input.blockerTaskId);

  // Idempotence: an existing edge is a no-op receipt, zero writes.
  const existing = await deps.findDependency(
    input.blockerTaskId,
    input.blockedTaskId,
  );
  if (existing) {
    return {
      operation: "dependency-add",
      taskId: input.blockedTaskId,
      task: blockedTask,
      blockerTaskId: input.blockerTaskId,
      blockedTaskId: input.blockedTaskId,
      dependencyId: existing.id,
      created: false,
      noteIds: [],
      activityIds: [],
      activityId: null,
      warnings: [],
    };
  }

  // Cycle check BEFORE any write; TaskDependencyCycleError propagates. The
  // refusal logs a dependency_cycle gate event (standalone, best-effort).
  try {
    await deps.assertNoCycle(input.blockerTaskId, input.blockedTaskId);
  } catch (err) {
    if (err instanceof TaskDependencyCycleError) {
      await deps.recordGateEvent({
        gate: "dependency_cycle",
        operation: "dependency-add",
        outcome: "blocked",
        surface: input.surface ?? "cli",
        taskId: input.blockedTaskId,
        detail: {
          blockerTaskId: input.blockerTaskId,
          blockedTaskId: input.blockedTaskId,
        },
      });
    }
    throw err;
  }

  const dependencyId = nanoid(12);
  const now = deps.now();
  const notePayload = dependencyNotePayload(
    "task_dependency_added",
    input.blockerTaskId,
    input.blockedTaskId,
  );

  const audit = await deps.runInTransaction(async (tx) => {
    await deps.insertDependency(tx, {
      id: dependencyId,
      blockerTaskId: input.blockerTaskId,
      blockedTaskId: input.blockedTaskId,
    });

    const noteIds: string[] = [];
    const activityIds: string[] = [];
    // Audit on BOTH tasks, [blocked, blocker] order.
    for (const taskId of [input.blockedTaskId, input.blockerTaskId]) {
      const note = await deps.appendTaskNote(tx, {
        taskId,
        noteType: "system",
        content: notePayload,
        createdBy: "agent",
      });
      noteIds.push(note.noteId);
      const activity = await deps.recordTaskDependencyAdded(tx, {
        taskId,
        blockerTaskId: input.blockerTaskId,
        blockedTaskId: input.blockedTaskId,
        by: "agent",
        occurredAt: now,
      });
      activityIds.push(activity.activityId);
    }
    return { noteIds, activityIds };
  });

  return {
    operation: "dependency-add",
    taskId: input.blockedTaskId,
    task: blockedTask,
    blockerTaskId: input.blockerTaskId,
    blockedTaskId: input.blockedTaskId,
    dependencyId,
    created: true,
    noteIds: audit.noteIds,
    activityIds: audit.activityIds,
    activityId: audit.activityIds[0] ?? null,
    warnings: [],
  };
}

/**
 * Remove a dependency edge with the mirrored note/activity pair on both
 * tasks. A missing edge throws CurationServiceError("dependency_not_found").
 */
export async function dependencyRemoveOperation(
  input: DependencyRemoveInput,
  deps: CurationOperationDeps = productionCurationOperationDeps,
): Promise<DependencyRemoveReceipt> {
  const blockedTask = await requireTask(deps, input.blockedTaskId);
  await requireTask(deps, input.blockerTaskId);

  const existing = await deps.findDependency(
    input.blockerTaskId,
    input.blockedTaskId,
  );
  if (!existing) {
    throw new CurationServiceError(
      "dependency_not_found",
      `Dependency does not exist: ${input.blockedTaskId} is not blocked by ${input.blockerTaskId}.`,
    );
  }

  const now = deps.now();
  const notePayload = dependencyNotePayload(
    "task_dependency_removed",
    input.blockerTaskId,
    input.blockedTaskId,
  );

  const audit = await deps.runInTransaction(async (tx) => {
    await deps.deleteDependency(tx, input.blockerTaskId, input.blockedTaskId);

    const noteIds: string[] = [];
    const activityIds: string[] = [];
    // Mirrored audit on BOTH tasks, [blocked, blocker] order.
    for (const taskId of [input.blockedTaskId, input.blockerTaskId]) {
      const note = await deps.appendTaskNote(tx, {
        taskId,
        noteType: "system",
        content: notePayload,
        createdBy: "agent",
      });
      noteIds.push(note.noteId);
      const activity = await deps.recordTaskDependencyRemoved(tx, {
        taskId,
        blockerTaskId: input.blockerTaskId,
        blockedTaskId: input.blockedTaskId,
        by: "agent",
        occurredAt: now,
      });
      activityIds.push(activity.activityId);
    }
    return { noteIds, activityIds };
  });

  return {
    operation: "dependency-remove",
    taskId: input.blockedTaskId,
    task: blockedTask,
    blockerTaskId: input.blockerTaskId,
    blockedTaskId: input.blockedTaskId,
    noteIds: audit.noteIds,
    activityIds: audit.activityIds,
    activityId: audit.activityIds[0] ?? null,
    warnings: [],
  };
}

/**
 * Flag a task as needing attention (wraps the flagAttention helper, audit ON
 * by default; `silent` suppresses the note/activity pair). Idempotent:
 * re-flagging keeps the original needs_attention_set_at.
 */
export async function flagAttentionOperation(
  input: FlagAttentionInput,
  deps: CurationOperationDeps = productionCurationOperationDeps,
): Promise<FlagAttentionReceipt> {
  const silent = input.silent ?? false;
  const reason = input.reason ?? null;

  // The helper is transactional on its own (single atomic write + audit).
  const result = await deps.flagAttention(input.taskId, reason, { silent });
  const task = await requireTask(deps, input.taskId);

  return {
    operation: "flag-attention",
    taskId: input.taskId,
    task,
    reason,
    alreadyFlagged: result.wasFlagged,
    silent,
    activityId: result.activityId,
    warnings: [],
  };
}

/**
 * Clear a task's needs-attention flag (wraps the unflagAttention helper,
 * audit ON by default; `silent` suppresses the note/activity pair).
 */
export async function unflagAttentionOperation(
  input: UnflagAttentionInput,
  deps: CurationOperationDeps = productionCurationOperationDeps,
): Promise<UnflagAttentionReceipt> {
  const silent = input.silent ?? false;

  const result = await deps.unflagAttention(input.taskId, { silent });
  const task = await requireTask(deps, input.taskId);

  return {
    operation: "unflag-attention",
    taskId: input.taskId,
    task,
    alreadyClear: !result.wasFlagged,
    silent,
    activityId: result.activityId,
    warnings: [],
  };
}
