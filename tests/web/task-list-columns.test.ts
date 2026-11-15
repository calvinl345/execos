import { describe, expect, test } from "vitest";
import {
  DEFAULT_TASK_LIST_COLUMN_ORDER,
  TASK_LIST_COLUMNS,
  clampTaskListColumnWidth,
  defaultTaskListColumnWidth,
  defaultTaskListColumnPreferences,
  normalizeTaskListColumnPreferences,
} from "../../src/web/lib/utils/task-list-columns.js";

describe("task list column preferences", () => {
  test("defaults to every column visible in the canonical order", () => {
    expect(defaultTaskListColumnPreferences()).toEqual({
      order: DEFAULT_TASK_LIST_COLUMN_ORDER,
      hidden: [],
      widths: {},
    });
  });

  test("includes the user-facing task metadata columns", () => {
    expect(TASK_LIST_COLUMNS.map((column) => column.id)).toEqual(
      expect.arrayContaining(["category", "attachments"]),
    );
  });

  test("normalizes stale stored preferences without losing new columns", () => {
    const prefs = normalizeTaskListColumnPreferences({
      order: ["title", "id", "ghost", "title"],
      hidden: ["owner", "ghost", "owner"],
      widths: { title: 420, owner: 30, ghost: 999 },
    });

    expect(prefs.order.slice(0, 2)).toEqual(["title", "id"]);
    expect(prefs.order).toEqual(expect.arrayContaining(DEFAULT_TASK_LIST_COLUMN_ORDER));
    expect(new Set(prefs.order).size).toBe(DEFAULT_TASK_LIST_COLUMN_ORDER.length);
    expect(prefs.hidden).toEqual(["owner"]);
    expect(prefs.widths.title).toBe(420);
    expect(prefs.widths.owner).toBeGreaterThan(30);
    expect("ghost" in prefs.widths).toBe(false);
  });

  test("refuses a stored state that hides every column", () => {
    const prefs = normalizeTaskListColumnPreferences({
      order: DEFAULT_TASK_LIST_COLUMN_ORDER,
      hidden: DEFAULT_TASK_LIST_COLUMN_ORDER,
    });

    expect(prefs.hidden).toEqual([]);
    expect(prefs.widths).toEqual({});
  });

  test("clamps resized widths to useful bounds", () => {
    expect(clampTaskListColumnWidth("title", 20)).toBeGreaterThan(20);
    expect(clampTaskListColumnWidth("title", 900)).toBe(640);
    expect(clampTaskListColumnWidth("title", Number.NaN)).toBe(
      defaultTaskListColumnWidth("title"),
    );
  });
});
