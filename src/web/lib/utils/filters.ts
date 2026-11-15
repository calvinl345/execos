/**
 * URL filter parsing, serialization, and in-memory task filtering for the dashboard.
 * Pure module — no Svelte imports.
 */

import type { DashboardTask, TaskCategory, TaskPriority, TaskStatus } from "../types.js";
import { TASK_FLAG_ORDER, flagsFor, type TaskFlag } from "./flags.js";

export type FlagKey = TaskFlag;
export type ViewMode = "kanban" | "list" | "inbox";
export type SortKey =
  | "id"
  | "priority"
  | "title"
  | "category"
  | "goal"
  | "status"
  | "owner"
  | "due"
  | "updated";

export interface Filters {
  view: ViewMode;
  categories: ReadonlySet<TaskCategory>;
  priorities: ReadonlySet<TaskPriority>;
  statuses: ReadonlySet<TaskStatus>;
  owners: ReadonlySet<string>;
  flags: ReadonlySet<FlagKey>;
  search: string;
  sort: SortKey;
  sortDir: "asc" | "desc";
  /** Well-formed goal id from URL (`G-\d+`), or null / ignored if invalid. */
  goal: string | null;
}

const CATEGORIES: TaskCategory[] = [
  "client",
  "business",
  "product",
  "house",
  "personal",
];

const PRIORITIES: TaskPriority[] = ["P0", "P1", "P2", "P3"];

const STATUSES: TaskStatus[] = [
  "triage",
  "backlog",
  "in_progress",
  "blocked",
  "review",
  "done",
  "cancelled",
];

const FLAG_KEYS: FlagKey[] = [...TASK_FLAG_ORDER];

const SORT_KEYS: SortKey[] = [
  "id",
  "priority",
  "title",
  "category",
  "goal",
  "status",
  "owner",
  "due",
  "updated",
];

/** Values for dashboard filter dropdowns (URL enums). */
export const FILTER_CATEGORY_VALUES: readonly TaskCategory[] = CATEGORIES;
export const FILTER_PRIORITY_VALUES: readonly TaskPriority[] = PRIORITIES;
export const FILTER_STATUS_VALUES: readonly TaskStatus[] = [
  "triage",
  "backlog",
  "in_progress",
  "blocked",
  "review",
];
export const FILTER_CLOSED_STATUS_VALUES: readonly TaskStatus[] = ["done", "cancelled"];
export const FILTER_FLAG_VALUES: readonly FlagKey[] = FLAG_KEYS;

function isCategory(s: string): s is TaskCategory {
  return (CATEGORIES as string[]).includes(s);
}

function isPriority(s: string): s is TaskPriority {
  return (PRIORITIES as string[]).includes(s);
}

function isStatus(s: string): s is TaskStatus {
  return (STATUSES as string[]).includes(s);
}

function isFlagKey(s: string): s is FlagKey {
  return (FLAG_KEYS as string[]).includes(s);
}

function isSortKey(s: string): s is SortKey {
  return (SORT_KEYS as string[]).includes(s);
}

function isWellFormedGoalId(s: string): boolean {
  return /^G-\d+$/.test(s);
}

function priorityRank(p: TaskPriority | null): number {
  if (p === null) return 4;
  return PRIORITIES.indexOf(p);
}

function statusRank(status: TaskStatus): number {
  return STATUSES.indexOf(status);
}

function dueMs(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
}

function updatedMs(t: DashboardTask): number {
  const ms = new Date(t.updated_at).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function compareString(
  a: string | null,
  b: string | null,
  dir: "asc" | "desc",
): number {
  const aa = a?.trim().toLowerCase() ?? "";
  const bb = b?.trim().toLowerCase() ?? "";
  if (!aa && !bb) return 0;
  if (!aa) return 1;
  if (!bb) return -1;
  const cmp = aa.localeCompare(bb);
  return dir === "asc" ? cmp : -cmp;
}

export function defaultFilters(): Filters {
  return {
    view: "inbox",
    categories: new Set(),
    priorities: new Set(),
    statuses: new Set(),
    owners: new Set(),
    flags: new Set(),
    search: "",
    sort: "updated",
    sortDir: "desc",
    goal: null,
  };
}

export function parseFilters(p: URLSearchParams): Filters {
  const viewRaw = p.get("view");
  const view: ViewMode = viewRaw === "list" ? "list" : viewRaw === "kanban" ? "kanban" : "inbox";

  const categories = new Set<TaskCategory>();
  for (const v of p.getAll("category")) {
    if (v && isCategory(v)) categories.add(v);
  }

  const priorities = new Set<TaskPriority>();
  for (const v of p.getAll("priority")) {
    if (v && isPriority(v)) priorities.add(v);
  }

  const statuses = new Set<TaskStatus>();
  for (const v of p.getAll("status")) {
    if (v && isStatus(v)) statuses.add(v);
  }

  const owners = new Set<string>();
  for (const v of p.getAll("owner")) {
    if (v.trim()) owners.add(v.trim());
  }

  const flags = new Set<FlagKey>();
  for (const v of p.getAll("flag")) {
    if (v && isFlagKey(v)) flags.add(v);
  }

  const search = (p.get("q") ?? "").trim();

  let sort: SortKey = "updated";
  const sortRaw = p.get("sort");
  if (sortRaw && isSortKey(sortRaw)) sort = sortRaw;

  let sortDir: "asc" | "desc" = "desc";
  const dirRaw = p.get("sortDir");
  if (dirRaw === "asc" || dirRaw === "desc") sortDir = dirRaw;

  const goalRaw = p.get("goal");
  const goal = goalRaw && isWellFormedGoalId(goalRaw) ? goalRaw : null;

  return {
    view,
    categories,
    priorities,
    statuses,
    owners,
    flags,
    search,
    sort,
    sortDir,
    goal,
  };
}

export function serializeFilters(f: Filters): URLSearchParams {
  const out = new URLSearchParams();

  if (f.view === "list") {
    out.set("view", "list");
    if (f.sort !== "updated" || f.sortDir !== "desc") {
      out.set("sort", f.sort);
      out.set("sortDir", f.sortDir);
    }
  } else if (f.view === "kanban") {
    out.set("view", "kanban");
  }

  for (const c of [...f.categories].sort()) {
    out.append("category", c);
  }
  for (const p of [...f.priorities].sort()) {
    out.append("priority", p);
  }
  for (const s of [...f.statuses].sort()) {
    out.append("status", s);
  }
  for (const o of [...f.owners].sort()) {
    out.append("owner", o);
  }
  for (const fl of [...f.flags].sort()) {
    out.append("flag", fl);
  }
  if (f.search.trim()) {
    out.set("q", f.search.trim());
  }
  if (f.goal) {
    out.set("goal", f.goal);
  }

  return out;
}

/** Single search matcher for every task view — id, title, and description, case-insensitive. */
export function taskMatchesQuery(task: DashboardTask, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    task.id.toLowerCase().includes(q) ||
    task.title.toLowerCase().includes(q) ||
    task.description.toLowerCase().includes(q)
  );
}

export function compareDue(
  a: DashboardTask,
  b: DashboardTask,
  dir: "asc" | "desc",
): number {
  const da = dueMs(a.due_date);
  const db = dueMs(b.due_date);
  const aNull = da === null;
  const bNull = db === null;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const cmp = dir === "asc" ? da - db : db - da;
  if (cmp !== 0) return cmp;
  const pr = priorityRank(a.priority) - priorityRank(b.priority);
  if (pr !== 0) return pr;
  return updatedMs(b) - updatedMs(a);
}

export function compareFollowUpUrgency(
  a: DashboardTask,
  b: DashboardTask,
  _now: Date,
): number {
  const fa = a.follow_up_date ? new Date(a.follow_up_date).getTime() : null;
  const fb = b.follow_up_date ? new Date(b.follow_up_date).getTime() : null;

  const aNull = fa === null || Number.isNaN(fa);
  const bNull = fb === null || Number.isNaN(fb);

  if (aNull && bNull) {
    // Tie-break when both are null
    const pr = priorityRank(a.priority) - priorityRank(b.priority);
    if (pr !== 0) return pr;
    return updatedMs(b) - updatedMs(a);
  }
  if (aNull) return 1;
  if (bNull) return -1;

  const cmp = fa - fb;
  if (cmp !== 0) return cmp;

  const pr = priorityRank(a.priority) - priorityRank(b.priority);
  if (pr !== 0) return pr;
  return updatedMs(b) - updatedMs(a);
}

function comparePriority(
  a: DashboardTask,
  b: DashboardTask,
  dir: "asc" | "desc",
): number {
  const aNull = a.priority === null;
  const bNull = b.priority === null;
  if (aNull && bNull) {
    // tie-break only
  } else if (aNull) return 1;
  else if (bNull) return -1;
  else {
    const ra = priorityRank(a.priority);
    const rb = priorityRank(b.priority);
    let cmp = ra - rb;
    if (dir === "desc") cmp = -cmp;
    if (cmp !== 0) return cmp;
  }
  const da = dueMs(a.due_date);
  const db = dueMs(b.due_date);
  if (da === null && db === null) return updatedMs(b) - updatedMs(a);
  if (da === null) return 1;
  if (db === null) return -1;
  const dueCmp = da - db;
  if (dueCmp !== 0) return dueCmp;
  return updatedMs(b) - updatedMs(a);
}

function compareId(a: DashboardTask, b: DashboardTask, dir: "asc" | "desc"): number {
  const cmp = a.id.localeCompare(b.id);
  return dir === "asc" ? cmp : -cmp;
}

function compareTitle(
  a: DashboardTask,
  b: DashboardTask,
  dir: "asc" | "desc",
): number {
  const cmp = compareString(a.title, b.title, dir);
  return cmp !== 0 ? cmp : compareId(a, b, "asc");
}

function compareGoal(a: DashboardTask, b: DashboardTask, dir: "asc" | "desc"): number {
  const cmp = compareString(a.goal_id, b.goal_id, dir);
  if (cmp !== 0) return cmp;
  return compareTitle(a, b, "asc");
}

function compareCategory(a: DashboardTask, b: DashboardTask, dir: "asc" | "desc"): number {
  const cmp = compareString(a.category, b.category, dir);
  if (cmp !== 0) return cmp;
  return comparePriority(a, b, "asc");
}

function compareStatus(
  a: DashboardTask,
  b: DashboardTask,
  dir: "asc" | "desc",
): number {
  let cmp = statusRank(a.status) - statusRank(b.status);
  if (dir === "desc") cmp = -cmp;
  return cmp !== 0 ? cmp : comparePriority(a, b, "asc");
}

function compareOwner(a: DashboardTask, b: DashboardTask, dir: "asc" | "desc"): number {
  const cmp = compareString(a.owner, b.owner, dir);
  return cmp !== 0 ? cmp : comparePriority(a, b, "asc");
}

function compareUpdated(
  a: DashboardTask,
  b: DashboardTask,
  dir: "asc" | "desc",
): number {
  const ua = updatedMs(a);
  const ub = updatedMs(b);
  const cmp = dir === "asc" ? ua - ub : ub - ua;
  if (cmp !== 0) return cmp;
  return a.id.localeCompare(b.id);
}

function sortTasks(tasks: DashboardTask[], f: Filters): DashboardTask[] {
  const out = [...tasks];
  const dir = f.sortDir;
  out.sort((a, b) => {
    let c = 0;
    if (f.sort === "id") c = compareId(a, b, dir);
    else if (f.sort === "priority") c = comparePriority(a, b, dir);
    else if (f.sort === "title") c = compareTitle(a, b, dir);
    else if (f.sort === "category") c = compareCategory(a, b, dir);
    else if (f.sort === "goal") c = compareGoal(a, b, dir);
    else if (f.sort === "status") c = compareStatus(a, b, dir);
    else if (f.sort === "owner") c = compareOwner(a, b, dir);
    else if (f.sort === "due") c = compareDue(a, b, dir);
    else c = compareUpdated(a, b, dir);
    if (c !== 0) return c;
    return a.id.localeCompare(b.id);
  });
  return out;
}

export function applyFilters(
  tasks: DashboardTask[],
  f: Filters,
  now: Date = new Date(),
): DashboardTask[] {
  const q = f.search.trim();

  let out = tasks.filter((task) => {
    if (f.categories.size && !f.categories.has(task.category)) return false;
    if (f.priorities.size && (task.priority === null || !f.priorities.has(task.priority))) {
      return false;
    }
    if (f.statuses.size && !f.statuses.has(task.status)) return false;
    if (f.owners.size) {
      const o = task.owner ?? "";
      if (!o || !f.owners.has(o)) return false;
    }
    if (f.flags.size) {
      const taskFlags = new Set(flagsFor(task, now));
      let any = false;
      for (const fl of f.flags) {
        if (taskFlags.has(fl)) {
          any = true;
          break;
        }
      }
      if (!any) return false;
    }
    if (!taskMatchesQuery(task, q)) return false;
    if (f.goal !== null && task.goal_id !== f.goal) return false;
    return true;
  });

  if (f.view === "list") {
    out = sortTasks(out, f);
  }
  return out;
}

/** True if Clear all should be shown (anything non-default vs filter defaults). */
export function hasActiveFilterState(f: Filters): boolean {
  const d = defaultFilters();
  if (f.view !== d.view) return true;
  if (hasActiveFilterCriteria(f)) return true;
  if (f.sort !== d.sort || f.sortDir !== d.sortDir) return true;
  return false;
}

/** True when actual task filter criteria are set, excluding view/sort UI state. */
export function hasActiveFilterCriteria(f: Filters): boolean {
  if (f.search.trim()) return true;
  if (f.categories.size || f.priorities.size || f.statuses.size || f.owners.size || f.flags.size)
    return true;
  if (f.goal !== null) return true;
  return false;
}

export function clearFilterCriteria(f: Filters): Filters {
  return {
    ...f,
    categories: new Set(),
    priorities: new Set(),
    statuses: new Set(),
    owners: new Set(),
    flags: new Set(),
    search: "",
    goal: null,
  };
}
