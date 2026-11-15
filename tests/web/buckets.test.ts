import { describe, expect, test } from "vitest";
import {
  COLUMNS,
  groupByColumn,
  statusToColumn,
} from "../../src/web/lib/utils/buckets.js";
import type { TaskStatus } from "../../src/web/lib/types.js";

describe("statusToColumn maps the canonical 7-status enum to visible board columns", () => {
  test("active statuses map to matching board columns", () => {
    expect(statusToColumn("triage")).toBe("triage");
    expect(statusToColumn("backlog")).toBe("backlog");
    expect(statusToColumn("in_progress")).toBe("in_progress");
    expect(statusToColumn("blocked")).toBe("blocked");
    expect(statusToColumn("review")).toBe("review");
  });
  test("terminal statuses do not appear on the active board", () => {
    expect(statusToColumn("done")).toBeNull();
    expect(statusToColumn("cancelled")).toBeNull();
  });
  test("terminal statuses appear in closed column when requested", () => {
    expect(statusToColumn("done", true)).toBe("closed");
    expect(statusToColumn("cancelled", true)).toBe("closed");
  });
});

describe("COLUMNS exports the visible active columns in canonical order", () => {
  test("ids match the active task statuses", () => {
    expect(COLUMNS.map((c) => c.id)).toEqual([
      "triage",
      "backlog",
      "in_progress",
      "blocked",
      "review",
    ]);
  });

  test("review status is labeled as delegated in the dashboard", () => {
    expect(COLUMNS.find((c) => c.id === "review")?.label).toBe("Delegated");
  });
});

describe("groupByColumn", () => {
  test("partitions tasks into the active status columns", () => {
    const tasks: { id: string; status: TaskStatus }[] = [
      { id: "KS-001", status: "triage" },
      { id: "KS-002", status: "backlog" },
      { id: "KS-003", status: "in_progress" },
      { id: "KS-004", status: "blocked" },
      { id: "KS-005", status: "review" },
    ];
    const grouped = groupByColumn(tasks);
    expect(grouped.triage.map((t) => t.id)).toEqual(["KS-001"]);
    expect(grouped.backlog.map((t) => t.id)).toEqual(["KS-002"]);
    expect(grouped.in_progress.map((t) => t.id)).toEqual(["KS-003"]);
    expect(grouped.blocked.map((t) => t.id)).toEqual(["KS-004"]);
    expect(grouped.review.map((t) => t.id)).toEqual(["KS-005"]);
  });
  test("drops terminal-status tasks from the board entirely", () => {
    const tasks: { id: string; status: TaskStatus }[] = [
      { id: "KS-100", status: "done" },
      { id: "KS-101", status: "cancelled" },
      { id: "KS-102", status: "in_progress" },
    ];
    const grouped = groupByColumn(tasks);
    expect(grouped.in_progress).toHaveLength(1);
    expect(grouped.triage.concat(grouped.backlog, grouped.blocked, grouped.review)).toHaveLength(0);
  });
  test("groups terminal-status tasks into closed column when requested", () => {
    const tasks: { id: string; status: TaskStatus }[] = [
      { id: "KS-100", status: "done" },
      { id: "KS-101", status: "cancelled" },
      { id: "KS-102", status: "in_progress" },
    ];
    const grouped = groupByColumn(tasks, true);
    expect(grouped.in_progress).toHaveLength(1);
    expect(grouped.closed.map((t) => t.id)).toEqual(["KS-100", "KS-101"]);
  });
});
