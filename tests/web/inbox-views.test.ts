import { describe, expect, it } from "vitest";
import {
  FOLLOW_UPS_VISIBLE,
  REVEAL_STEP,
  TASKS_VISIBLE,
  VIEW_ORDER,
  buildInboxCandidates,
  groupTasksForView,
} from "../../src/web/lib/utils/inbox-views.js";
import type { DashboardTask } from "../../src/web/lib/types.js";

// All fixture timestamps use 12:00Z so local-day banding is invariant to the
// host timezone (now and due dates shift local days together).
const now = new Date("2026-06-08T12:00:00.000Z");
const onDay = (isoDay: string) => `${isoDay}T12:00:00.000Z`;

function task(partial: Partial<DashboardTask> & Pick<DashboardTask, "id" | "title">): DashboardTask {
  return {
    description: "",
    status: "in_progress",
    priority: "P1",
    category: "house",
    owner: "me",
    due_date: null,
    follow_up_date: null,
    snoozed_until: null,
    handoff_state: "not_applicable",
    handoff_copied_at: null,
    handoff_last_copied_at: null,
    handoff_last_nudge_copied_at: null,
    goal_id: null,
    goal_title: null,
    needs_attention: false,
    needs_attention_set_at: null,
    needs_attention_reason: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    completed_at: null,
    attachment_count: 0,
    hard_deadline: false,
    effort: null,
    queue_rank: null,
    queue_rationale: null,
    queue_ranked_at: null,
    ...partial,
  };
}

function queued(id: string, title: string, rank: number, extra: Partial<DashboardTask> = {}): DashboardTask {
  return task({
    id,
    title,
    queue_rank: rank,
    queue_rationale: `because ${id}`,
    queue_ranked_at: now.toISOString(),
    ...extra,
  });
}

describe("view metadata constants", () => {
  it("VIEW_ORDER cycles agent → due → priority → updated → title", () => {
    expect([...VIEW_ORDER]).toEqual(["agent", "due", "priority", "updated", "title"]);
  });

  it("volume caps match the A15 constants", () => {
    expect(FOLLOW_UPS_VISIBLE).toBe(5);
    expect(TASKS_VISIBLE).toBe(10);
    expect(REVEAL_STEP).toBe(25);
  });
});

describe("buildInboxCandidates", () => {
  it("drops terminal rows leaked into activeTasks via ?closed=1", () => {
    const open = task({ id: "KS-1", title: "Open" });
    const staleDone = task({ id: "KS-2", title: "Old done", status: "done", completed_at: onDay("2026-01-05") });
    const cancelled = task({ id: "KS-3", title: "Cancelled", status: "cancelled" });

    const out = buildInboxCandidates([open, staleDone, cancelled], []);
    expect(out.map((t) => t.id)).toEqual(["KS-1"]);
  });

  it("appends recentlyDone after open tasks", () => {
    const open = task({ id: "KS-1", title: "Open" });
    const done = task({ id: "KS-2", title: "Done", status: "done", completed_at: now.toISOString() });

    const out = buildInboxCandidates([open], [done]);
    expect(out.map((t) => t.id)).toEqual(["KS-1", "KS-2"]);
  });

  it("dedupes by id with the recentlyDone copy winning", () => {
    const staleCopy = task({ id: "KS-1", title: "Stale active copy", status: "done", completed_at: null });
    const freshCopy = task({
      id: "KS-1",
      title: "Fresh done copy",
      status: "done",
      completed_at: now.toISOString(),
    });

    const out = buildInboxCandidates([staleCopy], [freshCopy]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("Fresh done copy");
    expect(out[0]!.completed_at).toBe(now.toISOString());
  });

  it("dedupes even when the activeTasks copy is still open", () => {
    const openCopy = task({ id: "KS-1", title: "Open copy" });
    const doneCopy = task({ id: "KS-1", title: "Done copy", status: "done", completed_at: now.toISOString() });

    const out = buildInboxCandidates([openCopy, task({ id: "KS-2", title: "Other" })], [doneCopy]);
    expect(out.map((t) => t.id).sort()).toEqual(["KS-1", "KS-2"]);
    expect(out.find((t) => t.id === "KS-1")!.title).toBe("Done copy");
  });
});

describe("groupTasksForView: agent", () => {
  it("puts queued tasks first by rank, the rest in engine order", () => {
    const q2 = queued("KS-2", "Second", 2);
    const q1 = queued("KS-1", "First", 1);
    const p3 = task({ id: "KS-3", title: "P3 loose", priority: "P3" });
    const p0 = task({ id: "KS-4", title: "P0 loose", priority: "P0" });

    const bands = groupTasksForView([p3, q2, p0, q1], "agent", now);
    expect(bands.map((b) => b.key)).toEqual(["queue", "not-queued"]);
    expect(bands[0]!.label).toBe("MY QUEUE");
    expect(bands[0]!.tasks.map((t) => t.id)).toEqual(["KS-1", "KS-2"]);
    expect(bands[1]!.label).toBe("IN YOUR LIST - NOT QUEUED");
    expect(bands[1]!.tasks.map((t) => t.id)).toEqual(["KS-4", "KS-3"]);
  });

  it("keeps an empty queue band when nothing is queued so the UI can explain the missing rank", () => {
    const a = task({ id: "KS-1", title: "A", priority: "P0" });
    const b = task({ id: "KS-2", title: "B", priority: "P2" });

    const bands = groupTasksForView([b, a], "agent", now);
    expect(bands.map((b2) => b2.key)).toEqual(["queue", "not-queued"]);
    expect(bands[0]!.tasks).toEqual([]);
    expect(bands[1]!.tasks.map((t) => t.id)).toEqual(["KS-1", "KS-2"]);
  });

  it("shows only the queue members present in the input (delegated queued task absent)", () => {
    // KS-2 was queued at #2 then delegated: it renders in Follow-ups, so the
    // own-tasks input never contains it. The band shows the remaining members.
    const q1 = queued("KS-1", "First", 1);
    const q3 = queued("KS-3", "Third", 3);

    const bands = groupTasksForView([q3, q1], "agent", now);
    expect(bands.map((b) => b.key)).toEqual(["queue"]);
    expect(bands[0]!.tasks.map((t) => t.id)).toEqual(["KS-1", "KS-3"]);
  });

  it("keeps a queued done task in its rank slot", () => {
    const q1 = queued("KS-1", "First", 1);
    const q2done = queued("KS-2", "Done second", 2, {
      status: "done",
      completed_at: now.toISOString(),
    });
    const q3 = queued("KS-3", "Third", 3);

    const bands = groupTasksForView([q3, q2done, q1], "agent", now);
    expect(bands[0]!.tasks.map((t) => t.id)).toEqual(["KS-1", "KS-2", "KS-3"]);
  });

  it("places non-queued done rows in the not-queued band", () => {
    const q1 = queued("KS-1", "First", 1);
    const doneLoose = task({
      id: "KS-2",
      title: "Done loose",
      status: "done",
      completed_at: now.toISOString(),
    });

    const bands = groupTasksForView([doneLoose, q1], "agent", now);
    expect(bands.map((b) => b.key)).toEqual(["queue", "not-queued"]);
    expect(bands[1]!.tasks.map((t) => t.id)).toEqual(["KS-2"]);
  });

  it("drops a future-snoozed task out of the queue band even with a stale rank", () => {
    // Legacy data: a task ranked before snooze-clears-rank shipped keeps its
    // queue_rank. A future snooze must still pull it out of MY QUEUE and sink it
    // to the bottom of the not-queued band (engine snoozes-last).
    const q1 = queued("KS-1", "First", 1);
    const snoozedRanked = queued("KS-2", "Snoozed but ranked", 2, {
      snoozed_until: onDay("2026-06-20"),
    });
    const loose = task({ id: "KS-3", title: "Loose", priority: "P2" });

    const bands = groupTasksForView([snoozedRanked, q1, loose], "agent", now);
    expect(bands.map((b) => b.key)).toEqual(["queue", "not-queued"]);
    expect(bands[0]!.tasks.map((t) => t.id)).toEqual(["KS-1"]);
    expect(bands[1]!.tasks.map((t) => t.id)).toEqual(["KS-3", "KS-2"]);
  });

  it("keeps an arrived-snooze ranked task in the queue band", () => {
    // Once the snooze elapses the task is eligible again; a rank that outlived
    // the snooze stays in the queue (only future snoozes are excluded).
    const q1 = queued("KS-1", "First", 1);
    const arrived = queued("KS-2", "Snooze elapsed", 2, {
      snoozed_until: onDay("2026-06-06"),
    });

    const bands = groupTasksForView([arrived, q1], "agent", now);
    expect(bands.map((b) => b.key)).toEqual(["queue"]);
    expect(bands[0]!.tasks.map((t) => t.id)).toEqual(["KS-1", "KS-2"]);
  });

  it("returns no bands for empty input", () => {
    expect(groupTasksForView([], "agent", now)).toEqual([]);
  });
});

describe("groupTasksForView: due", () => {
  it("bands by local day: overdue, today, this week, after this week", () => {
    const overdue = task({ id: "KS-1", title: "Overdue", due_date: onDay("2026-06-06") });
    const today = task({ id: "KS-2", title: "Today", due_date: onDay("2026-06-08") });
    const thisWeek = task({ id: "KS-3", title: "This week", due_date: onDay("2026-06-12") });
    const weekEdge = task({ id: "KS-4", title: "Week edge (+7d)", due_date: onDay("2026-06-15") });
    const later = task({ id: "KS-5", title: "Later", due_date: onDay("2026-06-20") });

    const bands = groupTasksForView([later, weekEdge, thisWeek, today, overdue], "due", now);
    expect(bands.map((b) => ({ key: b.key, ids: b.tasks.map((t) => t.id) }))).toEqual([
      { key: "overdue", ids: ["KS-1"] },
      { key: "today", ids: ["KS-2"] },
      { key: "week", ids: ["KS-3", "KS-4"] },
      { key: "later", ids: ["KS-5"] },
    ]);
    expect(bands.map((b) => b.label)).toEqual([
      "OVERDUE",
      "DUE TODAY",
      "DUE THIS WEEK",
      "AFTER THIS WEEK",
    ]);
  });

  it("omits empty bands and renders No due date only when null-due tasks exist", () => {
    const today = task({ id: "KS-1", title: "Today", due_date: onDay("2026-06-08") });
    expect(groupTasksForView([today], "due", now).map((b) => b.key)).toEqual(["today"]);

    const legacy = task({ id: "KS-2", title: "Legacy no due", due_date: null });
    const bands = groupTasksForView([today, legacy], "due", now);
    expect(bands.map((b) => b.key)).toEqual(["today", "no-due"]);
    expect(bands[1]!.label).toBe("NO DUE DATE");
    expect(bands[1]!.tasks.map((t) => t.id)).toEqual(["KS-2"]);
  });

  it("sorts within a band by due date ascending", () => {
    const farOverdue = task({ id: "KS-1", title: "Far overdue", due_date: onDay("2026-06-01"), priority: "P3" });
    const nearOverdue = task({ id: "KS-2", title: "Near overdue", due_date: onDay("2026-06-07"), priority: "P0" });

    const bands = groupTasksForView([nearOverdue, farOverdue], "due", now);
    expect(bands[0]!.tasks.map((t) => t.id)).toEqual(["KS-1", "KS-2"]);
  });

  it("keeps queued tasks in their due band (no queue-on-top outside agent view)", () => {
    const queuedLater = queued("KS-1", "Queued but later", 1, { due_date: onDay("2026-06-20") });
    const looseToday = task({ id: "KS-2", title: "Loose today", due_date: onDay("2026-06-08") });

    const bands = groupTasksForView([queuedLater, looseToday], "due", now);
    expect(bands.map((b) => ({ key: b.key, ids: b.tasks.map((t) => t.id) }))).toEqual([
      { key: "today", ids: ["KS-2"] },
      { key: "later", ids: ["KS-1"] },
    ]);
  });
});

describe("groupTasksForView: priority", () => {
  it("bands P0..P3 then No priority, omitting empty tiers", () => {
    const p0 = task({ id: "KS-1", title: "Critical", priority: "P0" });
    const p2 = task({ id: "KS-2", title: "Normal", priority: "P2" });
    const untriaged = task({ id: "KS-3", title: "Untriaged", priority: null });

    const bands = groupTasksForView([untriaged, p2, p0], "priority", now);
    expect(bands.map((b) => ({ key: b.key, label: b.label, ids: b.tasks.map((t) => t.id) }))).toEqual([
      { key: "p0", label: "P0", ids: ["KS-1"] },
      { key: "p2", label: "P2", ids: ["KS-2"] },
      { key: "no-priority", label: "NO PRIORITY", ids: ["KS-3"] },
    ]);
  });

  it("orders within a tier by engine order (due date breaks the tie)", () => {
    const dueLater = task({ id: "KS-1", title: "Due later", priority: "P1", due_date: onDay("2026-06-20") });
    const dueSoon = task({ id: "KS-2", title: "Due soon", priority: "P1", due_date: onDay("2026-06-09") });

    const bands = groupTasksForView([dueLater, dueSoon], "priority", now);
    expect(bands[0]!.tasks.map((t) => t.id)).toEqual(["KS-2", "KS-1"]);
  });
});

describe("groupTasksForView: updated", () => {
  it("returns one band sorted by updated_at descending", () => {
    const older = task({ id: "KS-1", title: "Older", updated_at: onDay("2026-06-05") });
    const newest = task({ id: "KS-2", title: "Newest", updated_at: onDay("2026-06-08") });
    const middle = task({ id: "KS-3", title: "Middle", updated_at: onDay("2026-06-07") });

    const bands = groupTasksForView([older, newest, middle], "updated", now);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.key).toBe("all");
    expect(bands[0]!.tasks.map((t) => t.id)).toEqual(["KS-2", "KS-3", "KS-1"]);
  });

  it("bubbles a just-completed done task to the top (completion updates updated_at)", () => {
    const open = task({ id: "KS-1", title: "Open", updated_at: onDay("2026-06-07") });
    const justDone = task({
      id: "KS-2",
      title: "Just done",
      status: "done",
      updated_at: onDay("2026-06-08"),
      completed_at: onDay("2026-06-08"),
    });

    const bands = groupTasksForView([open, justDone], "updated", now);
    expect(bands[0]!.tasks.map((t) => t.id)).toEqual(["KS-2", "KS-1"]);
  });
});

describe("groupTasksForView: title", () => {
  it("returns one band sorted alphabetically, case-insensitive, id tiebreak", () => {
    const b = task({ id: "KS-1", title: "banana" });
    const a = task({ id: "KS-2", title: "Apple" });
    const dupe2 = task({ id: "KS-4", title: "Cherry" });
    const dupe1 = task({ id: "KS-3", title: "cherry" });

    const bands = groupTasksForView([b, dupe2, a, dupe1], "title", now);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.tasks.map((t) => t.id)).toEqual(["KS-2", "KS-1", "KS-3", "KS-4"]);
  });

  it("keeps queue ranks irrelevant to ordering (queued tasks sit at their alpha position)", () => {
    const queuedZebra = queued("KS-1", "Zebra task", 1);
    const looseAlpha = task({ id: "KS-2", title: "Alpha task" });

    const bands = groupTasksForView([queuedZebra, looseAlpha], "title", now);
    expect(bands[0]!.tasks.map((t) => t.id)).toEqual(["KS-2", "KS-1"]);
  });
});
