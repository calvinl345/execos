/**
 * `daily review` command family per AC-009 / AC-010 / AC-011 / AC-012.
 *
 * Subcommands:
 *   next     Top-prioritized eligible task with one-line reasoning.
 *   morning  Top-5 eligible tasks with reasoning, plus active quarterly
 *            goals, Needs Attention list, and Calendar enrichment slot
 *            (populated once the Calendar integration is configured).
 *   eod      Today's closeout: tasks completed today, status changes,
 *            tasks newly stalled, tomorrow's projected top 3.
 *   weekly   Weekly review: tasks shipped this week, tasks at risk,
 *            goal-level summary, next week's focus suggestions.
 *   refresh-attention
 *            Curates the dashboard Needs Attention panel from current
 *            daily priorities.
 *
 * The next / morning / eod / weekly review views are read-only. The
 * refresh-attention subcommand updates only task attention fields; it
 * never mutates task_notes. Append-only enforcement is verified by
 * tests/db/append-only-scan.test.ts.
 *
 * Settings are resolved once via loadSettings() at command start for
 * review-specific thresholds. Ranking itself is settings-free.
 */

import { Command } from "commander";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  goals,
  taskActivities,
  tasks,
} from "../../db/index.js";
import {
  flagAttentionOperation,
  unflagAttentionOperation,
} from "../../services/task-curation-operations.js";
import {
  isOverdue,
  isStale,
  type TaskInput,
  type TaskReasons,
} from "../../domain/prioritization.js";
import {
  getHostTimeZone,
  utcFromLocalInTimeZone,
  wallClockComponents,
} from "../../domain/dates.js";
import { loadSettings } from "../settings-loader.js";
import { ctxFromProgram } from "../index-shared.js";
import { emit, type FormatterContext } from "../output-formatters/index.js";
import {
  TaskCategorySchema,
  TaskPrioritySchema,
  TaskStatusSchema,
} from "../../domain/validation.js";
import {
  rankEligible,
  type RankedRow,
  type ReviewTaskDetail,
} from "./rank-eligible.js";
import {
  EXIT_OK,
  EXIT_GENERIC,
  EXIT_INPUT_VALIDATION,
  EXIT_APP_SETTING_MISSING,
  InputValidationError,
} from "../errors.js";

// ---------------------------------------------------------------------------
// Calendar enrichment placeholder. The Calendar integration replaces this
// constant at the call site once it is configured in `.mcp.json`.
// ---------------------------------------------------------------------------

const CALENDAR_NOT_CONFIGURED = {
  status: "not_configured" as const,
  reason:
    "Calendar enrichment is not configured. Configure the Calendar integration in .mcp.json to enable schedule-aware prioritization.",
};

const NEEDS_ATTENTION_LIMIT = 10;
const ATTENTION_REFRESH_DEFAULT_LIMIT = 3;
const NEXT_WEEK_FOCUS_LIMIT = 5;
const TOMORROW_TOP_LIMIT = 3;
const NEEDS_ATTENTION_ELIGIBLE_STATUSES = [
  "triage",
  "backlog",
  "in_progress",
  "blocked",
  "review",
] as const;

// ---------------------------------------------------------------------------
// Registration.
// ---------------------------------------------------------------------------

export function registerReviewCommand(program: Command): void {
  const review = program
    .command("review")
    .description("Review and prioritization workflows");

  review
    .command("next")
    .description("Top-prioritized eligible task with reasoning")
    .action(async () => {
      await runNext(program);
    });

  review
    .command("morning")
    .description(
      "Morning review: top-5 prioritized tasks, active goals, Needs Attention",
    )
    .action(async () => {
      await runMorning(program);
    });

  review
    .command("refresh-attention")
    .description("Refresh dashboard Needs Attention from daily priorities")
    .option(
      "--limit <n>",
      "Number of tasks to keep flagged for attention (1-10)",
      String(ATTENTION_REFRESH_DEFAULT_LIMIT),
    )
    .action(async (opts) => {
      await runRefreshAttention(program, opts);
    });

  review
    .command("eod")
    .description(
      "EOD closeout: completed today, status changes, newly stalled, tomorrow's top 3",
    )
    .action(async () => {
      await runEod(program);
    });

  review
    .command("weekly")
    .description(
      "Weekly review: shipped, at risk, goal summary, next week's focus",
    )
    .action(async () => {
      await runWeekly(program);
    });
}

function rankedRowJson(row: RankedRow): {
  taskId: string;
  title: string;
  reasons: TaskReasons;
  task: ReviewTaskDetail;
} {
  return {
    taskId: row.ranking.taskId,
    title: row.title,
    reasons: row.ranking.reasons,
    task: row.task,
  };
}

// ---------------------------------------------------------------------------
// review next
// ---------------------------------------------------------------------------

async function runNext(program: Command): Promise<void> {
  const ctx = ctxFromProgram(program);
  const now = new Date();
  const settingsResult = await loadSettings();
  emitWarnings(ctx, settingsResult.warnings);
  const { ranked, evaluated } = await rankEligible(now);

  const top = ranked[0] ?? null;
  emit(ctx, {
    text: () => renderNextText(top, evaluated),
    json: () =>
      top === null
        ? { ok: true, top: null, evaluated }
        : {
            ok: true,
            top: rankedRowJson(top),
            evaluated,
          },
  });
}

// ---------------------------------------------------------------------------
// review morning
// ---------------------------------------------------------------------------

interface ActiveGoal {
  id: string;
  title: string;
  quarter: string;
}

interface NeedsAttentionRow {
  id: string;
  title: string;
  description: string;
  needsAttentionSetAt: Date | null;
  needsAttentionReason: string | null;
}

async function fetchActiveGoals(): Promise<ActiveGoal[]> {
  const rows = await db
    .select({
      id: goals.id,
      title: goals.title,
      quarter: goals.quarter,
    })
    .from(goals)
    .where(eq(goals.status, "active"))
    .orderBy(asc(goals.quarter), asc(goals.id));
  return rows;
}

async function fetchNeedsAttention(
  limit: number | undefined = NEEDS_ATTENTION_LIMIT,
): Promise<NeedsAttentionRow[]> {
  const baseQuery = db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      needsAttentionSetAt: tasks.needsAttentionSetAt,
      needsAttentionReason: tasks.needsAttentionReason,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.needsAttention, true),
        inArray(tasks.status, [...NEEDS_ATTENTION_ELIGIBLE_STATUSES]),
      ),
    )
    .orderBy(desc(tasks.needsAttentionSetAt));

  return limit === undefined ? await baseQuery : await baseQuery.limit(limit);
}

interface RefreshAttentionOpts {
  limit?: string;
}

interface RefreshAttentionSelected {
  taskId: string;
  title: string;
  task: ReviewTaskDetail;
  reasons: TaskReasons;
  reason: string;
  action: "flagged" | "kept";
}

interface RefreshAttentionCleared {
  taskId: string;
  title: string;
  previousReason: string | null;
}

async function runRefreshAttention(
  program: Command,
  opts: RefreshAttentionOpts,
): Promise<void> {
  const ctx = ctxFromProgram(program);
  const now = new Date();
  const settingsResult = await loadSettings();
  emitWarnings(ctx, settingsResult.warnings);

  const limit = parseAttentionRefreshLimit(opts.limit);
  const { ranked, evaluated } = await rankEligible(now);
  const selectedRanked = ranked.slice(0, limit);
  const selectedIds = new Set(selectedRanked.map((r) => r.ranking.taskId));
  const currentNeedsAttention = await fetchNeedsAttention(undefined);
  const currentById = new Map(currentNeedsAttention.map((r) => [r.id, r]));

  const cleared: RefreshAttentionCleared[] = [];
  for (const current of currentNeedsAttention) {
    await unflagAttentionOperation({ taskId: current.id, silent: true });
    if (selectedIds.has(current.id)) continue;
    cleared.push({
      taskId: current.id,
      title: current.title,
      previousReason: current.needsAttentionReason,
    });
  }

  const selected: RefreshAttentionSelected[] = [];
  for (const r of [...selectedRanked].reverse()) {
    const reason = attentionReasonFor(r);
    await flagAttentionOperation({
      taskId: r.ranking.taskId,
      reason,
      silent: true,
    });
    selected.unshift({
      taskId: r.ranking.taskId,
      title: r.title,
      task: r.task,
      reasons: r.ranking.reasons,
      reason,
      action: currentById.has(r.ranking.taskId) ? "kept" : "flagged",
    });
  }

  emit(ctx, {
    text: () =>
      renderRefreshAttentionText({
        evaluated,
        selected,
        cleared,
      }),
    json: () => ({
      ok: true,
      generatedAt: now.toISOString(),
      evaluated,
      selected,
      cleared,
    }),
  });
}

async function runMorning(program: Command): Promise<void> {
  const ctx = ctxFromProgram(program);
  const now = new Date();
  const settingsResult = await loadSettings();
  emitWarnings(ctx, settingsResult.warnings);

  const { ranked, evaluated } = await rankEligible(now);
  const top5 = ranked.slice(0, 5);
  const activeGoals = await fetchActiveGoals();
  const needsAttention = await fetchNeedsAttention();

  emit(ctx, {
    text: () =>
      renderMorningText(top5, evaluated, activeGoals, needsAttention),
    json: () => ({
      ok: true,
      generatedAt: now.toISOString(),
      evaluated,
      top: top5.map(rankedRowJson),
      activeGoals,
      needsAttention: needsAttention.map((r) => ({
        taskId: r.id,
        title: r.title,
        description: r.description,
        needsAttentionSetAt:
          r.needsAttentionSetAt === null
            ? null
            : r.needsAttentionSetAt.toISOString(),
        reason: r.needsAttentionReason,
      })),
      calendar: CALENDAR_NOT_CONFIGURED,
    }),
  });
}

// ---------------------------------------------------------------------------
// status change activity helpers (shared by eod / weekly).
// ---------------------------------------------------------------------------

interface StatusChangeNote {
  taskId: string;
  title: string;
  description: string;
  fromStatus: string;
  toStatus: string;
  createdAt: Date;
}

interface TaskStatusArc {
  taskId: string;
  title: string;
  description: string;
  statusChain: string[];
}

async function fetchStatusChanges(
  startUtc: Date,
  endUtc: Date,
): Promise<StatusChangeNote[]> {
  const rows = await db
    .select({
      taskId: taskActivities.taskId,
      payload: taskActivities.payload,
      createdAt: taskActivities.occurredAt,
      title: tasks.title,
      description: tasks.description,
    })
    .from(taskActivities)
    .innerJoin(tasks, eq(tasks.id, taskActivities.taskId))
    .where(
      and(
        eq(taskActivities.eventType, "task_status_changed"),
        gte(taskActivities.occurredAt, startUtc),
        lt(taskActivities.occurredAt, endUtc),
      ),
    )
    .orderBy(asc(taskActivities.occurredAt));

  return rows.map((r) => ({
    taskId: r.taskId,
    title: r.title,
    description: r.description,
    ...parseStatusChangePayload(r.payload),
    createdAt: r.createdAt,
  }));
}

function parseStatusChangePayload(payload: Record<string, unknown>): {
  fromStatus: string;
  toStatus: string;
} {
  const fromStatus = typeof payload.from_status === "string" ? payload.from_status : "?";
  const toStatus = typeof payload.to_status === "string" ? payload.to_status : "?";
  return { fromStatus, toStatus };
}

function groupByTask(notes: StatusChangeNote[]): TaskStatusArc[] {
  // Notes arrive in ascending created_at order. The first note in a
  // task's arc contributes both `from` and `to`; subsequent notes only
  // contribute `to` so the chain reads as `triage -> in_progress -> done`.
  const byId = new Map<string, TaskStatusArc>();
  for (const n of notes) {
    const arc = byId.get(n.taskId) ?? {
      taskId: n.taskId,
      title: n.title,
      description: n.description,
      statusChain: [],
    };
    if (arc.statusChain.length === 0) {
      arc.statusChain.push(n.fromStatus, n.toStatus);
    } else {
      arc.statusChain.push(n.toStatus);
    }
    byId.set(n.taskId, arc);
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0,
  );
}

// ---------------------------------------------------------------------------
// review eod
// ---------------------------------------------------------------------------

interface CompletedTaskRow {
  taskId: string;
  title: string;
  description: string;
  completedAt: Date | null;
}

async function fetchCompletedInWindow(
  startUtc: Date,
  endUtc: Date,
): Promise<CompletedTaskRow[]> {
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.status, "done"),
        gte(tasks.completedAt, startUtc),
        lt(tasks.completedAt, endUtc),
      ),
    )
    .orderBy(asc(tasks.completedAt));
  return rows.map((r) => ({
    taskId: r.id,
    title: r.title,
    description: r.description,
    completedAt: r.completedAt,
  }));
}

interface NewlyStalledRow {
  taskId: string;
  title: string;
  description: string;
  status: string;
  updatedAt: Date;
  daysSinceUpdate: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Pure predicate: a task is "newly stalled" if it is in a non-terminal
 * status AND its updatedAt has crossed the staleness threshold within
 * the last `thresholdDays` days. That is, days_since_update is in the
 * half-open window [thresholdDays, 2 * thresholdDays). This captures
 * tasks that just crossed the staleness threshold without also
 * surfacing tasks that have been stale for many cycles.
 *
 * The threshold value comes from
 * `Settings.needs_attention.staleness_days_threshold`. It is a separate
 * tunable from `Settings.prioritization.staleness.days_per_penalty`
 * (which governs the prioritization formula's scoring penalty). The
 * two are independent so the operator can tune the EOD review's
 * "newly stalled" surface without affecting prioritization scoring.
 */
export function isNewlyStalled(
  updatedAt: Date,
  referenceTime: Date,
  thresholdDays: number,
): boolean {
  if (thresholdDays <= 0) return false;
  const ms = referenceTime.getTime() - updatedAt.getTime();
  if (ms < 0) return false;
  const days = Math.floor(ms / MS_PER_DAY);
  return days >= thresholdDays && days < 2 * thresholdDays;
}

const NON_TERMINAL_STATUSES = [
  "triage",
  "backlog",
  "in_progress",
  "blocked",
  "review",
] as const;

async function fetchNewlyStalled(
  referenceTime: Date,
  thresholdDays: number,
): Promise<NewlyStalledRow[]> {
  if (thresholdDays <= 0) return [];
  const newCutoff = new Date(
    referenceTime.getTime() - thresholdDays * MS_PER_DAY,
  );
  const oldCutoff = new Date(
    referenceTime.getTime() - 2 * thresholdDays * MS_PER_DAY,
  );
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .where(
      and(
        inArray(tasks.status, [...NON_TERMINAL_STATUSES]),
        lt(tasks.updatedAt, newCutoff),
        gte(tasks.updatedAt, oldCutoff),
      ),
    )
    .orderBy(asc(tasks.updatedAt));
  return rows.map((r) => ({
    taskId: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    updatedAt: r.updatedAt,
    daysSinceUpdate: Math.floor(
      (referenceTime.getTime() - r.updatedAt.getTime()) / MS_PER_DAY,
    ),
  }));
}

async function runEod(program: Command): Promise<void> {
  const ctx = ctxFromProgram(program);
  const now = new Date();
  const tz = getHostTimeZone();
  const wc = wallClockComponents(now, tz);
  const startUtc = utcFromLocalInTimeZone(
    wc.year,
    wc.month,
    wc.day,
    0,
    0,
    tz,
  );
  const endUtc = addLocalDays(now, tz, 1);

  const settingsResult = await loadSettings();
  emitWarnings(ctx, settingsResult.warnings);
  // Newly-stalled threshold is independent of the prioritization
  // formula's staleness penalty cadence. Operators tune them separately.
  const stalenessThreshold =
    settingsResult.settings.needs_attention.staleness_days_threshold;

  const notes = await fetchStatusChanges(startUtc, endUtc);
  const items = groupByTask(notes);
  const completedToday = await fetchCompletedInWindow(startUtc, endUtc);
  const newlyStalled = await fetchNewlyStalled(now, stalenessThreshold);

  // Tomorrow's top 3 is a forward-looking projection: re-rank the
  // current eligible set with referenceTime set to tomorrow's start.
  // It shows what the prioritization formula will surface tomorrow
  // morning given today's task state.
  const { ranked: tomorrowRanked } = await rankEligible(endUtc);
  const tomorrowTop = tomorrowRanked.slice(0, TOMORROW_TOP_LIMIT);

  const dateKey = formatDateKey(wc.year, wc.month, wc.day);

  emit(ctx, {
    text: () =>
      renderEodText({
        dateKey,
        tz,
        items,
        completedToday,
        newlyStalled,
        tomorrowTop,
      }),
    json: () => ({
      ok: true,
      scope: "eod",
      timeZone: tz,
      date: dateKey,
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
      changedTaskCount: items.length,
      items,
      completedToday: completedToday.map((r) => ({
        taskId: r.taskId,
        title: r.title,
        description: r.description,
        completedAt:
          r.completedAt === null ? null : r.completedAt.toISOString(),
      })),
      newlyStalled: newlyStalled.map((r) => ({
        taskId: r.taskId,
        title: r.title,
        description: r.description,
        status: r.status,
        updatedAt: r.updatedAt.toISOString(),
        daysSinceUpdate: r.daysSinceUpdate,
      })),
      tomorrowTop: tomorrowTop.map(rankedRowJson),
      tomorrowProjectionReferenceTime: endUtc.toISOString(),
    }),
  });
}

// ---------------------------------------------------------------------------
// review weekly
// ---------------------------------------------------------------------------

interface AtRiskRow {
  taskId: string;
  title: string;
  task: ReviewTaskDetail;
  reason: "overdue" | "stale" | "overdue+stale";
}

/**
 * Pure predicate: a task is "at risk" when it is overdue or stale.
 */
export function atRisk(
  task: TaskInput,
  stalenessThresholdDays: number,
  referenceTime: Date,
): { atRisk: true; reason: AtRiskRow["reason"] } | { atRisk: false } {
  const overdue = isOverdue(task, referenceTime);
  const stale = isStale(task.updatedAt, referenceTime, stalenessThresholdDays);
  if (overdue && stale) return { atRisk: true, reason: "overdue+stale" };
  if (overdue) return { atRisk: true, reason: "overdue" };
  if (stale) return { atRisk: true, reason: "stale" };
  return { atRisk: false };
}

interface GoalSummaryRow {
  goalId: string;
  title: string;
  quarter: string;
  advanced: number;
  stalled: number;
  totalLinked: number;
}

/**
 * Pure helper: for a set of active goals + a list of all their linked
 * tasks (status + completedAt + last status_change in window), counts
 * how many advanced this week (status='done' AND completedAt in window,
 * OR a status_change note for the task in the window) versus how many
 * are stalled (no status change in window AND status not done).
 *
 * The wiring layer fetches the inputs; this function is pure for ease
 * of testing.
 */
export function summarizeGoals(
  activeGoals: Array<{ id: string; title: string; quarter: string }>,
  linkedTasks: Array<{
    taskId: string;
    goalId: string;
    status: string;
    completedAt: Date | null;
  }>,
  changedTaskIdsInWindow: ReadonlySet<string>,
  windowStartUtc: Date,
  windowEndUtc: Date,
): GoalSummaryRow[] {
  const byGoalId = new Map<string, GoalSummaryRow>();
  for (const g of activeGoals) {
    byGoalId.set(g.id, {
      goalId: g.id,
      title: g.title,
      quarter: g.quarter,
      advanced: 0,
      stalled: 0,
      totalLinked: 0,
    });
  }
  for (const t of linkedTasks) {
    const row = byGoalId.get(t.goalId);
    if (row === undefined) continue;
    row.totalLinked += 1;
    const completedInWindow =
      t.status === "done" &&
      t.completedAt !== null &&
      t.completedAt.getTime() >= windowStartUtc.getTime() &&
      t.completedAt.getTime() < windowEndUtc.getTime();
    const movedInWindow = changedTaskIdsInWindow.has(t.taskId);
    if (completedInWindow || movedInWindow) {
      row.advanced += 1;
    } else if (t.status !== "done" && t.status !== "cancelled") {
      row.stalled += 1;
    }
  }
  return Array.from(byGoalId.values()).sort((a, b) =>
    a.goalId < b.goalId ? -1 : a.goalId > b.goalId ? 1 : 0,
  );
}

async function fetchTasksLinkedToGoals(
  goalIds: string[],
): Promise<
  Array<{
    taskId: string;
    goalId: string;
    status: string;
    completedAt: Date | null;
  }>
> {
  if (goalIds.length === 0) return [];
  const rows = await db
    .select({
      id: tasks.id,
      goalId: tasks.goalId,
      status: tasks.status,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(inArray(tasks.goalId, goalIds));
  return rows
    .filter((r): r is typeof r & { goalId: string } => r.goalId !== null)
    .map((r) => ({
      taskId: r.id,
      goalId: r.goalId,
      status: r.status,
      completedAt: r.completedAt,
    }));
}

async function runWeekly(program: Command): Promise<void> {
  const ctx = ctxFromProgram(program);
  const now = new Date();
  const tz = getHostTimeZone();
  const wc = wallClockComponents(now, tz);
  // weekday: 0=Sunday..6=Saturday. Days since this week's Monday:
  //   Mon -> 0, Tue -> 1, ..., Sun -> 6.
  const daysFromMonday = (wc.weekday + 6) % 7;
  const startUtc = addLocalDays(now, tz, -daysFromMonday);
  const endUtc = addLocalDays(now, tz, 7 - daysFromMonday);

  const settingsResult = await loadSettings();
  emitWarnings(ctx, settingsResult.warnings);
  const stalenessThreshold =
    settingsResult.settings.needs_attention.staleness_days_threshold;

  const notes = await fetchStatusChanges(startUtc, endUtc);
  const items = groupByTask(notes);
  const changedTaskIds = new Set(items.map((it) => it.taskId));

  const shippedThisWeek = await fetchCompletedInWindow(startUtc, endUtc);

  // At risk: eligible tasks where overdue or staleness fires.
  const { ranked: rankedNow } = await rankEligible(now);
  const atRiskRows: AtRiskRow[] = [];
  for (const r of rankedNow) {
    const result = atRisk(r.taskInput, stalenessThreshold, now);
    if (!result.atRisk) continue;
    atRiskRows.push({
      taskId: r.ranking.taskId,
      title: r.title,
      task: r.task,
      reason: result.reason,
    });
  }

  // Goal-level summary across all active goals that have linked tasks.
  const activeGoals = await fetchActiveGoals();
  const linkedTasks = await fetchTasksLinkedToGoals(
    activeGoals.map((g) => g.id),
  );
  const goalSummary = summarizeGoals(
    activeGoals,
    linkedTasks,
    changedTaskIds,
    startUtc,
    endUtc,
  );

  // Next-week focus: forward-looking projection using next Monday 00:00.
  const { ranked: nextWeekRanked } = await rankEligible(endUtc);
  const nextWeekFocus = nextWeekRanked.slice(0, NEXT_WEEK_FOCUS_LIMIT);

  const startDateKey = startUtc.toISOString().slice(0, 10);
  const endDateKey = endUtc.toISOString().slice(0, 10);

  emit(ctx, {
    text: () =>
      renderWeeklyText({
        startDateKey,
        endDateKey,
        tz,
        items,
        shippedThisWeek,
        atRisk: atRiskRows,
        goalSummary,
        nextWeekFocus,
      }),
    json: () => ({
      ok: true,
      scope: "weekly",
      timeZone: tz,
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
      changedTaskCount: items.length,
      items,
      shippedThisWeek: shippedThisWeek.map((r) => ({
        taskId: r.taskId,
        title: r.title,
        description: r.description,
        completedAt:
          r.completedAt === null ? null : r.completedAt.toISOString(),
      })),
      atRisk: atRiskRows,
      goalSummary,
      nextWeekFocus: nextWeekFocus.map(rankedRowJson),
      nextWeekProjectionReferenceTime: endUtc.toISOString(),
    }),
  });
}

// ---------------------------------------------------------------------------
// Local-day helper. DST-safe per the noon-shift convention used in
// `addDaysInTz` inside src/domain/dates.ts.
// ---------------------------------------------------------------------------

function addLocalDays(reference: Date, tz: string, delta: number): Date {
  const wc = wallClockComponents(reference, tz);
  const startToday = utcFromLocalInTimeZone(
    wc.year,
    wc.month,
    wc.day,
    0,
    0,
    tz,
  );
  // Shift via local noon to avoid DST 1-hour discontinuities crossing
  // midnight when delta != 0.
  const noonUtc = new Date(startToday.getTime() + 12 * 3_600_000);
  const shifted = new Date(noonUtc.getTime() + delta * 86_400_000);
  const w2 = wallClockComponents(shifted, tz);
  return utcFromLocalInTimeZone(w2.year, w2.month, w2.day, 0, 0, tz);
}

function formatDateKey(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseAttentionRefreshLimit(raw: string | undefined): number {
  const n =
    raw === undefined || raw.trim() === ""
      ? ATTENTION_REFRESH_DEFAULT_LIMIT
      : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > NEEDS_ATTENTION_LIMIT) {
    throw new InputValidationError(
      `--limit must be an integer from 1 to ${NEEDS_ATTENTION_LIMIT}.`,
    );
  }
  return n;
}

function attentionReasonFor(row: RankedRow): string {
  const reasons = formatReasons(row.ranking.reasons);
  const reason =
    reasons.length > 0 ? `daily focus: ${reasons}` : "daily focus";
  return reason.length <= 200 ? reason : reason.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Output rendering.
// ---------------------------------------------------------------------------

function emitWarnings(ctx: FormatterContext, warnings: string[]): void {
  for (const w of warnings) ctx.err(`warning: ${w}\n`);
}

function renderNextText(top: RankedRow | null, evaluated: number): string {
  if (top === null) {
    return `(no eligible tasks; evaluated ${evaluated})`;
  }
  const reasons = formatReasons(top.ranking.reasons);
  return [
    `${top.ranking.taskId}  ${top.title}`,
    `  reasoning: ${reasons.length > 0 ? reasons : "(no ranking reasons)"}`,
  ].join("\n");
}

function renderMorningText(
  top5: RankedRow[],
  evaluated: number,
  activeGoals: ActiveGoal[],
  needsAttention: NeedsAttentionRow[],
): string {
  const lines: string[] = [];
  lines.push(`Morning review  (evaluated ${evaluated} eligible tasks)`);
  lines.push(`Calendar: not configured`);
  lines.push("");
  lines.push("Active quarterly goals:");
  if (activeGoals.length === 0) {
    lines.push("  (none)");
  } else {
    for (const g of activeGoals) {
      lines.push(`  ${g.id}  [${g.quarter}]  ${g.title}`);
    }
  }
  lines.push("");
  lines.push("Needs Attention:");
  if (needsAttention.length === 0) {
    lines.push("  (none)");
  } else {
    for (const t of needsAttention) {
      const reason = t.needsAttentionReason ?? "(no reason)";
      lines.push(`  ${t.id}  ${t.title}  -  ${reason}`);
    }
  }
  lines.push("");
  lines.push("Top prioritized tasks:");
  if (top5.length === 0) {
    lines.push("  (no eligible tasks)");
    return lines.join("\n");
  }
  let i = 1;
  for (const r of top5) {
    const reasons = formatReasons(r.ranking.reasons);
    lines.push(`  ${i}. ${r.ranking.taskId}  ${r.title}`);
    if (reasons.length > 0) lines.push(`     reasoning: ${reasons}`);
    i++;
  }
  return lines.join("\n");
}

function renderRefreshAttentionText(args: {
  evaluated: number;
  selected: RefreshAttentionSelected[];
  cleared: RefreshAttentionCleared[];
}): string {
  const lines: string[] = [];
  lines.push(
    `Needs Attention refreshed  (evaluated ${args.evaluated} eligible tasks)`,
  );
  lines.push("");
  lines.push("Selected:");
  if (args.selected.length === 0) {
    lines.push("  (none)");
  } else {
    for (const t of args.selected) {
      lines.push(
        `  ${t.taskId}  ${t.title}  -  ${t.reason} (${t.action})`,
      );
    }
  }
  lines.push("");
  lines.push("Cleared:");
  if (args.cleared.length === 0) {
    lines.push("  (none)");
  } else {
    for (const t of args.cleared) {
      lines.push(`  ${t.taskId}  ${t.title}`);
    }
  }
  return lines.join("\n");
}

function renderEodText(args: {
  dateKey: string;
  tz: string;
  items: TaskStatusArc[];
  completedToday: CompletedTaskRow[];
  newlyStalled: NewlyStalledRow[];
  tomorrowTop: RankedRow[];
}): string {
  const { dateKey, tz, items, completedToday, newlyStalled, tomorrowTop } =
    args;
  const lines: string[] = [];
  lines.push(`EOD review (${dateKey}, ${tz})`);
  lines.push("");

  lines.push("Completed today:");
  if (completedToday.length === 0) {
    lines.push("  (none)");
  } else {
    for (const t of completedToday) {
      lines.push(`  ${t.taskId}  ${t.title}`);
    }
  }
  lines.push("");

  lines.push("Status changes today:");
  if (items.length === 0) {
    lines.push("  (no status_change activity in window)");
  } else {
    for (const a of items) {
      lines.push(`  ${a.taskId}  ${a.title}:  ${a.statusChain.join(" -> ")}`);
    }
  }
  lines.push("");

  lines.push("Newly stalled:");
  if (newlyStalled.length === 0) {
    lines.push("  (none)");
  } else {
    for (const t of newlyStalled) {
      lines.push(
        `  ${t.taskId}  [${t.status}]  ${t.title}  -  ${t.daysSinceUpdate}d since update`,
      );
    }
  }
  lines.push("");

  lines.push("Tomorrow's top 3 (forward projection):");
  if (tomorrowTop.length === 0) {
    lines.push("  (no eligible tasks)");
  } else {
    let i = 1;
    for (const r of tomorrowTop) {
      const reasons = formatReasons(r.ranking.reasons);
      lines.push(`  ${i}. ${r.ranking.taskId}  ${r.title}`);
      if (reasons.length > 0) lines.push(`     reasoning: ${reasons}`);
      i++;
    }
  }
  return lines.join("\n");
}

function renderWeeklyText(args: {
  startDateKey: string;
  endDateKey: string;
  tz: string;
  items: TaskStatusArc[];
  shippedThisWeek: CompletedTaskRow[];
  atRisk: AtRiskRow[];
  goalSummary: GoalSummaryRow[];
  nextWeekFocus: RankedRow[];
}): string {
  const {
    startDateKey,
    endDateKey,
    tz,
    items,
    shippedThisWeek,
    atRisk,
    goalSummary,
    nextWeekFocus,
  } = args;
  const lines: string[] = [];
  lines.push(`Weekly review (${startDateKey} -> ${endDateKey}, ${tz})`);
  lines.push("");

  lines.push("Shipped this week:");
  if (shippedThisWeek.length === 0) {
    lines.push("  (none)");
  } else {
    for (const t of shippedThisWeek) {
      lines.push(`  ${t.taskId}  ${t.title}`);
    }
  }
  lines.push("");

  lines.push("At risk (overdue or stale):");
  if (atRisk.length === 0) {
    lines.push("  (none)");
  } else {
    for (const r of atRisk) {
      lines.push(`  ${r.taskId}  [${r.reason}]  ${r.title}`);
    }
  }
  lines.push("");

  lines.push("Goal summary:");
  if (goalSummary.length === 0) {
    lines.push("  (no active goals)");
  } else {
    for (const g of goalSummary) {
      lines.push(
        `  ${g.goalId}  [${g.quarter}]  ${g.title}  -  advanced=${g.advanced}, stalled=${g.stalled}, total linked=${g.totalLinked}`,
      );
    }
  }
  lines.push("");

  lines.push("Status change activity this week:");
  if (items.length === 0) {
    lines.push("  (no status_change activity in window)");
  } else {
    for (const a of items) {
      lines.push(`  ${a.taskId}  ${a.title}:  ${a.statusChain.join(" -> ")}`);
    }
  }
  lines.push("");

  lines.push("Next week's focus (forward projection):");
  if (nextWeekFocus.length === 0) {
    lines.push("  (no eligible tasks)");
  } else {
    let i = 1;
    for (const r of nextWeekFocus) {
      const reasons = formatReasons(r.ranking.reasons);
      lines.push(`  ${i}. ${r.ranking.taskId}  ${r.title}`);
      if (reasons.length > 0) lines.push(`     reasoning: ${reasons}`);
      i++;
    }
  }
  return lines.join("\n");
}

function formatReasons(reasons: TaskReasons): string {
  const parts: string[] = [];
  if (reasons.tier !== null) parts.push(reasons.tier);
  if (reasons.overdue) parts.push("overdue");
  else if (reasons.dueToday) parts.push("due today");
  if (reasons.goalLinked) parts.push("goal-linked");
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Typed CLI command Schemas.
//
// This file exports a `Schemas` object describing each review
// subcommand's input shape, success-output shape, reserved exit codes,
// and error categories. See `task.ts` for the pattern definition.
// ---------------------------------------------------------------------------

const isoDateString = z.string().refine(
  (s) => !Number.isNaN(Date.parse(s)),
  { message: "expected ISO-8601 date string" },
);

const TaskReasonsSchema = z.object({
  tier: TaskPrioritySchema.nullable(),
  overdue: z.boolean(),
  dueToday: z.boolean(),
  goalLinked: z.boolean(),
});

const ReviewTaskDetailJsonSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema.nullable(),
  category: TaskCategorySchema,
  owner: z.string().nullable(),
  dueAt: isoDateString.nullable(),
  goalId: z.string().nullable(),
  needsAttention: z.boolean(),
  needsAttentionReason: z.string().nullable(),
});

const RankedRowJsonSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  reasons: TaskReasonsSchema,
  task: ReviewTaskDetailJsonSchema,
});

const StatusArcJsonSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  description: z.string(),
  statusChain: z.array(z.string()),
});

const CalendarSlotSchema = z.object({
  status: z.literal("not_configured"),
  reason: z.string(),
});

const ReviewCommonExitCodes = [
  EXIT_OK,
  EXIT_GENERIC,
  EXIT_INPUT_VALIDATION,
  EXIT_APP_SETTING_MISSING,
] as const;

const ReviewCommonErrorCategories = [
  "input_validation",
  "app_setting_missing",
  "unhandled",
] as const;

export const Schemas = {
  next: {
    input: z.object({}).strict(),
    output: z.object({
      ok: z.literal(true),
      top: RankedRowJsonSchema.nullable(),
      evaluated: z.number().int().nonnegative(),
    }),
    exitCodes: [...ReviewCommonExitCodes] as readonly number[],
    errorCategories: [...ReviewCommonErrorCategories] as readonly string[],
  },
  morning: {
    input: z.object({}).strict(),
    output: z.object({
      ok: z.literal(true),
      generatedAt: isoDateString,
      evaluated: z.number().int().nonnegative(),
      top: z.array(RankedRowJsonSchema),
      activeGoals: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          quarter: z.string(),
        }),
      ),
      needsAttention: z.array(
        z.object({
          taskId: z.string(),
          title: z.string(),
          description: z.string(),
          needsAttentionSetAt: isoDateString.nullable(),
          reason: z.string().nullable(),
        }),
      ),
      calendar: CalendarSlotSchema,
    }),
    exitCodes: [...ReviewCommonExitCodes] as readonly number[],
    errorCategories: [...ReviewCommonErrorCategories] as readonly string[],
  },
  refreshAttention: {
    input: z.object({
      limit: z.number().int().min(1).max(NEEDS_ATTENTION_LIMIT).optional(),
    }).strict(),
    output: z.object({
      ok: z.literal(true),
      generatedAt: isoDateString,
      evaluated: z.number().int().nonnegative(),
      selected: z.array(
        z.object({
          taskId: z.string(),
          title: z.string(),
          task: ReviewTaskDetailJsonSchema,
          reasons: TaskReasonsSchema,
          reason: z.string(),
          action: z.enum(["flagged", "kept"]),
        }),
      ),
      cleared: z.array(
        z.object({
          taskId: z.string(),
          title: z.string(),
          previousReason: z.string().nullable(),
        }),
      ),
    }),
    exitCodes: [...ReviewCommonExitCodes] as readonly number[],
    errorCategories: [...ReviewCommonErrorCategories] as readonly string[],
  },
  eod: {
    input: z.object({}).strict(),
    output: z.object({
      ok: z.literal(true),
      scope: z.literal("eod"),
      timeZone: z.string(),
      date: z.string(),
      windowStart: isoDateString,
      windowEnd: isoDateString,
      changedTaskCount: z.number().int().nonnegative(),
      items: z.array(StatusArcJsonSchema),
      completedToday: z.array(
        z.object({
          taskId: z.string(),
          title: z.string(),
          description: z.string(),
          completedAt: isoDateString.nullable(),
        }),
      ),
      newlyStalled: z.array(
        z.object({
          taskId: z.string(),
          title: z.string(),
          description: z.string(),
          status: TaskStatusSchema,
          updatedAt: isoDateString,
          daysSinceUpdate: z.number().int().nonnegative(),
        }),
      ),
      tomorrowTop: z.array(RankedRowJsonSchema),
      tomorrowProjectionReferenceTime: isoDateString,
    }),
    exitCodes: [...ReviewCommonExitCodes] as readonly number[],
    errorCategories: [...ReviewCommonErrorCategories] as readonly string[],
  },
  weekly: {
    input: z.object({}).strict(),
    output: z.object({
      ok: z.literal(true),
      scope: z.literal("weekly"),
      timeZone: z.string(),
      windowStart: isoDateString,
      windowEnd: isoDateString,
      changedTaskCount: z.number().int().nonnegative(),
      items: z.array(StatusArcJsonSchema),
      shippedThisWeek: z.array(
        z.object({
          taskId: z.string(),
          title: z.string(),
          description: z.string(),
          completedAt: isoDateString.nullable(),
        }),
      ),
      atRisk: z.array(
        z.object({
          taskId: z.string(),
          title: z.string(),
          task: ReviewTaskDetailJsonSchema,
          reason: z.enum(["overdue", "stale", "overdue+stale"]),
        }),
      ),
      goalSummary: z.array(
        z.object({
          goalId: z.string(),
          title: z.string(),
          quarter: z.string(),
          advanced: z.number().int().nonnegative(),
          stalled: z.number().int().nonnegative(),
          totalLinked: z.number().int().nonnegative(),
        }),
      ),
      nextWeekFocus: z.array(RankedRowJsonSchema),
      nextWeekProjectionReferenceTime: isoDateString,
    }),
    exitCodes: [...ReviewCommonExitCodes] as readonly number[],
    errorCategories: [...ReviewCommonErrorCategories] as readonly string[],
  },
} as const;

export type ReviewCommandName = keyof typeof Schemas;
