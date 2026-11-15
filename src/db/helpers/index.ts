/**
 * Re-exports for the TS-layer helpers that replace the PL/pgSQL triggers
 * per ADR-006.
 */

export { composeTaskId, composeGoalId } from "./compose-id.js";
export {
  formatTaskId,
  formatGoalId,
  formatStatusChangeNote,
  type StatusChangeNoteContent,
  computeTaskFieldDiff,
  type TaskFieldDiff,
  formatTaskFieldUpdateNote,
  formatGoalLinkNote,
  formatGoalUnlinkNote,
  formatAttentionFlaggedNote,
  formatAttentionClearedNote,
} from "./formatters.js";
export {
  flagAttention,
  unflagAttention,
} from "./needs-attention.js";
export { assertNoCycle } from "./no-cycle.js";
export {
  appendTaskNote,
  type AppendTaskNoteInput,
  type AppendTaskNoteResult,
} from "./append-task-note.js";
export {
  appendGateEvent,
  recordGateEvent,
  tryAppendGateEvent,
  type AppendGateEventInput,
  type AppendGateEventResult,
  type RecordGateEvent,
  type RecordGateEventOptions,
  type TryAppendGateEventResult,
} from "./gate-events.js";
export {
  appendTaskActivity,
  recordTaskAttentionCleared,
  recordTaskAttentionFlagged,
  recordTaskCreated,
  recordTaskDelegationUpdated,
  recordTaskDependencyAdded,
  recordTaskDependencyRemoved,
  recordTaskFieldsUpdated,
  recordTaskFollowedUp,
  recordTaskDeferred,
  recordTaskSnoozeCleared,
  recordTaskGoalLinked,
  recordTaskGoalUnlinked,
  recordTaskMcpAction,
  recordTaskQueueChanged,
  recordTaskResourceAttached,
  recordTaskStatusChanged,
  type AppendTaskActivityInput,
  type AppendTaskActivityResult,
  type TaskActivityActor,
} from "./append-task-activity.js";
export {
  updateTaskStatus,
  type UpdateTaskStatusResult,
} from "./task-status.js";
export {
  setTaskEmbedding,
  updateTaskFields,
  type UpdateTaskFieldsOptions,
  type UpdateTaskFieldsResult,
} from "./update-task-fields.js";
export {
  deferTask,
  clearTaskSnooze,
  delegateTask,
  recordFollowUp,
  type DeferTaskInput,
  type DeferTaskResult,
  type ClearSnoozeInput,
  type ClearSnoozeResult,
  type DelegateTaskInput,
  type DelegateTaskResult,
  type RecordFollowUpInput,
  type RecordFollowUpResult,
} from "./follow-ups.js";
export { enforcePZeroWipCap } from "./p0-wip-cap.js";
export { insertTask } from "./insert-task.js";
export {
  setQueue,
  clearQueue,
  type SetQueueEntry,
  type SetQueueOptions,
} from "./set-queue.js";
export type { TaskWriteClient } from "./types.js";
