import { describe, expect, it } from "vitest";
import {
  commitmentsAtRisk,
  goalsAtRisk,
  newlyUnblocked,
  quarterEnd,
  type GoalTaskCounts,
  type RiskGoalInput,
  type RiskTaskInput,
} from "../../src/domain/risk-detectors.js";

const NOW = new Date("2026-06-10T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function makeTask(
  overrides: Partial<RiskTaskInput> & Pick<RiskTaskInput, "id">,
): RiskTaskInput {
  return {
    title: `Task ${overrides.id}`,
    status: "backlog",
    priority: "P1",
    owner: "me",
    dueDate: null,
    hardDeadline: false,
    lastUnblockedAt: null,
    ...overrides,
  };
}

function makeGoal(
  overrides: Partial<RiskGoalInput> & Pick<RiskGoalInput, "id">,
): RiskGoalInput {
  return {
    title: `Goal ${overrides.id}`,
    quarter: "2026-Q2",
    status: "active",
    ...overrides,
  };
}

function counts(entries: Array<[string, GoalTaskCounts]>): Map<string, GoalTaskCounts> {
  return new Map(entries);
}

describe("domain/risk-detectors commitmentsAtRisk", () => {
  it("flags hard-deadline tasks due within the window with transparency fields", () => {
    const inWindow = makeTask({
      id: "KS-001",
      hardDeadline: true,
      dueDate: new Date(NOW.getTime() + 2 * DAY),
    });
    const rows = commitmentsAtRisk([inWindow], NOW, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "KS-001",
      daysLeft: 2,
      windowDays: 3,
      rule: "within-window",
    });
  });

  it("flags overdue hard-deadline tasks with negative daysLeft and rule overdue", () => {
    const overdue = makeTask({
      id: "KS-002",
      hardDeadline: true,
      dueDate: new Date(NOW.getTime() - 2 * DAY),
    });
    const rows = commitmentsAtRisk([overdue], NOW, 3);
    expect(rows[0]?.daysLeft).toBe(-2);
    expect(rows[0]?.rule).toBe("overdue");
  });

  it("includes the window edge (due exactly commitmentDays away) and excludes one day past it", () => {
    const onEdge = makeTask({
      id: "KS-EDGE",
      hardDeadline: true,
      dueDate: new Date(NOW.getTime() + 3 * DAY),
    });
    const pastEdge = makeTask({
      id: "KS-PAST",
      hardDeadline: true,
      dueDate: new Date(NOW.getTime() + 4 * DAY),
    });
    const rows = commitmentsAtRisk([onEdge, pastEdge], NOW, 3);
    expect(rows.map((r) => r.id)).toEqual(["KS-EDGE"]);
  });

  it("ignores soft-deadline tasks, dateless hard flags, and terminal statuses", () => {
    const soft = makeTask({ id: "KS-SOFT", dueDate: NOW });
    const dateless = makeTask({ id: "KS-NODATE", hardDeadline: true });
    const done = makeTask({
      id: "KS-DONE",
      status: "done",
      hardDeadline: true,
      dueDate: NOW,
    });
    const cancelled = makeTask({
      id: "KS-CANC",
      status: "cancelled",
      hardDeadline: true,
      dueDate: NOW,
    });
    expect(commitmentsAtRisk([soft, dateless, done, cancelled], NOW, 3)).toEqual([]);
  });

  it("keeps delegated, snoozed-status, review, and blocked tasks visible", () => {
    // Jordan's AWS/Noah case: a delegated hard commitment must not
    // silently vanish from the risk section just because he does not own
    // it or it is out of the do-next eligibility view.
    const delegated = makeTask({
      id: "KS-DELEG",
      owner: "noah",
      hardDeadline: true,
      dueDate: new Date(NOW.getTime() + 1 * DAY),
    });
    const inReview = makeTask({
      id: "KS-REVIEW",
      status: "review",
      hardDeadline: true,
      dueDate: new Date(NOW.getTime() + 1 * DAY),
    });
    const blocked = makeTask({
      id: "KS-BLOCKED",
      status: "blocked",
      hardDeadline: true,
      dueDate: new Date(NOW.getTime() + 1 * DAY),
    });
    const rows = commitmentsAtRisk([delegated, inReview, blocked], NOW, 3);
    expect(rows.map((r) => r.id).sort()).toEqual([
      "KS-BLOCKED",
      "KS-DELEG",
      "KS-REVIEW",
    ]);
  });

  it("sorts soonest-due first with overdue tasks leading", () => {
    const dueIn2 = makeTask({
      id: "KS-2D",
      hardDeadline: true,
      dueDate: new Date(NOW.getTime() + 2 * DAY),
    });
    const overdue = makeTask({
      id: "KS-OVER",
      hardDeadline: true,
      dueDate: new Date(NOW.getTime() - 1 * DAY),
    });
    const dueToday = makeTask({
      id: "KS-TODAY",
      hardDeadline: true,
      dueDate: NOW,
    });
    const rows = commitmentsAtRisk([dueIn2, overdue, dueToday], NOW, 3);
    expect(rows.map((r) => r.id)).toEqual(["KS-OVER", "KS-TODAY", "KS-2D"]);
  });
});

describe("domain/risk-detectors goalsAtRisk", () => {
  // NOW is 2026-06-10; 2026-Q2 ends 2026-06-30, 20 days out.
  it("flags an active goal with open tasks inside the window, carrying counts", () => {
    const goal = makeGoal({ id: "G-001" });
    const rows = goalsAtRisk(
      [goal],
      counts([["G-001", { open: 3, done: 5 }]]),
      NOW,
      21,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      goalId: "G-001",
      quarter: "2026-Q2",
      daysLeft: 20,
      windowDays: 21,
      openCount: 3,
      doneCount: 5,
    });
    expect(rows[0]?.quarterEnd.toISOString()).toBe("2026-06-30T00:00:00.000Z");
  });

  it("excludes goals outside the window, with no open tasks, or not active", () => {
    const outside = makeGoal({ id: "G-OUT" }); // 20 days out, window 14
    const noOpen = makeGoal({ id: "G-NOPEN" });
    const achieved = makeGoal({ id: "G-DONE", status: "achieved" });
    const futureQuarter = makeGoal({ id: "G-Q3", quarter: "2026-Q3" });
    const rows = goalsAtRisk(
      [outside, noOpen, achieved, futureQuarter],
      counts([
        ["G-OUT", { open: 1, done: 0 }],
        ["G-NOPEN", { open: 0, done: 4 }],
        ["G-DONE", { open: 2, done: 0 }],
        ["G-Q3", { open: 2, done: 0 }],
      ]),
      NOW,
      14,
    );
    expect(rows).toEqual([]);
  });

  it("flags a past-quarter active goal with negative daysLeft", () => {
    const stale = makeGoal({ id: "G-OLD", quarter: "2026-Q1" });
    const rows = goalsAtRisk(
      [stale],
      counts([["G-OLD", { open: 1, done: 0 }]]),
      NOW,
      14,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.daysLeft).toBeLessThan(0);
  });

  it("treats a goal missing from the counts map as having no open tasks", () => {
    const goal = makeGoal({ id: "G-UNKNOWN" });
    expect(goalsAtRisk([goal], counts([]), NOW, 30)).toEqual([]);
  });
});

describe("domain/risk-detectors newlyUnblocked", () => {
  it("includes open tasks unblocked within 24h and excludes older or future stamps", () => {
    const fresh = makeTask({
      id: "KS-FRESH",
      status: "blocked",
      lastUnblockedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    });
    const stale = makeTask({
      id: "KS-STALE",
      lastUnblockedAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
    });
    const future = makeTask({
      id: "KS-FUTURE",
      lastUnblockedAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    });
    const never = makeTask({ id: "KS-NEVER" });
    const rows = newlyUnblocked([fresh, stale, future, never], NOW);
    expect(rows.map((r) => r.id)).toEqual(["KS-FRESH"]);
  });

  it("excludes terminal tasks and sorts most recently unblocked first", () => {
    const doneButFresh = makeTask({
      id: "KS-DONE",
      status: "done",
      lastUnblockedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    const olderFresh = makeTask({
      id: "KS-OLDER",
      lastUnblockedAt: new Date(NOW.getTime() - 5 * 60 * 60 * 1000),
    });
    const newest = makeTask({
      id: "KS-NEWEST",
      lastUnblockedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    const rows = newlyUnblocked([doneButFresh, olderFresh, newest], NOW);
    expect(rows.map((r) => r.id)).toEqual(["KS-NEWEST", "KS-OLDER"]);
  });
});

describe("domain/risk-detectors quarterEnd", () => {
  it("returns the UTC last day of each quarter", () => {
    expect(quarterEnd("2026-Q1").toISOString()).toBe("2026-03-31T00:00:00.000Z");
    expect(quarterEnd("2026-Q2").toISOString()).toBe("2026-06-30T00:00:00.000Z");
    expect(quarterEnd("2026-Q3").toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(quarterEnd("2026-Q4").toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });

  it("throws on malformed quarter codes", () => {
    expect(() => quarterEnd("2026-Q5")).toThrow();
    expect(() => quarterEnd("2026Q2")).toThrow();
    expect(() => quarterEnd("Q2-2026")).toThrow();
    expect(() => quarterEnd("")).toThrow();
  });
});
