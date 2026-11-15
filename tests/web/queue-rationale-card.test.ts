import { describe, expect, it } from "vitest";
import {
  queueRankContext,
  queueRationaleBody,
  queueRationaleTitle,
  shouldShowQueueRationale,
} from "../../src/web/lib/utils/queue-rationale-card.js";
import type { DashboardTask } from "../../src/web/lib/types.js";

function task(
  partial: Partial<Pick<DashboardTask, "owner" | "queue_rank" | "queue_rationale">>,
): Pick<DashboardTask, "owner" | "queue_rank" | "queue_rationale"> {
  return {
    owner: "me",
    queue_rank: null,
    queue_rationale: null,
    ...partial,
  };
}

function delegatedTask(
  partial: Pick<DashboardTask, "queue_rank" | "queue_rationale">,
): Pick<DashboardTask, "owner" | "queue_rank" | "queue_rationale"> {
  return {
    owner: "marcus",
    ...partial,
  };
}

describe("shouldShowQueueRationale", () => {
  it("shows queue rationale only for self-owned ranked tasks", () => {
    expect(shouldShowQueueRationale(task({ queue_rank: 1 }))).toBe(true);
    expect(shouldShowQueueRationale(task({ queue_rank: null }))).toBe(false);
    expect(shouldShowQueueRationale(delegatedTask({ queue_rank: 1, queue_rationale: "Legacy rank" }))).toBe(false);
  });
});

function queueTask(
  partial: Partial<Pick<DashboardTask, "owner" | "queue_rank" | "queue_rationale">>,
): Pick<DashboardTask, "owner" | "queue_rank" | "queue_rationale"> {
  return task(partial);
}

describe("task detail queue rationale card copy", () => {
  it("labels queued tasks as explicit AI rank reasoning while keeping rank context", () => {
    const queued = queueTask({
      owner: "me",
      queue_rank: 3,
      queue_rationale: "This moves the KPI goal forward before lower-leverage invoice cleanup.",
    });

    expect(queueRationaleTitle(queued)).toBe("Why this task is ranked #3 (AI reasoning)");
    expect(queueRankContext(queued)).toBe("Queued #3");
    expect(queueRationaleBody(queued)).toBe(
      "This moves the KPI goal forward before lower-leverage invoice cleanup.",
    );
  });

  it("returns empty copy for unranked tasks so the reasoning card can stay hidden", () => {
    const notQueued = queueTask({
      owner: "me",
      queue_rank: null,
      queue_rationale: null,
    });

    expect(queueRationaleTitle(notQueued)).toBe("");
    expect(queueRankContext(notQueued)).toBeNull();
    expect(queueRationaleBody(notQueued)).toBe("");
  });

  it("returns empty copy for delegated tasks with legacy rank fields", () => {
    const delegated = delegatedTask({
      queue_rank: 1,
      queue_rationale: "Legacy queue rationale from before delegation cleared rank.",
    });

    expect(queueRationaleTitle(delegated)).toBe("");
    expect(queueRankContext(delegated)).toBeNull();
    expect(queueRationaleBody(delegated)).toBe("");
  });
});
