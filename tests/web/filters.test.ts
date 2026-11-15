import { describe, expect, test } from "vitest";
import {
  applyFilters,
  clearFilterCriteria,
  defaultFilters,
  hasActiveFilterCriteria,
  hasActiveFilterState,
  parseFilters,
  serializeFilters,
  type Filters,
} from "../../src/web/lib/utils/filters.js";
import type { DashboardTask } from "../../src/web/lib/types.js";

const NOW = new Date("2026-04-29T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
const future = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

function task(partial: Partial<DashboardTask> & Pick<DashboardTask, "id" | "title">): DashboardTask {
  return {
    id: partial.id,
    title: partial.title,
    description: partial.description ?? "",
    status: partial.status ?? "in_progress",
    priority: partial.priority === undefined ? "P1" : partial.priority,
    category: partial.category ?? "house",
    owner: partial.owner ?? null,
    due_date: partial.due_date ?? null,
    follow_up_date: partial.follow_up_date ?? null,
    snoozed_until: partial.snoozed_until ?? null,
    handoff_state: partial.handoff_state ?? "not_applicable",
    handoff_copied_at: partial.handoff_copied_at ?? null,
    handoff_last_copied_at: partial.handoff_last_copied_at ?? null,
    handoff_last_nudge_copied_at: partial.handoff_last_nudge_copied_at ?? null,
    goal_id: partial.goal_id ?? null,
    goal_title: partial.goal_title ?? null,
    needs_attention: partial.needs_attention ?? false,
    needs_attention_set_at: partial.needs_attention_set_at ?? null,
    needs_attention_reason: partial.needs_attention_reason ?? null,
    created_at: partial.created_at ?? day(30),
    updated_at: partial.updated_at ?? day(1),
    completed_at: partial.completed_at ?? null,
    attachment_count: partial.attachment_count ?? 0,
    hard_deadline: partial.hard_deadline ?? false,
    effort: partial.effort ?? null,
    queue_rank: partial.queue_rank ?? null,
    queue_rationale: partial.queue_rationale ?? null,
    queue_ranked_at: partial.queue_ranked_at ?? null,
  };
}

function expectFiltersRoundTrip(f: Filters): void {
  const again = parseFilters(serializeFilters(f));
  expect(again.view).toBe(f.view);
  expect([...again.categories].sort()).toEqual([...f.categories].sort());
  expect([...again.priorities].sort()).toEqual([...f.priorities].sort());
  expect([...again.statuses].sort()).toEqual([...f.statuses].sort());
  expect([...again.owners].sort()).toEqual([...f.owners].sort());
  expect([...again.flags].sort()).toEqual([...f.flags].sort());
  expect(again.search).toBe(f.search);
  expect(again.sort).toBe(f.sort);
  expect(again.sortDir).toBe(f.sortDir);
  expect(again.goal).toBe(f.goal);
}

describe("parseFilters / serializeFilters", () => {
  test("defaultFilters() round-trips through serialize → parse to itself", () => {
    const d = defaultFilters();
    expectFiltersRoundTrip(d);
    expect(serializeFilters(d).toString()).toBe("");
  });

  test("empty filter sets produce a URL with no extra params (list view default sort)", () => {
    const f: Filters = {
      ...defaultFilters(),
      view: "list",
    };
    expect(serializeFilters(f).toString()).toBe("view=list");
    expectFiltersRoundTrip(f);
  });

  test("unknown enum values in the URL are dropped, not errored", () => {
    const p = new URLSearchParams();
    p.append("category", "not-a-category");
    p.append("category", "product");
    p.set("priority", "P9");
    p.set("status", "floating");
    p.set("flag", "nope");
    p.set("sort", "banana");
    const f = parseFilters(p);
    expect([...f.categories]).toEqual(["product"]);
    expect(f.priorities.size).toBe(0);
    expect(f.statuses.size).toBe(0);
    expect(f.flags.size).toBe(0);
    expect(f.sort).toBe("updated");
  });

  test("view=kanban does not emit sort / sortDir even if non-default in object", () => {
    const f: Filters = {
      ...defaultFilters(),
      view: "kanban",
      sort: "due",
      sortDir: "asc",
    };
    const s = serializeFilters(f).toString();
    expect(s).not.toContain("sort");
    expect(s).not.toContain("sortDir");
  });

  test("repeated category keys round-trip", () => {
    const p = new URLSearchParams();
    p.append("category", "product");
    p.append("category", "house");
    const f = parseFilters(p);
    expect([...f.categories].sort()).toEqual(["house", "product"]);
    const again = serializeFilters(f);
    expect(again.getAll("category").sort()).toEqual(["house", "product"]);
  });
});

describe("legacy horizon URL params", () => {
  test("the removed until param is ignored on parse and never re-serialized", () => {
    const f = parseFilters(new URLSearchParams("until=week"));
    expect(hasActiveFilterState(f)).toBe(false);
    expect(serializeFilters(f).toString()).toBe("");
  });
});

describe("goal URL filter", () => {
  test("defaultFilters goal is null", () => {
    expect(defaultFilters().goal).toBeNull();
  });

  test("parseFilters reads well-formed goal", () => {
    expect(parseFilters(new URLSearchParams("goal=G-001")).goal).toBe("G-001");
  });

  test("parseFilters ignores malformed goal", () => {
    expect(parseFilters(new URLSearchParams("goal=foo")).goal).toBeNull();
  });

  test("serialize round-trip for goal", () => {
    const f: Filters = { ...defaultFilters(), goal: "G-001" };
    expect(serializeFilters(f).get("goal")).toBe("G-001");
    expect(serializeFilters({ ...f, goal: null }).has("goal")).toBe(false);
    expectFiltersRoundTrip(f);
  });

  test("applyFilters restricts by goal_id", () => {
    const a = task({ id: "KS-1", title: "a", goal_id: "G-001" });
    const b = task({ id: "KS-2", title: "b", goal_id: "G-002" });
    const base = defaultFilters();
    const out = applyFilters([a, b], { ...base, goal: "G-001" }, NOW);
    expect(out.map((t) => t.id)).toEqual(["KS-1"]);
  });

  test("applyFilters intersects goal with priority", () => {
    const a = task({ id: "KS-1", title: "a", goal_id: "G-001", priority: "P0" });
    const b = task({ id: "KS-2", title: "b", goal_id: "G-001", priority: "P1" });
    const c = task({ id: "KS-3", title: "c", goal_id: "G-002", priority: "P0" });
    const f: Filters = {
      ...defaultFilters(),
      goal: "G-001",
      priorities: new Set(["P0"] as const),
    };
    expect(applyFilters([a, b, c], f, NOW).map((t) => t.id)).toEqual(["KS-1"]);
  });

  test("hasActiveFilterState considers goal set", () => {
    expect(hasActiveFilterState({ ...defaultFilters(), goal: "G-001" })).toBe(true);
  });
});

describe("applyFilters", () => {
  test("honors AND across dimensions, OR within", () => {
    const t1 = task({
      id: "KS-1",
      title: "a",
      category: "product",
      priority: "P0",
      status: "in_progress",
    });
    const t2 = task({
      id: "KS-2",
      title: "b",
      category: "house",
      priority: "P0",
      status: "in_progress",
    });
    const t3 = task({
      id: "KS-3",
      title: "c",
      category: "product",
      priority: "P1",
      status: "in_progress",
    });
    const base = defaultFilters();
    const f: Filters = {
      ...base,
      categories: new Set(["product"]),
      priorities: new Set(["P0", "P1"] as const),
    };
    const out = applyFilters([t1, t2, t3], f, NOW);
    expect(out.map((t) => t.id).sort()).toEqual(["KS-1", "KS-3"]);
  });

  test("search matches title and description case-insensitively", () => {
    const t1 = task({ id: "KS-1", title: "Foo Task", description: "x" });
    const t2 = task({ id: "KS-2", title: "Other", description: "contains fOo bar" });
    const t3 = task({ id: "KS-3", title: "Nope", description: "nada" });
    const f: Filters = { ...defaultFilters(), search: "foo" };
    const out = applyFilters([t1, t2, t3], f, NOW);
    expect(out.map((t) => t.id).sort()).toEqual(["KS-1", "KS-2"]);
  });

  test("search matches task id case-insensitively", () => {
    const t1 = task({ id: "KS-202", title: "Stripe migration", description: "x" });
    const t2 = task({ id: "KS-205", title: "Headband warranty", description: "y" });
    const f: Filters = { ...defaultFilters(), search: "ks-202" };
    const out = applyFilters([t1, t2], f, NOW);
    expect(out.map((t) => t.id)).toEqual(["KS-202"]);
  });

  test("flags filter matches when flagsFor emits at least one requested flag", () => {
    const overdue = task({
      id: "KS-1",
      title: "overdue",
      status: "in_progress",
      due_date: day(1),
      updated_at: day(1),
    });
    const f: Filters = { ...defaultFilters(), flags: new Set(["overdue"] as const) };
    expect(applyFilters([overdue], f, NOW)).toHaveLength(1);
    const fresh = task({
      id: "KS-2",
      title: "ok",
      status: "in_progress",
      due_date: future(1),
      updated_at: day(1),
    });
    expect(applyFilters([fresh], f, NOW)).toHaveLength(0);
  });

  test("overdue flag filter keeps delegated tasks with past follow-up dates", () => {
    const delegatedFollowUp = task({
      id: "KS-3",
      title: "delegated follow-up",
      status: "in_progress",
      owner: "riley",
      due_date: future(5),
      follow_up_date: day(1),
      updated_at: day(1),
    });
    const f: Filters = { ...defaultFilters(), flags: new Set(["overdue"] as const) };

    expect(applyFilters([delegatedFollowUp], f, NOW).map((t) => t.id)).toEqual(["KS-3"]);
  });

  test("sort by due puts nulls last in asc and desc", () => {
    const withDue = task({
      id: "KS-d1",
      title: "d1",
      due_date: day(5),
      updated_at: day(1),
    });
    const withDue2 = task({
      id: "KS-d2",
      title: "d2",
      due_date: day(2),
      updated_at: day(1),
    });
    const noDue = task({
      id: "KS-x",
      title: "nodue",
      due_date: null,
      updated_at: day(1),
    });
    const baseList: Filters = {
      ...defaultFilters(),
      view: "list",
      sort: "due",
    };
    const asc = applyFilters([withDue, noDue, withDue2], { ...baseList, sortDir: "asc" }, NOW);
    expect(asc.map((t) => t.id)).toEqual(["KS-d1", "KS-d2", "KS-x"]);
    const desc = applyFilters([withDue, noDue, withDue2], { ...baseList, sortDir: "desc" }, NOW);
    expect(desc.map((t) => t.id)).toEqual(["KS-d2", "KS-d1", "KS-x"]);
  });

  test("sort by priority orders P0 → P3 → null in asc", () => {
    const p0 = task({ id: "a", title: "a", priority: "P0" });
    const p3 = task({ id: "b", title: "b", priority: "P3" });
    const pn = task({ id: "c", title: "c", priority: null });
    const f: Filters = {
      ...defaultFilters(),
      view: "list",
      sort: "priority",
      sortDir: "asc",
    };
    const out = applyFilters([pn, p3, p0], f, NOW);
    expect(out.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  test("sort by category uses the category label", () => {
    const house = task({ id: "a", title: "a", category: "house" });
    const client = task({ id: "b", title: "b", category: "client" });
    const trace = task({ id: "c", title: "c", category: "product" });
    const f: Filters = {
      ...defaultFilters(),
      view: "list",
      sort: "category",
      sortDir: "asc",
    };
    const out = applyFilters([trace, house, client], f, NOW);
    expect(out.map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  test("does not sort when view is kanban", () => {
    const a = task({ id: "KS-a", title: "a", updated_at: day(1) });
    const b = task({ id: "KS-b", title: "b", updated_at: day(10) });
    const f: Filters = {
      ...defaultFilters(),
      view: "kanban",
      sort: "updated",
      sortDir: "asc",
    };
    const out = applyFilters([a, b], f, NOW);
    expect(out.map((t) => t.id)).toEqual(["KS-a", "KS-b"]);
  });
});

describe("hasActiveFilterState", () => {
  test("default filters are inactive", () => {
    expect(hasActiveFilterState(defaultFilters())).toBe(false);
  });
  test("list view alone is active", () => {
    expect(hasActiveFilterState({ ...defaultFilters(), view: "list" })).toBe(true);
  });
});

describe("filter criteria controls", () => {
  test("active filter criteria excludes view and sort state", () => {
    expect(
      hasActiveFilterCriteria({
        ...defaultFilters(),
        view: "list",
        sort: "category",
        sortDir: "asc",
      }),
    ).toBe(false);
  });

  test("active filter criteria includes search, dropdown filters, and goal filter", () => {
    expect(hasActiveFilterCriteria({ ...defaultFilters(), search: "skill" })).toBe(true);
    expect(
      hasActiveFilterCriteria({
        ...defaultFilters(),
        priorities: new Set(["P0"] as const),
      }),
    ).toBe(true);
    expect(hasActiveFilterCriteria({ ...defaultFilters(), goal: "G-001" })).toBe(true);
  });

  test("clearFilterCriteria preserves view and sort but removes actual filters", () => {
    const f: Filters = {
      ...defaultFilters(),
      view: "list",
      sort: "category",
      sortDir: "asc",
      search: "skill",
      categories: new Set(["product"]),
      priorities: new Set(["P0"] as const),
      statuses: new Set(["in_progress"] as const),
      owners: new Set(["me"]),
      flags: new Set(["stale"] as const),
      goal: "G-001",
    };

    const cleared = clearFilterCriteria(f);

    expect(cleared.view).toBe("list");
    expect(cleared.sort).toBe("category");
    expect(cleared.sortDir).toBe("asc");
    expect(cleared.search).toBe("");
    expect(cleared.categories.size).toBe(0);
    expect(cleared.priorities.size).toBe(0);
    expect(cleared.statuses.size).toBe(0);
    expect(cleared.owners.size).toBe(0);
    expect(cleared.flags.size).toBe(0);
    expect(cleared.goal).toBeNull();
  });
});
