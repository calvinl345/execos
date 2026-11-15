import { describe, expect, it } from "vitest";
import { partitionInbox } from "../../src/web/lib/utils/inbox-partition.js";
import type { DashboardTask } from "../../src/web/lib/types.js";

const now = new Date("2026-06-08T12:00:00.000Z");

function task(partial: Partial<DashboardTask> & Pick<DashboardTask, "id" | "title">): DashboardTask {
  return {
    description: "",
    status: "in_progress",
    priority: "P1",
    category: "house",
    owner: "me",
    due_date: null,
    follow_up_date: null,
    snoozed_until: null,
    handoff_state: "not_applicable",
    handoff_copied_at: null,
    handoff_last_copied_at: null,
    handoff_last_nudge_copied_at: null,
    goal_id: null,
    goal_title: null,
    needs_attention: false,
    needs_attention_set_at: null,
    needs_attention_reason: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    completed_at: null,
    attachment_count: 0,
    hard_deadline: false,
    effort: null,
    queue_rank: null,
    queue_rationale: null,
    queue_ranked_at: null,
    ...partial,
  };
}

describe("inbox partition", () => {
  it("partitions active tasks by owner (me vs others)", () => {
    const t1 = task({ id: "KS-1", title: "Own Task", owner: "me" });
    const t2 = task({ id: "KS-2", title: "Delegated Task", owner: "elena" });

    const result = partitionInbox([t1, t2], { now });
    expect(result.tasks.map((t) => t.id)).toEqual(["KS-1"]);
    expect(result.followUps.map((t) => t.id)).toEqual(["KS-2"]);
  });

  it("always excludes cancelled tasks, regardless of doneVisibleSince", () => {
    const t1 = task({ id: "KS-1", title: "Cancelled Own", status: "cancelled", owner: "me" });
    const t2 = task({ id: "KS-2", title: "Cancelled Delegated", status: "cancelled", owner: "elena" });

    for (const doneVisibleSince of [undefined, null, new Date(0)]) {
      const result = partitionInbox([t1, t2], { now, doneVisibleSince });
      expect(result.tasks).toHaveLength(0);
      expect(result.followUps).toHaveLength(0);
    }
  });

  it("excludes all done tasks when doneVisibleSince is absent or null", () => {
    const t1 = task({
      id: "KS-1",
      title: "Done Task",
      status: "done",
      owner: "me",
      completed_at: now.toISOString(),
    });

    expect(partitionInbox([t1], { now }).tasks).toHaveLength(0);
    expect(partitionInbox([t1], { now, doneVisibleSince: null }).tasks).toHaveLength(0);
  });

  it("keeps done tasks completed after the watermark and drops those completed before it", () => {
    const watermark = new Date("2026-06-08T08:00:00.000Z");
    const before = task({
      id: "KS-1",
      title: "Cleared earlier",
      status: "done",
      owner: "me",
      completed_at: "2026-06-08T07:00:00.000Z",
    });
    const after = task({
      id: "KS-2",
      title: "Fresh win",
      status: "done",
      owner: "me",
      completed_at: "2026-06-08T09:00:00.000Z",
    });

    const result = partitionInbox([before, after], { now, doneVisibleSince: watermark });
    expect(result.tasks.map((t) => t.id)).toEqual(["KS-2"]);
  });

  it("epoch-0 doneVisibleSince shows every done task that has a completed_at", () => {
    const oldDone = task({
      id: "KS-1",
      title: "Old win",
      status: "done",
      owner: "me",
      completed_at: "2026-06-02T09:00:00.000Z",
    });
    const noCompletedAt = task({
      id: "KS-2",
      title: "Done without completed_at",
      status: "done",
      owner: "me",
      completed_at: null,
    });

    const result = partitionInbox([oldDone, noCompletedAt], { now, doneVisibleSince: new Date(0) });
    expect(result.tasks.map((t) => t.id)).toEqual(["KS-1"]);
  });

  it("never hides future-dated follow-up rows (horizon removal, S16)", () => {
    const futureDate = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); // +1 day
    const t1 = task({ id: "KS-1", title: "Future Own Task", owner: "me", snoozed_until: futureDate });
    const t2 = task({ id: "KS-2", title: "Future Delegated Task", owner: "elena", follow_up_date: futureDate });

    const result = partitionInbox([t1, t2], { now });
    expect(result.tasks.map((t) => t.id)).toEqual(["KS-1"]);
    expect(result.followUps.map((t) => t.id)).toEqual(["KS-2"]);
  });

  it("keeps legacy delegated tasks with null follow-up dates in Follow-ups", () => {
    const t1 = task({ id: "KS-1", title: "Legacy Delegated Task", owner: "elena", follow_up_date: null });
    const result = partitionInbox([t1], { now });
    expect(result.followUps.map((t) => t.id)).toEqual(["KS-1"]);
  });

  it("sorts follow-ups by follow_up_date ascending with nulls last (S13)", () => {
    const f1 = task({ id: "KS-1", title: "Later", owner: "elena", follow_up_date: "2026-06-12T12:00:00.000Z", priority: "P0" });
    const f2 = task({ id: "KS-2", title: "Overdue", owner: "riley", follow_up_date: "2026-06-06T12:00:00.000Z", priority: "P3" });
    const f3 = task({ id: "KS-3", title: "No date", owner: "elena", follow_up_date: null, priority: "P0" });
    const f4 = task({ id: "KS-4", title: "Today", owner: "riley", follow_up_date: now.toISOString(), priority: "P2" });

    const result = partitionInbox([f1, f2, f3, f4], { now });
    expect(result.followUps.map((t) => t.id)).toEqual(["KS-2", "KS-4", "KS-1", "KS-3"]);
  });

  it("breaks follow-up date ties by engine order", () => {
    const sameDate = "2026-06-09T12:00:00.000Z";
    const low = task({ id: "KS-1", title: "P3 tie", owner: "elena", follow_up_date: sameDate, priority: "P3" });
    const high = task({ id: "KS-2", title: "P0 tie", owner: "elena", follow_up_date: sameDate, priority: "P0" });

    const result = partitionInbox([low, high], { now });
    expect(result.followUps.map((t) => t.id)).toEqual(["KS-2", "KS-1"]);
  });

  it("sorts own tasks by tier before due date (engine order)", () => {
    const t1 = task({ id: "KS-1", title: "Own P3 due first", owner: "me", priority: "P3", due_date: "2026-06-09T12:00:00.000Z" });
    const t2 = task({ id: "KS-2", title: "Own P0 no due", owner: "me", priority: "P0", due_date: null });
    const t3 = task({ id: "KS-3", title: "Own P1 due second", owner: "me", priority: "P1", due_date: "2026-06-10T12:00:00.000Z" });

    const result = partitionInbox([t1, t2, t3], { now });
    expect(result.tasks.map((t) => t.id)).toEqual(["KS-2", "KS-3", "KS-1"]);
  });

  it("breaks ties between equal priority and equal due dates by hard_deadline first", () => {
    const due = "2026-06-09T12:00:00.000Z";
    const soft = task({ id: "KS-1", title: "Soft due", owner: "me", priority: "P1", due_date: due });
    const hard = task({ id: "KS-2", title: "Hard due", owner: "me", priority: "P1", due_date: due, hard_deadline: true });

    const result = partitionInbox([soft, hard], { now });
    expect(result.tasks.map((t) => t.id)).toEqual(["KS-2", "KS-1"]);
  });

  it("visible done tasks partition by owner like any other row", () => {
    const ownDone = task({
      id: "KS-1",
      title: "Own done",
      status: "done",
      owner: "me",
      completed_at: now.toISOString(),
    });

    const result = partitionInbox([ownDone], { now, doneVisibleSince: new Date(0) });
    expect(result.tasks.map((t) => t.id)).toEqual(["KS-1"]);
    expect(result.followUps).toHaveLength(0);
  });
});
