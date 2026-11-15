import { describe, expect, it } from "vitest";
import { buildAgentContextPrompt } from "../../src/web/lib/utils/agent-context-prompt.js";
import type { DashboardTask } from "../../src/web/lib/types.js";

function task(partial: Partial<DashboardTask> = {}): DashboardTask {
  return {
    id: "KS-001",
    title: "Invoice Globex",
    description: "Send the invoice to Globex for the current billing period.",
    status: "triage",
    priority: "P1",
    category: "client",
    owner: "me",
    due_date: "2026-06-15T12:00:00.000Z",
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
    created_at: "2026-06-14T12:00:00.000Z",
    updated_at: "2026-06-14T12:00:00.000Z",
    completed_at: null,
    attachment_count: 0,
    hard_deadline: true,
    effort: "S",
    queue_rank: null,
    queue_rationale: null,
    queue_ranked_at: null,
    ...partial,
  };
}

describe("buildAgentContextPrompt", () => {
  it("includes queue context for self-owned ranked tasks", () => {
    const prompt = buildAgentContextPrompt(
      task({
        queue_rank: 1,
        queue_rationale: "Cash flow blocker.",
        queue_ranked_at: "2026-06-14T12:00:00.000Z",
      }),
    );

    expect(prompt).toContain("Queue: #1 of 5 (Cash flow blocker.)");
  });

  it("omits stale queue context for delegated tasks", () => {
    const prompt = buildAgentContextPrompt(
      task({
        owner: "marcus",
        follow_up_date: "2026-06-15T12:00:00.000Z",
        handoff_state: "copied",
        queue_rank: 1,
        queue_rationale: "Legacy queue rationale.",
        queue_ranked_at: "2026-06-14T12:00:00.000Z",
      }),
    );

    expect(prompt).toContain("owner marcus");
    expect(prompt).not.toContain("Queue:");
    expect(prompt).not.toContain("Legacy queue rationale.");
  });
});
