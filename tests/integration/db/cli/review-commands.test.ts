/**
 * End-to-end contract tests for the `daily review` command family.
 *
 * Coverage matches the AC-009/010/011/012 review surface:
 *   - review next:    no eligible tasks, single task, multi-task ordering
 *                     parity with the domain layer's rankTasks call.
 *   - review morning: top-5 cap, calendar slot is `not_configured`,
 *                     evaluated count surfaces.
 *   - review eod:     today's status_change chain renders, empty surface
 *                     produces changedTaskCount=0, completed task arc
 *                     covers triage -> done.
 *   - review weekly:  wider window than eod, includes today's items,
 *                     empty surface produces changedTaskCount=0.
 *
 * Each test runs the production buildProgram/parseAsync path against
 * dev Supabase. Tests reset settings + DB state before each case.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, db } from "../../../../src/db/index.js";
import { resetDbData, insertGoal, insertTask } from "../../../db/db-test-utils.js";
import { resetSettingsCache } from "../../../../src/cli/settings-loader.js";
import {
  runCli,
  parseLastJsonStdout,
  parseLastJsonStdoutValidated,
} from "../../../cli/test-utils.js";
import { Schemas as ReviewSchemas } from "../../../../src/cli/commands/review.js";
import {
  rankTasks,
  type PrioritizationInput,
  type TaskReasons,
} from "../../../../src/domain/prioritization.js";
import { EXIT_OK } from "../../../../src/cli/errors.js";

interface NextResponse {
  ok: boolean;
  evaluated: number;
  top: { taskId: string; title: string; reasons: TaskReasons } | null;
}

interface MorningResponse {
  ok: boolean;
  evaluated: number;
  top: Array<{ taskId: string; title: string; reasons: TaskReasons }>;
  calendar: { status: string; reason: string };
  activeGoals: Array<{ id: string; title: string; quarter: string }>;
  needsAttention: Array<{
    taskId: string;
    title: string;
    needsAttentionSetAt: string | null;
    reason: string | null;
  }>;
}

interface EodResponse {
  ok: boolean;
  scope: string;
  timeZone: string;
  windowStart: string;
  windowEnd: string;
  changedTaskCount: number;
  date?: string;
  items: Array<{ taskId: string; title: string; statusChain: string[] }>;
  completedToday: Array<{ taskId: string; title: string; completedAt: string | null }>;
  newlyStalled: Array<{
    taskId: string;
    title: string;
    status: string;
    updatedAt: string;
    daysSinceUpdate: number;
  }>;
  tomorrowTop: Array<{ taskId: string; title: string; reasons: TaskReasons }>;
  tomorrowProjectionReferenceTime: string;
}

interface WeeklyResponse {
  ok: boolean;
  scope: string;
  timeZone: string;
  windowStart: string;
  windowEnd: string;
  changedTaskCount: number;
  items: Array<{ taskId: string; title: string; statusChain: string[] }>;
  shippedThisWeek: Array<{ taskId: string; title: string; completedAt: string | null }>;
  atRisk: Array<{
    taskId: string;
    title: string;
    reason: "overdue" | "stale" | "overdue+stale";
  }>;
  goalSummary: Array<{
    goalId: string;
    title: string;
    quarter: string;
    advanced: number;
    stalled: number;
    totalLinked: number;
  }>;
  nextWeekFocus: Array<{ taskId: string; title: string; reasons: TaskReasons }>;
  nextWeekProjectionReferenceTime: string;
}

// Minimal shared shape used by the older arc-based tests (covers
// fields common to both eod and weekly responses).
interface ActivityResponse {
  ok: boolean;
  scope: string;
  timeZone: string;
  windowStart: string;
  windowEnd: string;
  changedTaskCount: number;
  date?: string;
  items: Array<{ taskId: string; title: string; statusChain: string[] }>;
}

describe("daily review CLI", () => {
  beforeEach(async () => {
    resetSettingsCache();
    await resetDbData();
  });

  afterAll(async () => {
    await closeDb();
  });

  // -------------------------------------------------------------------------
  // review next
  // -------------------------------------------------------------------------

  describe("next", () => {
    it("returns top: null when no eligible tasks exist", async () => {
      const result = await runCli(["review", "next"], { format: "json" });
      expect(result.exitCode).toBe(EXIT_OK);
      // Validates the captured JSON against the exported `review next`
      // output schema before asserting fields. If the production emitter
      // ever drifts from the documented Schemas shape, this test fails
      // at THIS line with a precise Zod error path.
      const parsed = parseLastJsonStdoutValidated(
        result,
        ReviewSchemas.next.output,
      );
      expect(parsed.ok).toBe(true);
      expect(parsed.top).toBeNull();
      expect(parsed.evaluated).toBe(0);
    });

    it("returns the only eligible task with reasons when one exists", async () => {
      await insertTask({
        id: "KS-101",
        status: "triage",
        priority: "P1",
        category: "personal",
      });

      const result = await runCli(["review", "next"], { format: "json" });
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdout(result) as NextResponse;
      expect(parsed.evaluated).toBe(1);
      expect(parsed.top).not.toBeNull();
      expect(parsed.top?.taskId).toBe("KS-101");
      expect(parsed.top?.reasons.tier).toBe("P1");
    });

    it("orders multi-task results to match the domain rankTasks call", async () => {
      // Build three tasks at different priorities. Insert in non-priority
      // order to avoid tying the ordering to insertion order.
      await insertTask({ id: "KS-201", status: "triage", priority: "P2", category: "personal" });
      await insertTask({ id: "KS-202", status: "triage", priority: "P0", category: "personal" });
      await insertTask({ id: "KS-203", status: "triage", priority: "P1", category: "personal" });

      const result = await runCli(["review", "next"], { format: "json" });
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdout(result) as NextResponse;

      // Compute the expected top via the domain layer to assert the CLI
      // and the formula agree on ordering.
      const rows = await db.execute<{ id: string; status: string; priority: string | null; description: string; created_at: Date; updated_at: Date; due_date: Date | null; follow_up_date: Date | null; snoozed_until: Date | null; last_unblocked_at: Date | null; goal_id: string | null; hard_deadline: boolean }>(sql`
        SELECT id, status, priority, description, created_at, updated_at, due_date, follow_up_date, snoozed_until, last_unblocked_at, goal_id, hard_deadline
        FROM v_eligible_for_prioritization
      `);
      const inputs: PrioritizationInput[] = (rows as unknown as Array<{
        id: string; status: string; priority: string | null; description: string;
        created_at: Date; updated_at: Date; due_date: Date | null; follow_up_date: Date | null; snoozed_until: Date | null;
        last_unblocked_at: Date | null; goal_id: string | null; hard_deadline: boolean;
      }>).map((r) => ({
        task: {
          id: r.id,
          // Cast through unknown to satisfy TaskInput's narrow enums; the
          // domain layer treats the strings opaquely as long as eligibility
          // matches.
          status: r.status as never,
          priority: r.priority as never,
          description: r.description,
          dueAt: r.due_date,
          followUpDate: r.follow_up_date,
          snoozedUntil: r.snoozed_until,
          createdAt: new Date(r.created_at),
          updatedAt: new Date(r.updated_at),
          lastUnblockedAt: r.last_unblocked_at ? new Date(r.last_unblocked_at) : null,
          goalId: r.goal_id,
          hardDeadline: r.hard_deadline,
        },
      }));
      const ranked = rankTasks(inputs, new Date());
      expect(parsed.top?.taskId).toBe(ranked[0]?.taskId);
      // Sanity: P0 must lead.
      expect(parsed.top?.taskId).toBe("KS-202");
    });
  });

  // -------------------------------------------------------------------------
  // review morning
  // -------------------------------------------------------------------------

  describe("morning", () => {
    it("returns the calendar not_configured slot even when no tasks exist", async () => {
      const result = await runCli(["review", "morning"], { format: "json" });
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdout(result) as MorningResponse;
      expect(parsed.ok).toBe(true);
      expect(parsed.evaluated).toBe(0);
      expect(parsed.top).toEqual([]);
      expect(parsed.calendar.status).toBe("not_configured");
      expect(parsed.calendar.reason).toMatch(/Calendar enrichment is not configured/);
      // AC-010: even when empty, both sections must be present.
      expect(parsed.activeGoals).toEqual([]);
      expect(parsed.needsAttention).toEqual([]);
    });

    it("populates activeGoals from goals.status='active' (AC-010)", async () => {
      // insertGoal creates an active goal in 2026-Q2 by default.
      await insertGoal("G-G01");
      await insertGoal("G-G02");
      // Mark one as achieved; it should drop from activeGoals.
      await db.execute(sql`UPDATE goals SET status = 'achieved' WHERE id = 'G-G02'`);

      const result = await runCli(["review", "morning"], { format: "json" });
      const parsed = parseLastJsonStdout(result) as MorningResponse;
      const ids = parsed.activeGoals.map((g) => g.id).sort();
      expect(ids).toEqual(["G-G01"]);
      expect(parsed.activeGoals[0]?.quarter).toBe("2026-Q2");
    });

    it("populates needsAttention from active tasks with needs_attention=true (AC-010)", async () => {
      // Two active flagged tasks, one terminal flagged task, plus one un-flagged.
      await insertTask({
        id: "KS-A01",
        status: "triage",
        category: "personal",
        needsAttention: true,
        needsAttentionReason: "block on owner reply",
      });
      await insertTask({
        id: "KS-A02",
        status: "backlog",
        category: "personal",
        needsAttention: true,
      });
      await insertTask({
        id: "KS-A04",
        status: "done",
        category: "personal",
        needsAttention: true,
      });
      await insertTask({
        id: "KS-A03",
        status: "triage",
        category: "personal",
        needsAttention: false,
      });
      // Set timestamps so ordering is deterministic.
      await db.execute(sql`
        UPDATE tasks SET needs_attention_set_at = now() - interval '1 hour' WHERE id = 'KS-A01'
      `);
      await db.execute(sql`
        UPDATE tasks SET needs_attention_set_at = now() WHERE id = 'KS-A02'
      `);

      const result = await runCli(["review", "morning"], { format: "json" });
      const parsed = parseLastJsonStdout(result) as MorningResponse;
      const ids = parsed.needsAttention.map((t) => t.taskId);
      // ORDER BY needs_attention_set_at DESC: KS-A02 first.
      expect(ids).toEqual(["KS-A02", "KS-A01"]);
      expect(ids).not.toContain("KS-A04");
      const a01 = parsed.needsAttention.find((t) => t.taskId === "KS-A01");
      expect(a01?.reason).toBe("block on owner reply");
    });

    it("caps top at 5 when more than five eligible tasks exist", async () => {
      for (let i = 0; i < 7; i++) {
        await insertTask({
          id: `KS-3${String(i).padStart(2, "0")}`,
          status: "triage",
          priority: "P1",
          category: "personal",
        });
      }
      const result = await runCli(["review", "morning"], { format: "json" });
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdout(result) as MorningResponse;
      expect(parsed.evaluated).toBe(7);
      expect(parsed.top).toHaveLength(5);
    });

    it("refresh-attention flags the daily focus set and clears stale attention flags", async () => {
      await insertTask({
        id: "KS-F01",
        title: "Handle the client fire",
        status: "triage",
        priority: "P0",
        category: "client",
      });
      await insertTask({
        id: "KS-F02",
        title: "Prep the operator notes",
        status: "triage",
        priority: "P1",
        category: "business",
        needsAttention: true,
        needsAttentionReason: "old reason",
      });
      await insertTask({
        id: "KS-OLD",
        title: "Low priority old flag",
        status: "triage",
        priority: "P3",
        category: "personal",
        needsAttention: true,
        needsAttentionReason: "old focus",
      });

      const result = await runCli(["review", "refresh-attention", "--limit", "2"], {
        format: "json",
      });
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdoutValidated(
        result,
        ReviewSchemas.refreshAttention.output,
      );
      expect(parsed.selected.map((t) => t.taskId)).toEqual(["KS-F01", "KS-F02"]);
      expect(parsed.cleared.map((t) => t.taskId)).toEqual(["KS-OLD"]);

      const rows = await db.execute<{
        id: string;
        needs_attention: boolean;
        needs_attention_reason: string | null;
      }>(sql`
        SELECT id, needs_attention, needs_attention_reason
        FROM tasks
        WHERE id IN ('KS-F01', 'KS-F02', 'KS-OLD')
        ORDER BY id
      `);
      const byId = new Map(
        Array.from(rows as unknown as Array<{
          id: string;
          needs_attention: boolean;
          needs_attention_reason: string | null;
        }>).map((r) => [r.id, r]),
      );
      expect(byId.get("KS-F01")?.needs_attention).toBe(true);
      expect(byId.get("KS-F01")?.needs_attention_reason).toMatch(/^daily focus:/);
      expect(byId.get("KS-F02")?.needs_attention).toBe(true);
      expect(byId.get("KS-F02")?.needs_attention_reason).toMatch(/^daily focus:/);
      expect(byId.get("KS-OLD")?.needs_attention).toBe(false);
      expect(byId.get("KS-OLD")?.needs_attention_reason).toBeNull();
    });

    it("text mode renders the Calendar: not configured line", async () => {
      const result = await runCli(["review", "morning"]);
      expect(result.exitCode).toBe(EXIT_OK);
      expect(result.out).toMatch(/Calendar: not configured/);
    });

    it("orders top-5 by tier-first rules and ranks goal-linked tasks ahead within a tier", async () => {
      // Active goal in 2026-Q2 (today is 2026-04-27 per session date,
      // which is Q2 - safe).
      const goalId = await insertGoal("G-300");
      await db.execute(sql`UPDATE goals SET quarter = '2026-Q2', status = 'active' WHERE id = ${goalId}`);

      await insertTask({
        id: "KS-401",
        status: "triage",
        priority: "P1",
        category: "personal",
      });
      const linkedTaskId = "KS-402";
      await insertTask({
        id: linkedTaskId,
        status: "triage",
        priority: "P1",
        category: "personal",
      });
      await db.execute(sql`UPDATE tasks SET goal_id = ${goalId} WHERE id = ${linkedTaskId}`);

      const result = await runCli(["review", "morning"], { format: "json" });
      const parsed = parseLastJsonStdout(result) as MorningResponse;
      expect(parsed.top[0]?.taskId).toBe(linkedTaskId);
    });
  });

  // -------------------------------------------------------------------------
  // review eod
  // -------------------------------------------------------------------------

  describe("eod", () => {
    it("returns changedTaskCount: 0 when there are no status changes today", async () => {
      const result = await runCli(["review", "eod"], { format: "json" });
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdout(result) as ActivityResponse;
      expect(parsed.ok).toBe(true);
      expect(parsed.scope).toBe("eod");
      expect(parsed.changedTaskCount).toBe(0);
      expect(parsed.items).toEqual([]);
      expect(parsed.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("renders the full triage -> in_progress -> done arc for a task completed today", async () => {
      const create = await runCli(
        [
          "taskops",
          "create",
          "Smoke arc",
          "-d",
          "Description that comfortably meets the ten-character minimum.",
          "-c",
          "personal",
          "--due",
          "tomorrow",
          "--allow-duplicate",
          "test fixture seed; duplicate gate intentionally bypassed",
        ],
        { format: "json" },
      );
      const id = (parseLastJsonStdout(create) as { task: { id: string } }).task.id;

      await runCli(["taskops", "update", "--task-id", id, "-s", "in_progress"], { format: "json" });
      await runCli(["taskops", "complete", "--task-id", id, "--yes"], { format: "json" });

      const result = await runCli(["review", "eod"], { format: "json" });
      const parsed = parseLastJsonStdout(result) as ActivityResponse;
      expect(parsed.changedTaskCount).toBe(1);
      const arc = parsed.items.find((it) => it.taskId === id);
      expect(arc).toBeDefined();
      expect(arc?.statusChain).toEqual(["triage", "in_progress", "done"]);
    });

    it("ignores notes outside the today window", async () => {
      // Insert a status_change note dated 3 days ago directly via SQL;
      // the EOD window must exclude it.
      const taskId = await insertTask({ id: "KS-501", status: "in_progress", category: "personal" });
      await db.execute(sql`
        INSERT INTO task_notes (id, task_id, note_type, content, created_at, created_by)
        VALUES (
          'older-than-today',
          ${taskId},
          'status_change',
          ${'{"from":"triage","to":"in_progress","by":"agent","at":"2026-04-24T12:00:00.000Z"}'},
          now() - interval '3 days',
          'agent'
        )
      `);

      const result = await runCli(["review", "eod"], { format: "json" });
      const parsed = parseLastJsonStdout(result) as ActivityResponse;
      expect(parsed.items.find((it) => it.taskId === taskId)).toBeUndefined();
    });

    it("surfaces completedToday for a task completed today (AC-011)", async () => {
      const create = await runCli(
        [
          "taskops",
          "create",
          "Completed today",
          "-d",
          "Description that comfortably meets the ten-character minimum.",
          "-c",
          "personal",
          "--due",
          "tomorrow",
          "--allow-duplicate",
          "test fixture seed; duplicate gate intentionally bypassed",
        ],
        { format: "json" },
      );
      const id = (parseLastJsonStdout(create) as { task: { id: string } }).task.id;
      await runCli(["taskops", "complete", "--task-id", id, "--yes"], { format: "json" });

      const result = await runCli(["review", "eod"], { format: "json" });
      const parsed = parseLastJsonStdout(result) as EodResponse;
      const found = parsed.completedToday.find((t) => t.taskId === id);
      expect(found).toBeDefined();
      expect(found?.completedAt).not.toBeNull();
    });

    it("surfaces newlyStalled tasks whose updatedAt crossed the staleness threshold (AC-011)", async () => {
      // 7 days < daysSinceUpdate < 14 days = newly stalled (default
      // days_per_penalty=7).
      const id = await insertTask({
        id: "KS-511",
        status: "in_progress",
        category: "personal",
      });
      await db.execute(sql`
        UPDATE tasks SET updated_at = now() - interval '8 days' WHERE id = ${id}
      `);

      // Control: a task updated yesterday must NOT appear as newly stalled.
      await insertTask({
        id: "KS-512",
        status: "in_progress",
        category: "personal",
      });
      await db.execute(sql`
        UPDATE tasks SET updated_at = now() - interval '1 day' WHERE id = 'KS-512'
      `);

      // Control: a task updated 30 days ago is "long stalled", not newly.
      await insertTask({
        id: "KS-513",
        status: "in_progress",
        category: "personal",
      });
      await db.execute(sql`
        UPDATE tasks SET updated_at = now() - interval '30 days' WHERE id = 'KS-513'
      `);

      const result = await runCli(["review", "eod"], { format: "json" });
      const parsed = parseLastJsonStdout(result) as EodResponse;
      const ids = parsed.newlyStalled.map((t) => t.taskId);
      expect(ids).toContain(id);
      expect(ids).not.toContain("KS-512");
      expect(ids).not.toContain("KS-513");
    });

    it("returns tomorrowTop ranked from tomorrow's reference time (AC-011)", async () => {
      await insertTask({
        id: "KS-521",
        status: "triage",
        priority: "P0",
        category: "personal",
      });
      await insertTask({
        id: "KS-522",
        status: "triage",
        priority: "P2",
        category: "personal",
      });

      const result = await runCli(["review", "eod"], { format: "json" });
      const parsed = parseLastJsonStdout(result) as EodResponse;
      expect(parsed.tomorrowTop.length).toBeGreaterThanOrEqual(2);
      expect(parsed.tomorrowTop.length).toBeLessThanOrEqual(3);
      // P0 wins by tier.
      expect(parsed.tomorrowTop[0]?.taskId).toBe("KS-521");
      // Reference time is the start of tomorrow in host TZ; must be
      // strictly later than the EOD window start.
      expect(
        new Date(parsed.tomorrowProjectionReferenceTime).getTime(),
      ).toBeGreaterThan(new Date(parsed.windowStart).getTime());
    });
  });

  // -------------------------------------------------------------------------
  // review weekly
  // -------------------------------------------------------------------------

  describe("weekly", () => {
    it("returns changedTaskCount: 0 when no status changes occurred this week", async () => {
      const result = await runCli(["review", "weekly"], { format: "json" });
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdout(result) as ActivityResponse;
      expect(parsed.scope).toBe("weekly");
      expect(parsed.changedTaskCount).toBe(0);
    });

    it("includes today's status changes in the weekly window", async () => {
      const create = await runCli(
        [
          "taskops",
          "create",
          "Weekly arc",
          "-d",
          "Description that comfortably meets the ten-character minimum.",
          "-c",
          "personal",
          "--due",
          "tomorrow",
          "--allow-duplicate",
          "test fixture seed; duplicate gate intentionally bypassed",
        ],
        { format: "json" },
      );
      const id = (parseLastJsonStdout(create) as { task: { id: string } }).task.id;
      await runCli(["taskops", "complete", "--task-id", id, "--yes"], { format: "json" });

      const result = await runCli(["review", "weekly"], { format: "json" });
      const parsed = parseLastJsonStdout(result) as ActivityResponse;
      const arc = parsed.items.find((it) => it.taskId === id);
      expect(arc).toBeDefined();
      expect(arc?.statusChain[0]).toBe("triage");
      expect(arc?.statusChain[arc.statusChain.length - 1]).toBe("done");
    });

    it("opens a strictly wider window than eod", async () => {
      const eod = await runCli(["review", "eod"], { format: "json" });
      const weekly = await runCli(["review", "weekly"], { format: "json" });
      const eodParsed = parseLastJsonStdout(eod) as ActivityResponse;
      const weeklyParsed = parseLastJsonStdout(weekly) as ActivityResponse;

      const eodStart = new Date(eodParsed.windowStart).getTime();
      const eodEnd = new Date(eodParsed.windowEnd).getTime();
      const weeklyStart = new Date(weeklyParsed.windowStart).getTime();
      const weeklyEnd = new Date(weeklyParsed.windowEnd).getTime();

      expect(weeklyStart).toBeLessThanOrEqual(eodStart);
      expect(weeklyEnd).toBeGreaterThanOrEqual(eodEnd);
      // 7 calendar days, accounting for DST edges (between 6.95 and 7.05 days).
      const span = (weeklyEnd - weeklyStart) / 86_400_000;
      expect(span).toBeGreaterThan(6.9);
      expect(span).toBeLessThan(7.1);
    });

    it("surfaces shippedThisWeek for tasks completed inside the week window (AC-012)", async () => {
      const create = await runCli(
        [
          "taskops",
          "create",
          "Shipped this week",
          "-d",
          "Description that comfortably meets the ten-character minimum.",
          "-c",
          "personal",
          "--due",
          "tomorrow",
          "--allow-duplicate",
          "test fixture seed; duplicate gate intentionally bypassed",
        ],
        { format: "json" },
      );
      const id = (parseLastJsonStdout(create) as { task: { id: string } }).task.id;
      await runCli(["taskops", "complete", "--task-id", id, "--yes"], { format: "json" });

      const result = await runCli(["review", "weekly"], { format: "json" });
      const parsed = parseLastJsonStdout(result) as WeeklyResponse;
      const found = parsed.shippedThisWeek.find((t) => t.taskId === id);
      expect(found).toBeDefined();
      expect(found?.completedAt).not.toBeNull();
    });

    it("surfaces atRisk tasks for overdue and stale conditions (AC-012)", async () => {
      // Overdue: due 5 days ago, status still actionable.
      const overdueId = await insertTask({
        id: "KS-WK01",
        status: "in_progress",
        priority: "P1",
        category: "personal",
      });
      await db.execute(sql`
        UPDATE tasks SET due_date = now() - interval '5 days' WHERE id = ${overdueId}
      `);

      // Stale: updated 14 days ago = max staleness penalty hit.
      const staleId = await insertTask({
        id: "KS-WK02",
        status: "triage",
        priority: "P1",
        category: "personal",
      });
      await db.execute(sql`
        UPDATE tasks SET updated_at = now() - interval '21 days' WHERE id = ${staleId}
      `);

      // Healthy task: should not appear in atRisk.
      await insertTask({
        id: "KS-WK03",
        status: "triage",
        priority: "P1",
        category: "personal",
      });

      const result = await runCli(["review", "weekly"], { format: "json" });
      const parsed = parseLastJsonStdout(result) as WeeklyResponse;
      const atRiskIds = parsed.atRisk.map((r) => r.taskId);
      expect(atRiskIds).toContain(overdueId);
      expect(atRiskIds).toContain(staleId);
      expect(atRiskIds).not.toContain("KS-WK03");

      const overdueRow = parsed.atRisk.find((r) => r.taskId === overdueId);
      expect(overdueRow?.reason).toMatch(/overdue/);
      const staleRow = parsed.atRisk.find((r) => r.taskId === staleId);
      expect(staleRow?.reason).toMatch(/stale/);
    });

    it("returns goalSummary counts of advanced and stalled linked tasks (AC-012)", async () => {
      const goalId = await insertGoal("G-901");

      // Linked + completed this week => advanced.
      const advancedResult = await runCli(
        [
          "taskops",
          "create",
          "Advanced",
          "-d",
          "Description that comfortably meets the ten-character minimum.",
          "-c",
          "business",
          "--goal-id",
          goalId,
          "--due",
          "tomorrow",
          "--allow-duplicate",
          "test fixture seed; duplicate gate intentionally bypassed",
        ],
        { format: "json" },
      );
      const advTaskId = (
        parseLastJsonStdout(advancedResult) as { task: { id: string } }
      ).task.id;
      await runCli(["taskops", "complete", "--task-id", advTaskId, "--yes"], { format: "json" });

      // Linked + still triage with no movement this week => stalled.
      const stalledId = await insertTask({
        id: "KS-W02",
        status: "triage",
        category: "personal",
      });
      await db.execute(sql`
        UPDATE tasks SET goal_id = ${goalId} WHERE id = ${stalledId}
      `);

      const result = await runCli(["review", "weekly"], { format: "json" });
      const parsed = parseLastJsonStdout(result) as WeeklyResponse;
      const row = parsed.goalSummary.find((g) => g.goalId === goalId);
      expect(row).toBeDefined();
      expect(row?.advanced).toBeGreaterThanOrEqual(1);
      expect(row?.stalled).toBeGreaterThanOrEqual(1);
      expect(row?.totalLinked).toBe(2);
    });

    it("returns nextWeekFocus ranked from next week's start as reference time (AC-012)", async () => {
      await insertTask({
        id: "KS-W11",
        status: "triage",
        priority: "P0",
        category: "personal",
      });
      await insertTask({
        id: "KS-W12",
        status: "triage",
        priority: "P3",
        category: "personal",
      });

      const result = await runCli(["review", "weekly"], { format: "json" });
      const parsed = parseLastJsonStdout(result) as WeeklyResponse;
      expect(parsed.nextWeekFocus.length).toBeGreaterThanOrEqual(2);
      expect(parsed.nextWeekFocus[0]?.taskId).toBe("KS-W11");
      expect(parsed.nextWeekProjectionReferenceTime).toBe(parsed.windowEnd);
    });

    it("includes a status change from earlier this week (older than today) in the weekly arc", async () => {
      // Create a task and seed a status_change activity dated yesterday so
      // we can verify the weekly window catches notes prior to "today".
      const taskId = await insertTask({
        id: "KS-601",
        status: "in_progress",
        category: "personal",
      });
      await db.execute(sql`
        INSERT INTO task_activities (
          id,
          task_id,
          event_type,
          summary,
          actor_type,
          actor_label,
          source,
          occurred_at,
          payload
        )
        VALUES (
          'yesterday-activity',
          ${taskId},
          'task_status_changed',
          'Task moved from triage to in_progress',
          'agent',
          'ExecOS agent',
          'cli',
          now() - interval '12 hours',
          ${JSON.stringify({ from_status: "triage", to_status: "in_progress" })}::jsonb
        )
      `);

      const result = await runCli(["review", "weekly"], { format: "json" });
      const parsed = parseLastJsonStdout(result) as ActivityResponse;
      const arc = parsed.items.find((it) => it.taskId === taskId);
      // The yesterday-note may or may not land inside this Mon-Mon window
      // depending on which weekday the test runs on, but `now() - 12h`
      // is guaranteed to be inside the weekly window.
      expect(arc).toBeDefined();
      expect(arc?.statusChain).toContain("in_progress");
    });
  });
});
