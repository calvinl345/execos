import { describe, expect, it } from "vitest";
import type { TaskActivity } from "../../src/web/lib/types.js";
import { formatTaskActivityForDisplay } from "../../src/web/lib/utils/task-activities.js";

function activity(overrides: Partial<TaskActivity>): TaskActivity {
  return {
    id: "ACT-1",
    task_id: "KS-001",
    event_type: "task_created",
    summary: "Task created: Example task",
    actor_type: "agent",
    actor_label: "ExecOS agent",
    source: "cli",
    occurred_at: "2026-06-05T00:00:00.000Z",
    payload: {},
    schema_version: 1,
    ...overrides,
  };
}

describe("task activity display formatting", () => {
  it("formats status changes consistently", () => {
    const display = formatTaskActivityForDisplay(
      activity({
        event_type: "task_status_changed",
        summary: "Status changed from triage to in progress",
        payload: { from_status: "triage", to_status: "in_progress" },
      }),
    );

    expect(display.label).toBe("Status");
    expect(display.title).toBe("Status changed from triage to in progress");
    expect(display.rows).toEqual([
      { label: "From", value: "triage" },
      { label: "To", value: "in progress" },
    ]);
  });

  it("formats field updates as before and after rows", () => {
    const display = formatTaskActivityForDisplay(
      activity({
        event_type: "task_fields_updated",
        summary: "Title updated",
        payload: {
          changes: {
            title: { from: "Old", to: "New" },
          },
        },
      }),
    );

    expect(display.label).toBe("Fields");
    expect(display.rows).toEqual([{ label: "Title", value: "Old -> New" }]);
  });

  it("formats delegation changes as a stable detail view", () => {
    const display = formatTaskActivityForDisplay(
      activity({
        event_type: "task_delegation_updated",
        summary: "Delegation changed from me to Avery",
        payload: { from_owner: "me", to_owner: "Avery" },
      }),
    );

    expect(display.label).toBe("Delegation");
    expect(display.rows).toEqual([
      { label: "From owner", value: "me" },
      { label: "To owner", value: "Avery" },
    ]);
  });
});
