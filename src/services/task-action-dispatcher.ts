import type { TaskStatus } from "../db/schema.js";
import { parseNaturalDate } from "../domain/dates.js";
import {
  clearSnoozeOperation as runClearSnoozeOperation,
  completeOperation as runCompleteOperation,
  deferOperation as runDeferOperation,
  delegationMessageOperation as runDelegationMessageOperation,
  delegateOperation as runDelegateOperation,
  FollowUpServiceError,
  recordFollowUpOperation as runRecordFollowUpOperation,
  undelegateOperation as runUndelegateOperation,
  updateTaskFieldsOperation as runUpdateTaskFieldsOperation,
} from "./follow-up-operations.js";
import {
  reopenTaskOperation as runReopenTaskOperation,
  TaskServiceError,
} from "./task-operations.js";

export type TaskActionPayload =
  | { action: "delegate"; owner: string; followUpDate?: string; dueDate?: string; notes?: string }
  | { action: "delegation-message"; kind: "handoff" | "nudge"; followUpDate?: string | null }
  | { action: "follow-up"; update: string; nextFollowUpDate: string; dueDate?: string; status?: string }
  | { action: "defer"; until: string }
  | { action: "clear-snooze" }
  | { action: "update-fields"; dueDate?: string | null }
  | { action: "complete" }
  | { action: "reopen" }
  | { action: "undelegate" };

export interface TaskActionOperations {
  delegateOperation: typeof runDelegateOperation;
  delegationMessageOperation: typeof runDelegationMessageOperation;
  recordFollowUpOperation: typeof runRecordFollowUpOperation;
  deferOperation: typeof runDeferOperation;
  clearSnoozeOperation: typeof runClearSnoozeOperation;
  updateTaskFieldsOperation: typeof runUpdateTaskFieldsOperation;
  completeOperation: typeof runCompleteOperation;
  reopenTaskOperation: typeof runReopenTaskOperation;
  undelegateOperation: typeof runUndelegateOperation;
}

export interface TaskActionDispatchResponse {
  status: number;
  body: unknown;
}

export const defaultTaskActionOperations: TaskActionOperations = {
  delegateOperation: runDelegateOperation,
  delegationMessageOperation: runDelegationMessageOperation,
  recordFollowUpOperation: runRecordFollowUpOperation,
  deferOperation: runDeferOperation,
  clearSnoozeOperation: runClearSnoozeOperation,
  updateTaskFieldsOperation: runUpdateTaskFieldsOperation,
  completeOperation: runCompleteOperation,
  reopenTaskOperation: runReopenTaskOperation,
  undelegateOperation: runUndelegateOperation,
};

export async function dispatchTaskAction(
  taskId: string,
  payload: TaskActionPayload,
  operations: TaskActionOperations = defaultTaskActionOperations,
): Promise<TaskActionDispatchResponse> {
  try {
    if (payload.action === "delegate") {
      const body = await operations.delegateOperation({
        taskId,
        ownerText: payload.owner,
        followUpDate: payload.followUpDate ? new Date(payload.followUpDate) : undefined,
        dueDate: payload.dueDate ? new Date(payload.dueDate) : undefined,
        note: payload.notes,
        // Gate-decision telemetry (W5): calls arriving through this
        // dispatcher come from the dashboard.
        surface: "web",
        source: "dashboard",
      });
      return { status: 200, body };
    }

    if (payload.action === "follow-up") {
      const body = await operations.recordFollowUpOperation({
        taskId,
        update: payload.update,
        nextFollowUpDate: new Date(payload.nextFollowUpDate),
        dueDate: payload.dueDate ? new Date(payload.dueDate) : undefined,
        status: payload.status as TaskStatus | undefined,
        source: "dashboard",
      });
      return { status: 200, body };
    }

    if (payload.action === "delegation-message") {
      let followUpDate: Date | null | undefined;
      if (payload.followUpDate !== undefined && payload.followUpDate !== null) {
        const parseRes = parseNaturalDate(payload.followUpDate);
        if (!parseRes.ok) {
          return { status: 400, body: { error: parseRes.reason } };
        }
        followUpDate = parseRes.date;
      } else {
        followUpDate = payload.followUpDate;
      }

      const body = await operations.delegationMessageOperation({
        taskId,
        kind: payload.kind,
        followUpDate,
        source: "dashboard",
      });
      return { status: 200, body };
    }

    if (payload.action === "defer") {
      const parseRes = parseNaturalDate(payload.until);
      if (!parseRes.ok) {
        return { status: 400, body: { error: parseRes.reason } };
      }

      const body = await operations.deferOperation({
        taskId,
        until: parseRes.date,
        source: "dashboard",
      });
      return { status: 200, body };
    }

    if (payload.action === "clear-snooze") {
      const body = await operations.clearSnoozeOperation({
        taskId,
        source: "dashboard",
      });
      return { status: 200, body };
    }

    if (payload.action === "update-fields") {
      const body = await operations.updateTaskFieldsOperation({
        taskId,
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        source: "dashboard",
      });
      return { status: 200, body };
    }

    if (payload.action === "complete") {
      // Gate-decision telemetry (W5): web surface stamped onto any
      // status_transition refusal this operation records.
      const body = await operations.completeOperation({
        taskId,
        surface: "web",
        source: "dashboard",
      });
      return { status: 200, body };
    }

    if (payload.action === "reopen") {
      const body = await operations.reopenTaskOperation({
        taskId,
        surface: "web",
        source: "dashboard",
      });
      return { status: 200, body };
    }

    if (payload.action === "undelegate") {
      const body = await operations.undelegateOperation({
        taskId,
        source: "dashboard",
      });
      return { status: 200, body };
    }

    return { status: 400, body: { error: "unknown action" } };
  } catch (err: unknown) {
    if (err instanceof FollowUpServiceError) {
      return {
        status: statusForFollowUpServiceError(err),
        body: { error: err.message, code: err.code },
      };
    }

    if (err instanceof TaskServiceError) {
      return {
        status: statusForTaskServiceError(err),
        body: { error: err.message, code: err.code },
      };
    }

    const message = err instanceof Error ? err.message : "An unexpected error occurred";
    return { status: 500, body: { error: message } };
  }
}

function statusForTaskServiceError(err: TaskServiceError): number {
  if (
    err.code === "illegal_transition" ||
    err.code === "not_terminal" ||
    err.code === "terminal_task"
  ) {
    return 409;
  }
  return 400;
}

function statusForFollowUpServiceError(err: FollowUpServiceError): number {
  if (err.code === "empty_update") return 400;
  if (
    err.code === "illegal_transition" ||
    err.code === "not_delegated" ||
    err.code === "terminal_task"
  ) {
    return 409;
  }
  return 400;
}
