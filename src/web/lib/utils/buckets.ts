/**
 * Status → Kanban column mapping.
 *
 * The active board uses canonical task statuses for routing and persistence,
 * while ColumnDef.label carries the dashboard-facing language. Terminal
 * statuses are grouped into Closed only when the dashboard explicitly shows
 * closed work.
 */

import type { TaskStatus } from "../types.js";
import { taskStatusLabel } from "./status-labels.js";

export type ColumnId = "triage" | "backlog" | "in_progress" | "blocked" | "review" | "closed";

export interface ColumnDef {
  id: ColumnId;
  label: string;
  dotClass: string;
}

export const ACTIVE_COLUMNS: ReadonlyArray<ColumnDef> = [
  { id: "triage", label: "Triage", dotClass: "bg-neutral-300" },
  { id: "backlog", label: "Backlog", dotClass: "bg-neutral-500" },
  { id: "in_progress", label: "In Progress", dotClass: "bg-blue-500" },
  { id: "blocked", label: "Blocked", dotClass: "bg-amber-500" },
  { id: "review", label: taskStatusLabel("review"), dotClass: "bg-purple-500" },
];

export const CLOSED_COLUMN: ColumnDef = {
  id: "closed",
  label: "Closed",
  dotClass: "bg-emerald-500",
};

export const COLUMNS: ReadonlyArray<ColumnDef> = ACTIVE_COLUMNS;

export function columnsFor(showClosed: boolean): ReadonlyArray<ColumnDef> {
  return showClosed ? [...ACTIVE_COLUMNS, CLOSED_COLUMN] : ACTIVE_COLUMNS;
}

export function statusToColumn(status: TaskStatus, showClosed = false): ColumnId | null {
  switch (status) {
    case "triage":
      return "triage";
    case "backlog":
      return "backlog";
    case "in_progress":
      return "in_progress";
    case "blocked":
      return "blocked";
    case "review":
      return "review";
    case "done":
    case "cancelled":
      return showClosed ? "closed" : null;
  }
}

export function groupByColumn<T extends { status: TaskStatus }>(
  tasks: ReadonlyArray<T>,
  showClosed = false,
): Record<ColumnId, T[]> {
  const out: Record<ColumnId, T[]> = {
    triage: [],
    backlog: [],
    in_progress: [],
    blocked: [],
    review: [],
    closed: [],
  };
  for (const t of tasks) {
    const col = statusToColumn(t.status, showClosed);
    if (col) out[col].push(t);
  }
  return out;
}
