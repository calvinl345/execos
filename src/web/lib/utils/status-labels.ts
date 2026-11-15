import type { TaskStatus } from "../types.js";

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  triage: "Triage",
  backlog: "Backlog",
  in_progress: "In Progress",
  blocked: "Blocked",
  review: "Delegated",
  done: "Done",
  cancelled: "Cancelled",
};

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status];
}

export function taskStatusLabelLower(status: TaskStatus): string {
  return taskStatusLabel(status).toLowerCase();
}
