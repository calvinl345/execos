import { describe, expect, it } from "vitest";
import {
  formatTaskNoteForDisplay,
  isManualTaskNote,
} from "../../src/web/lib/utils/task-notes.js";
import type { TaskNote } from "../../src/web/lib/types.js";

function note(overrides: Partial<TaskNote>): TaskNote {
  return {
    id: "note-1",
    task_id: "KS-001",
    note_type: "manual",
    content: "Remember to follow up.",
    created_at: "2026-04-30T12:00:00.000Z",
    created_by: "agent",
    ...overrides,
  };
}

describe("task note display formatting", () => {
  it("turns intake checklist JSON into a readable checklist summary", () => {
    const display = formatTaskNoteForDisplay(
      note({
        note_type: "intake_checklist",
        content: JSON.stringify({
          step_1_dedup: "passed",
          step_2_complexity: "split_suggested",
          step_3_dependency: "passed",
          step_4_field_assignment: "partial:category,priority",
          step_5_delegation: "not_delegated",
          step_6_downstream: "noted",
          duration_ms: 42,
        }),
      }),
    );

    expect(display.label).toBe("Intake");
    expect(display.title).toBe("Intake completed");
    expect(display.rows).toContainEqual({ label: "Complexity", value: "split suggested" });
    expect(display.rows).toContainEqual({ label: "Fields", value: "partial: category, priority" });
    expect(display.rows).toContainEqual({ label: "Runtime", value: "42 ms" });
  });

  it("summarizes status-change JSON without exposing raw content", () => {
    const display = formatTaskNoteForDisplay(
      note({
        note_type: "status_change",
        content: JSON.stringify({
          from: "triage",
          to: "in_progress",
          by: "agent",
          at: "2026-04-30T12:00:00.000Z",
        }),
      }),
    );

    expect(display.title).toBe("Status changed from triage to in progress");
    expect(display.rows).toContainEqual({ label: "By", value: "agent" });
  });

  it("leaves manual notes as prose", () => {
    const display = formatTaskNoteForDisplay(note({ content: "Plain user note." }));

    expect(display.title).toBe("Plain user note.");
    expect(display.rows).toEqual([]);
  });

  it("distinguishes manual notes from system activity", () => {
    expect(isManualTaskNote(note({ note_type: "manual" }))).toBe(true);
    expect(isManualTaskNote(note({ note_type: "intake_checklist" }))).toBe(false);
    expect(isManualTaskNote(note({ note_type: "status_change" }))).toBe(false);
  });

  it("formats task_fields_updated system note into readable rows", () => {
    const display = formatTaskNoteForDisplay(
      note({
        note_type: "system",
        content: JSON.stringify({
          type: "task_fields_updated",
          changes: {
            title: { from: "Old Title", to: "New Title" },
            priority: { from: "P2", to: "P0" },
          },
          by: "agent",
          at: "2026-06-04T12:00:00.000Z",
        }),
      }),
    );

    expect(display.label).toBe("System");
    expect(display.title).toBe("Fields updated");
    expect(display.rows).toContainEqual({ label: "Title", value: "Old Title -> New Title" });
    expect(display.rows).toContainEqual({ label: "Priority", value: "P2 -> P0" });
  });

  it("formats task_goal_linked and task_goal_unlinked system notes", () => {
    const linkDisplay = formatTaskNoteForDisplay(
      note({
        note_type: "system",
        content: JSON.stringify({
          type: "task_goal_linked",
          goalId: "G-007",
          by: "agent",
          at: "2026-06-04T12:00:00.000Z",
        }),
      }),
    );
    expect(linkDisplay.title).toBe("Goal linked");
    expect(linkDisplay.rows).toContainEqual({ label: "Goal ID", value: "G-007" });

    const unlinkDisplay = formatTaskNoteForDisplay(
      note({
        note_type: "system",
        content: JSON.stringify({
          type: "task_goal_unlinked",
          from: "G-007",
          by: "agent",
          at: "2026-06-04T12:00:00.000Z",
        }),
      }),
    );
    expect(unlinkDisplay.title).toBe("Goal unlinked");
    expect(unlinkDisplay.rows).toContainEqual({ label: "From Goal", value: "G-007" });
  });

  it("formats task_attention_flagged and task_attention_cleared system notes", () => {
    const flagDisplay = formatTaskNoteForDisplay(
      note({
        note_type: "system",
        content: JSON.stringify({
          type: "task_attention_flagged",
          reason: "stuck on details",
          by: "agent",
          at: "2026-06-04T12:00:00.000Z",
        }),
      }),
    );
    expect(flagDisplay.title).toBe("Needs attention flagged");
    expect(flagDisplay.rows).toContainEqual({ label: "Reason", value: "stuck on details" });

    const clearDisplay = formatTaskNoteForDisplay(
      note({
        note_type: "system",
        content: JSON.stringify({
          type: "task_attention_cleared",
          by: "agent",
          at: "2026-06-04T12:00:00.000Z",
        }),
      }),
    );
    expect(clearDisplay.title).toBe("Needs attention cleared");
  });

  it("formats task_dependency_added and task_dependency_removed system notes", () => {
    const addDisplay = formatTaskNoteForDisplay(
      note({
        note_type: "system",
        content: JSON.stringify({
          type: "task_dependency_added",
          blockerTaskId: "KS-002",
          blockedTaskId: "KS-001",
          by: "agent",
        }),
      }),
    );
    expect(addDisplay.title).toBe("Dependency added");
    expect(addDisplay.rows).toContainEqual({ label: "Blocker Task ID", value: "KS-002" });

    const removeDisplay = formatTaskNoteForDisplay(
      note({
        note_type: "system",
        content: JSON.stringify({
          type: "task_dependency_removed",
          blockerTaskId: "KS-002",
          blockedTaskId: "KS-001",
          by: "agent",
        }),
      }),
    );
    expect(removeDisplay.title).toBe("Dependency removed");
  });

  it("maps review to delegated in status changes", () => {
    const display = formatTaskNoteForDisplay(
      note({
        note_type: "status_change",
        content: JSON.stringify({
          from: "triage",
          to: "review",
          by: "agent",
          at: "2026-04-30T12:00:00.000Z",
        }),
      }),
    );

    expect(display.title).toBe("Status changed from triage to delegated");
    // Assert status field updates map review to delegated
    const fieldsDisplay = formatTaskNoteForDisplay(
      note({
        note_type: "system",
        content: JSON.stringify({
          type: "task_fields_updated",
          changes: {
            status: { from: "triage", to: "review" },
          },
          by: "agent",
        }),
      }),
    );
    expect(fieldsDisplay.rows).toContainEqual({ label: "Status", value: "triage -> delegated" });
  });

  it("formats ISO date/time strings inside note display rows", () => {
    const display = formatTaskNoteForDisplay(
      note({
        note_type: "status_change",
        content: JSON.stringify({
          from: "triage",
          to: "in_progress",
          by: "agent",
          at: "2026-04-30T12:00:00.000Z",
        }),
      }),
    );

    // at was "2026-04-30T12:00:00.000Z" which is a full timestamp, so it will format to local time.
    // We can check that it has month and year and time, rather than a raw ISO string.
    const row = display.rows.find((r) => r.label === "Recorded");
    expect(row).toBeDefined();
    expect(row!.value).not.toContain("T");
    expect(row!.value).not.toContain("Z");
    expect(row!.value).toContain("2026");

    // Test a date-only string like YYYY-MM-DD
    const fieldsDisplay = formatTaskNoteForDisplay(
      note({
        note_type: "system",
        content: JSON.stringify({
          type: "task_fields_updated",
          changes: {
            due_date: { from: null, to: "2026-06-05" },
          },
        }),
      }),
    );
    const dateRow = fieldsDisplay.rows.find((r) => r.label === "Due date");
    expect(dateRow).toBeDefined();
    expect(dateRow!.value).toBe("none -> Jun 5, 2026");
  });
});

