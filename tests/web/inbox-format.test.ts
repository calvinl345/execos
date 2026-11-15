import { describe, expect, it } from "vitest";
import { resolveDisplayName, composeSlackNudge } from "../../src/web/lib/utils/inbox-format.js";
import type { TeamMember } from "../../src/web/lib/types.js";

const team: TeamMember[] = [
  { slug: "noah", displayName: "Noah Brooks" },
  { slug: "elena", displayName: "elena smith" }, // lowercase display name to test casing if needed, but nudge first name gets capitalized
];

describe("inbox format utils", () => {
  describe("resolveDisplayName", () => {
    it("resolves null, empty, or 'me' to 'me'", () => {
      expect(resolveDisplayName(null, team)).toBe("me");
      expect(resolveDisplayName("", team)).toBe("me");
      expect(resolveDisplayName("   ", team)).toBe("me");
      expect(resolveDisplayName("me", team)).toBe("me");
      expect(resolveDisplayName("ME", team)).toBe("me");
      expect(resolveDisplayName("  me  ", team)).toBe("me");
    });

    it("resolves a known slug to the display name", () => {
      expect(resolveDisplayName("noah", team)).toBe("Noah Brooks");
      expect(resolveDisplayName("elena", team)).toBe("elena smith");
    });

    it("resolves an unknown slug to itself (fallback)", () => {
      expect(resolveDisplayName("unknown", team)).toBe("unknown");
      expect(resolveDisplayName("someone-else", team)).toBe("someone-else");
    });
  });

  describe("composeSlackNudge", () => {
    it("composes nudge with due date, extracting and capitalizing first name", () => {
      const nudge = composeSlackNudge("Noah Brooks", "Complete the budget", "2026-06-15T12:00:00.000Z");
      expect(nudge).toBe(
        'Hey Noah, just checking in on: "Complete the budget" (originally due Jun 15). Let me know if you need any help or if we should adjust the timeline!',
      );
    });

    it("composes nudge without due date, extracting and capitalizing first name", () => {
      const nudge = composeSlackNudge("elena smith", "Write API docs", null);
      expect(nudge).toBe('Hey Elena, just checking in on: "Write API docs". Let me know how it\'s going!');
    });

    it("handles single name display names properly", () => {
      const nudge = composeSlackNudge("elena", "Write API docs", null);
      expect(nudge).toBe('Hey Elena, just checking in on: "Write API docs". Let me know how it\'s going!');
    });
  });
});
