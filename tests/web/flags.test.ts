import { describe, expect, test } from "vitest";
import {
  TASK_FLAG_ORDER,
  flagsFor,
  overdueDays,
  staleDays,
} from "../../src/web/lib/utils/flags.js";

const NOW = new Date("2026-04-29T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
const future = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000).toISOString();
const LOCAL_NOW = new Date(2026, 3, 29, 12, 0);

type FlagTask = Parameters<typeof flagsFor>[0];

function flagTask(overrides: Partial<FlagTask> = {}): FlagTask {
  return {
    status: "in_progress",
    priority: "P1",
    owner: null,
    due_date: null,
    follow_up_date: null,
    updated_at: day(1),
    ...overrides,
  };
}

describe("flagsFor", () => {
  test("active task with past due_date emits 'overdue'", () => {
    const flags = flagsFor(
      flagTask({
        due_date: day(2),
      }),
      NOW,
    );
    expect(flags).toContain("overdue");
    expect(flags).not.toContain("stale");
  });

  test("emits 'stale' once updated_at is at least 14 days ago", () => {
    const flags = flagsFor(
      flagTask({
        due_date: future(5),
        updated_at: day(14),
      }),
      NOW,
    );
    expect(flags).toContain("stale");
    expect(flags).not.toContain("overdue");
  });

  test("done and cancelled tasks never emit flags", () => {
    expect(
      flagsFor(
        flagTask({ status: "done", priority: "P0", due_date: day(30), updated_at: day(30) }),
        NOW,
      ),
    ).toEqual([]);
    expect(
      flagsFor(
        flagTask({ status: "cancelled", priority: "P0", due_date: day(30), updated_at: day(30) }),
        NOW,
      ),
    ).toEqual([]);
  });

  test("future due date and recent updated_at → no flags", () => {
    expect(
      flagsFor(
        flagTask({ status: "in_progress", priority: "P1", due_date: future(7), updated_at: day(1) }),
        NOW,
      ),
    ).toEqual([]);
  });

  test("emits useful board signals in legend order", () => {
    expect(TASK_FLAG_ORDER).toEqual(["overdue", "due_today", "stale", "blocked"]);
    expect(
      flagsFor(
        flagTask({
          status: "blocked",
          priority: "P0",
          due_date: day(3),
          updated_at: day(20),
        }),
        NOW,
      ),
    ).toEqual(["overdue", "stale", "blocked"]);
  });

  test("emits due_today for active tasks due later today", () => {
    expect(
      flagsFor(
        flagTask({
          status: "in_progress",
          priority: "P2",
          due_date: new Date("2026-04-29T18:00:00Z").toISOString(),
          updated_at: day(1),
        }),
        NOW,
      ),
    ).toEqual(["due_today"]);
  });

  test("delegated tasks derive overdue from follow_up_date", () => {
    const flags = flagsFor(
      flagTask({
        owner: "riley",
        due_date: future(5),
        follow_up_date: day(1),
      }),
      NOW,
    );
    expect(flags).toContain("overdue");
    expect(flags).not.toContain("due_today");
  });

  test("delegated tasks derive due_today from follow_up_date", () => {
    const flags = flagsFor(
      flagTask({
        owner: "riley",
        due_date: future(5),
        follow_up_date: new Date("2026-04-29T18:00:00Z").toISOString(),
      }),
      NOW,
    );
    expect(flags).toContain("due_today");
    expect(flags).not.toContain("overdue");
  });

  test("own tasks ignore follow_up_date for date flags", () => {
    const flags = flagsFor(
      flagTask({
        owner: "me",
        due_date: future(5),
        follow_up_date: day(1),
      }),
      NOW,
    );
    expect(flags).not.toContain("overdue");
    expect(flags).not.toContain("due_today");
  });

  test("overdue and due_today use local calendar day boundaries", () => {
    expect(
      flagsFor(
        flagTask({
          due_date: new Date(2026, 3, 28, 23, 0).toISOString(),
        }),
        LOCAL_NOW,
      ),
    ).toContain("overdue");

    expect(
      flagsFor(
        flagTask({
          due_date: new Date(2026, 3, 29, 9, 0).toISOString(),
        }),
        LOCAL_NOW,
      ),
    ).toContain("due_today");
  });
});

describe("overdueDays / staleDays raw counts", () => {
  test("overdueDays floors to whole days past due", () => {
    expect(overdueDays({ due_date: day(3) }, NOW)).toBe(3);
    expect(overdueDays({ due_date: future(1) }, NOW)).toBe(0);
    expect(overdueDays({ due_date: null }, NOW)).toBe(0);
  });
  test("staleDays returns Infinity when updated_at missing", () => {
    expect(staleDays({ updated_at: null }, NOW)).toBe(Infinity);
    expect(staleDays({ updated_at: day(7) }, NOW)).toBe(7);
  });
});
