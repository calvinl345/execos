import { and, desc, eq, inArray, not } from "drizzle-orm";
import { db, tasks, team } from "../db/index.js";
import type { GateEventSurface, TaskStatus, TaskActivitySource, TaskNoteCreatedBy } from "../db/schema.js";
import { TaskNotFoundError } from "../db/errors.js";
import {
  deferTask as dbDeferTask,
  clearTaskSnooze as dbClearTaskSnooze,
  delegateTask as dbDelegateTask,
  recordFollowUp as dbRecordFollowUp,
  recordGateEvent,
  updateTaskStatus,
  updateTaskFields,
  appendTaskNote,
  type RecordGateEvent,
  type TaskWriteClient,
} from "../db/helpers/index.js";
import {
  defaultFollowUpDate,
  followUpAfterDueWarning,
  resolveOwnerToTeamSlug,
  type OwnerResolution,
  type TeamMemberLike,
  requireFollowUpForDelegatedOwner,
  normalizedOwner,
  isSelfOwner,
} from "../domain/follow-ups.js";
import { composeDelegationMessage } from "../domain/delegation-messages.js";
import { canTransitionTask } from "../domain/status-transitions.js";

export type FollowUpTaskRow = typeof tasks.$inferSelect;

export interface OwnerOpenTaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: Date | null;
  followUpDate: Date | null;
}

export interface FollowUpReceipt {
  taskId: string;
  task: FollowUpTaskRow;
  warnings: string[];
  activityId: string;
}

export interface DelegateReceipt extends FollowUpReceipt {
  operation: "delegate";
  ownerSlug: string;
  ownerDisplayName: string;
  followUpDate: Date;
  dueDate: Date | null;
  noteId: string | null;
  ownerOpenTasks: OwnerOpenTaskSummary[];
  defaultFollowUpApplied: boolean;
}

export interface RecordFollowUpReceipt extends FollowUpReceipt {
  operation: "follow-up";
  nextFollowUpDate: Date;
  dueDate: Date | null;
  status: TaskStatus;
  noteId: string;
}

export interface DeferReceipt extends FollowUpReceipt {
  operation: "defer";
  until: Date;
}

export interface ClearSnoozeReceipt extends FollowUpReceipt {
  operation: "clear-snooze";
}

export interface CompleteReceipt extends FollowUpReceipt {
  operation: "complete";
  newStatus: "done";
}

export interface UndelegateReceipt extends FollowUpReceipt {
  operation: "undelegate";
  noteId: string;
}

export interface UpdateFieldsReceipt extends FollowUpReceipt {
  operation: "update-fields";
}

export interface DelegationMessageReceipt extends FollowUpReceipt {
  operation: "delegation-message";
  kind: "handoff" | "nudge";
  followUpDate: Date | null;
  message: string;
}

export type DelegateResult =
  | { ok: true; receipt: DelegateReceipt }
  | { ok: false; outcome: "ask_owner"; resolution: Exclude<OwnerResolution, { status: "resolved" }> };

export interface FollowUpOperationDeps {
  now(): Date;
  findTask(taskId: string): Promise<FollowUpTaskRow | null>;
  listTeam(): Promise<TeamMemberLike[]>;
  listOwnerOpenTasks(ownerSlug: string): Promise<FollowUpTaskRow[]>;
  delegateTask(input: {
    taskId: string;
    owner: string;
    followUpDate: Date;
    dueDate?: Date | null;
    note?: string | null;
    source?: TaskActivitySource;
  }): Promise<{ task: FollowUpTaskRow; noteId: string | null; activityId: string }>;
  recordFollowUp(input: {
    taskId: string;
    update: string;
    nextFollowUpDate: Date;
    dueDate?: Date | null;
    status?: TaskStatus | null;
    source?: TaskActivitySource;
  }): Promise<{ task: FollowUpTaskRow; noteId: string; activityId: string }>;
  deferTask(input: {
    taskId: string;
    until: Date;
    source?: TaskActivitySource;
  }): Promise<{ task: FollowUpTaskRow; activityId: string }>;
  clearTaskSnooze(input: {
    taskId: string;
    source?: TaskActivitySource;
  }): Promise<{ task: FollowUpTaskRow; activityId: string | null }>;
  updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    by?: TaskNoteCreatedBy,
    opts?: { tx?: TaskWriteClient; source?: TaskActivitySource },
  ): Promise<{ task: FollowUpTaskRow; noteId: string; activityId: string }>;
  updateTaskFields(
    taskId: string,
    patch: Record<string, unknown>,
    opts?: { by?: TaskNoteCreatedBy; tx?: TaskWriteClient; source?: TaskActivitySource },
  ): Promise<{ task: FollowUpTaskRow; noteId: string; activityIds: string[] }>;
  undelegateTask(
    taskId: string,
    opts?: { source?: TaskActivitySource },
  ): Promise<{ task: FollowUpTaskRow; noteId: string; activityIds: string[] }>;
  appendTaskNote(input: {
    taskId: string;
    content: string;
    noteType: "system" | "manual";
    createdBy: "agent" | "system" | "user-direct";
  }): Promise<{ noteId: string }>;
  /**
   * Gate-decision telemetry seam (W5). Best-effort by contract: never
   * throws. All events recorded from this module are blocked outcomes on
   * refusal paths, inserted standalone.
   */
  recordGateEvent: RecordGateEvent;
}

export class FollowUpServiceError extends Error {
  constructor(
    public readonly code:
      | "terminal_task"
      | "empty_update"
      | "illegal_transition"
      | "not_delegated"
      | "delegated_task",
    message: string,
  ) {
    super(message);
    this.name = "FollowUpServiceError";
  }
}

export const productionFollowUpOperationDeps: FollowUpOperationDeps = {
  now: () => new Date(),
  async findTask(taskId) {
    const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    return rows[0] ?? null;
  },
  async listTeam() {
    return db.select().from(team).orderBy(team.displayName);
  },
  async listOwnerOpenTasks(ownerSlug) {
    return db
      .select()
      .from(tasks)
      .where(and(eq(tasks.owner, ownerSlug), not(inArray(tasks.status, ["done", "cancelled"]))))
      .orderBy(desc(tasks.lastStatusChangeAt));
  },
  delegateTask: dbDelegateTask,
  recordFollowUp: dbRecordFollowUp,
  deferTask: dbDeferTask,
  clearTaskSnooze: dbClearTaskSnooze,
  async updateTaskStatus(taskId, status, by, opts) {
    const res = await updateTaskStatus(taskId, status, by, opts);
    const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!rows[0]) throw new TaskNotFoundError(taskId);
    return { task: rows[0], noteId: res.noteId, activityId: res.activityId };
  },
  async updateTaskFields(taskId, patch, opts) {
    const res = await updateTaskFields(taskId, patch, opts);
    const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!rows[0]) throw new TaskNotFoundError(taskId);
    return { task: rows[0], noteId: res.noteId, activityIds: res.activityIds };
  },
  async undelegateTask(taskId, opts) {
    return db.transaction(async (tx) => {
      const fields = await updateTaskFields(
        taskId,
        {
          owner: null,
          followUpDate: null,
          handoffState: "not_applicable",
          handoffCopiedAt: null,
          handoffLastCopiedAt: null,
          handoffLastNudgeCopiedAt: null,
        },
        { tx, source: opts?.source },
      );

      const note = await appendTaskNote(tx, {
        taskId,
        content: UNDELEGATE_NOTE_CONTENT,
        noteType: "manual",
        createdBy: "agent",
      });

      const rows = await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (!rows[0]) throw new TaskNotFoundError(taskId);

      return {
        task: rows[0],
        noteId: note.noteId,
        activityIds: fields.activityIds,
      };
    });
  },
  async appendTaskNote(input) {
    return appendTaskNote(db, input);
  },
  recordGateEvent,
};

export async function delegateOperation(
  input: {
    taskId: string;
    ownerText: string;
    followUpDate?: Date | null;
    dueDate?: Date | null;
    note?: string | null;
    /** Calling surface for gate-decision telemetry (W5). Default "cli". */
    surface?: GateEventSurface;
    source?: TaskActivitySource;
  },
  deps: FollowUpOperationDeps = productionFollowUpOperationDeps,
): Promise<DelegateResult> {
  const surface: GateEventSurface = input.surface ?? "cli";
  const task = await requireOpenTask(deps, input.taskId);
  const resolution = resolveOwnerToTeamSlug(input.ownerText, await deps.listTeam());
  if (resolution.status !== "resolved") {
    // owner_resolution gate: ambiguous/unresolved owner refuses the
    // delegation. Standalone, best-effort.
    await deps.recordGateEvent({
      gate: "owner_resolution",
      operation: "delegate",
      outcome: "blocked",
      surface,
      taskId: input.taskId,
      detail: {
        ownerText: input.ownerText,
        resolution: resolution.status,
        ...(resolution.status === "ambiguous"
          ? { candidates: resolution.matches.map((member) => member.slug) }
          : {}),
      },
    });
    return { ok: false, outcome: "ask_owner", resolution };
  }

  const dueDate = input.dueDate === undefined ? task.dueDate : input.dueDate;
  const defaultFollowUpApplied = !input.followUpDate;
  const followUpDate =
    input.followUpDate ??
    defaultFollowUpDate({
      now: deps.now(),
      dueDate,
    });

  const validation = requireFollowUpForDelegatedOwner(resolution.slug, followUpDate);
  if (!validation.ok) {
    // owner_follow_up gate: a delegated owner without a follow-up date
    // refuses the delegation. Standalone, best-effort.
    await deps.recordGateEvent({
      gate: "owner_follow_up",
      operation: "delegate",
      outcome: "blocked",
      surface,
      taskId: input.taskId,
      detail: { owner: resolution.slug, reason: validation.reason },
    });
    throw new FollowUpServiceError("illegal_transition", validation.reason);
  }

  const warnings = warningMessages(followUpDate, dueDate);

  const mutation = await deps.delegateTask({
    taskId: input.taskId,
    owner: resolution.slug,
    followUpDate,
    dueDate,
    note: input.note,
    source: input.source,
  });
  const ownerOpenTasks = (await deps.listOwnerOpenTasks(resolution.slug)).map(openTaskSummary);

  return {
    ok: true,
    receipt: {
      operation: "delegate",
      taskId: input.taskId,
      task: mutation.task,
      ownerSlug: resolution.slug,
      ownerDisplayName: resolution.displayName,
      followUpDate,
      dueDate,
      noteId: mutation.noteId,
      ownerOpenTasks,
      defaultFollowUpApplied,
      warnings,
      activityId: mutation.activityId,
    },
  };
}

export async function recordFollowUpOperation(
  input: {
    taskId: string;
    update: string;
    nextFollowUpDate: Date;
    dueDate?: Date | null;
    status?: TaskStatus | null;
    source?: TaskActivitySource;
  },
  deps: FollowUpOperationDeps = productionFollowUpOperationDeps,
): Promise<RecordFollowUpReceipt> {
  const task = await requireOpenTask(deps, input.taskId);
  if (input.update.trim() === "") {
    throw new FollowUpServiceError("empty_update", "Follow-up update text is required.");
  }

  if (input.status) {
    if (!canTransitionTask(task.status, input.status)) {
      throw new FollowUpServiceError(
        "illegal_transition",
        `Illegal status transition from ${task.status} to ${input.status}.`,
      );
    }
  }

  const dueDate = input.dueDate === undefined ? task.dueDate : input.dueDate;
  const warnings = warningMessages(input.nextFollowUpDate, dueDate);
  const mutation = await deps.recordFollowUp({
    taskId: input.taskId,
    update: input.update,
    nextFollowUpDate: input.nextFollowUpDate,
    dueDate,
    status: input.status,
    source: input.source,
  });

  return {
    operation: "follow-up",
    taskId: input.taskId,
    task: mutation.task,
    nextFollowUpDate: input.nextFollowUpDate,
    dueDate,
    status: mutation.task.status,
    noteId: mutation.noteId,
    warnings,
    activityId: mutation.activityId,
  };
}

export async function deferOperation(
  input: {
    taskId: string;
    until: Date;
    source?: TaskActivitySource;
  },
  deps: FollowUpOperationDeps = productionFollowUpOperationDeps,
): Promise<DeferReceipt> {
  const task = await requireOpenTask(deps, input.taskId);
  if (!isSelfOwner(task.owner)) {
    throw new FollowUpServiceError(
      "delegated_task",
      `Task ${input.taskId} is delegated; change its follow-up date instead of snoozing it.`,
    );
  }
  const mutation = await deps.deferTask({
    taskId: input.taskId,
    until: input.until,
    source: input.source,
  });
  return {
    operation: "defer",
    taskId: input.taskId,
    task: mutation.task,
    until: input.until,
    warnings: [],
    activityId: mutation.activityId,
  };
}

export async function clearSnoozeOperation(
  input: {
    taskId: string;
    source?: TaskActivitySource;
  },
  deps: FollowUpOperationDeps = productionFollowUpOperationDeps,
): Promise<ClearSnoozeReceipt> {
  const task = await requireOpenTask(deps, input.taskId);
  if (!isSelfOwner(task.owner)) {
    throw new FollowUpServiceError(
      "delegated_task",
      `Task ${input.taskId} is delegated; it has no self-owned snooze to clear.`,
    );
  }
  const mutation = await deps.clearTaskSnooze({
    taskId: input.taskId,
    source: input.source,
  });
  return {
    operation: "clear-snooze",
    taskId: input.taskId,
    task: mutation.task,
    warnings: [],
    activityId: mutation.activityId ?? "",
  };
}

export async function completeOperation(
  input: {
    taskId: string;
    /** Calling surface for gate-decision telemetry (W5). Default "cli". */
    surface?: GateEventSurface;
    source?: TaskActivitySource;
  },
  deps: FollowUpOperationDeps = productionFollowUpOperationDeps,
): Promise<CompleteReceipt> {
  const task = await requireOpenTask(deps, input.taskId);
  if (!canTransitionTask(task.status, "done")) {
    // status_transition gate: refusal logs standalone, best-effort.
    await deps.recordGateEvent({
      gate: "status_transition",
      operation: "complete",
      outcome: "blocked",
      surface: input.surface ?? "cli",
      taskId: input.taskId,
      detail: { from: task.status, to: "done" },
    });
    throw new FollowUpServiceError(
      "illegal_transition",
      `Illegal status transition from ${task.status} to done.`,
    );
  }

  const mutation = await deps.updateTaskStatus(input.taskId, "done", "agent", { source: input.source });
  return {
    operation: "complete",
    taskId: input.taskId,
    task: mutation.task,
    newStatus: "done",
    warnings: [],
    activityId: mutation.activityId,
  };
}

export async function undelegateOperation(
  input: { taskId: string; source?: TaskActivitySource },
  deps: FollowUpOperationDeps = productionFollowUpOperationDeps,
): Promise<UndelegateReceipt> {
  const task = await requireOpenTask(deps, input.taskId);
  if (normalizedOwner(task.owner) === "me") {
    throw new FollowUpServiceError(
      "not_delegated",
      `Task ${input.taskId} is already owned by Jordan (not delegated).`,
    );
  }

  const mutation = await deps.undelegateTask(input.taskId, { source: input.source });

  const activityId = mutation.activityIds[0] ?? "";

  return {
    operation: "undelegate",
    taskId: input.taskId,
    task: mutation.task,
    noteId: mutation.noteId,
    warnings: [],
    activityId,
  };
}

export async function updateTaskFieldsOperation(
  input: { taskId: string; dueDate: Date | null; source?: TaskActivitySource },
  deps: FollowUpOperationDeps = productionFollowUpOperationDeps,
): Promise<UpdateFieldsReceipt> {
  await requireOpenTask(deps, input.taskId);
  const mutation = await deps.updateTaskFields(
    input.taskId,
    { dueDate: input.dueDate },
    { source: input.source },
  );

  const activityId = mutation.activityIds[0] ?? "";

  return {
    operation: "update-fields",
    taskId: input.taskId,
    task: mutation.task,
    warnings: [],
    activityId,
  };
}

export async function delegationMessageOperation(
  input: {
    taskId: string;
    kind: "handoff" | "nudge";
    followUpDate?: Date | null;
    source?: TaskActivitySource;
  },
  deps: FollowUpOperationDeps = productionFollowUpOperationDeps,
): Promise<DelegationMessageReceipt> {
  const task = await requireOpenTask(deps, input.taskId);
  if (normalizedOwner(task.owner) === "me") {
    throw new FollowUpServiceError(
      "not_delegated",
      `Task ${input.taskId} is owned by Jordan; delegation messages require a teammate owner.`,
    );
  }

  const now = deps.now();
  const followUpDate = input.followUpDate === undefined ? task.followUpDate : input.followUpDate;

  // Deduplicate rapid subsequent copies of the same handoff or nudge message.
  // If the last copy of this kind was less than 5 minutes ago and the follow-up date is unchanged,
  // we return the existing state directly without updating database timestamps or creating activity logs.
  const lastCopied = input.kind === "handoff" ? task.handoffLastCopiedAt : task.handoffLastNudgeCopiedAt;
  const isTimeDeduplicated = lastCopied && (now.getTime() - lastCopied.getTime() < 5 * 60 * 1000);
  const dateVal = (d: Date | null | undefined) => d ? d.getTime() : null;
  const isFollowUpUnchanged = dateVal(followUpDate) === dateVal(task.followUpDate);
  const isStateUnchanged = input.kind !== "handoff" || task.handoffState === "copied";

  if (isTimeDeduplicated && isFollowUpUnchanged && isStateUnchanged) {
    const message = composeDelegationMessage({
      kind: input.kind,
      task: {
        title: task.title,
        description: task.description,
        dueDate: task.dueDate,
        owner: task.owner,
      },
      followUpDate,
    });

    return {
      operation: "delegation-message",
      taskId: input.taskId,
      task,
      kind: input.kind,
      followUpDate,
      message,
      warnings: [],
      activityId: "",
    };
  }

  const patch =
    input.kind === "handoff"
      ? {
          followUpDate,
          handoffState: "copied" as const,
          handoffCopiedAt: task.handoffCopiedAt ?? now,
          handoffLastCopiedAt: now,
        }
      : {
          followUpDate,
          handoffLastNudgeCopiedAt: now,
        };

  const mutation = await deps.updateTaskFields(
    input.taskId,
    patch,
    { source: input.source },
  );
  const updated = mutation.task;
  const message = composeDelegationMessage({
    kind: input.kind,
    task: {
      title: updated.title,
      description: updated.description,
      dueDate: updated.dueDate,
      owner: updated.owner,
    },
    followUpDate,
  });

  return {
    operation: "delegation-message",
    taskId: input.taskId,
    task: updated,
    kind: input.kind,
    followUpDate,
    message,
    warnings: [],
    activityId: mutation.activityIds[0] ?? "",
  };
}

async function requireOpenTask(
  deps: FollowUpOperationDeps,
  taskId: string,
): Promise<FollowUpTaskRow> {
  const task = await deps.findTask(taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  if (task.status === "done" || task.status === "cancelled") {
    throw new FollowUpServiceError(
      "terminal_task",
      `Task ${taskId} is already terminal (${task.status}).`,
    );
  }
  return task;
}

function warningMessages(followUpDate: Date, dueDate: Date | null): string[] {
  const warning = followUpAfterDueWarning({ followUpDate, dueDate });
  return warning.warning ? [warning.message] : [];
}

function openTaskSummary(task: FollowUpTaskRow): OwnerOpenTaskSummary {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    dueDate: task.dueDate,
    followUpDate: task.followUpDate,
  };
}

const UNDELEGATE_NOTE_CONTENT = "Task un-delegated: returned to Jordan's queue";
