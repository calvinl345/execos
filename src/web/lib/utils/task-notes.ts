import type { TaskNote, TaskNoteType, TaskStatus } from "../types.js";
import { taskStatusLabel } from "./status-labels.js";

export interface TaskNoteDisplayRow {
  label: string;
  value: string;
}

export interface TaskNoteDisplay {
  label: string;
  title: string;
  body: string | null;
  rows: TaskNoteDisplayRow[];
}

const INTAKE_STEP_LABELS: Record<string, string> = {
  step_1_dedup: "Dedup",
  step_2_complexity: "Complexity",
  step_3_dependency: "Dependencies",
  step_4_field_assignment: "Fields",
  step_5_delegation: "Delegation",
  step_6_downstream: "Downstream",
};

function noteTypeLabel(noteType: TaskNoteType): string {
  switch (noteType) {
    case "manual":
      return "Note";
    case "intake_checklist":
      return "Intake";
    case "status_change":
      return "Status";
    case "mcp_action":
      return "MCP";
    case "system":
      return "System";
  }
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function humanizeValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") {
    // Detect ISO datetime or date
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/.test(value)) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) {
        const hasTime = value.includes("T") && !value.endsWith("T00:00:00.000Z") && !value.endsWith("T00:00:00Z");
        if (hasTime) {
          return d.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });
        } else {
          return d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          });
        }
      }
    }
    return value
      .replaceAll("_", " ")
      .replaceAll(":", ": ")
      .replaceAll(",", ", ")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function getStatusLabel(statusVal: unknown): string {
  const s = String(statusVal);
  const validStatuses = ["triage", "backlog", "in_progress", "blocked", "review", "done", "cancelled"];
  if (validStatuses.includes(s)) {
    return taskStatusLabel(s as TaskStatus).toLowerCase();
  }
  return humanizeValue(statusVal);
}

function humanizeKey(key: string): string {
  return key
    .replace(/^step_\d+_/, "")
    .replaceAll("_", " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function fallbackDisplay(note: TaskNote): TaskNoteDisplay {
  const parsed = parseJsonRecord(note.content);
  if (!parsed) {
    return {
      label: noteTypeLabel(note.note_type),
      title: note.content,
      body: null,
      rows: [],
    };
  }

  return {
    label: noteTypeLabel(note.note_type),
    title: noteTypeLabel(note.note_type),
    body: null,
    rows: Object.entries(parsed).map(([key, value]) => ({
      label: humanizeKey(key),
      value: humanizeValue(value),
    })),
  };
}

function formatIntakeChecklist(note: TaskNote): TaskNoteDisplay {
  const parsed = parseJsonRecord(note.content);
  if (!parsed) return fallbackDisplay(note);

  const rows: TaskNoteDisplayRow[] = [];
  for (const [key, label] of Object.entries(INTAKE_STEP_LABELS)) {
    rows.push({ label, value: humanizeValue(parsed[key]) });
  }
  if (parsed.duration_ms !== undefined) {
    rows.push({ label: "Runtime", value: `${humanizeValue(parsed.duration_ms)} ms` });
  }

  return {
    label: noteTypeLabel(note.note_type),
    title: "Intake completed",
    body: null,
    rows,
  };
}

function formatStatusChange(note: TaskNote): TaskNoteDisplay {
  const parsed = parseJsonRecord(note.content);
  if (!parsed) return fallbackDisplay(note);

  const from = getStatusLabel(parsed.from);
  const to = getStatusLabel(parsed.to);
  const rows: TaskNoteDisplayRow[] = [];
  if (parsed.by !== undefined) rows.push({ label: "By", value: humanizeValue(parsed.by) });
  if (parsed.at !== undefined) rows.push({ label: "Recorded", value: humanizeValue(parsed.at) });

  return {
    label: noteTypeLabel(note.note_type),
    title: `Status changed from ${from} to ${to}`,
    body: null,
    rows,
  };
}

function formatSystemNote(note: TaskNote): TaskNoteDisplay {
  const parsed = parseJsonRecord(note.content);
  if (!parsed || typeof parsed.type !== "string") {
    return fallbackDisplay(note);
  }

  const type = parsed.type;
  const rows: TaskNoteDisplayRow[] = [];

  switch (type) {
    case "task_fields_updated": {
      const changes = parsed.changes as Record<string, { from: unknown; to: unknown }> | undefined;
      if (changes) {
        for (const [field, delta] of Object.entries(changes)) {
          let fromVal = delta.from === null || delta.from === undefined ? "none" : humanizeValue(delta.from);
          let toVal = delta.to === null || delta.to === undefined ? "none" : humanizeValue(delta.to);
          if (field === "status") {
            fromVal = delta.from === null || delta.from === undefined ? "none" : getStatusLabel(delta.from);
            toVal = delta.to === null || delta.to === undefined ? "none" : getStatusLabel(delta.to);
          }
          rows.push({
            label: humanizeKey(field),
            value: `${fromVal} -> ${toVal}`,
          });
        }
      }
      return {
        label: "System",
        title: "Fields updated",
        body: null,
        rows,
      };
    }
    case "task_goal_linked": {
      rows.push({ label: "Goal ID", value: String(parsed.goalId ?? "-") });
      if (parsed.by !== undefined) rows.push({ label: "By", value: humanizeValue(parsed.by) });
      if (parsed.at !== undefined) rows.push({ label: "Recorded", value: humanizeValue(parsed.at) });
      return {
        label: "System",
        title: "Goal linked",
        body: null,
        rows,
      };
    }
    case "task_goal_unlinked": {
      rows.push({ label: "From Goal", value: String(parsed.from ?? "-") });
      if (parsed.by !== undefined) rows.push({ label: "By", value: humanizeValue(parsed.by) });
      if (parsed.at !== undefined) rows.push({ label: "Recorded", value: humanizeValue(parsed.at) });
      return {
        label: "System",
        title: "Goal unlinked",
        body: null,
        rows,
      };
    }
    case "task_attention_flagged": {
      rows.push({ label: "Reason", value: String(parsed.reason ?? "no reason") });
      if (parsed.by !== undefined) rows.push({ label: "By", value: humanizeValue(parsed.by) });
      if (parsed.at !== undefined) rows.push({ label: "Recorded", value: humanizeValue(parsed.at) });
      return {
        label: "System",
        title: "Needs attention flagged",
        body: null,
        rows,
      };
    }
    case "task_attention_cleared": {
      if (parsed.by !== undefined) rows.push({ label: "By", value: humanizeValue(parsed.by) });
      if (parsed.at !== undefined) rows.push({ label: "Recorded", value: humanizeValue(parsed.at) });
      return {
        label: "System",
        title: "Needs attention cleared",
        body: null,
        rows,
      };
    }
    case "task_dependency_added": {
      rows.push({ label: "Blocker Task ID", value: String(parsed.blockerTaskId ?? "-") });
      rows.push({ label: "Blocked Task ID", value: String(parsed.blockedTaskId ?? "-") });
      if (parsed.by !== undefined) rows.push({ label: "By", value: humanizeValue(parsed.by) });
      return {
        label: "System",
        title: "Dependency added",
        body: null,
        rows,
      };
    }
    case "task_dependency_removed": {
      rows.push({ label: "Blocker Task ID", value: String(parsed.blockerTaskId ?? "-") });
      rows.push({ label: "Blocked Task ID", value: String(parsed.blockedTaskId ?? "-") });
      if (parsed.by !== undefined) rows.push({ label: "By", value: humanizeValue(parsed.by) });
      return {
        label: "System",
        title: "Dependency removed",
        body: null,
        rows,
      };
    }
    default:
      return fallbackDisplay(note);
  }
}

export function formatTaskNoteForDisplay(note: TaskNote): TaskNoteDisplay {
  switch (note.note_type) {
    case "intake_checklist":
      return formatIntakeChecklist(note);
    case "status_change":
      return formatStatusChange(note);
    case "system":
      return formatSystemNote(note);
    default:
      return fallbackDisplay(note);
  }
}

export function isManualTaskNote(note: TaskNote): boolean {
  return note.note_type === "manual";
}
