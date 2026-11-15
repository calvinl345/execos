/**
 * Merge serialized task filters with navigational URL state (drawer, board tab,
 * goals-tab filters). Pure module — no Svelte imports.
 */

import type { GoalStatus } from "../types.js";

/** Keys layered on dashboard URLs beyond serializeFilters(...) output. */
const PRESERVE_KEYS_FROM_CURRENT = ["task", "board", "gstatus", "gq", "gview", "closed"] as const;

export function mergeDashboardNavState(
  nextParams: URLSearchParams,
  currentFullParams: URLSearchParams,
): URLSearchParams {
  const merged = new URLSearchParams(nextParams);
  for (const key of PRESERVE_KEYS_FROM_CURRENT) {
    const v = currentFullParams.get(key);
    if (v !== null && v !== "") merged.set(key, v);
    else merged.delete(key);
  }
  return merged;
}

/** Task board URL with `goal` applied; strips drawer + goals-tab clutter. Kept compose with task filters. */
export function mergeUrlForGoalTaskView(current: URLSearchParams, goalId: string): URLSearchParams {
  const p = new URLSearchParams(current);
  p.delete("task");
  p.delete("board");
  p.delete("gstatus");
  p.delete("gq");
  p.delete("gview");
  if (!/^G-\d+$/.test(goalId)) p.delete("goal");
  else p.set("goal", goalId);
  return p;
}

/** Goals board URL with the selected goal opened in the details drawer. */
export function setGoalDetailsParam(current: URLSearchParams, goalId: string): URLSearchParams {
  const p = new URLSearchParams(current);
  p.set("board", "goals");
  p.delete("task");
  if (!/^G-\d+$/.test(goalId)) p.delete("goal");
  else p.set("goal", goalId);
  return p;
}

export function clearGoalDetailsParam(current: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(current);
  p.delete("goal");
  return p;
}

export function pathWithQuery(params: URLSearchParams): "/" | `/?${string}` {
  const s = params.toString();
  return (s === "" ? "/" : `/?${s}`) as "/" | `/?${string}`;
}

export type MainBoardTab = "tasks" | "goals";

export function parseMainBoardTab(p: URLSearchParams): MainBoardTab {
  return p.get("board") === "goals" ? "goals" : "tasks";
}

/** Goals-tab filters (`gstatus`, `gq`) — distinct from task `status` / list filters. */
export type GoalsBoardStatusFilter = GoalStatus | "all";
export type GoalsBoardViewMode = "kanban" | "list";

export function parseGoalsBoardFilters(p: URLSearchParams): {
  status: GoalsBoardStatusFilter;
  quarter: string | "all";
  view: GoalsBoardViewMode;
} {
  const VALID: readonly GoalStatus[] = ["active", "achieved", "dropped"];
  const gs = p.get("gstatus");
  let status: GoalsBoardStatusFilter = "active";
  if (gs === "all") status = "all";
  else if (gs && (VALID as readonly string[]).includes(gs)) status = gs as GoalStatus;

  const gq = p.get("gq");
  let quarter: string | "all" = "all";
  if (gq && /^\d{4}-Q[1-4]$/.test(gq)) quarter = gq;

  const view: GoalsBoardViewMode = p.get("gview") === "list" ? "list" : "kanban";

  return { status, quarter, view };
}
