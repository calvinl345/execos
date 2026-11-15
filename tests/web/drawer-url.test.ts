import { describe, expect, test } from "vitest";
import {
  clearTaskParam,
  mergePreservingTaskParam,
  setTaskParam,
} from "../../src/web/lib/utils/drawer.js";

describe("drawer URL helpers", () => {
  test("setTaskParam adds task while preserving filter params", () => {
    const current = new URLSearchParams("view=list&category=product");
    const next = setTaskParam(current, "KS-1");
    expect(next.get("view")).toBe("list");
    expect(next.get("category")).toBe("product");
    expect(next.get("task")).toBe("KS-1");
  });

  test("clearTaskParam removes only task when multiple params exist", () => {
    const current = new URLSearchParams("view=list&category=product&task=KS-99");
    const next = clearTaskParam(current);
    expect(next.get("view")).toBe("list");
    expect(next.get("category")).toBe("product");
    expect(next.get("task")).toBeNull();
  });

  test("clearTaskParam is no-op when task absent", () => {
    const current = new URLSearchParams("view=list&category=product");
    const next = clearTaskParam(current);
    expect(next.toString()).toBe(current.toString());
  });

  test("mergePreservingTaskParam re-attaches task from full URL params", () => {
    const full = new URLSearchParams("view=list&task=KS-7&q=hello");
    const serialized = new URLSearchParams("view=list&q=hello");
    const merged = mergePreservingTaskParam(serialized, full);
    expect(merged.get("task")).toBe("KS-7");
    expect(merged.get("q")).toBe("hello");
  });
});
