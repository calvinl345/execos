import type { DashboardTask } from "../types.js";
import { isSelfOwned } from "./task-row-workflow.js";

type QueueFields = Pick<DashboardTask, "owner" | "queue_rank" | "queue_rationale">;

export function shouldShowQueueRationale(task: QueueFields): boolean {
  return task.queue_rank !== null && isSelfOwned(task);
}

export function queueRationaleTitle(task: QueueFields): string {
  return !shouldShowQueueRationale(task)
    ? ""
    : `Why this task is ranked #${task.queue_rank} (AI reasoning)`;
}

export function queueRankContext(task: QueueFields): string | null {
  return shouldShowQueueRationale(task) ? `Queued #${task.queue_rank}` : null;
}

export function queueRationaleBody(task: QueueFields): string {
  if (shouldShowQueueRationale(task)) {
    return task.queue_rationale ?? "No rationale saved for this queue slot.";
  }
  return "";
}
