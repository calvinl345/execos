import { describe, expect, it } from "vitest";
import {
  compareTasks,
  isEligible,
  isOverdue,
  isStale,
  rankTasks,
  taskReasons,
  type PrioritizationInput,
  type TaskInput,
} from "../../src/domain/prioritization.js";

const REF = new Date("2026-04-26T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function makeTask(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    id: "KS-001",
    title: "Do the thing",
    status: "backlog",
    priority: "P1",
    description: "Do the thing",
    dueAt: null,
    followUpDate: null,
    snoozedUntil: null,
    createdAt: new Date("2026-04-01T00:00:00Z"),
    updatedAt: new Date("2026-04-25T00:00:00Z"),
    lastUnblockedAt: null,
    goalId: null,
    hardDeadline: false,
    ...overrides,
  };
}

function ids(inputs: PrioritizationInput[]): string[] {
  return rankTasks(inputs, REF).map((row) => row.taskId);
}

describe("domain/prioritization isEligible", () => {
  it("includes triage, backlog, in_progress", () => {
    expect(isEligible(makeTask({ status: "triage" }), REF)).toBe(true);
    expect(isEligible(makeTask({ status: "backlog" }), REF)).toBe(true);
    expect(isEligible(makeTask({ status: "in_progress" }), REF)).toBe(true);
  });

  it("excludes review, done, cancelled", () => {
    expect(isEligible(makeTask({ status: "review" }), REF)).toBe(false);
    expect(isEligible(makeTask({ status: "done" }), REF)).toBe(false);
    expect(isEligible(makeTask({ status: "cancelled" }), REF)).toBe(false);
  });

  it("only includes blocked tasks newly unblocked within the last 24h", () => {
    expect(
      isEligible(makeTask({ status: "blocked", lastUnblockedAt: null }), REF),
    ).toBe(false);
    expect(
      isEligible(
        makeTask({
          status: "blocked",
          lastUnblockedAt: new Date(REF.getTime() - 25 * 60 * 60 * 1000),
        }),
        REF,
      ),
    ).toBe(false);
    expect(
      isEligible(
        makeTask({
          status: "blocked",
          lastUnblockedAt: new Date(REF.getTime() - 24 * 60 * 60 * 1000),
        }),
        REF,
      ),
    ).toBe(true);
    expect(
      isEligible(
        makeTask({
          status: "blocked",
          lastUnblockedAt: new Date(REF.getTime() + 60_000),
        }),
        REF,
      ),
    ).toBe(false);
  });
});

describe("domain/prioritization compareTasks", () => {
  it("sinks future-snoozed tasks below all non-snoozed tasks", () => {
    const activeLow = makeTask({ id: "KS-001", priority: "P3" });
    const snoozedHigh = makeTask({
      id: "KS-002",
      priority: "P0",
      snoozedUntil: new Date(REF.getTime() + DAY),
    });

    expect(compareTasks(activeLow, snoozedHigh, REF)).toBeLessThan(0);
    expect(
      ids([{ task: snoozedHigh }, { task: activeLow }]),
    ).toEqual(["KS-001", "KS-002"]);
  });

  it("orders by priority tier before due date pressure", () => {
    const p1Future = makeTask({
      id: "KS-001",
      priority: "P1",
      dueAt: new Date(REF.getTime() + 30 * DAY),
    });
    const p2Overdue = makeTask({
      id: "KS-002",
      priority: "P2",
      dueAt: new Date(REF.getTime() - 10 * DAY),
    });

    expect(ids([{ task: p2Overdue }, { task: p1Future }])).toEqual([
      "KS-001",
      "KS-002",
    ]);
  });

  it("orders overdue and due-today tasks before later due dates", () => {
    const tomorrow = makeTask({
      id: "KS-001",
      priority: "P1",
      dueAt: new Date(REF.getTime() + DAY),
    });
    const dueToday = makeTask({
      id: "KS-002",
      priority: "P1",
      dueAt: new Date("2026-04-26T23:00:00Z"),
    });
    const overdue = makeTask({
      id: "KS-003",
      priority: "P1",
      dueAt: new Date(REF.getTime() - DAY),
    });

    expect(ids([{ task: tomorrow }, { task: dueToday }, { task: overdue }])).toEqual([
      "KS-003",
      "KS-002",
      "KS-001",
    ]);
  });

  it("sorts null priority and null due dates last", () => {
    const p3NoDue = makeTask({ id: "KS-001", priority: "P3", dueAt: null });
    const nullPriorityOverdue = makeTask({
      id: "KS-002",
      priority: null,
      dueAt: new Date(REF.getTime() - DAY),
    });
    const p3Due = makeTask({
      id: "KS-003",
      priority: "P3",
      dueAt: new Date(REF.getTime() + DAY),
    });

    expect(ids([
      { task: nullPriorityOverdue },
      { task: p3NoDue },
      { task: p3Due },
    ])).toEqual(["KS-003", "KS-001", "KS-002"]);
  });

  it("orders goal-linked tasks before unlinked tasks within the same tier and due state", () => {
    const unlinked = makeTask({ id: "KS-001", goalId: null });
    const linked = makeTask({ id: "KS-002", goalId: "G-001" });

    expect(ids([{ task: unlinked }, { task: linked }])).toEqual([
      "KS-002",
      "KS-001",
    ]);
  });

  it("breaks equal-due-date ties with hard deadline first", () => {
    const due = new Date(REF.getTime() + 2 * DAY);
    const soft = makeTask({ id: "KS-SOFT", dueAt: due });
    const hard = makeTask({ id: "KS-HARD", dueAt: due, hardDeadline: true });

    expect(ids([{ task: soft }, { task: hard }])).toEqual([
      "KS-HARD",
      "KS-SOFT",
    ]);
  });

  it("never lets a hard deadline outrank a higher tier or an earlier due date", () => {
    const hardP2 = makeTask({
      id: "KS-HARD-P2",
      priority: "P2",
      dueAt: new Date(REF.getTime() + 1 * DAY),
      hardDeadline: true,
    });
    const softP1 = makeTask({
      id: "KS-SOFT-P1",
      priority: "P1",
      dueAt: new Date(REF.getTime() + 5 * DAY),
    });
    expect(ids([{ task: hardP2 }, { task: softP1 }])).toEqual([
      "KS-SOFT-P1",
      "KS-HARD-P2",
    ]);

    const hardLater = makeTask({
      id: "KS-HARD-LATER",
      dueAt: new Date(REF.getTime() + 3 * DAY),
      hardDeadline: true,
    });
    const softSooner = makeTask({
      id: "KS-SOFT-SOONER",
      dueAt: new Date(REF.getTime() + 1 * DAY),
    });
    expect(ids([{ task: hardLater }, { task: softSooner }])).toEqual([
      "KS-SOFT-SOONER",
      "KS-HARD-LATER",
    ]);
  });

  it("ignores the hard flag when due dates are null", () => {
    // A hard flag without a real date carries no commitment date, so it
    // must not reorder null-due tasks; the goal-link level still decides.
    const linked = makeTask({ id: "KS-LINKED", dueAt: null, goalId: "G-001" });
    const hard = makeTask({ id: "KS-HARD", dueAt: null, hardDeadline: true });

    expect(ids([{ task: linked }, { task: hard }])).toEqual([
      "KS-LINKED",
      "KS-HARD",
    ]);
  });

  it("applies updatedAt desc, createdAt asc, then id asc tie-breakers", () => {
    const newest = makeTask({
      id: "KS-004",
      updatedAt: new Date("2026-04-25T10:00:00Z"),
      createdAt: new Date("2026-04-20T00:00:00Z"),
    });
    const oldCreatedA = makeTask({
      id: "KS-A",
      updatedAt: new Date("2026-04-25T00:00:00Z"),
      createdAt: new Date("2026-04-01T00:00:00Z"),
    });
    const oldCreatedB = makeTask({
      id: "KS-B",
      updatedAt: new Date("2026-04-25T00:00:00Z"),
      createdAt: new Date("2026-04-01T00:00:00Z"),
    });
    const newerCreated = makeTask({
      id: "KS-001",
      updatedAt: new Date("2026-04-25T00:00:00Z"),
      createdAt: new Date("2026-04-02T00:00:00Z"),
    });

    expect(
      ids([
        { task: newerCreated },
        { task: oldCreatedB },
        { task: newest },
        { task: oldCreatedA },
      ]),
    ).toEqual(["KS-004", "KS-A", "KS-B", "KS-001"]);
  });
});

describe("domain/prioritization rankTasks", () => {
  it("filters ineligible tasks and returns an empty list for empty input", () => {
    expect(rankTasks([], REF)).toEqual([]);
    expect(
      ids([
        { task: makeTask({ id: "KS-001", status: "done" }) },
        { task: makeTask({ id: "KS-002", status: "review" }) },
        { task: makeTask({ id: "KS-003", status: "cancelled" }) },
      ]),
    ).toEqual([]);
  });

  it("returns slim ranked rows with title and reasons", () => {
    const out = rankTasks(
      [
        {
          task: makeTask({
            id: "KS-001",
            title: "Important",
            priority: "P0",
            dueAt: new Date(REF.getTime() - DAY),
            goalId: "G-001",
          }),
        },
      ],
      REF,
    );

    expect(out).toEqual([
      {
        taskId: "KS-001",
        title: "Important",
        reasons: {
          tier: "P0",
          overdue: true,
          dueToday: false,
          goalLinked: true,
        },
      },
    ]);
  });

  it("is deterministic across calls", () => {
    const inputs: PrioritizationInput[] = [
      { task: makeTask({ id: "KS-003", priority: "P2" }) },
      { task: makeTask({ id: "KS-001", priority: "P1" }) },
      { task: makeTask({ id: "KS-002", priority: "P0" }) },
    ];
    expect(rankTasks(inputs, REF)).toEqual(rankTasks(inputs, REF));
  });
});

describe("domain/prioritization surfacing helpers", () => {
  it("reports task reasons without reading settings", () => {
    expect(
      taskReasons(
        makeTask({
          priority: "P2",
          dueAt: new Date("2026-04-26T08:00:00Z"),
          goalId: "G-001",
        }),
        REF,
      ),
    ).toEqual({
      tier: "P2",
      overdue: false,
      dueToday: true,
      goalLinked: true,
    });
  });

  it("detects overdue tasks by calendar day", () => {
    expect(
      isOverdue(makeTask({ dueAt: new Date("2026-04-25T23:59:59Z") }), REF),
    ).toBe(true);
    expect(
      isOverdue(makeTask({ dueAt: new Date("2026-04-26T00:00:00Z") }), REF),
    ).toBe(false);
  });

  it("detects stale tasks from an injected threshold", () => {
    expect(
      isStale(new Date(REF.getTime() - 30 * DAY), REF, 30),
    ).toBe(true);
    expect(
      isStale(new Date(REF.getTime() - 29 * DAY), REF, 30),
    ).toBe(false);
    expect(
      isStale(new Date(REF.getTime() + DAY), REF, 30),
    ).toBe(false);
  });
});
