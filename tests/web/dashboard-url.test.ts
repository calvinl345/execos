import { describe, expect, test } from "vitest";
import {
  mergeDashboardNavState,
  mergeUrlForGoalTaskView,
  clearGoalDetailsParam,
  parseGoalsBoardFilters,
  parseMainBoardTab,
  pathWithQuery,
  setGoalDetailsParam,
} from "../../src/web/lib/utils/dashboard-url.js";

describe("dashboard URL helpers", () => {
  test("parseMainBoardTab defaults to tasks", () => {
    expect(parseMainBoardTab(new URLSearchParams())).toBe("tasks");
    expect(parseMainBoardTab(new URLSearchParams("board=tasks"))).toBe("tasks");
  });

  test("parseMainBoardTab goals", () => {
    expect(parseMainBoardTab(new URLSearchParams("board=goals"))).toBe("goals");
  });

  test("mergeDashboardNavState preserves task drawer + board tab + goals filters + closed toggle", () => {
    const serialized = new URLSearchParams("view=list&category=product");
    const current = new URLSearchParams(
      "view=list&category=product&task=KS-9&board=goals&gstatus=all&gq=2026-Q2&gview=list&closed=1",
    );
    const merged = mergeDashboardNavState(serialized, current);
    expect(merged.get("view")).toBe("list");
    expect(merged.get("category")).toBe("product");
    expect(merged.get("task")).toBe("KS-9");
    expect(merged.get("board")).toBe("goals");
    expect(merged.get("gstatus")).toBe("all");
    expect(merged.get("gq")).toBe("2026-Q2");
    expect(merged.get("gview")).toBe("list");
    expect(merged.get("closed")).toBe("1");
  });

  test("mergeUrlForGoalTaskView strips tab noise and sets goal when well-formed", () => {
    const current = new URLSearchParams(
      "board=goals&gstatus=all&gq=2026-Q1&gview=list&category=product&task=KS-5",
    );
    const merged = mergeUrlForGoalTaskView(current, "G-010");
    expect(merged.get("board")).toBeNull();
    expect(merged.get("gstatus")).toBeNull();
    expect(merged.get("gq")).toBeNull();
    expect(merged.get("gview")).toBeNull();
    expect(merged.get("task")).toBeNull();
    expect(merged.get("goal")).toBe("G-010");
    expect(merged.get("category")).toBe("product");
  });

  test("setGoalDetailsParam opens a goal on the goals board and clears task drawer", () => {
    const current = new URLSearchParams("board=goals&gstatus=all&task=KS-5&goal=G-001");
    const merged = setGoalDetailsParam(current, "G-026");
    expect(merged.get("board")).toBe("goals");
    expect(merged.get("goal")).toBe("G-026");
    expect(merged.get("task")).toBeNull();
    expect(merged.get("gstatus")).toBe("all");
  });

  test("clearGoalDetailsParam leaves the goals board open", () => {
    const current = new URLSearchParams("board=goals&goal=G-026&gq=2026-Q2");
    const merged = clearGoalDetailsParam(current);
    expect(merged.get("board")).toBe("goals");
    expect(merged.get("goal")).toBeNull();
    expect(merged.get("gq")).toBe("2026-Q2");
  });

  test("parseGoalsBoardFilters ignores garbage gq", () => {
    const f = parseGoalsBoardFilters(new URLSearchParams("gq=nope&gstatus=dropped"));
    expect(f.quarter).toBe("all");
    expect(f.status).toBe("dropped");
  });

  test("parseGoalsBoardFilters defaults to kanban and accepts list view", () => {
    expect(parseGoalsBoardFilters(new URLSearchParams()).view).toBe("kanban");
    expect(parseGoalsBoardFilters(new URLSearchParams("gview=list")).view).toBe("list");
    expect(parseGoalsBoardFilters(new URLSearchParams("gview=table")).view).toBe("kanban");
  });

  test("pathWithQuery", () => {
    expect(pathWithQuery(new URLSearchParams(""))).toBe("/");
    expect(pathWithQuery(new URLSearchParams("view=list"))).toBe("/?view=list");
  });
});
