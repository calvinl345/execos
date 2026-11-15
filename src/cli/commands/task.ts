/**
 * `execos task` command family — READ-ONLY surface (change-008, A11/S2).
 *
 * Live subcommands:
 *   list             List tasks with optional filters.
 *   show             Show one task by id.
 *   dependency list  List incoming and outgoing dependencies for a task.
 *
 * The legacy write subcommands (create, update, complete, cancel,
 * dependency add/remove, link-goal, unlink-goal, flag-attention,
 * unflag-attention) have been removed entirely. All task writes route
 * through the services layer via `execos taskops`.
 *
 * Per ADR-006: task_notes is APPEND-ONLY. This file performs no writes
 * at all; the append-only scan test (`tests/db/append-only-scan.test.ts`)
 * and the write-funnel scan (`tests/cli/task-write-funnel-scan.test.ts`)
 * enforce the boundary.
 */

import { Command } from "commander";
import { and, asc, desc, eq, gte, inArray, lt, not, or } from "drizzle-orm";
import { z } from "zod";
import { db, tasks, taskDependencies, taskNotes } from "../../db/index.js";
import { TaskNotFoundError } from "../../db/errors.js";
import type {
  TaskCategory,
  TaskHandoffState,
  TaskPriority,
  TaskStatus,
} from "../../db/schema.js";
import {
  TaskCategorySchema,
  TaskPrioritySchema,
  TaskStatusSchema,
} from "../../domain/validation.js";
import {
  EXIT_OK,
  EXIT_GENERIC,
  EXIT_INPUT_VALIDATION,
  EXIT_TASK_NOT_FOUND,
  EXIT_APP_SETTING_MISSING,
  InputValidationError,
} from "../errors.js";
import {
  parseNaturalDate,
  getHostTimeZone,
  utcFromLocalInTimeZone,
} from "../../domain/dates.js";
import {
  ctxFromProgram,
} from "../index-shared.js";
import {
  emit,
} from "../output-formatters/index.js";

// ---------------------------------------------------------------------------
// Registration.
// ---------------------------------------------------------------------------

export function registerTaskCommand(program: Command): void {
  const task = program
    .command("task")
    .description("Inspect tasks (reads only; writes live under `execos taskops`)");

  task
    .command("list")
    .description("List tasks")
    .option("-s, --status <status>", "Filter by status")
    .option("--all", "Include done and cancelled tasks")
    .option("-p, --priority <P0|P1|P2|P3>", "Filter by priority")
    .option("-c, --category <category>", "Filter by category")
    .option("-g, --goal <id>", "Filter by goal id")
    .option("--due <phrase>", "Alias for --due-on; filter to tasks due on a local calendar day")
    .option("--due-on <phrase>", "Filter to tasks due on a local calendar day")
    .option("--due-by <phrase>", "Filter to tasks due on or before a local calendar day")
    .option("--hard-deadline", "Only tasks whose due date is a hard external commitment")
    .option("--overdue", "Only tasks due before today (open tasks unless --all/--status)")
    .option("--tz <iana>", "Time zone for due-date filters (default: host)")
    .option("--limit <n>", "Optional cap on rows (1-1000); default: all matching rows")
    .action(async (opts) => {
      await runList(program, opts);
    });

  task
    .command("show")
    .description("Show one task by id")
    .argument("<id>", "Task id (e.g. KS-001)")
    .action(async (id: string) => {
      await runShow(program, id);
    });

  const dependency = task
    .command("dependency")
    .description("Inspect task-to-task dependency edges");

  dependency
    .command("list")
    .description("List incoming and outgoing dependencies for a task")
    .argument("<task-id>", "Task id")
    .action(async (taskId: string) => {
      await runDependencyList(program, taskId);
    });
}

// ---------------------------------------------------------------------------
// Subcommand implementations.
// ---------------------------------------------------------------------------

interface ListOpts {
  status?: string;
  all?: boolean;
  priority?: string;
  category?: string;
  goal?: string;
  due?: string;
  dueOn?: string;
  dueBy?: string;
  hardDeadline?: boolean;
  overdue?: boolean;
  tz?: string;
  limit?: string;
}

async function runList(program: Command, opts: ListOpts): Promise<void> {
  const ctx = ctxFromProgram(program);

  const conditions = [];
  if (opts.status) conditions.push(eq(tasks.status, parseStatus(opts.status)));
  if (!opts.status && !opts.all) {
    conditions.push(not(inArray(tasks.status, ["done", "cancelled"])));
  }
  if (opts.priority) conditions.push(eq(tasks.priority, parsePriority(opts.priority)));
  if (opts.category) conditions.push(eq(tasks.category, parseCategory(opts.category)));
  if (opts.goal) conditions.push(eq(tasks.goalId, parseGoalId(opts.goal)));
  if (opts.due && opts.dueOn) {
    throw new InputValidationError(
      "Cannot use --due and --due-on together; choose one.",
    );
  }
  const tz = opts.tz ?? getHostTimeZone();
  const dueOnPhrase = opts.dueOn ?? opts.due;
  if (dueOnPhrase) {
    const range = parseDueDayRange(dueOnPhrase, tz, opts.due ? "--due" : "--due-on");
    conditions.push(gte(tasks.dueDate, range.start));
    conditions.push(lt(tasks.dueDate, range.endExclusive));
  }
  if (opts.dueBy) {
    const range = parseDueDayRange(opts.dueBy, tz, "--due-by");
    conditions.push(lt(tasks.dueDate, range.endExclusive));
  }
  if (opts.hardDeadline) {
    conditions.push(eq(tasks.hardDeadline, true));
  }
  if (opts.overdue) {
    const today = parseDueDayRange("today", tz, "--overdue");
    conditions.push(lt(tasks.dueDate, today.start));
  }

  // No default row cap: the agent must always be able to read the full list
  // (batch-004 ISS-003). --limit stays available as an explicit cap.
  const limit = opts.limit !== undefined ? parseLimit(opts.limit) : undefined;
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const baseQuery = db
    .select()
    .from(tasks)
    .where(where)
    .orderBy(asc(tasks.dueDate), desc(tasks.lastStatusChangeAt));
  const rows = limit === undefined ? await baseQuery : await baseQuery.limit(limit);

  emit(ctx, {
    text: () => {
      if (rows.length === 0) return "(no tasks match)";
      return rows.map(formatTaskOneLine).join("\n");
    },
    json: () => ({
      ok: true,
      count: rows.length,
      tasks: rows.map(serializeTask),
    }),
  });
}

async function runShow(program: Command, id: string): Promise<void> {
  const ctx = ctxFromProgram(program);
  const detail = await fetchTaskDetail(id);

  emit(ctx, {
    text: () => renderTaskShowText(detail.task, detail.recentNotes),
    json: () => ({
      ok: true,
      task: serializeTask(detail.task),
      recentNotes: detail.recentNotes.map(serializeTaskNote),
    }),
  });
}

async function runDependencyList(
  program: Command,
  taskIdRaw: string,
): Promise<void> {
  const ctx = ctxFromProgram(program);
  const taskId = parseTaskId(taskIdRaw);
  await fetchTaskOrThrow(taskId);

  const rows = await db
    .select()
    .from(taskDependencies)
    .where(
      or(
        eq(taskDependencies.blockedTaskId, taskId),
        eq(taskDependencies.blockerTaskId, taskId),
      ),
    )
    .orderBy(asc(taskDependencies.createdAt));

  const incoming = rows.filter((row) => row.blockedTaskId === taskId);
  const outgoing = rows.filter((row) => row.blockerTaskId === taskId);

  emit(ctx, {
    text: () => renderDependencyListText(taskId, incoming, outgoing),
    json: () => ({
      ok: true,
      taskId,
      blockedBy: incoming.map(serializeDependency),
      blocks: outgoing.map(serializeDependency),
    }),
  });
}

// ---------------------------------------------------------------------------
// Input parsing (every CLI parameter passes through one of these so a
// bad value yields a clean InputValidationError, not a Postgres error).
// ---------------------------------------------------------------------------

function parsePriority(raw: string): TaskPriority {
  const result = TaskPrioritySchema.safeParse(raw);
  if (!result.success) {
    throw new InputValidationError(
      `Invalid priority '${raw}'. Expected one of P0, P1, P2, P3.`,
    );
  }
  return result.data;
}

function parseCategory(raw: string | undefined): TaskCategory {
  if (!raw) {
    throw new InputValidationError(
      "Category is required (--category). Expected one of client, business, product, house, personal.",
    );
  }
  const result = TaskCategorySchema.safeParse(raw);
  if (!result.success) {
    throw new InputValidationError(
      `Invalid category '${raw}'. Expected one of client, business, product, house, personal.`,
    );
  }
  return result.data;
}

function parseStatus(raw: string): TaskStatus {
  const result = TaskStatusSchema.safeParse(raw);
  if (!result.success) {
    throw new InputValidationError(
      `Invalid status '${raw}'. Expected one of triage, backlog, in_progress, blocked, review, done, cancelled.`,
    );
  }
  return result.data;
}

function parseGoalId(raw: string): string {
  if (!/^G-\d{3,}$/.test(raw)) {
    throw new InputValidationError(
      `Invalid goal id '${raw}'. Expected format like G-001.`,
    );
  }
  return raw;
}

function parseTaskId(raw: string): string {
  if (!/^[A-Z]{1,5}-\d{3,}$/.test(raw)) {
    throw new InputValidationError(
      `Invalid task id '${raw}'. Expected format like KS-001.`,
    );
  }
  return raw;
}

function parseLimit(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 1000) {
    throw new InputValidationError(
      `--limit must be an integer between 1 and 1000 (got '${raw}').`,
    );
  }
  return n;
}

function parseDueDayRange(
  raw: string,
  tz: string,
  optionName: "--due" | "--due-on" | "--due-by" | "--overdue",
): { start: Date; endExclusive: Date } {
  const parsed = parseNaturalDate(raw, { defaultTimeZone: tz });
  if (!parsed.ok) {
    throw new InputValidationError(
      `Could not parse ${optionName} phrase '${raw}': ${parsed.reason ?? "unrecognized"}`,
    );
  }

  const parts = localDateParts(parsed.date, tz);
  const start = utcFromLocalInTimeZone(parts.year, parts.month, parts.day, 0, 0, tz);
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  const nextParts = localDateParts(next, "UTC");
  const endExclusive = utcFromLocalInTimeZone(
    nextParts.year,
    nextParts.month,
    nextParts.day,
    0,
    0,
    tz,
  );

  return { start, endExclusive };
}

function localDateParts(
  date: Date,
  tz: string,
): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

// ---------------------------------------------------------------------------
// DB helpers used by multiple subcommands.
// ---------------------------------------------------------------------------

interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  category: TaskCategory;
  owner: string | null;
  dueDate: Date | null;
  hardDeadline: boolean;
  effort: string | null;
  followUpDate: Date | null;
  snoozedUntil: Date | null;
  handoffState: TaskHandoffState;
  handoffCopiedAt: Date | null;
  handoffLastCopiedAt: Date | null;
  handoffLastNudgeCopiedAt: Date | null;
  goalId: string | null;
  queueRank: number | null;
  queueRationale: string | null;
  queueRankedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  lastStatusChangeAt: Date;
  needsAttention: boolean;
  needsAttentionSetAt: Date | null;
  needsAttentionReason: string | null;
}

type TaskDependencyRow = typeof taskDependencies.$inferSelect;

type TaskNoteRow = typeof taskNotes.$inferSelect;

interface TaskDetail {
  task: TaskRow;
  recentNotes: TaskNoteRow[];
}

async function fetchTaskOrThrow(id: string): Promise<TaskRow> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (rows.length === 0) throw new TaskNotFoundError(id);
  return rows[0] as TaskRow;
}

async function fetchTaskDetail(id: string): Promise<TaskDetail> {
  const task = await fetchTaskOrThrow(id);
  const recentNotes = await db
    .select()
    .from(taskNotes)
    .where(and(eq(taskNotes.taskId, id), eq(taskNotes.noteType, "manual")))
    .orderBy(desc(taskNotes.createdAt))
    .limit(10);
  return { task, recentNotes };
}

// ---------------------------------------------------------------------------
// Output rendering.
// ---------------------------------------------------------------------------

function serializeTask(row: TaskRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    category: row.category,
    owner: row.owner,
    dueAt: row.dueDate ? row.dueDate.toISOString() : null,
    hardDeadline: row.hardDeadline,
    effort: row.effort,
    followUpAt: row.followUpDate ? row.followUpDate.toISOString() : null,
    snoozedUntil: row.snoozedUntil ? row.snoozedUntil.toISOString() : null,
    handoffState: row.handoffState,
    handoffCopiedAt: row.handoffCopiedAt ? row.handoffCopiedAt.toISOString() : null,
    handoffLastCopiedAt: row.handoffLastCopiedAt
      ? row.handoffLastCopiedAt.toISOString()
      : null,
    handoffLastNudgeCopiedAt: row.handoffLastNudgeCopiedAt
      ? row.handoffLastNudgeCopiedAt.toISOString()
      : null,
    goalId: row.goalId,
    queueRank: row.queueRank,
    queueRationale: row.queueRationale,
    queueRankedAt: row.queueRankedAt ? row.queueRankedAt.toISOString() : null,
    needsAttention: row.needsAttention,
    needsAttentionReason: row.needsAttentionReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastStatusChangeAt: row.lastStatusChangeAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
  };
}

function serializeTaskNote(row: TaskNoteRow): Record<string, unknown> {
  return {
    id: row.id,
    type: row.noteType,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    content: row.content,
  };
}

function serializeDependency(row: TaskDependencyRow): Record<string, unknown> {
  return {
    id: row.id,
    blockerTaskId: row.blockerTaskId,
    blockedTaskId: row.blockedTaskId,
    createdAt: row.createdAt.toISOString(),
  };
}

function formatTaskOneLine(row: TaskRow): string {
  const flag = row.needsAttention ? " [!]" : "";
  const due = row.dueDate
    ? ` due=${row.dueDate.toISOString().slice(0, 10)}${row.hardDeadline ? " (hard)" : ""}`
    : "";
  const effort = row.effort ? ` effort=${row.effort}` : "";
  const queued = row.queueRank !== null ? ` queue=#${row.queueRank}` : "";
  const snoozed = row.snoozedUntil
    ? ` snoozed=${row.snoozedUntil.toISOString().slice(0, 10)}`
    : "";
  const handoff =
    row.handoffState === "pending" ? " handoff=pending" : "";
  const pri = row.priority ?? "-";
  return `${row.id}  ${pri}  ${row.status.padEnd(11)}  ${row.title}${due}${effort}${queued}${snoozed}${handoff}${flag}`;
}

function renderTaskShowText(row: TaskRow, notes: Array<{
  id: string;
  noteType: string;
  content: string;
  createdAt: Date;
  createdBy: string;
}>): string {
  const lines: string[] = [];
  lines.push(`${row.id}  ${row.title}`);
  lines.push("");
  lines.push(`status:    ${row.status}`);
  lines.push(`priority:  ${row.priority ?? "-"}`);
  lines.push(`category:  ${row.category}`);
  lines.push(`owner:     ${row.owner ?? "-"}`);
  if (row.dueDate) lines.push(`due:       ${row.dueDate.toISOString()}`);
  lines.push(`hard:      ${row.hardDeadline ? "yes" : "no"}`);
  if (row.effort) lines.push(`effort:    ${row.effort}`);
  if (row.followUpDate) lines.push(`follow-up: ${row.followUpDate.toISOString()}`);
  if (row.snoozedUntil) lines.push(`snoozed:   ${row.snoozedUntil.toISOString()}`);
  if (row.handoffState !== "not_applicable") {
    lines.push(`handoff:   ${row.handoffState}`);
  }
  if (row.handoffCopiedAt) {
    lines.push(`handoff first copied:  ${row.handoffCopiedAt.toISOString()}`);
  }
  if (row.handoffLastCopiedAt) {
    lines.push(`handoff last copied:   ${row.handoffLastCopiedAt.toISOString()}`);
  }
  if (row.handoffLastNudgeCopiedAt) {
    lines.push(`handoff last nudge:    ${row.handoffLastNudgeCopiedAt.toISOString()}`);
  }
  if (row.goalId) lines.push(`goal:      ${row.goalId}`);
  if (row.queueRank !== null) {
    lines.push(`queue:     #${row.queueRank} (${row.queueRationale ?? "no rationale"})`);
  }
  if (row.needsAttention) {
    lines.push(`!attn:     ${row.needsAttentionReason ?? "(no reason)"}`);
  }
  lines.push("");
  lines.push(`description:`);
  lines.push(indent(row.description, "  "));
  if (notes.length > 0) {
    lines.push("");
    lines.push(`recent notes (${notes.length}):`);
    for (const n of notes) {
      lines.push(
        `  ${n.createdAt.toISOString()}  ${n.noteType.padEnd(18)}  ${truncate(n.content, 80)}`,
      );
    }
  }
  return lines.join("\n");
}

function renderDependencyListText(
  taskId: string,
  incoming: TaskDependencyRow[],
  outgoing: TaskDependencyRow[],
): string {
  const lines: string[] = [];
  lines.push(`${taskId} dependencies`);
  lines.push("");
  lines.push("Blocked by:");
  if (incoming.length === 0) {
    lines.push("  (none)");
  } else {
    for (const dep of incoming) {
      lines.push(`  ${dep.blockerTaskId}`);
    }
  }
  lines.push("");
  lines.push("Blocks:");
  if (outgoing.length === 0) {
    lines.push("  (none)");
  } else {
    for (const dep of outgoing) {
      lines.push(`  ${dep.blockedTaskId}`);
    }
  }
  return lines.join("\n");
}

function indent(text: string, prefix: string): string {
  return text.split(/\r?\n/).map((line) => prefix + line).join("\n");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

// ---------------------------------------------------------------------------
// Typed CLI command Schemas.
//
// This file exports a `Schemas` object describing each subcommand's input
// shape, success-output shape, reserved exit codes, and error categories.
//
// The schemas are exported as DATA. They live alongside the Commander
// `register*Command` registration above; they do NOT replace it. The
// downstream contract test (`tests/cli/schemas-contract.test.ts`) imports
// these and asserts: (a) representative real outputs parse without error,
// (b) every listed exit code is a member of the EXIT_* constants in
// `../errors.ts`. The MCP layer and the local dashboard consume these
// schemas to build typed callers without re-deriving the CLI's
// input/output contract.
//
// Pattern: each subcommand has { input, output, exitCodes, errorCategories }.
// `input` covers the union of positional args and option flags (Commander
// passes options as an opts object; positional args are separate). For
// schema simplicity, input schemas project both into one object.
// ---------------------------------------------------------------------------

const isoDateString = z.string().refine(
  (s) => !Number.isNaN(Date.parse(s)),
  { message: "expected ISO-8601 date string" },
);

const SerializedTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema.nullable(),
  category: TaskCategorySchema,
  owner: z.string().nullable(),
  dueAt: isoDateString.nullable(),
  hardDeadline: z.boolean(),
  effort: z.string().nullable(),
  followUpAt: isoDateString.nullable(),
  snoozedUntil: isoDateString.nullable(),
  handoffState: z.enum(["not_applicable", "pending", "copied"]),
  handoffCopiedAt: isoDateString.nullable(),
  handoffLastCopiedAt: isoDateString.nullable(),
  handoffLastNudgeCopiedAt: isoDateString.nullable(),
  goalId: z.string().nullable(),
  queueRank: z.number().int().nullable(),
  queueRationale: z.string().nullable(),
  queueRankedAt: isoDateString.nullable(),
  needsAttention: z.boolean(),
  needsAttentionReason: z.string().nullable(),
  createdAt: isoDateString,
  updatedAt: isoDateString,
  lastStatusChangeAt: isoDateString,
  completedAt: isoDateString.nullable(),
  cancelledAt: isoDateString.nullable(),
});

const TaskNoteSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  createdAt: isoDateString,
  createdBy: z.string(),
  content: z.string(),
});

const SerializedTaskDependencySchema = z.object({
  id: z.string(),
  blockerTaskId: z.string(),
  blockedTaskId: z.string(),
  createdAt: isoDateString,
});

const TaskCommonExitCodes = [
  EXIT_OK,
  EXIT_GENERIC,
  EXIT_INPUT_VALIDATION,
  EXIT_APP_SETTING_MISSING,
] as const;

const TaskCommonErrorCategories = [
  "input_validation",
  "app_setting_missing",
  "unhandled",
] as const;

export const Schemas = {
  list: {
    input: z.object({
      status: TaskStatusSchema.optional(),
      all: z.boolean().optional(),
      priority: TaskPrioritySchema.optional(),
      category: TaskCategorySchema.optional(),
      goal: z.string().regex(/^G-\d{3,}$/).optional(),
      due: z.string().optional(),
      dueOn: z.string().optional(),
      dueBy: z.string().optional(),
      hardDeadline: z.boolean().optional(),
      overdue: z.boolean().optional(),
      tz: z.string().optional(),
      limit: z.string().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      count: z.number().int().nonnegative(),
      tasks: z.array(SerializedTaskSchema),
    }),
    exitCodes: [...TaskCommonExitCodes] as readonly number[],
    errorCategories: [...TaskCommonErrorCategories] as readonly string[],
  },
  show: {
    input: z.object({
      id: z.string().regex(/^[A-Z]{1,5}-\d+$/),
    }),
    output: z.object({
      ok: z.literal(true),
      task: SerializedTaskSchema,
      recentNotes: z.array(TaskNoteSummarySchema),
    }),
    exitCodes: [
      ...TaskCommonExitCodes,
      EXIT_TASK_NOT_FOUND,
    ] as readonly number[],
    errorCategories: [
      ...TaskCommonErrorCategories,
      "task_not_found",
    ] as readonly string[],
  },
  dependencyList: {
    input: z.object({
      taskId: z.string().regex(/^[A-Z]{1,5}-\d{3,}$/),
    }),
    output: z.object({
      ok: z.literal(true),
      taskId: z.string(),
      blockedBy: z.array(SerializedTaskDependencySchema),
      blocks: z.array(SerializedTaskDependencySchema),
    }),
    exitCodes: [
      ...TaskCommonExitCodes,
      EXIT_TASK_NOT_FOUND,
    ] as readonly number[],
    errorCategories: [
      ...TaskCommonErrorCategories,
      "task_not_found",
    ] as readonly string[],
  },
} as const;

export type TaskCommandName = keyof typeof Schemas;
