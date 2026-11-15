import { describe, expect, it } from "vitest";
import { composeDelegationMessage } from "../../src/domain/delegation-messages.js";

describe("delegation messages", () => {
  it("composes a teammate-facing handoff with title, context, due date, and follow-up", () => {
    const message = composeDelegationMessage({
      kind: "handoff",
      task: {
        title: "Screen Indeed project manager candidates",
        description: "Review incoming resumes and pick the strongest candidates for first calls.",
        dueDate: "2026-06-14T12:00:00.000Z",
        owner: "elena",
      },
      ownerDisplayName: "Elena Torres",
      followUpDate: "2026-06-15T12:00:00.000Z",
    });

    expect(message).toBe(
      "Hey Elena, can you take this on: Screen Indeed project manager candidates? Context: Review incoming resumes and pick the strongest candidates for first calls. Due Jun 14. I'll check back Jun 15.",
    );
  });

  it("composes a concise nudge without sounding like an agent prompt", () => {
    const message = composeDelegationMessage({
      kind: "nudge",
      task: {
        title: "Prepare Stripe billing spike notes",
        description: "",
        dueDate: "2026-06-16T12:00:00.000Z",
        owner: "noah",
      },
      ownerDisplayName: "Noah Brooks",
      followUpDate: "2026-06-18T12:00:00.000Z",
    });

    expect(message).toBe(
      "Hey Noah, checking in on Prepare Stripe billing spike notes. Can you send me the latest? Due Jun 16. I'll check back Jun 18 if we still need time.",
    );
    expect(message.toLowerCase()).not.toContain("ai");
    expect(message.toLowerCase()).not.toContain("prompt");
  });

  it("falls back gracefully when the owner or dates are missing", () => {
    const message = composeDelegationMessage({
      kind: "handoff",
      task: {
        title: "Review loose operational notes",
        description: null,
        dueDate: null,
        owner: null,
      },
      followUpDate: null,
    });

    expect(message).toBe(
      "Hey there, can you take this on: Review loose operational notes? I'll check back soon.",
    );
  });
});
