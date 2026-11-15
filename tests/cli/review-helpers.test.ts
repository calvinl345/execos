/**
 * Pure-function unit tests for the review command helpers.
 *
 * These tests do not touch the DB. Per Rule 13: every pure function
 * ships with a direct unit test in the same session it is written.
 */

import { describe, expect, it } from "vitest";
import {
  atRisk,
  isNewlyStalled,
  summarizeGoals,
} from "../../src/cli/commands/review.js";
import type { TaskInput } from "../../src/domain/prioritization.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function makeTask(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    id: "KS-T",
    title: "Task",
    status: "backlog",
    priority: "P1",
    description: "Description",
    dueAt: null,
    followUpDate: null,
    snoozedUntil: null,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-26T12:00:00.000Z"),
    lastUnblockedAt: null,
    goalId: null,
    hardDeadline: false,
    ...overrides,
  };
}

describe("isNewlyStalled", () => {
  const now = new Date("2026-04-27T12:00:00.000Z");

  it("returns false when updatedAt is in the future", () => {
    const future = new Date(now.getTime() + 3 * MS_PER_DAY);
    expect(isNewlyStalled(future, now, 7)).toBe(false);
  });

  it("returns false for a task updated within the threshold window", () => {
    const fresh = new Date(now.getTime() - 6 * MS_PER_DAY);
    expect(isNewlyStalled(fresh, now, 7)).toBe(false);
  });

  it("returns true when days_since_update lands in [daysPerPenalty, 2*daysPerPenalty)", () => {
    const justCrossed = new Date(now.getTime() - 7 * MS_PER_DAY - 60_000);
    expect(isNewlyStalled(justCrossed, now, 7)).toBe(true);
    const stillNew = new Date(now.getTime() - 13 * MS_PER_DAY);
    expect(isNewlyStalled(stillNew, now, 7)).toBe(true);
  });

  it("returns false once the second penalty cycle starts (>= 2*daysPerPenalty)", () => {
    const longStale = new Date(now.getTime() - 14 * MS_PER_DAY - 60_000);
    expect(isNewlyStalled(longStale, now, 7)).toBe(false);
  });

  it("returns false when daysPerPenalty is non-positive", () => {
    const old = new Date(now.getTime() - 100 * MS_PER_DAY);
    expect(isNewlyStalled(old, now, 0)).toBe(false);
    expect(isNewlyStalled(old, now, -1)).toBe(false);
  });
});

describe("atRisk", () => {
  const now = new Date("2026-04-27T12:00:00.000Z");

  it("returns atRisk=false when no overdue and no staleness", () => {
    expect(atRisk(makeTask(), 7, now)).toEqual({ atRisk: false });
  });

  it("flags overdue-only correctly", () => {
    const r = atRisk(
      makeTask({ dueAt: new Date("2026-04-26T23:59:59.000Z") }),
      7,
      now,
    );
    expect(r.atRisk).toBe(true);
    if (r.atRisk) expect(r.reason).toBe("overdue");
  });

  it("flags stale-only correctly", () => {
    const r = atRisk(
      makeTask({ updatedAt: new Date(now.getTime() - 8 * MS_PER_DAY) }),
      7,
      now,
    );
    expect(r.atRisk).toBe(true);
    if (r.atRisk) expect(r.reason).toBe("stale");
  });

  it("flags both reasons when both fire", () => {
    const r = atRisk(
      makeTask({
        dueAt: new Date("2026-04-20T00:00:00.000Z"),
        updatedAt: new Date(now.getTime() - 8 * MS_PER_DAY),
      }),
      7,
      now,
    );
    expect(r.atRisk).toBe(true);
    if (r.atRisk) expect(r.reason).toBe("overdue+stale");
  });
});

describe("summarizeGoals", () => {
  const start = new Date("2026-04-20T00:00:00.000Z");
  const end = new Date("2026-04-27T00:00:00.000Z");

  it("returns one row per active goal sorted by goalId", () => {
    const result = summarizeGoals(
      [
        { id: "G-002", title: "Second", quarter: "2026-Q2" },
        { id: "G-001", title: "First", quarter: "2026-Q2" },
      ],
      [],
      new Set<string>(),
      start,
      end,
    );
    expect(result.map((r) => r.goalId)).toEqual(["G-001", "G-002"]);
    expect(result.every((r) => r.totalLinked === 0)).toBe(true);
  });

  it("counts a task as advanced when it completed inside the window", () => {
    const result = summarizeGoals(
      [{ id: "G-001", title: "Goal", quarter: "2026-Q2" }],
      [
        {
          taskId: "KS-001",
          goalId: "G-001",
          status: "done",
          completedAt: new Date("2026-04-22T10:00:00.000Z"),
        },
      ],
      new Set<string>(),
      start,
      end,
    );
    expect(result[0]).toMatchObject({
      goalId: "G-001",
      advanced: 1,
      stalled: 0,
      totalLinked: 1,
    });
  });

  it("counts a task as advanced when it had a status change in the window even without completion", () => {
    const result = summarizeGoals(
      [{ id: "G-001", title: "Goal", quarter: "2026-Q2" }],
      [
        {
          taskId: "KS-002",
          goalId: "G-001",
          status: "in_progress",
          completedAt: null,
        },
      ],
      new Set<string>(["KS-002"]),
      start,
      end,
    );
    expect(result[0]).toMatchObject({ advanced: 1, stalled: 0, totalLinked: 1 });
  });

  it("counts a non-terminal task with no movement as stalled", () => {
    const result = summarizeGoals(
      [{ id: "G-001", title: "Goal", quarter: "2026-Q2" }],
      [
        {
          taskId: "KS-003",
          goalId: "G-001",
          status: "triage",
          completedAt: null,
        },
      ],
      new Set<string>(),
      start,
      end,
    );
    expect(result[0]).toMatchObject({ advanced: 0, stalled: 1, totalLinked: 1 });
  });

  it("does not count a task completed before the window as advanced", () => {
    const result = summarizeGoals(
      [{ id: "G-001", title: "Goal", quarter: "2026-Q2" }],
      [
        {
          taskId: "KS-004",
          goalId: "G-001",
          status: "done",
          completedAt: new Date("2026-04-10T10:00:00.000Z"),
        },
      ],
      new Set<string>(),
      start,
      end,
    );
    // status='done' and not in window AND not in changedTaskIds -> not
    // advanced; also status='done' is excluded from stalled.
    expect(result[0]).toMatchObject({ advanced: 0, stalled: 0, totalLinked: 1 });
  });

  it("ignores tasks linked to goals not in the active set", () => {
    const result = summarizeGoals(
      [{ id: "G-001", title: "Goal", quarter: "2026-Q2" }],
      [
        {
          taskId: "KS-005",
          goalId: "G-099",
          status: "triage",
          completedAt: null,
        },
      ],
      new Set<string>(),
      start,
      end,
    );
    expect(result[0].totalLinked).toBe(0);
  });
});
