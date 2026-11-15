import { describe, expect, test } from "vitest";
import {
  TASK_CARD_FIELDS,
  defaultTaskCardFieldPreferences,
  normalizeTaskCardFieldPreferences,
} from "../../src/web/lib/utils/task-card-fields.js";

describe("task card field preferences", () => {
  test("defaults to every configurable card field visible", () => {
    expect(defaultTaskCardFieldPreferences()).toEqual({ hidden: [] });
  });

  test("makes card header and filter metadata configurable", () => {
    expect(TASK_CARD_FIELDS.map((field) => field.id)).toEqual(
      expect.arrayContaining(["id", "priority", "title", "category", "status"]),
    );
  });

  test("drops stale and duplicate hidden field ids", () => {
    expect(
      normalizeTaskCardFieldPreferences({
        hidden: ["id", "category", "goal", "ghost", "due", "goal"],
      }),
    ).toEqual({ hidden: ["id", "category", "goal", "due"] });
  });

  test("refuses a stored state that hides every field", () => {
    expect(
      normalizeTaskCardFieldPreferences({
        hidden: TASK_CARD_FIELDS.map((field) => field.id),
      }),
    ).toEqual({ hidden: [] });
  });
});
