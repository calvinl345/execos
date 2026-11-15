import { describe, expect, it } from "vitest";
import type { DashboardTask } from "../../src/web/lib/types.js";
import {
  handoffControlState,
  ownerInitials,
  secondaryTimingLabel,
  shouldDimForWaiting,
} from "../../src/web/lib/utils/task-row-workflow.js";

const now = new Date("2026-06-13T12:00:00.000Z");

function task(partial: Partial<DashboardTask> & Pick<DashboardTask, "id" | "title">): DashboardTask {
  return {
    description: "",
    status: "in_progress",
    priority: "P1",
    category: "business",
    owner: "me",
    due_date: "2026-06-20T12:00:00.000Z",
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

describe("task row workflow state", () => {
  it("treats self-owned snooze as the only self-owned waiting date", () => {
    const own = task({
      id: "KS-001",
      title: "Own task",
      snoozed_until: "2026-06-15T12:00:00.000Z",
    });

    expect(shouldDimForWaiting(own, now)).toBe(true);
    expect(secondaryTimingLabel(own, now)).toBe("snoozed until Jun 15");
    expect(handoffControlState(own, now)).toBeNull();
  });

  it("does not dim a delegated pending handoff just because follow-up is future", () => {
    const delegated = task({
      id: "KS-002",
      title: "Delegated task",
      owner: "elena",
      follow_up_date: "2026-06-15T12:00:00.000Z",
      handoff_state: "pending",
    });

    expect(shouldDimForWaiting(delegated, now)).toBe(false);
    expect(secondaryTimingLabel(delegated, now)).toBe("follow-up Jun 15");
    expect(handoffControlState(delegated, now)).toMatchObject({
      kind: "handoff",
      buttonLabel: "Copy handoff",
      tone: "attention",
    });
  });

  it("dims copied delegated work while its follow-up date is more than 24 hours away", () => {
    const delegated = task({
      id: "KS-003",
      title: "Waiting delegated task",
      owner: "elena",
      follow_up_date: "2026-06-15T12:00:00.000Z",
      handoff_state: "copied",
    });

    expect(shouldDimForWaiting(delegated, now)).toBe(true);
    expect(handoffControlState(delegated, now)).toMatchObject({
      kind: "handoff",
      buttonLabel: "Handoff copied",
      tone: "waiting",
    });
  });

  it("does not dim copied delegated work with a follow-up in the next 24 hours", () => {
    const delegated = task({
      id: "KS-003B",
      title: "Soon follow-up task",
      owner: "elena",
      follow_up_date: "2026-06-14T11:59:00.000Z",
      handoff_state: "copied",
    });

    expect(shouldDimForWaiting(delegated, now)).toBe(false);
    expect(handoffControlState(delegated, now)).toMatchObject({
      kind: "handoff",
      buttonLabel: "Handoff copied",
      tone: "waiting",
    });
  });

  it("turns copied delegated work into a nudge when follow-up arrives", () => {
    const delegated = task({
      id: "KS-004",
      title: "Due follow-up task",
      owner: "elena",
      follow_up_date: "2026-06-13T10:00:00.000Z",
      handoff_state: "copied",
    });

    expect(shouldDimForWaiting(delegated, now)).toBe(false);
    expect(handoffControlState(delegated, now)).toMatchObject({
      kind: "nudge",
      buttonLabel: "Copy nudge",
      tone: "attention",
    });
  });

  it("surfaces delegated rows with no follow-up as needing a date", () => {
    const delegated = task({
      id: "KS-005",
      title: "Missing date delegated task",
      owner: "elena",
      follow_up_date: null,
      handoff_state: "pending",
    });

    expect(secondaryTimingLabel(delegated, now)).toBe("follow-up not set");
    expect(handoffControlState(delegated, now)).toMatchObject({
      buttonLabel: "Set follow-up",
      tone: "needs-date",
    });
  });

  it("formats owner initials as exactly two uppercase characters", () => {
    expect(ownerInitials("me")).toBe("ME");
    expect(ownerInitials("Marcus")).toBe("MA");
    expect(ownerInitials("Marcus Lee")).toBe("ML");
    expect(ownerInitials("Jordan Avery")).toBe("JA");
    expect(ownerInitials("q")).toBe("QQ");
    expect(ownerInitials("")).toBe("ME");
  });
});
