import { describe, expect, test } from "vitest";
import { isWellFormedTaskId } from "../../src/web/lib/utils/task-id.js";

describe("task-id URL validation", () => {
  test("accepts default KS prefix with padding", () => {
    expect(isWellFormedTaskId("KS-001")).toBe(true);
  });

  test("accepts configurable 1-letter prefix", () => {
    expect(isWellFormedTaskId("K-042")).toBe(true);
  });

  test("accepts 4-letter prefix", () => {
    expect(isWellFormedTaskId("ABCD-99")).toBe(true);
  });

  test("accepts test-seeded nanoid suffixes already visible on the board", () => {
    expect(isWellFormedTaskId("KS-YQrlX0eG")).toBe(true);
  });

  test("rejects lowercase prefix", () => {
    expect(isWellFormedTaskId("ks-1")).toBe(false);
  });

  test("rejects missing digits", () => {
    expect(isWellFormedTaskId("KS-")).toBe(false);
  });
});
