/**
 * `execos goal` command family.
 *
 * Subcommands:
 *   create         Create a goal. Validates quarter regex and minimum
 *                  description length before INSERT.
 *   update         Mutate title / description / quarter on an existing
 *                  goal. NOT status -- terminal transitions go through
 *                  the dedicated close-* commands per Appendix A.2.1.
 *   close-achieved Close a goal as achieved. Requires --yes confirmation
 *                  (terminal status transition; mirrors task complete).
 *   close-dropped  Close a goal as dropped. Requires --yes confirmation.
 *   list           List goals with optional status / quarter filters.
 *   show           Show one goal by id, plus the linked-task count and
 *                  a one-line summary of up to 10 linked tasks.
 *   linked-tasks   List every task with goal_id = <id>, with optional
 *                  status filter.
 *
 * Goal closing does NOT auto-close linked tasks (per Appendix A.2.1
 * notes). Tasks remain on their independent lifecycle.
 *
 * The goals table has no audit-notes companion (unlike task_notes), so
 * close-* writes the new status + closed_at inside a single transaction
 * and the row state itself is the audit trail. updated_at is bumped by
 * Drizzle's $onUpdate hook.
 */

import { Command } from "commander";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, goals, tasks } from "../../db/index.js";
import { composeGoalId } from "../../db/helpers/index.js";
import { GoalNotFoundError } from "../../db/errors.js";
import type {
  GoalStatus,
  TaskCategory,
  TaskPriority,
  TaskStatus,
} from "../../db/schema.js";
import {
  GoalStatusSchema,
  QuarterCodeSchema,
  TaskCategorySchema,
  TaskPrioritySchema,
  TaskStatusSchema,
  nonEmptyString,
} from "../../domain/validation.js";
import {
  canTransitionGoal,
  explainGoalTransition,
  TERMINAL_GOAL_STATUSES,
} from "../../domain/status-transitions.js";
import {
  EXIT_OK,
  EXIT_GENERIC,
  EXIT_INPUT_VALIDATION,
  EXIT_GOAL_NOT_FOUND,
  EXIT_TRANSITION_DENIED,
  InputValidationError,
  TransitionDeniedError,
} from "../errors.js";
import { ctxFromProgram } from "../index-shared.js";
import { emit } from "../output-formatters/index.js";
import { TextInputResolver } from "../text-input.js";

// ---------------------------------------------------------------------------
// Registration.
// ---------------------------------------------------------------------------

export function registerGoalCommand(program: Command): void {
  const goal = program
    .command("goal")
    .description("Manage quarterly goals");

  goal
    .command("create")
    .description("Create a new goal")
    .argument("<title>", "Goal title")
    .requiredOption(
      "-q, --quarter <code>",
      "Quarter code in YYYY-Q[1-4] format (e.g. 2026-Q2)",
    )
    .option(
      "-d, --description <text>",
      "Goal description (>=10 chars; defaults to title if omitted). Use - to read from stdin",
    )
    .action(async (title: string, opts) => {
      await runCreate(program, title, opts);
    });

  goal
    .command("update")
    .description("Update fields on a goal (title, description, quarter)")
    .argument("<id>", "Goal id (e.g. G-001)")
    .option("-t, --title <text>", "New title")
    .option("-d, --description <text>", "New description (>=10 chars). Use - to read from stdin")
    .option("-q, --quarter <code>", "New quarter code (YYYY-Q[1-4])")
    .action(async (id: string, opts) => {
      await runUpdate(program, id, opts);
    });

  goal
    .command("close-achieved")
    .description("Close a goal as achieved (terminal status; requires --yes)")
    .argument("<id>", "Goal id (e.g. G-001)")
    .option(
      "-y, --yes",
      "Skip the terminal-status confirmation",
      false,
    )
    .action(async (id: string, opts) => {
      await runClose(program, id, opts, "achieved");
    });

  goal
    .command("close-dropped")
    .description("Close a goal as dropped (terminal status; requires --yes)")
    .argument("<id>", "Goal id (e.g. G-001)")
    .option(
      "-y, --yes",
      "Skip the terminal-status confirmation",
      false,
    )
    .action(async (id: string, opts) => {
      await runClose(program, id, opts, "dropped");
    });

  goal
    .command("list")
    .description("List goals")
    .option("-s, --status <status>", "Filter by status (active|achieved|dropped)")
    .option("-q, --quarter <code>", "Filter by quarter code (YYYY-Q[1-4])")
    .option("--limit <n>", "Maximum rows (default 50)", "50")
    .action(async (opts) => {
      await runList(program, opts);
    });

  goal
    .command("show")
    .description("Show one goal by id with linked-task summary")
    .argument("<id>", "Goal id (e.g. G-001)")
    .action(async (id: string) => {
      await runShow(program, id);
    });

  goal
    .command("linked-tasks")
    .description("List every task linked to a goal")
    .argument("<id>", "Goal id (e.g. G-001)")
    .option(
      "-s, --status <status>",
      "Filter by task status (e.g. in_progress)",
    )
    .action(async (id: string, opts) => {
      await runLinkedTasks(program, id, opts);
    });
}

// ---------------------------------------------------------------------------
// Subcommand implementations.
// ---------------------------------------------------------------------------

interface CreateOpts {
  description?: string;
  quarter: string;
}

async function runCreate(
  program: Command,
  title: string,
  opts: CreateOpts,
): Promise<void> {
  const ctx = ctxFromProgram(program);
  const titleParsed = parseTitle(title);
  const textInputs = new TextInputResolver();
  const rawDescription = await textInputs.resolve({
    inline: opts.description,
    inlineName: "--description",
  });
  const description = parseDescription(rawDescription ?? title);
  const quarter = parseQuarter(opts.quarter);

  const id = await composeGoalId();
  await db.insert(goals).values({
    id,
    title: titleParsed,
    description,
    quarter,
  });

  const row = await fetchGoalOrThrow(id);
  emit(ctx, {
    text: () =>
      [
        `Created ${id}: ${row.title}`,
        `  quarter:     ${row.quarter}`,
        `  status:      ${row.status}`,
        `  description: ${truncate(row.description, 80)}`,
      ].join("\n"),
    json: () => ({ ok: true, goal: serializeGoal(row) }),
  });
}

interface UpdateOpts {
  title?: string;
  description?: string;
  quarter?: string;
}

async function runUpdate(
  program: Command,
  id: string,
  opts: UpdateOpts,
): Promise<void> {
  const ctx = ctxFromProgram(program);
  const goalId = parseGoalId(id);
  await fetchGoalOrThrow(goalId);

  const patch: Record<string, unknown> = {};
  if (opts.title !== undefined) patch.title = parseTitle(opts.title);
  if (opts.description !== undefined) {
    const textInputs = new TextInputResolver();
    const rawDescription = await textInputs.resolve({
      inline: opts.description,
      inlineName: "--description",
    });
    patch.description = parseDescription(rawDescription ?? opts.description);
  }
  if (opts.quarter !== undefined) patch.quarter = parseQuarter(opts.quarter);

  if (Object.keys(patch).length === 0) {
    throw new InputValidationError(
      `No fields to update. Provide at least one of --title, --description, --quarter.`,
    );
  }

  await db.update(goals).set(patch).where(eq(goals.id, goalId));
  const updated = await fetchGoalOrThrow(goalId);
  emit(ctx, {
    text: () => `${goalId} updated.\n${formatGoalOneLine(updated)}`,
    json: () => ({ ok: true, goal: serializeGoal(updated) }),
  });
}

interface CloseOpts {
  yes?: boolean;
}

async function runClose(
  program: Command,
  id: string,
  opts: CloseOpts,
  toStatus: Exclude<GoalStatus, "active">,
): Promise<void> {
  const ctx = ctxFromProgram(program);
  const goalId = parseGoalId(id);
  const current = await fetchGoalOrThrow(goalId);

  if (TERMINAL_GOAL_STATUSES.has(current.status)) {
    throw new TransitionDeniedError(
      current.status,
      toStatus,
      "terminal_source",
      `Goal ${goalId} is already in terminal status '${current.status}'.`,
    );
  }

  if (!canTransitionGoal(current.status, toStatus)) {
    const reason = explainGoalTransition(current.status, toStatus);
    throw new TransitionDeniedError(
      current.status,
      toStatus,
      reason?.reason ?? "denied",
      reason?.message ?? `Cannot move ${current.status} -> ${toStatus}.`,
    );
  }

  // Per Appendix A.2.1: closing a goal is a terminal status change and
  // requires explicit confirmation. --yes is the operator's confirm.
  if (!opts.yes) {
    throw new InputValidationError(
      `Closing ${goalId} as '${toStatus}' is a terminal status change. Re-run with --yes to confirm.`,
      { goalId, fromStatus: current.status, toStatus },
    );
  }

  // Atomic write: status + closed_at inside one transaction. Linked
  // tasks are deliberately NOT cascaded (Appendix A.2.1 notes); they
  // remain on their independent lifecycle.
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(goals)
      .set({ status: toStatus, closedAt: now })
      .where(eq(goals.id, goalId));
  });

  emit(ctx, {
    text: () => `${goalId} marked ${toStatus} (was ${current.status}).`,
    json: () => ({
      ok: true,
      goalId,
      from: current.status,
      to: toStatus,
      changedAt: now.toISOString(),
    }),
  });
}

interface ListOpts {
  status?: string;
  quarter?: string;
  limit?: string;
}

async function runList(program: Command, opts: ListOpts): Promise<void> {
  const ctx = ctxFromProgram(program);

  const conditions = [];
  if (opts.status) conditions.push(eq(goals.status, parseGoalStatus(opts.status)));
  if (opts.quarter) conditions.push(eq(goals.quarter, parseQuarter(opts.quarter)));

  const limit = parseLimit(opts.limit ?? "50");
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(goals)
    .where(where)
    .orderBy(asc(goals.quarter), asc(goals.id))
    .limit(limit);

  emit(ctx, {
    text: () => {
      if (rows.length === 0) return "(no goals match)";
      return rows.map(formatGoalOneLine).join("\n");
    },
    json: () => ({
      ok: true,
      count: rows.length,
      goals: rows.map(serializeGoal),
    }),
  });
}

async function runShow(program: Command, id: string): Promise<void> {
  const ctx = ctxFromProgram(program);
  const goalId = parseGoalId(id);
  const row = await fetchGoalOrThrow(goalId);

  // Linked-task count includes ALL statuses (including done / cancelled).
  // Sample preview of up to 10 tasks ordered by recency.
  const linked = await db
    .select()
    .from(tasks)
    .where(eq(tasks.goalId, goalId))
    .orderBy(desc(tasks.lastStatusChangeAt))
    .limit(10);

  // Total count is a separate query so we can render N when there are
  // more than 10 (preview is bounded; count is exact).
  const allLinked = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.goalId, goalId));
  const totalLinked = allLinked.length;

  emit(ctx, {
    text: () => renderGoalShowText(row, totalLinked, linked),
    json: () => ({
      ok: true,
      goal: serializeGoal(row),
      linkedTaskCount: totalLinked,
      linkedTasksPreview: linked.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        needsAttention: t.needsAttention,
      })),
    }),
  });
}

interface LinkedTasksOpts {
  status?: string;
}

async function runLinkedTasks(
  program: Command,
  id: string,
  opts: LinkedTasksOpts,
): Promise<void> {
  const ctx = ctxFromProgram(program);
  const goalId = parseGoalId(id);
  await fetchGoalOrThrow(goalId);

  const conditions = [eq(tasks.goalId, goalId)];
  if (opts.status) conditions.push(eq(tasks.status, parseTaskStatus(opts.status)));

  const rows = await db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(desc(tasks.lastStatusChangeAt));

  emit(ctx, {
    text: () => {
      if (rows.length === 0) return `(no tasks linked to ${goalId})`;
      const lines = [`${goalId} linked tasks (${rows.length}):`];
      for (const t of rows) {
        lines.push("  " + formatLinkedTaskOneLine(t));
      }
      return lines.join("\n");
    },
    json: () => ({
      ok: true,
      goalId,
      count: rows.length,
      tasks: rows.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        category: t.category,
        owner: t.owner,
        dueAt: t.dueDate ? t.dueDate.toISOString() : null,
        needsAttention: t.needsAttention,
        lastStatusChangeAt: t.lastStatusChangeAt.toISOString(),
      })),
    }),
  });
}

// ---------------------------------------------------------------------------
// Input parsing.
// ---------------------------------------------------------------------------

function parseTitle(raw: string): string {
  const result = nonEmptyString(200).safeParse(raw);
  if (!result.success) {
    throw new InputValidationError(
      `Invalid title: ${result.error.issues[0]?.message ?? "must be 1-200 chars and non-empty"}.`,
    );
  }
  return result.data;
}

function parseDescription(raw: string): string {
  const result = nonEmptyString(10000).safeParse(raw);
  if (!result.success || raw.length < 10) {
    throw new InputValidationError(
      `Invalid description: must be at least 10 characters and at most 10000.`,
    );
  }
  return result.data;
}

function parseQuarter(raw: string): string {
  const result = QuarterCodeSchema.safeParse(raw);
  if (!result.success) {
    throw new InputValidationError(
      `Invalid --quarter '${raw}'. Expected format YYYY-Q[1-4] (e.g. 2026-Q2).`,
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

function parseGoalStatus(raw: string): GoalStatus {
  const result = GoalStatusSchema.safeParse(raw);
  if (!result.success) {
    throw new InputValidationError(
      `Invalid status '${raw}'. Expected one of active, achieved, dropped.`,
    );
  }
  return result.data;
}

function parseTaskStatus(raw: string): TaskStatus {
  const result = TaskStatusSchema.safeParse(raw);
  if (!result.success) {
    throw new InputValidationError(
      `Invalid status '${raw}'. Expected one of triage, backlog, in_progress, blocked, review, done, cancelled.`,
    );
  }
  return result.data;
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

// ---------------------------------------------------------------------------
// DB helpers.
// ---------------------------------------------------------------------------

interface GoalRow {
  id: string;
  title: string;
  description: string;
  quarter: string;
  status: GoalStatus;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}

async function fetchGoalOrThrow(id: string): Promise<GoalRow> {
  const rows = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
  if (rows.length === 0) throw new GoalNotFoundError(id);
  return rows[0] as GoalRow;
}

interface LinkedTaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  category: TaskCategory;
  owner: string | null;
  dueDate: Date | null;
  needsAttention: boolean;
  lastStatusChangeAt: Date;
}

// ---------------------------------------------------------------------------
// Output rendering.
// ---------------------------------------------------------------------------

function serializeGoal(row: GoalRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    quarter: row.quarter,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  };
}

function formatGoalOneLine(row: GoalRow): string {
  return `${row.id}  ${row.quarter}  ${row.status.padEnd(8)}  ${row.title}`;
}

function formatLinkedTaskOneLine(row: LinkedTaskRow): string {
  const flag = row.needsAttention ? " [!]" : "";
  const pri = row.priority ?? "-";
  return `${row.id}  ${pri}  ${row.status.padEnd(11)}  ${row.title}${flag}`;
}

function renderGoalShowText(
  row: GoalRow,
  totalLinked: number,
  linked: LinkedTaskRow[],
): string {
  const lines: string[] = [];
  lines.push(`${row.id}  ${row.title}`);
  lines.push("");
  lines.push(`status:      ${row.status}`);
  lines.push(`quarter:     ${row.quarter}`);
  if (row.closedAt) {
    lines.push(`closed at:   ${row.closedAt.toISOString()}`);
  }
  lines.push("");
  lines.push(`description:`);
  lines.push(indent(row.description, "  "));
  lines.push("");
  lines.push(`linked tasks: ${totalLinked}`);
  if (linked.length > 0) {
    const previewLabel =
      totalLinked > linked.length
        ? `  (showing ${linked.length} most-recent of ${totalLinked})`
        : "";
    lines.push(previewLabel);
    for (const t of linked) {
      lines.push("  " + formatLinkedTaskOneLine(t));
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
// Mirrors the export pattern in `task.ts` so the schemas-contract test
// covers `goal` exactly the way it covers task / health / review. The
// MCP layer and the local dashboard consume `Schemas` to build typed
// callers without re-deriving the JSON contract from the action code.
//
// Each subcommand has { input, output, exitCodes, errorCategories }.
// ---------------------------------------------------------------------------

const isoDateString = z.string().refine(
  (s) => !Number.isNaN(Date.parse(s)),
  { message: "expected ISO-8601 date string" },
);

const SerializedGoalSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  quarter: QuarterCodeSchema,
  status: GoalStatusSchema,
  createdAt: isoDateString,
  updatedAt: isoDateString,
  closedAt: isoDateString.nullable(),
});

const LinkedTaskPreviewSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema.nullable(),
  needsAttention: z.boolean(),
});

const LinkedTaskFullSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema.nullable(),
  category: TaskCategorySchema,
  owner: z.string().nullable(),
  dueAt: isoDateString.nullable(),
  needsAttention: z.boolean(),
  lastStatusChangeAt: isoDateString,
});

const GoalCommonExitCodes = [
  EXIT_OK,
  EXIT_GENERIC,
  EXIT_INPUT_VALIDATION,
] as const;

const GoalCommonErrorCategories = [
  "input_validation",
  "unhandled",
] as const;

export const Schemas = {
  create: {
    input: z.object({
      title: nonEmptyString(200),
      description: z.string().min(10).max(10000).optional(),
      quarter: QuarterCodeSchema,
    }),
    output: z.object({
      ok: z.literal(true),
      goal: SerializedGoalSchema,
    }),
    exitCodes: [...GoalCommonExitCodes] as readonly number[],
    errorCategories: [...GoalCommonErrorCategories] as readonly string[],
  },
  update: {
    input: z.object({
      id: z.string().regex(/^G-\d{3,}$/),
      title: nonEmptyString(200).optional(),
      description: z.string().min(10).max(10000).optional(),
      quarter: QuarterCodeSchema.optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      goal: SerializedGoalSchema,
    }),
    exitCodes: [
      ...GoalCommonExitCodes,
      EXIT_GOAL_NOT_FOUND,
    ] as readonly number[],
    errorCategories: [
      ...GoalCommonErrorCategories,
      "goal_not_found",
    ] as readonly string[],
  },
  closeAchieved: {
    input: z.object({
      id: z.string().regex(/^G-\d{3,}$/),
      yes: z.boolean().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      goalId: z.string(),
      from: GoalStatusSchema,
      to: z.literal("achieved"),
      changedAt: isoDateString,
    }),
    exitCodes: [
      ...GoalCommonExitCodes,
      EXIT_GOAL_NOT_FOUND,
      EXIT_TRANSITION_DENIED,
    ] as readonly number[],
    errorCategories: [
      ...GoalCommonErrorCategories,
      "goal_not_found",
      "transition_denied",
    ] as readonly string[],
  },
  closeDropped: {
    input: z.object({
      id: z.string().regex(/^G-\d{3,}$/),
      yes: z.boolean().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      goalId: z.string(),
      from: GoalStatusSchema,
      to: z.literal("dropped"),
      changedAt: isoDateString,
    }),
    exitCodes: [
      ...GoalCommonExitCodes,
      EXIT_GOAL_NOT_FOUND,
      EXIT_TRANSITION_DENIED,
    ] as readonly number[],
    errorCategories: [
      ...GoalCommonErrorCategories,
      "goal_not_found",
      "transition_denied",
    ] as readonly string[],
  },
  list: {
    input: z.object({
      status: GoalStatusSchema.optional(),
      quarter: QuarterCodeSchema.optional(),
      limit: z.string().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      count: z.number().int().nonnegative(),
      goals: z.array(SerializedGoalSchema),
    }),
    exitCodes: [...GoalCommonExitCodes] as readonly number[],
    errorCategories: [...GoalCommonErrorCategories] as readonly string[],
  },
  show: {
    input: z.object({
      id: z.string().regex(/^G-\d{3,}$/),
    }),
    output: z.object({
      ok: z.literal(true),
      goal: SerializedGoalSchema,
      linkedTaskCount: z.number().int().nonnegative(),
      linkedTasksPreview: z.array(LinkedTaskPreviewSchema),
    }),
    exitCodes: [
      ...GoalCommonExitCodes,
      EXIT_GOAL_NOT_FOUND,
    ] as readonly number[],
    errorCategories: [
      ...GoalCommonErrorCategories,
      "goal_not_found",
    ] as readonly string[],
  },
  linkedTasks: {
    input: z.object({
      id: z.string().regex(/^G-\d{3,}$/),
      status: TaskStatusSchema.optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      goalId: z.string(),
      count: z.number().int().nonnegative(),
      tasks: z.array(LinkedTaskFullSchema),
    }),
    exitCodes: [
      ...GoalCommonExitCodes,
      EXIT_GOAL_NOT_FOUND,
    ] as readonly number[],
    errorCategories: [
      ...GoalCommonErrorCategories,
      "goal_not_found",
    ] as readonly string[],
  },
} as const;

export type GoalCommandName = keyof typeof Schemas;
