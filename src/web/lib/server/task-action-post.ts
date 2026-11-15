import {
  dispatchTaskAction,
  type TaskActionDispatchResponse,
  type TaskActionOperations,
  type TaskActionPayload,
} from "../../../services/task-action-dispatcher.js";
import { isWellFormedTaskId } from "../utils/task-id.js";

export class TaskActionRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TaskActionRequestError";
  }
}

export async function handleTaskActionPost(input: {
  taskId: string | null | undefined;
  readJson: () => Promise<unknown>;
  operations?: TaskActionOperations;
}): Promise<TaskActionDispatchResponse> {
  if (!input.taskId || !isWellFormedTaskId(input.taskId)) {
    throw new TaskActionRequestError(400, "bad task id");
  }

  let payload: TaskActionPayload;
  try {
    payload = await input.readJson() as TaskActionPayload;
  } catch {
    throw new TaskActionRequestError(400, "invalid json body");
  }

  return dispatchTaskAction(input.taskId, payload, input.operations);
}
