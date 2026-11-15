export const TASK_CARD_FIELD_PREFS_STORAGE_KEY = "execos.taskCard.fields.v1";

export const TASK_CARD_FIELDS = [
  { id: "id", label: "ID" },
  { id: "priority", label: "Priority" },
  { id: "title", label: "Title" },
  { id: "category", label: "Category" },
  { id: "status", label: "Status" },
  { id: "goal", label: "Goal" },
  { id: "owner", label: "Owner" },
  { id: "due", label: "Due date" },
  { id: "updated", label: "Updated" },
  { id: "attachments", label: "Attachments" },
  { id: "flags", label: "Flags" },
] as const;

export type TaskCardFieldId = (typeof TASK_CARD_FIELDS)[number]["id"];

export interface TaskCardFieldPreferences {
  hidden: TaskCardFieldId[];
}

const DEFAULT_FIELD_IDS: TaskCardFieldId[] = TASK_CARD_FIELDS.map((field) => field.id);
const VALID_FIELD_IDS = new Set<TaskCardFieldId>(DEFAULT_FIELD_IDS);

function isTaskCardFieldId(value: unknown): value is TaskCardFieldId {
  return typeof value === "string" && VALID_FIELD_IDS.has(value as TaskCardFieldId);
}

export function defaultTaskCardFieldPreferences(): TaskCardFieldPreferences {
  return { hidden: [] };
}

export function normalizeTaskCardFieldPreferences(candidate: unknown): TaskCardFieldPreferences {
  if (!candidate || typeof candidate !== "object") {
    return defaultTaskCardFieldPreferences();
  }

  const raw = candidate as { hidden?: unknown };
  const hidden: TaskCardFieldId[] = [];
  const seen = new Set<TaskCardFieldId>();

  if (Array.isArray(raw.hidden)) {
    for (const value of raw.hidden) {
      if (!isTaskCardFieldId(value) || seen.has(value)) continue;
      hidden.push(value);
      seen.add(value);
    }
  }

  if (hidden.length >= DEFAULT_FIELD_IDS.length) {
    return defaultTaskCardFieldPreferences();
  }

  return { hidden };
}
