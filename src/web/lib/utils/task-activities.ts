import type { TaskActivity, TaskActivityEventType, TaskStatus } from "../types.js";
import { taskStatusLabel } from "./status-labels.js";

export interface TaskActivityDisplayRow {
  label: string;
  value: string;
}

export interface TaskActivityDisplay {
  label: string;
  title: string;
  rows: TaskActivityDisplayRow[];
}

function eventTypeLabel(eventType: TaskActivityEventType): string {
  switch (eventType) {
    case "task_created":
      return "Created";
    case "task_fields_updated":
      return "Fields";
    case "task_status_changed":
      return "Status";
    case "task_goal_linked":
    case "task_goal_unlinked":
      return "Goal";
    case "task_dependency_added":
    case "task_dependency_removed":
      return "Dependency";
    case "task_attention_flagged":
    case "task_attention_cleared":
      return "Attention";
    case "task_delegation_updated":
      return "Delegation";
    case "task_resource_attached":
      return "Resource";
    case "task_mcp_action_recorded":
      return "MCP";
    case "task_queue_changed":
      return "Queue";
    case "task_followed_up":
      return "Follow-up";
    case "task_deferred":
      return "Deferred";
  }
}

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replaceAll("_", " ")
    .replace(/^\w/, (char) => char.toUpperCase())
    .trim();
}

function humanizeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") {
    const date = new Date(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(date.getTime())) {
      return date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
    return value.replaceAll("_", " ");
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function statusValue(value: unknown): string {
  if (typeof value !== "string") return humanizeValue(value);
  const valid = ["triage", "backlog", "in_progress", "blocked", "review", "done", "cancelled"];
  return valid.includes(value) ? taskStatusLabel(value as TaskStatus).toLowerCase() : humanizeValue(value);
}

function changedRows(changes: unknown): TaskActivityDisplayRow[] {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
  return Object.entries(changes as Record<string, { from?: unknown; to?: unknown }>).map(([field, delta]) => ({
    label: humanizeKey(field),
    value: `${humanizeValue(delta.from)} -> ${humanizeValue(delta.to)}`,
  }));
}

export function formatTaskActivityForDisplay(activity: TaskActivity): TaskActivityDisplay {
  const p = activity.payload;
  const rows: TaskActivityDisplayRow[] = [];

  switch (activity.event_type) {
    case "task_fields_updated":
      rows.push(...changedRows(p.changes));
      break;
    case "task_status_changed":
      rows.push(
        { label: "From", value: statusValue(p.from_status) },
        { label: "To", value: statusValue(p.to_status) },
      );
      break;
    case "task_delegation_updated":
      rows.push(
        { label: "From owner", value: humanizeValue(p.from_owner) },
        { label: "To owner", value: humanizeValue(p.to_owner) },
      );
      break;
    default:
      for (const [key, value] of Object.entries(p)) {
        rows.push({ label: humanizeKey(key), value: humanizeValue(value) });
      }
      break;
  }

  return {
    label: eventTypeLabel(activity.event_type),
    title: activity.summary,
    rows,
  };
}
