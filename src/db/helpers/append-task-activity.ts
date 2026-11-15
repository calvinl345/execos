import { nanoid } from "nanoid";
import type {
  TaskActivityActorType,
  TaskActivityEventType,
  TaskActivitySource,
  TaskNoteCreatedBy,
  TaskStatus,
} from "../schema.js";
import { taskActivities } from "../schema.js";
import type { TaskFieldDiff } from "./formatters.js";
import type { TaskWriteClient } from "./types.js";

const DEFAULT_SCHEMA_VERSION = 1;

export interface TaskActivityActor {
  actorType?: TaskActivityActorType;
  actorLabel?: string;
  source?: TaskActivitySource;
  occurredAt?: Date;
}

export interface AppendTaskActivityInput extends TaskActivityActor {
  taskId: string;
  eventType: TaskActivityEventType;
  summary: string;
  payload?: Record<string, unknown>;
  schemaVersion?: number;
}

export interface AppendTaskActivityResult {
  activityId: string;
}

export async function appendTaskActivity(
  tx: TaskWriteClient,
  input: AppendTaskActivityInput,
): Promise<AppendTaskActivityResult> {
  const activityId = `ACT-${nanoid(12)}`;
  await tx.insert(taskActivities).values({
    id: activityId,
    taskId: input.taskId,
    eventType: input.eventType,
    summary: input.summary,
    actorType: input.actorType ?? "agent",
    actorLabel: input.actorLabel ?? defaultActorLabel(input.actorType ?? "agent"),
    source: input.source ?? "cli",
    occurredAt: input.occurredAt ?? new Date(),
    payload: input.payload ?? {},
    schemaVersion: input.schemaVersion ?? DEFAULT_SCHEMA_VERSION,
  });
  return { activityId };
}

function defaultActorLabel(actorType: TaskActivityActorType): string {
  switch (actorType) {
    case "agent":
      return "ExecOS agent";
    case "system":
      return "System";
    case "user":
      return "User";
  }
}

function actorFromCreatedBy(by: TaskNoteCreatedBy): TaskActivityActorType {
  return by === "user-direct" ? "user" : by;
}

function actorLabelFromCreatedBy(by: TaskNoteCreatedBy): string {
  switch (by) {
    case "agent":
      return "ExecOS agent";
    case "system":
      return "System";
    case "user-direct":
      return "User";
  }
}

function activityActor(by: TaskNoteCreatedBy, opts: TaskActivityActor = {}): Required<TaskActivityActor> {
  const actorType = opts.actorType ?? actorFromCreatedBy(by);
  return {
    actorType,
    actorLabel: opts.actorLabel ?? actorLabelFromCreatedBy(by),
    source: opts.source ?? "cli",
    occurredAt: opts.occurredAt ?? new Date(),
  };
}

function fieldLabel(field: string): string {
  return field
    .replace(/([A-Z])/g, " $1")
    .replaceAll("_", " ")
    .replace(/^\w/, (char) => char.toUpperCase())
    .trim();
}

function statusLabel(status: TaskStatus): string {
  return status.replaceAll("_", " ");
}

export async function recordTaskCreated(
  tx: TaskWriteClient,
  input: {
    taskId: string;
    title: string;
    status: TaskStatus;
    priority: string | null;
    category: string;
    owner: string | null;
    dueDate: Date | null;
    goalId: string | null;
    by?: TaskNoteCreatedBy;
  } & TaskActivityActor,
): Promise<AppendTaskActivityResult> {
  const by = input.by ?? "agent";
  const actor = activityActor(by, input);
  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_created",
    summary: `Task created: ${input.title}`,
    ...actor,
    payload: {
      title: input.title,
      status: input.status,
      priority: input.priority,
      category: input.category,
      owner: input.owner,
      due_date: input.dueDate?.toISOString() ?? null,
      goal_id: input.goalId,
    },
  });
}

export async function recordTaskStatusChanged(
  tx: TaskWriteClient,
  input: {
    taskId: string;
    fromStatus: TaskStatus;
    toStatus: TaskStatus;
    by?: TaskNoteCreatedBy;
  } & TaskActivityActor,
): Promise<AppendTaskActivityResult> {
  const by = input.by ?? "agent";
  const actor = activityActor(by, input);
  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_status_changed",
    summary: `Status changed from ${statusLabel(input.fromStatus)} to ${statusLabel(input.toStatus)}`,
    ...actor,
    payload: {
      from_status: input.fromStatus,
      to_status: input.toStatus,
    },
  });
}

export async function recordTaskFieldsUpdated(
  tx: TaskWriteClient,
  input: {
    taskId: string;
    diff: TaskFieldDiff;
    by?: TaskNoteCreatedBy;
  } & TaskActivityActor,
): Promise<AppendTaskActivityResult | null> {
  const changes = Object.entries(input.diff.changes).filter(([field]) => field !== "owner");
  if (changes.length === 0) return null;

  const by = input.by ?? "agent";
  const actor = activityActor(by, input);
  const labels = changes.map(([field]) => fieldLabel(field));
  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_fields_updated",
    summary:
      labels.length === 1
        ? `${labels[0]} updated`
        : `${labels.length} task fields updated`,
    ...actor,
    payload: {
      changes: Object.fromEntries(changes),
    },
  });
}

export async function recordTaskDelegationUpdated(
  tx: TaskWriteClient,
  input: {
    taskId: string;
    fromOwner: unknown;
    toOwner: unknown;
    followUpDate?: Date | null;
    dueDate?: Date | null;
    noteId?: string | null;
    by?: TaskNoteCreatedBy;
  } & TaskActivityActor,
): Promise<AppendTaskActivityResult> {
  const by = input.by ?? "agent";
  const actor = activityActor(by, input);
  const fromOwner = input.fromOwner == null || input.fromOwner === "" ? "unassigned" : String(input.fromOwner);
  const toOwner = input.toOwner == null || input.toOwner === "" ? "unassigned" : String(input.toOwner);
  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_delegation_updated",
    summary: `Delegation changed from ${fromOwner} to ${toOwner}`,
    ...actor,
    payload: {
      from_owner: input.fromOwner ?? null,
      to_owner: input.toOwner ?? null,
      follow_up_date: input.followUpDate?.toISOString() ?? null,
      due_date: input.dueDate?.toISOString() ?? null,
      note_id: input.noteId ?? null,
    },
  });
}

export async function recordTaskFollowedUp(
  tx: TaskWriteClient,
  input: {
    taskId: string;
    updateNoteId: string;
    nextFollowUpDate: Date;
    previousFollowUpDate?: Date | null;
    dueDate?: Date | null;
    status?: TaskStatus | null;
    by?: TaskNoteCreatedBy;
  } & TaskActivityActor,
): Promise<AppendTaskActivityResult> {
  const by = input.by ?? "agent";
  const actor = activityActor(by, input);
  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_followed_up",
    summary: `Follow-up logged; next follow-up ${input.nextFollowUpDate.toISOString()}`,
    ...actor,
    payload: {
      update_note_id: input.updateNoteId,
      previous_follow_up_date: input.previousFollowUpDate?.toISOString() ?? null,
      next_follow_up_date: input.nextFollowUpDate.toISOString(),
      due_date: input.dueDate?.toISOString() ?? null,
      status: input.status ?? null,
    },
  });
}

export async function recordTaskDeferred(
  tx: TaskWriteClient,
  input: {
    taskId: string;
    fromSnoozedUntil?: Date | null;
    until: Date;
    by?: TaskNoteCreatedBy;
  } & TaskActivityActor,
): Promise<AppendTaskActivityResult> {
  const by = input.by ?? "agent";
  const actor = activityActor(by, input);
  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_deferred",
    summary: `Deferred until ${input.until.toISOString()}`,
    ...actor,
    payload: {
      from_snoozed_until: input.fromSnoozedUntil?.toISOString() ?? null,
      until: input.until.toISOString(),
    },
  });
}

export async function recordTaskSnoozeCleared(
  tx: TaskWriteClient,
  input: {
    taskId: string;
    fromSnoozedUntil?: Date | null;
    by?: TaskNoteCreatedBy;
  } & TaskActivityActor,
): Promise<AppendTaskActivityResult> {
  const by = input.by ?? "agent";
  const actor = activityActor(by, input);
  // Reuses the task_deferred event type (the snooze family) so the un-snooze
  // needs no new enum value / migration; the summary distinguishes it.
  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_deferred",
    summary: "Snooze cleared",
    ...actor,
    payload: {
      from_snoozed_until: input.fromSnoozedUntil?.toISOString() ?? null,
      until: null,
    },
  });
}

export async function recordTaskGoalLinked(
  tx: TaskWriteClient,
  input: { taskId: string; goalId: string; by?: TaskNoteCreatedBy } & TaskActivityActor,
): Promise<AppendTaskActivityResult> {
  const by = input.by ?? "agent";
  const actor = activityActor(by, input);
  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_goal_linked",
    summary: `Linked to goal ${input.goalId}`,
    ...actor,
    payload: { goal_id: input.goalId },
  });
}

export async function recordTaskGoalUnlinked(
  tx: TaskWriteClient,
  input: { taskId: string; fromGoalId: string; by?: TaskNoteCreatedBy } & TaskActivityActor,
): Promise<AppendTaskActivityResult> {
  const by = input.by ?? "agent";
  const actor = activityActor(by, input);
  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_goal_unlinked",
    summary: `Unlinked from goal ${input.fromGoalId}`,
    ...actor,
    payload: { from_goal_id: input.fromGoalId },
  });
}

export async function recordTaskDependencyAdded(
  tx: TaskWriteClient,
  input: { taskId: string; blockerTaskId: string; blockedTaskId: string; by?: TaskNoteCreatedBy } & TaskActivityActor,
): Promise<AppendTaskActivityResult> {
  const by = input.by ?? "agent";
  const actor = activityActor(by, input);
  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_dependency_added",
    summary: `${input.blockedTaskId} is blocked by ${input.blockerTaskId}`,
    ...actor,
    payload: {
      blocker_task_id: input.blockerTaskId,
      blocked_task_id: input.blockedTaskId,
    },
  });
}

export async function recordTaskDependencyRemoved(
  tx: TaskWriteClient,
  input: { taskId: string; blockerTaskId: string; blockedTaskId: string; by?: TaskNoteCreatedBy } & TaskActivityActor,
): Promise<AppendTaskActivityResult> {
  const by = input.by ?? "agent";
  const actor = activityActor(by, input);
  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_dependency_removed",
    summary: `${input.blockedTaskId} is no longer blocked by ${input.blockerTaskId}`,
    ...actor,
    payload: {
      blocker_task_id: input.blockerTaskId,
      blocked_task_id: input.blockedTaskId,
    },
  });
}

export async function recordTaskAttentionFlagged(
  tx: TaskWriteClient,
  input: { taskId: string; reason?: string | null; by?: TaskNoteCreatedBy } & TaskActivityActor,
): Promise<AppendTaskActivityResult> {
  const by = input.by ?? "agent";
  const actor = activityActor(by, input);
  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_attention_flagged",
    summary: input.reason ? `Needs attention: ${input.reason}` : "Needs attention flagged",
    ...actor,
    payload: { reason: input.reason ?? null },
  });
}

export async function recordTaskAttentionCleared(
  tx: TaskWriteClient,
  input: { taskId: string; by?: TaskNoteCreatedBy } & TaskActivityActor,
): Promise<AppendTaskActivityResult> {
  const by = input.by ?? "agent";
  const actor = activityActor(by, input);
  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_attention_cleared",
    summary: "Needs attention cleared",
    ...actor,
    payload: {},
  });
}

export async function recordTaskResourceAttached(
  tx: TaskWriteClient,
  input: {
    taskId: string;
    documentId: string;
    filename: string;
    storagePath: string;
    by?: TaskNoteCreatedBy;
  } & TaskActivityActor,
): Promise<AppendTaskActivityResult> {
  const by = input.by ?? "agent";
  const actor = activityActor(by, input);
  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_resource_attached",
    summary: `Resource attached: ${input.filename}`,
    ...actor,
    payload: {
      document_id: input.documentId,
      filename: input.filename,
      storage_path: input.storagePath,
    },
  });
}

export async function recordTaskMcpAction(
  tx: TaskWriteClient,
  input: {
    taskId: string;
    action: string;
    details?: Record<string, unknown>;
    by?: TaskNoteCreatedBy;
  } & TaskActivityActor,
): Promise<AppendTaskActivityResult> {
  const by = input.by ?? "agent";
  const actor = activityActor(by, { ...input, source: input.source ?? "mcp" });
  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_mcp_action_recorded",
    summary: input.action,
    ...actor,
    payload: input.details ?? {},
  });
}

export async function recordTaskQueueChanged(
  tx: TaskWriteClient,
  input: {
    taskId: string;
    rank: number | null;
    previousRank: number | null;
    rationale: string | null;
    by?: TaskNoteCreatedBy;
  } & TaskActivityActor,
): Promise<AppendTaskActivityResult> {
  const by = input.by ?? "agent";
  const actor = activityActor(by, input);
  
  let summary = "";
  if (input.rank !== null) {
    summary = `Queued at #${input.rank} - ${input.rationale}`;
  } else {
    summary = "Left the queue (reprioritization)";
  }

  return appendTaskActivity(tx, {
    taskId: input.taskId,
    eventType: "task_queue_changed",
    summary,
    ...actor,
    payload: {
      rank: input.rank,
      previousRank: input.previousRank,
      rationale: input.rationale,
    },
  });
}
