import { describe, expect, it } from "vitest";
import {
  assigneeThemeFor,
  assigneeThemeStyle,
  assigneeThemeStylesFor,
  normalizeAssigneeKey,
} from "../../src/web/lib/utils/assignee-theme.js";

describe("assignee theme", () => {
  it("normalizes empty owners to self", () => {
    expect(normalizeAssigneeKey(null)).toBe("me");
    expect(normalizeAssigneeKey("  ")).toBe("me");
    expect(normalizeAssigneeKey(" ME ")).toBe("me");
  });

  it("keeps the same owner on the same color theme", () => {
    expect(assigneeThemeFor("Marcus")).toEqual(assigneeThemeFor(" marcus "));
    expect(assigneeThemeStyle("Marcus")).toBe(assigneeThemeStyle("marcus"));
  });

  it("keeps self on a distinct standard blue treatment", () => {
    const self = assigneeThemeFor("me");
    const teammate = assigneeThemeFor("marcus");

    expect(self.isSelf).toBe(true);
    expect(self.background).toBe("hsl(214 72% 42%)");
    expect(self.background).not.toBe(teammate.background);
  });

  it("spreads common team members across different colors", () => {
    const colors = Object.values(
      assigneeThemeStylesFor(["me", "marcus", "jordan", "elena", "casey", "quinn"]),
    );

    expect(new Set(colors).size).toBe(colors.length);
  });
});
