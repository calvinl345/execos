import { describe, expect, it } from "vitest";
import {
  computeTaskFieldDiff,
  formatTaskFieldUpdateNote,
  formatGoalLinkNote,
  formatGoalUnlinkNote,
  formatAttentionFlaggedNote,
  formatAttentionClearedNote,
} from "../../src/db/helpers/formatters.js";

describe("pure helpers and formatters (fast tier)", () => {
  describe("computeTaskFieldDiff", () => {
    it("changed-subset only", () => {
      const before = { title: "old title", description: "old desc", priority: "P2" };
      const patch = { title: "new title" };
      const diff = computeTaskFieldDiff(before, patch);
      expect(diff).toEqual({
        changes: {
          title: { from: "old title", to: "new title" },
        },
      });
    });

    it("no-op gives empty changes", () => {
      const before = { title: "old title", priority: "P2" };
      const patch = { title: "old title" };
      const diff = computeTaskFieldDiff(before, patch);
      expect(diff).toEqual({ changes: {} });
    });

    it("Date equality by time", () => {
      const d1 = new Date("2026-06-04T12:00:00.000Z");
      const d2 = new Date("2026-06-04T12:00:00.000Z");
      const d3 = new Date("2026-06-04T13:00:00.000Z");

      const before = { dueDate: d1 };
      const patchEqual = { dueDate: d2 };
      const patchDiff = { dueDate: d3 };

      expect(computeTaskFieldDiff(before, patchEqual)).toEqual({ changes: {} });
      expect(computeTaskFieldDiff(before, patchDiff)).toEqual({
        changes: {
          dueDate: {
            from: d1.toISOString(),
            to: d3.toISOString(),
          },
        },
      });
    });

    it("null/undefined normalization", () => {
      const before1 = { priority: null };
      const patch1 = { priority: undefined };
      expect(computeTaskFieldDiff(before1, patch1)).toEqual({ changes: {} });

      const before2 = { priority: undefined };
      const patch2 = { priority: null };
      expect(computeTaskFieldDiff(before2, patch2)).toEqual({ changes: {} });

      const before3 = { priority: "P1" };
      const patch3 = { priority: null };
      expect(computeTaskFieldDiff(before3, patch3)).toEqual({
        changes: {
          priority: { from: "P1", to: null },
        },
      });
    });
  });

  describe("formatters exact JSON shape", () => {
    const at = new Date("2026-06-04T12:34:56.000Z");

    it("formatTaskFieldUpdateNote", () => {
      const diff = {
        changes: {
          title: { from: "old", to: "new" },
        },
      };
      const result = formatTaskFieldUpdateNote(diff, "agent", at);
      expect(JSON.parse(result)).toEqual({
        type: "task_fields_updated",
        changes: {
          title: { from: "old", to: "new" },
        },
        by: "agent",
        at: "2026-06-04T12:34:56.000Z",
      });
    });

    it("formatGoalLinkNote", () => {
      const result = formatGoalLinkNote("G-007", "agent", at);
      expect(JSON.parse(result)).toEqual({
        type: "task_goal_linked",
        goalId: "G-007",
        by: "agent",
        at: "2026-06-04T12:34:56.000Z",
      });
    });

    it("formatGoalUnlinkNote", () => {
      const result = formatGoalUnlinkNote("G-007", "agent", at);
      expect(JSON.parse(result)).toEqual({
        type: "task_goal_unlinked",
        from: "G-007",
        by: "agent",
        at: "2026-06-04T12:34:56.000Z",
      });
    });

    it("formatAttentionFlaggedNote", () => {
      const result = formatAttentionFlaggedNote("stuck", "agent", at);
      expect(JSON.parse(result)).toEqual({
        type: "task_attention_flagged",
        reason: "stuck",
        by: "agent",
        at: "2026-06-04T12:34:56.000Z",
      });
    });

    it("formatAttentionClearedNote", () => {
      const result = formatAttentionClearedNote("agent", at);
      expect(JSON.parse(result)).toEqual({
        type: "task_attention_cleared",
        by: "agent",
        at: "2026-06-04T12:34:56.000Z",
      });
    });
  });
});
