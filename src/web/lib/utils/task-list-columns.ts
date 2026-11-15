export const TASK_LIST_COLUMN_PREFS_STORAGE_KEY = "execos.taskList.columns.v1";

export const TASK_LIST_COLUMNS = [
  { id: "id", label: "ID", sortable: true, defaultWidth: 92, minWidth: 72 },
  { id: "priority", label: "Priority", sortable: true, defaultWidth: 110, minWidth: 92 },
  { id: "title", label: "Title", sortable: true, defaultWidth: 280, minWidth: 180 },
  { id: "category", label: "Category", sortable: true, defaultWidth: 150, minWidth: 112 },
  { id: "goal", label: "Goal", sortable: true, defaultWidth: 112, minWidth: 88 },
  { id: "status", label: "Status", sortable: true, defaultWidth: 120, minWidth: 96 },
  { id: "owner", label: "Owner", sortable: true, defaultWidth: 116, minWidth: 88 },
  { id: "due", label: "Due", sortable: true, defaultWidth: 120, minWidth: 96 },
  { id: "updated", label: "Updated", sortable: true, defaultWidth: 112, minWidth: 92 },
  { id: "attachments", label: "Files", sortable: false, defaultWidth: 90, minWidth: 72 },
  { id: "flags", label: "Flags", sortable: false, defaultWidth: 130, minWidth: 96 },
] as const;

export type TaskListColumnId = (typeof TASK_LIST_COLUMNS)[number]["id"];

export interface TaskListColumnPreferences {
  order: TaskListColumnId[];
  hidden: TaskListColumnId[];
  widths: Partial<Record<TaskListColumnId, number>>;
}

export const DEFAULT_TASK_LIST_COLUMN_ORDER: TaskListColumnId[] = TASK_LIST_COLUMNS.map(
  (column) => column.id,
);

const VALID_COLUMN_IDS = new Set<TaskListColumnId>(DEFAULT_TASK_LIST_COLUMN_ORDER);
const MAX_COLUMN_WIDTH = 640;

function isTaskListColumnId(value: unknown): value is TaskListColumnId {
  return typeof value === "string" && VALID_COLUMN_IDS.has(value as TaskListColumnId);
}

export function defaultTaskListColumnPreferences(): TaskListColumnPreferences {
  return {
    order: [...DEFAULT_TASK_LIST_COLUMN_ORDER],
    hidden: [],
    widths: {},
  };
}

export function defaultTaskListColumnWidth(id: TaskListColumnId): number {
  return TASK_LIST_COLUMNS.find((column) => column.id === id)?.defaultWidth ?? 120;
}

export function minTaskListColumnWidth(id: TaskListColumnId): number {
  return TASK_LIST_COLUMNS.find((column) => column.id === id)?.minWidth ?? 72;
}

export function clampTaskListColumnWidth(id: TaskListColumnId, width: number): number {
  if (!Number.isFinite(width)) return defaultTaskListColumnWidth(id);
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(minTaskListColumnWidth(id), width)));
}

export function normalizeTaskListColumnPreferences(
  candidate: unknown,
): TaskListColumnPreferences {
  if (!candidate || typeof candidate !== "object") {
    return defaultTaskListColumnPreferences();
  }

  const raw = candidate as { order?: unknown; hidden?: unknown; widths?: unknown };
  const order: TaskListColumnId[] = [];
  const seen = new Set<TaskListColumnId>();

  if (Array.isArray(raw.order)) {
    for (const value of raw.order) {
      if (!isTaskListColumnId(value) || seen.has(value)) continue;
      order.push(value);
      seen.add(value);
    }
  }

  for (const column of DEFAULT_TASK_LIST_COLUMN_ORDER) {
    if (!seen.has(column)) order.push(column);
  }

  const hidden: TaskListColumnId[] = [];
  const hiddenSeen = new Set<TaskListColumnId>();
  if (Array.isArray(raw.hidden)) {
    for (const value of raw.hidden) {
      if (!isTaskListColumnId(value) || hiddenSeen.has(value)) continue;
      hidden.push(value);
      hiddenSeen.add(value);
    }
  }

  if (hidden.length >= DEFAULT_TASK_LIST_COLUMN_ORDER.length) {
    return { order, hidden: [], widths: normalizeColumnWidths(raw.widths) };
  }

  return { order, hidden, widths: normalizeColumnWidths(raw.widths) };
}

function normalizeColumnWidths(candidate: unknown): Partial<Record<TaskListColumnId, number>> {
  if (!candidate || typeof candidate !== "object") return {};

  const widths: Partial<Record<TaskListColumnId, number>> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (!isTaskListColumnId(key) || typeof value !== "number") continue;
    widths[key] = clampTaskListColumnWidth(key, value);
  }
  return widths;
}
