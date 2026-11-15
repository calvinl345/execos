import { describe, expect, it } from "vitest";
import {
  formatGoalId,
  formatStatusChangeNote,
  formatTaskId,
} from "../../src/db/helpers/formatters.js";
import { AppSettingMissingError } from "../../src/db/errors.js";

describe("db pure helpers", () => {
  describe("formatTaskId", () => {
    it("formats prefix + sequence with 3-digit padding", () => {
      expect(formatTaskId("KS", 1)).toBe("KS-001");
      expect(formatTaskId("KS", 42)).toBe("KS-042");
      expect(formatTaskId("ABCD", 1000)).toBe("ABCD-1000");
    });

    it("rejects invalid prefixes", () => {
      expect(() => formatTaskId("", 1)).toThrow(AppSettingMissingError);
      expect(() => formatTaskId("abc", 1)).toThrow(AppSettingMissingError);
      expect(() => formatTaskId("ABCDE", 1)).toThrow(AppSettingMissingError);
    });

    it("rejects invalid sequence values", () => {
      expect(() => formatTaskId("KS", 0)).toThrow(/positive integer/);
      expect(() => formatTaskId("KS", 1.5)).toThrow(/positive integer/);
    });
  });

  describe("formatGoalId", () => {
    it("formats sequence with hardcoded G prefix", () => {
      expect(formatGoalId(1)).toBe("G-001");
      expect(formatGoalId(999)).toBe("G-999");
    });

    it("rejects invalid sequence values", () => {
      expect(() => formatGoalId(0)).toThrow(/positive integer/);
      expect(() => formatGoalId(-1)).toThrow(/positive integer/);
    });
  });

  describe("formatStatusChangeNote", () => {
    it("serializes the Appendix G.3.1 status_change JSON shape", () => {
      const at = new Date("2026-04-26T12:34:56.000Z");
      expect(
        JSON.parse(formatStatusChangeNote("triage", "backlog", "agent", at)),
      ).toEqual({
        from: "triage",
        to: "backlog",
        by: "agent",
        at: "2026-04-26T12:34:56.000Z",
      });
    });
  });
});
