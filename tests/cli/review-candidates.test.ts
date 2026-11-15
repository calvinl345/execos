import { describe, expect, it } from "vitest";
import {
  partitionReviewCandidates,
  toReviewCandidateRow,
} from "../../src/cli/commands/review-candidates.js";
import type { RankedRow } from "../../src/cli/commands/rank-eligible.js";
import type { TaskInput, TaskReasons } from "../../src/domain/prioritization.js";

const REF = new Date("2026-04-27T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function makeRankedRow(overrides: {
  id?: string;
  owner?: string | null;
  status?: TaskInput["status"];
  priority?: TaskInput["priority"];
  dueAt?: Date | null;
  followUpDate?: Date | null;
  snoozedUntil?: Date | null;
  updatedAt?: Date;
  goalId?: string | null;
  effort?: RankedRow["effort"];
  reasons?: Partial<TaskReasons>;
} = {}): RankedRow {
  const id = overrides.id ?? "KS-001";
  const reasons: TaskReasons = {
    tier: overrides.priority ?? "P1",
    overdue: false,
    dueToday: false,
    goalLinked: overrides.goalId !== null && overrides.goalId !== undefined,
    ...overrides.reasons,
  };
  const taskInput: TaskInput = {
    id,
    title: `Task ${id}`,
    status: overrides.status ?? "backlog",
    priority: overrides.priority ?? "P1",
    description: "Description",
    dueAt: overrides.dueAt ?? null,
    followUpDate: overrides.followUpDate ?? null,
    snoozedUntil: overrides.snoozedUntil ?? null,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-04-26T12:00:00.000Z"),
    lastUnblockedAt: null,
    goalId: overrides.goalId ?? null,
    hardDeadline: false,
  };

  return {
    ranking: {
      taskId: id,
      title: `Task ${id}`,
      reasons,
    },
    title: `Task ${id}`,
    task: {
      id,
      title: `Task ${id}`,
      description: "Description",
      status: taskInput.status,
      priority: taskInput.priority,
      category: "personal",
      owner: overrides.owner ?? "me",
      dueAt: taskInput.dueAt?.toISOString() ?? null,
      goalId: taskInput.goalId,
      needsAttention: false,
      needsAttentionReason: null,
    },
    taskInput,
    effort: overrides.effort ?? null,
  };
}

describe("review candidates", () => {
  it("maps candidate rows with task ID and current priority", () => {
    const row = toReviewCandidateRow(
      makeRankedRow({
        id: "KS-101",
        priority: "P2",
        dueAt: new Date("2026-04-29T00:00:00.000Z"),
        goalId: "G-001",
        reasons: { goalLinked: true },
      }),
    );

    expect(row).toMatchObject({
      id: "KS-101",
      priority: "P2",
      goalId: "G-001",
      why: "P2, goal-linked",
    });
  });

  it("carries the effort estimate (and null when absent) onto candidate rows", () => {
    const withEffort = toReviewCandidateRow(
      makeRankedRow({ id: "KS-102", effort: "M" }),
    );
    expect(withEffort.effort).toBe("M");

    const withoutEffort = toReviewCandidateRow(makeRankedRow({ id: "KS-103" }));
    expect(withoutEffort.effort).toBeNull();
  });

  it("excludes delegated tasks from do-next and anomaly groups", () => {
    const partitions = partitionReviewCandidates(
      [
        makeRankedRow({ id: "KS-ME", owner: "me" }),
        makeRankedRow({
          id: "KS-DELEGATED",
          owner: "noah",
          dueAt: new Date(REF.getTime() - DAY),
        }),
      ],
      REF,
      7,
    );

    expect(partitions.doNext.map((row) => row.id)).toEqual(["KS-ME"]);
    expect(partitions.overdue.map((row) => row.id)).toEqual([]);
  });

  it("groups overdue, stale, and triage anomalies", () => {
    const overdue = makeRankedRow({
      id: "KS-OVERDUE",
      dueAt: new Date(REF.getTime() - DAY),
    });
    const stale = makeRankedRow({
      id: "KS-STALE",
      updatedAt: new Date(REF.getTime() - 10 * DAY),
    });
    const triage = makeRankedRow({
      id: "KS-TRIAGE",
      status: "triage",
    });

    const partitions = partitionReviewCandidates([overdue, stale, triage], REF, 7);

    expect(partitions.overdue.map((row) => row.id)).toEqual(["KS-OVERDUE"]);
    expect(partitions.stale.map((row) => row.id)).toEqual(["KS-STALE"]);
    expect(partitions.newTriage.map((row) => row.id)).toEqual(["KS-TRIAGE"]);
  });

  it("separates arrived snoozes from future snoozes", () => {
    const arrived = makeRankedRow({
      id: "KS-ARRIVED",
      snoozedUntil: new Date(REF.getTime() - DAY),
    });
    const future = makeRankedRow({
      id: "KS-FUTURE",
      snoozedUntil: new Date(REF.getTime() + DAY),
    });

    const partitions = partitionReviewCandidates([arrived, future], REF, 7);

    expect(partitions.doNext.map((row) => row.id)).toEqual(["KS-ARRIVED"]);
    expect(partitions.arrivedSnooze.map((row) => row.id)).toEqual([
      "KS-ARRIVED",
    ]);
  });
});
