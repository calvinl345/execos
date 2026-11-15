import { Command } from "commander";
import { and, asc, desc, eq, inArray, lte, not, sql } from "drizzle-orm";
import { z } from "zod";
import { db, tasks, goals, memories, taskNotes, team } from "../../db/index.js";
import { appendTaskNote, tryAppendGateEvent } from "../../db/helpers/index.js";
import type { TaskEffort } from "../../db/schema.js";
import { TaskNotFoundError } from "../../db/errors.js";
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
  EXIT_TRANSITION_DENIED,
  EXIT_WIP_CAP_EXCEEDED,
  type CliError,
} from "../errors.js";
import { TERMINAL_TASK_STATUSES } from "../../domain/status-transitions.js";
import { embed } from "../../embeddings/index.js";
import { retrieveMemories } from "../../domain/memory-retrieval.js";
import {
  COMPOSED_WORK_ORDER_CAP,
  compileComposedHydration,
  compileHydrationPrompt,
  compileReceipt,
  parseComposedOperationSpec,
  type ComposedOrderSpec,
  type ComposedWorkOrderInput,
} from "../../domain/taskops-hydration.js";
import { loadTaskopsTemplate } from "../adapters/taskops-templates.js";
import {
  parseNaturalDate,
  getHostTimeZone,
  resolveTimeZone,
  addBusinessDaysInTz,
  DEFAULT_DUE_BUSINESS_DAYS,
} from "../../domain/dates.js";
import { defaultFollowUpDate, followUpAfterDueWarning, resolveOwnerToTeamSlug } from "../../domain/follow-ups.js";
import { ownerInference } from "../../domain/intake.js";
import { dedupSuggestion } from "../../domain/memory-policy.js";
import {
  FollowUpServiceError,
  deferOperation,
  delegateOperation,
  recordFollowUpOperation,
  type DeferReceipt,
  type DelegateReceipt,
  type RecordFollowUpReceipt,
} from "../../services/follow-up-operations.js";
import {
  TaskServiceError,
  cancelTaskOperation,
  completeTaskOperation,
  createTaskOperation,
  productionTaskOperationDeps,
  reopenTaskOperation,
  updateTaskOperation,
  type DedupMatch,
  type NonTerminalTaskStatus,
  type ReopenTargetTaskStatus,
} from "../../services/task-operations.js";
import { QueueServiceError, queueOperation } from "../../services/queue-operations.js";
import {
  CurationServiceError,
  dependencyAddOperation,
  dependencyRemoveOperation,
  flagAttentionOperation,
  unflagAttentionOperation,
} from "../../services/task-curation-operations.js";
import {
  commitmentsAtRisk,
  goalsAtRisk,
  newlyUnblocked,
  type CommitmentAtRiskRow,
  type GoalAtRiskRow,
  type NewlyUnblockedRow,
} from "../../domain/risk-detectors.js";
import { loadSettings } from "../settings-loader.js";
import { ctxFromProgram } from "../index-shared.js";
import { emit, type FormatterContext } from "../output-formatters/index.js";
import { InputValidationError, TransitionDeniedError } from "../errors.js";
import { TextInputResolver } from "../text-input.js";
import { selectGoalRiskInputs, selectOpenRiskTasks } from "./goal-risk.js";
import { rankEligible } from "./rank-eligible.js";
import { partitionReviewCandidates } from "./review-candidates.js";

// ---------------------------------------------------------------------------
// CLI Command Registration.
// ---------------------------------------------------------------------------

export function registerTaskopsCommand(program: Command): void {
  const taskops = program
    .command("taskops")
    .description("Operational contract commands for context hydration and CRUD execution");

  taskops
    .command("hydrate")
    .description("Hydrate task management prompt context (single operation, or a composed batch via repeated --op)")
    .option("-o, --operation <operation>", "Operation type (create, update, complete, ...)")
    .option("-i, --intent <text>", "User intent description")
    .option("-t, --task-id <id>", "Task ID (e.g. KS-001)")
    .option(
      "--op <spec>",
      `Composed work order, repeatable up to ${COMPOSED_WORK_ORDER_CAP} per call: "create:<intent>" or "<operation>:<task-id>[:<intent>]"`,
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .action(async (opts) => {
      await runHydrate(program, opts);
    });

  taskops
    .command("create")
    .description("Create a task through the unified create service (dedup-gated)")
    .argument("[title]", "Task title")
    .option("-t, --title <text>", "Task title (alternative to positional title)")
    .option("-d, --description <text>", "Task description (>=10 chars). Use - to read from stdin")
    .option("--description-file <path>", "Read task description from a UTF-8 text file, or - for stdin")
    .option("--note <text>", "Append an initial manual note. Use - to read from stdin")
    .option("--note-file <path>", "Read an initial manual note from a UTF-8 text file, or - for stdin")
    .option("--return-detail", "Return full created task detail, including recent notes")
    .requiredOption("-c, --category <category>", "Task category")
    .option("-p, --priority <P0|P1|P2|P3>", "Task priority (explicit only; never inferred)")
    .option("-s, --status <status>", "Initial status (non-terminal; default triage)")
    .option(
      "--due <phrase>",
      "Due date natural-language phrase; defaults to 3 business days out when omitted",
    )
    .option("--goal-id <id>", "Goal ID")
    .option("--owner <name>", "Owner; must be 'me' (teammate owners go through 'taskops delegate')")
    .option("--effort <size>", "T-shirt effort estimate (S, M, L, XL)")
    .option("--hard-deadline", "Mark the due date as a hard external commitment")
    .option("--tz <iana>", "Time zone for --due parsing (default: host)")
    .option(
      "--allow-duplicate <justification>",
      "Override a duplicate-gate refusal with a non-empty justification (recorded in the audit note and receipt)",
    )
    .action(async (title: string | undefined, opts) => {
      await runTaskopsCreate(program, title, opts);
    });

  taskops
    .command("update")
    .description("Update task fields (including goal link/unlink) through the update service")
    .requiredOption("--task-id <id>", "Task ID")
    .option("-t, --title <text>", "New title")
    .option("-d, --description <text>", "New description (>=10 chars). Use - to read from stdin")
    .option("--description-file <path>", "Read new description from a UTF-8 text file, or - for stdin")
    .option("-p, --priority <priority>", "New priority")
    .option("-c, --category <category>", "New category")
    .option("-s, --status <status>", "New status (non-terminal; terminal moves use complete/cancel)")
    .option("--due <phrase>", "New due date phrase")
    .option("--owner <name>", "New owner; must be 'me' (teammate owners go through 'taskops delegate')")
    .option("--goal-id <id>", "Link the task to this goal")
    .option("--clear-goal", "Remove the task's goal link")
    .option("--effort <size>", "New t-shirt effort estimate (S, M, L, XL)")
    .option("--clear-effort", "Remove the task's effort estimate")
    .option("--hard-deadline <true|false>", "Set or clear the hard-deadline marker")
    .option("--note <text>", "Append a manual note. Use - to read from stdin")
    .option("--note-file <path>", "Read a manual note from a UTF-8 text file, or - for stdin")
    .option("--tz <iana>", "Time zone for --due parsing (default: host)")
    .action(async (opts) => {
      await runTaskopsUpdate(program, opts);
    });

  taskops
    .command("complete")
    .description("Mark a task done (terminal; requires --yes)")
    .requiredOption("--task-id <id>", "Task ID")
    .option("-y, --yes", "Confirm the terminal transition (required)", false)
    .option("--note <text>", "Append a closing manual note")
    .action(async (opts) => {
      await runTaskopsComplete(program, opts);
    });

  taskops
    .command("cancel")
    .description("Mark a task cancelled (terminal; requires --yes)")
    .requiredOption("--task-id <id>", "Task ID")
    .option("-y, --yes", "Confirm the terminal transition (required)", false)
    .option("--note <text>", "Append a closing manual note")
    .action(async (opts) => {
      await runTaskopsCancel(program, opts);
    });

  taskops
    .command("reopen")
    .description("Reopen a done or cancelled task to active work")
    .requiredOption("--task-id <id>", "Task ID")
    .option("--to <status>", "Restore to backlog, in_progress, blocked, or review")
    .option("--note <text>", "Append a reopen note")
    .action(async (opts) => {
      await runTaskopsReopen(program, opts);
    });

  taskops
    .command("delegate")
    .description("Delegate a task to a resolved team owner and set follow-up date")
    .requiredOption("--task-id <id>", "Task ID")
    .requiredOption("--owner <teamSlug>", "Team owner slug")
    .option("--follow-up <phrase>", "Follow-up date phrase")
    .option("--due <phrase>", "Optional due date phrase")
    .option("--note <text>", "Optional delegation context note (standard flag)")
    .option("--notes <text>", "Alias for --note (back-compat)")
    .action(async (opts) => {
      await runTaskopsDelegate(program, opts);
    });

  taskops
    .command("follow-up")
    .description("Record a delegated follow-up result")
    .requiredOption("--task-id <id>", "Task ID")
    .requiredOption("--update <text>", "Delegate update text")
    .requiredOption("--next <phrase>", "Next follow-up date phrase")
    .option("--due <phrase>", "Optional revised due date phrase")
    .option("--status <status>", "Optional revised task status")
    .action(async (opts) => {
      await runTaskopsFollowUp(program, opts);
    });

  taskops
    .command("defer")
    .description("Defer/snooze a task or follow-up until a future date")
    .requiredOption("--task-id <id>", "Task ID")
    .requiredOption("--until <phrase>", "Future resurface date phrase")
    .action(async (opts) => {
      await runTaskopsDefer(program, opts);
    });

  taskops
    .command("dependency-add")
    .description("Record that one task is blocked by another task")
    .option("--blocked <id>", "Task that is blocked")
    .option("--task-id <id>", "Alias for --blocked (the blocked task)")
    .requiredOption("--blocked-by <id>", "Task that must finish first")
    .action(async (opts) => {
      await runTaskopsDependency(program, "dependency-add", opts);
    });

  taskops
    .command("dependency-remove")
    .description("Remove a task dependency edge")
    .option("--blocked <id>", "Task that is blocked")
    .option("--task-id <id>", "Alias for --blocked (the blocked task)")
    .requiredOption("--blocked-by <id>", "Task that was blocking it")
    .action(async (opts) => {
      await runTaskopsDependency(program, "dependency-remove", opts);
    });

  taskops
    .command("flag-attention")
    .description("Flag a task as needing attention")
    .requiredOption("--task-id <id>", "Task ID")
    .option("-r, --reason <text>", "Reason (<=200 chars)")
    .action(async (opts) => {
      await runTaskopsFlagAttention(program, opts);
    });

  taskops
    .command("unflag-attention")
    .description("Clear the needs-attention flag on a task")
    .requiredOption("--task-id <id>", "Task ID")
    .action(async (opts) => {
      await runTaskopsUnflagAttention(program, opts);
    });

  taskops
    .command("follow-ups")
    .description("Hydrate due follow-ups grouped by person")
    .action(async () => {
      await runTaskopsFollowUps(program, "follow-ups");
    });

  taskops
    .command("draft-follow-ups")
    .description("Hydrate per-person follow-up context for Slack drafts")
    .action(async () => {
      await runTaskopsFollowUps(program, "draft-follow-ups");
    });

  taskops
    .command("show")
    .description("Hydrate and show details of a specific task")
    .argument("<id>", "Task ID (e.g. KS-001)")
    .option("-i, --intent <text>", "User intent description (optional, for memory search)")
    .action(async (id: string, opts) => {
      await runTaskopsShow(program, id, opts);
    });

  taskops
    .command("list")
    .description("Hydrate and show active tasks and goals")
    .action(async () => {
      await runTaskopsList(program);
    });

  taskops
    .command("re-rank")
    .description("Execute a re-rank: replace or clear the agent prioritized do-next queue of open tasks")
    .option(
      "--task <id>",
      "Task ID to place in the queue (repeatable, order defines rank)",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option(
      "--why <text>",
      "Agent rationale for why this task is queued (repeatable, matches --task order)",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option("--clear", "Clear the entire queue", false)
    .action(async (opts) => {
      await runTaskopsReRank(program, opts);
    });
}

// ---------------------------------------------------------------------------
// Service error mapping (commands parse flags, call ONE service, format the
// receipt; service refusal/error codes map onto the existing CLI error
// classes the classifier in src/cli/errors.ts already understands).
// ---------------------------------------------------------------------------

async function serviceCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof FollowUpServiceError) {
      throw new InputValidationError(err.message);
    }
    if (err instanceof TaskServiceError) {
      throw mapTaskServiceError(err);
    }
    if (err instanceof CurationServiceError) {
      throw new InputValidationError(err.message);
    }
    if (err instanceof QueueServiceError) {
      throw new InputValidationError(err.message);
    }
    throw err;
  }
}

function mapTaskServiceError(err: TaskServiceError): CliError {
  if (err.code === "terminal_task" || err.code === "illegal_transition") {
    const match = /from (\S+) to (\S+?)\.?$/.exec(err.message);
    return new TransitionDeniedError(
      match?.[1] ?? "unknown",
      match?.[2] ?? "unknown",
      err.code === "terminal_task" ? "terminal_source" : "denied",
      err.message,
    );
  }
  // goal_not_found, due_required, owner_not_self, validation: bad input on
  // this surface.
  return new InputValidationError(err.message);
}

function duplicateRefusalError(matches: DedupMatch[]): InputValidationError {
  const lines = matches.map((m) => {
    const base = `  - ${m.id} | ${m.title} | similarity ${m.similarity.toFixed(2)} | band ${m.band}`;
    return m.band === "exact" && m.matchedOn !== undefined
      ? `${base} | matched_on ${m.matchedOn}`
      : base;
  });
  return new InputValidationError(
    [
      "Create refused: near-duplicate open tasks found:",
      ...lines,
      'Update the existing task instead, or re-run with --allow-duplicate "<justification>" if this is genuinely a new task (the justification is audited).',
    ].join("\n"),
  );
}

function emitWarningLines(ctx: FormatterContext, warnings: string[]): void {
  for (const warning of warnings) {
    ctx.err(`warning: ${warning}\n`);
  }
}

// ---------------------------------------------------------------------------
// Hydrate.
// ---------------------------------------------------------------------------

interface HydrateOpts {
  operation?: string;
  intent?: string;
  taskId?: string;
  /** Repeatable composed work-order specifiers (`--op`). */
  op: string[];
}

const HYDRATE_READ_OPERATIONS = new Set([
  "list",
  "show",
  "follow-ups",
  "draft-follow-ups",
]);

const HYDRATE_WRITE_OPERATIONS = new Set([
  "create",
  "update",
  "complete",
  "cancel",
  "reopen",
  "delegate",
  "follow-up",
  "defer",
  "dependency-add",
  "dependency-remove",
  "flag-attention",
  "unflag-attention",
  "re-rank",
]);

/** Candidate count requested for the create duplicate-gate preview. */
const DEDUP_PREVIEW_LIMIT = 5;

/** Retrieve the top-k memories relevant to an already-embedded intent. */
async function memoriesForEmbedding(queryEmbedding: number[]): Promise<typeof memories.$inferSelect[]> {
  const activeMemories = await db
    .select()
    .from(memories)
    .where(eq(memories.state, "active"));
  return retrieveMemories({
    queryContentEmbedding: queryEmbedding,
    queryApplicabilityEmbedding: queryEmbedding,
    memories: activeMemories,
    k: 5,
  });
}

/** Create duplicate-gate preview (A9): the same nearestTasks seam + band
 * classification the create service runs, so dedup matches are a true preview
 * of the gate. Throws on failure; callers degrade to empty matches + warning. */
async function dedupPreviewForEmbedding(queryEmbedding: number[]): Promise<DedupMatch[]> {
  const settingsResult = await loadSettings();
  const candidates = await productionTaskOperationDeps.nearestTasks(
    queryEmbedding,
    DEDUP_PREVIEW_LIMIT,
  );
  return candidates
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      similarity: candidate.similarity,
      band: dedupSuggestion(candidate.similarity, settingsResult.settings),
    }))
    .filter((match) => match.band !== "no_match");
}

async function runHydrate(program: Command, opts: HydrateOpts): Promise<void> {
  const now = new Date();
  if (opts.op.length > 0) {
    if (opts.operation !== undefined || opts.intent !== undefined || opts.taskId !== undefined) {
      throw new InputValidationError(
        "Use either the single-operation flags (--operation/--intent/--task-id) or repeated --op work-order specifiers, not both.",
      );
    }
    await runComposedHydrate(program, opts.op);
    return;
  }
  if (opts.operation === undefined) {
    throw new InputValidationError(
      "Single-operation hydrate requires --operation <operation>. To hydrate a batch in one call, pass repeated --op specifiers instead.",
    );
  }

  const operation = opts.operation.toLowerCase();

  // The re-rank packet has its own assembly lane (ranked candidates, risk
  // detectors, current queue). --intent is optional here: it carries Jordan's
  // situational context for today's ranking, not an operation description.
  if (operation === "re-rank") {
    await runHydrateReRank(program, opts.intent);
    return;
  }

  if (opts.intent === undefined) {
    throw new InputValidationError(
      "Single-operation hydrate requires --operation <operation> and --intent <text>. To hydrate a batch in one call, pass repeated --op specifiers instead.",
    );
  }
  const intent = opts.intent;

  const ctx = ctxFromProgram(program);

  if (HYDRATE_READ_OPERATIONS.has(operation)) {
    throw new InputValidationError(
      `Operation '${opts.operation}' is a read-only request. Invoke 'execos taskops ${operation}' directly instead.`,
    );
  }

  if (!HYDRATE_WRITE_OPERATIONS.has(operation)) {
    throw new InputValidationError(
      `Unsupported operation '${opts.operation}'. Supported operations: ${[...HYDRATE_WRITE_OPERATIONS].join(", ")}.`,
    );
  }

  // Fetch context data
  const activeTasks = await db
    .select()
    .from(tasks)
    .where(not(inArray(tasks.status, ["done", "cancelled"])))
    .orderBy(desc(tasks.lastStatusChangeAt));

  const activeGoals = await db
    .select()
    .from(goals)
    .where(eq(goals.status, "active"))
    .orderBy(desc(goals.id));

  // Semantic query of memories. For create, embed failure degrades (empty
  // memories + empty dedup matches + warning) instead of failing the hydrate:
  // the agent must always be able to preview a create.
  const hydrateWarnings: string[] = [];
  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await embed(intent);
  } catch (err) {
    if (operation !== "create") throw err;
    const message = err instanceof Error ? err.message : String(err);
    hydrateWarnings.push(
      `Duplicate-check preview skipped: embedding unavailable (${message}).`,
    );
  }

  let matchedMemories: typeof memories.$inferSelect[] = [];
  if (queryEmbedding !== null) {
    matchedMemories = await memoriesForEmbedding(queryEmbedding);
  }

  // Create duplicate-gate preview (A9): failures degrade to empty matches
  // plus a warning.
  let dedupMatches: DedupMatch[] = [];
  if (operation === "create" && queryEmbedding !== null) {
    try {
      dedupMatches = await dedupPreviewForEmbedding(queryEmbedding);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dedupMatches = [];
      hydrateWarnings.push(`Duplicate-check preview skipped: ${message}.`);
    }
  }

  let targetTask = null;
  if (operation !== "create") {
    if (!opts.taskId) {
      throw new InputValidationError(`Operation '${opts.operation}' requires --task-id <id>.`);
    }
    const rows = await db.select().from(tasks).where(eq(tasks.id, opts.taskId)).limit(1);
    targetTask = rows[0] ?? null;
    if (!targetTask) {
      throw new TaskNotFoundError(opts.taskId);
    }
  }

  const teamRows = operation === "delegate" ? await db.select().from(team).orderBy(asc(team.displayName)) : [];
  let ownerOpenTasks: typeof tasks.$inferSelect[] = [];
  if (operation === "delegate") {
    const inferredOwner = ownerInference(intent).owner;
    const resolved = resolveOwnerToTeamSlug(inferredOwner, teamRows);
    if (resolved.status === "resolved") {
      ownerOpenTasks = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.owner, resolved.slug), not(inArray(tasks.status, ["done", "cancelled"]))))
        .orderBy(desc(tasks.lastStatusChangeAt));
    }
  }
  const targetNotes = operation === "follow-up" && opts.taskId
    ? await db
        .select()
        .from(taskNotes)
        .where(and(eq(taskNotes.taskId, opts.taskId), eq(taskNotes.noteType, "manual")))
        .orderBy(desc(taskNotes.createdAt))
        .limit(10)
    : [];
  const defaultDate = targetTask
    ? defaultFollowUpDate({ now, dueDate: targetTask.dueDate })
    : null;
  const defaultWarning = targetTask && defaultDate
    ? followUpAfterDueWarning({ followUpDate: defaultDate, dueDate: targetTask.dueDate })
    : { warning: false as const };
  const template = loadTaskopsTemplate(operation as Parameters<typeof loadTaskopsTemplate>[0], "hydrate");
  const prompt = compileHydrationPrompt(
    {
      operation: operation as Parameters<typeof compileHydrationPrompt>[0]["operation"],
      intent,
      taskId: opts.taskId,
      tasks: activeTasks,
      goals: activeGoals,
      memories: matchedMemories,
      targetTask,
      targetNotes,
      team: teamRows,
      ownerOpenTasks,
      defaultFollowUpDate: defaultDate,
      warnings: defaultWarning.warning ? [defaultWarning.message] : [],
      dedupMatches,
      now,
    },
    template,
  );

  emitWarningLines(ctx, hydrateWarnings);
  emit(ctx, {
    text: () => prompt,
    json: () => ({
      ok: true,
      prompt,
      as_of: now.toISOString(),
    }),
  });
}

// ---------------------------------------------------------------------------
// Composed hydrate: one call returns the context packets for many planned
// write operations (shared context once, instructions once per type, one
// numbered work order per operation). Assembly only — the write funnel (R2)
// and the per-operation template bijection (R6) are untouched.
// ---------------------------------------------------------------------------

async function runComposedHydrate(program: Command, rawSpecs: string[]): Promise<void> {
  const ctx = ctxFromProgram(program);
  const now = new Date();

  const specs: ComposedOrderSpec[] = rawSpecs.map((raw) => {
    try {
      return parseComposedOperationSpec(raw);
    } catch (err) {
      throw new InputValidationError(err instanceof Error ? err.message : String(err));
    }
  });

  // Cap: refuse, never truncate.
  if (specs.length > COMPOSED_WORK_ORDER_CAP) {
    throw new InputValidationError(
      `Composed hydrate refused: ${specs.length} work orders requested, cap is ${COMPOSED_WORK_ORDER_CAP} per call. ` +
        `Split the batch into waves of at most ${COMPOSED_WORK_ORDER_CAP}, run one composed hydrate per wave, ` +
        `and verify each wave's receipts before starting the next.`,
    );
  }

  // Shared context, fetched once for the whole batch.
  const activeTasks = await db
    .select()
    .from(tasks)
    .where(not(inArray(tasks.status, ["done", "cancelled"])))
    .orderBy(desc(tasks.lastStatusChangeAt));
  const activeGoals = await db
    .select()
    .from(goals)
    .where(eq(goals.status, "active"))
    .orderBy(desc(goals.id));
  const hasDelegate = specs.some((spec) => spec.operation === "delegate");
  const teamRows = hasDelegate ? await db.select().from(team).orderBy(asc(team.displayName)) : [];

  const hydrateWarnings: string[] = [];
  const orders: ComposedWorkOrderInput[] = [];

  for (const [index, spec] of specs.entries()) {
    const label = `work order ${index + 1} (${spec.operation}${spec.taskId ? ` ${spec.taskId}` : ""})`;

    // Per-intent memory retrieval. In a composed packet an embedding outage
    // degrades every work order (empty memories + warning) instead of failing
    // the batch: hydration is a preview, and the agent must always be able to
    // assemble its wave.
    let queryEmbedding: number[] | null = null;
    if (spec.intent) {
      try {
        queryEmbedding = await embed(spec.intent);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        hydrateWarnings.push(`${label}: memory retrieval skipped: embedding unavailable (${message}).`);
      }
    }
    const matchedMemories = queryEmbedding !== null ? await memoriesForEmbedding(queryEmbedding) : [];

    // Create duplicate-gate preview, per draft.
    let dedupMatches: DedupMatch[] = [];
    if (spec.operation === "create" && queryEmbedding !== null) {
      try {
        dedupMatches = await dedupPreviewForEmbedding(queryEmbedding);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        hydrateWarnings.push(`${label}: duplicate-check preview skipped: ${message}.`);
      }
    }

    // Target task resolution (everything except create). A missing task fails
    // the whole call before any packet is emitted.
    let targetTask: typeof tasks.$inferSelect | null = null;
    if (spec.operation !== "create") {
      const rows = await db.select().from(tasks).where(eq(tasks.id, spec.taskId!)).limit(1);
      targetTask = rows[0] ?? null;
      if (!targetTask) {
        throw new TaskNotFoundError(spec.taskId!);
      }
    }

    let ownerOpenTasks: typeof tasks.$inferSelect[] = [];
    if (spec.operation === "delegate" && spec.intent) {
      const inferredOwner = ownerInference(spec.intent).owner;
      const resolved = resolveOwnerToTeamSlug(inferredOwner, teamRows);
      if (resolved.status === "resolved") {
        ownerOpenTasks = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.owner, resolved.slug), not(inArray(tasks.status, ["done", "cancelled"]))))
          .orderBy(desc(tasks.lastStatusChangeAt));
      }
    }

    const targetNotes = spec.operation === "follow-up" && spec.taskId
      ? await db
          .select()
          .from(taskNotes)
          .where(and(eq(taskNotes.taskId, spec.taskId), eq(taskNotes.noteType, "manual")))
          .orderBy(desc(taskNotes.createdAt))
          .limit(10)
      : [];

    const defaultDate = targetTask
      ? defaultFollowUpDate({ now, dueDate: targetTask.dueDate })
      : null;
    const defaultWarning = targetTask && defaultDate
      ? followUpAfterDueWarning({ followUpDate: defaultDate, dueDate: targetTask.dueDate })
      : { warning: false as const };

    orders.push({
      operation: spec.operation,
      template: loadTaskopsTemplate(spec.operation, "hydrate"),
      context: {
        operation: spec.operation,
        intent: spec.intent,
        taskId: spec.taskId,
        tasks: [],
        goals: [],
        memories: matchedMemories,
        targetTask,
        targetNotes,
        team: teamRows,
        ownerOpenTasks,
        defaultFollowUpDate: defaultDate,
        warnings: defaultWarning.warning ? [defaultWarning.message] : [],
        dedupMatches,
        now,
      },
    });
  }

  const prompt = compileComposedHydration({
    tasks: activeTasks,
    goals: activeGoals,
    team: teamRows,
    orders,
    now,
  });

  emitWarningLines(ctx, hydrateWarnings);
  emit(ctx, {
    text: () => prompt,
    json: () => ({
      ok: true,
      prompt,
      as_of: now.toISOString(),
    }),
  });
}

// ---------------------------------------------------------------------------
// Create.
// ---------------------------------------------------------------------------

interface CreateOpts {
  title?: string;
  description?: string;
  descriptionFile?: string;
  note?: string;
  noteFile?: string;
  returnDetail?: boolean;
  category: string;
  priority?: string;
  status?: string;
  due?: string;
  goalId?: string;
  owner?: string;
  effort?: string;
  hardDeadline?: boolean;
  tz?: string;
  allowDuplicate?: string;
}

const TASK_EFFORT_VALUES: readonly TaskEffort[] = ["S", "M", "L", "XL"];

function parseEffort(value: string): TaskEffort {
  if ((TASK_EFFORT_VALUES as readonly string[]).includes(value)) {
    return value as TaskEffort;
  }
  throw new InputValidationError(
    `Invalid --effort value '${value}'. Expected one of: S, M, L, XL.`,
  );
}

async function runTaskopsCreate(
  program: Command,
  positionalTitle: string | undefined,
  opts: CreateOpts,
): Promise<void> {
  const ctx = ctxFromProgram(program);

  const titleRaw = opts.title ?? positionalTitle;
  if (!titleRaw || titleRaw.trim().length === 0) {
    throw new InputValidationError(
      "Task creation requires a title. Pass it positionally or with --title.",
    );
  }
  const title = titleRaw.trim();

  const textInputs = new TextInputResolver();
  const descriptionRaw = await textInputs.resolve({
    inline: opts.description,
    file: opts.descriptionFile,
    inlineName: "--description",
    fileName: "--description-file",
  });
  const description = (descriptionRaw ?? title).trim();
  if (description.length < 10) {
    throw new InputValidationError("Description must be at least 10 characters long.");
  }
  const initialNoteRaw = await textInputs.resolve({
    inline: opts.note,
    file: opts.noteFile,
    inlineName: "--note",
    fileName: "--note-file",
  });
  const initialNote = initialNoteRaw === undefined ? undefined : initialNoteRaw.trim();
  if (initialNote !== undefined && initialNote.length === 0) {
    throw new InputValidationError("Initial note must not be empty.");
  }

  const category = TaskCategorySchema.parse(opts.category);
  // D2: priority is explicit-only. No inference of any kind on this surface.
  const priority = opts.priority ? TaskPrioritySchema.parse(opts.priority) : undefined;

  let status: NonTerminalTaskStatus | undefined;
  if (opts.status !== undefined) {
    const parsed = TaskStatusSchema.parse(opts.status);
    if (TERMINAL_TASK_STATUSES.has(parsed)) {
      throw new InputValidationError(
        `Initial status '${parsed}' is terminal; tasks are created into non-terminal statuses only.`,
      );
    }
    status = parsed as NonTerminalTaskStatus;
  }

  // ISS-008: --due is optional. When the user gives no due signal, default
  // to 3 business days out (weekend-avoiding). The service still enforces
  // R27 (createTaskOperation refuses an undefined dueAt), so every task
  // ends up with a due date regardless of which branch supplied it.
  const dueAt =
    opts.due !== undefined
      ? parseDatePhrase("due", opts.due, opts.tz)
      : defaultDueDate(opts.tz);
  const dueWasDefaulted = opts.due === undefined;
  const effort = opts.effort !== undefined ? parseEffort(opts.effort) : undefined;

  // Valued override (decision 006): --allow-duplicate carries a mandatory
  // justification; empty or whitespace-only is rejected on this surface.
  let allowDuplicate: string | undefined;
  if (opts.allowDuplicate !== undefined) {
    allowDuplicate = opts.allowDuplicate.trim();
    if (allowDuplicate.length === 0) {
      throw new InputValidationError(
        '--allow-duplicate requires a non-empty justification, e.g. --allow-duplicate "recurring weekly task, prior KS-041 covers last week only".',
      );
    }
  }

  const result = await serviceCall(() =>
    createTaskOperation({
      title,
      description,
      category,
      priority,
      status,
      dueAt,
      goalId: opts.goalId,
      owner: opts.owner,
      hardDeadline: opts.hardDeadline === true,
      effort,
      initialNote,
      allowDuplicate,
    }),
  );

  if (!result.ok) {
    // D4 duplicate refusal: structured refusal surfaced as input validation
    // listing the matches and the --allow-duplicate override.
    throw duplicateRefusalError(result.matches);
  }

  const receipt = result.receipt;
  const recentNotes = opts.returnDetail
    ? await db
        .select()
        .from(taskNotes)
        .where(eq(taskNotes.taskId, receipt.taskId))
        .orderBy(desc(taskNotes.createdAt))
        .limit(10)
    : null;

  // ISS-008: surface that the due date was defaulted so the agent can flag it
  // to Jordan. Kept in the existing free-form warnings channel (no contract
  // change) so it appears in both the human receipt and the JSON output.
  const warnings = dueWasDefaulted
    ? [
        ...receipt.warnings,
        `Due date was defaulted to ${DEFAULT_DUE_BUSINESS_DAYS} business days out because no due date was given; pass --due to set a specific date.`,
      ]
    : receipt.warnings;

  emitWarningLines(ctx, warnings);
  const receiptTemplate = loadTaskopsTemplate("create", "receipt");
  emit(ctx, {
    text: () => {
      let body = compileReceipt({ operation: "create", task: receipt.task }, receiptTemplate);
      if (receipt.dedup.overridden) {
        const matchIds = receipt.dedup.matches.map((m) => m.id).join(", ");
        body += `\nduplicate override: ${receipt.dedup.justification} (matches: ${matchIds})`;
      }
      if (!recentNotes) return body;
      const noteLines = recentNotes.map(
        (note) => `- [${note.noteType}] (${note.createdBy}) ${note.content}`,
      );
      return `${body}\nRecent notes:\n${noteLines.length > 0 ? noteLines.join("\n") : "- none"}`;
    },
    json: () => ({
      ok: true,
      task: serializeTaskopsTask(receipt.task),
      warnings,
      dedup: {
        matches: receipt.dedup.matches,
        overridden: receipt.dedup.overridden,
        justification: receipt.dedup.justification,
      },
      ...(recentNotes
        ? {
            detail: {
              recentNotes: recentNotes.map((note) => ({
                id: note.id,
                type: note.noteType,
                createdAt: note.createdAt.toISOString(),
                createdBy: note.createdBy,
                content: note.content,
              })),
            },
          }
        : {}),
    }),
  });
}

// ---------------------------------------------------------------------------
// Update.
// ---------------------------------------------------------------------------

interface UpdateOpts {
  taskId: string;
  title?: string;
  description?: string;
  descriptionFile?: string;
  priority?: string;
  category?: string;
  status?: string;
  due?: string;
  owner?: string;
  goalId?: string;
  clearGoal?: boolean;
  effort?: string;
  clearEffort?: boolean;
  hardDeadline?: string;
  note?: string;
  noteFile?: string;
  tz?: string;
}

async function runTaskopsUpdate(program: Command, opts: UpdateOpts): Promise<void> {
  const ctx = ctxFromProgram(program);

  const textInputs = new TextInputResolver();
  const descriptionRaw = await textInputs.resolve({
    inline: opts.description,
    file: opts.descriptionFile,
    inlineName: "--description",
    fileName: "--description-file",
  });
  let description: string | undefined;
  if (descriptionRaw !== undefined) {
    description = descriptionRaw.trim();
    if (description.length < 10) {
      throw new InputValidationError("Description must be at least 10 characters long.");
    }
  }

  // Manual note (ISS-003): resolve --note / --note-file with the same helper
  // used by create; an explicitly-provided empty note is rejected here, and
  // the service validates again as a backstop.
  const noteRaw = await textInputs.resolve({
    inline: opts.note,
    file: opts.noteFile,
    inlineName: "--note",
    fileName: "--note-file",
  });
  let note: string | undefined;
  if (noteRaw !== undefined) {
    note = noteRaw.trim();
    if (note.length === 0) {
      throw new InputValidationError("Note must not be empty.");
    }
  }

  if (opts.goalId !== undefined && opts.clearGoal) {
    throw new InputValidationError("Cannot use --goal-id and --clear-goal together; choose one.");
  }
  const goalId = opts.clearGoal ? null : opts.goalId;

  // Effort mirrors the goal-link precedent: --effort sets, --clear-effort
  // clears (null), neither leaves the field untouched (undefined).
  if (opts.effort !== undefined && opts.clearEffort) {
    throw new InputValidationError("Cannot use --effort and --clear-effort together; choose one.");
  }
  const effort: TaskEffort | null | undefined = opts.clearEffort
    ? null
    : opts.effort !== undefined
      ? parseEffort(opts.effort)
      : undefined;

  // --hard-deadline takes an explicit true/false so 'leave untouched'
  // (omitted) stays distinguishable from 'clear' (false).
  let hardDeadline: boolean | undefined;
  if (opts.hardDeadline !== undefined) {
    if (opts.hardDeadline !== "true" && opts.hardDeadline !== "false") {
      throw new InputValidationError(
        `Invalid --hard-deadline value '${opts.hardDeadline}'. Expected 'true' or 'false'.`,
      );
    }
    hardDeadline = opts.hardDeadline === "true";
  }

  let status: NonTerminalTaskStatus | undefined;
  if (opts.status !== undefined) {
    const parsed = TaskStatusSchema.parse(opts.status);
    if (TERMINAL_TASK_STATUSES.has(parsed)) {
      throw new InputValidationError(
        `Transitioning task ${opts.taskId} to terminal status '${parsed}' is not allowed in update command. Use taskops complete or taskops cancel.`,
      );
    }
    status = parsed as NonTerminalTaskStatus;
  }

  const receipt = await serviceCall(() =>
    updateTaskOperation({
      taskId: opts.taskId,
      title: opts.title !== undefined ? opts.title.trim() : undefined,
      description,
      category: opts.category !== undefined ? TaskCategorySchema.parse(opts.category) : undefined,
      priority: opts.priority !== undefined ? TaskPrioritySchema.parse(opts.priority) : undefined,
      status,
      dueAt: opts.due !== undefined ? parseDatePhrase("due", opts.due, opts.tz) : undefined,
      owner: opts.owner,
      goalId,
      hardDeadline,
      effort,
      note,
    }),
  );

  emitWarningLines(ctx, receipt.warnings);
  const receiptTemplate = loadTaskopsTemplate("update", "receipt");
  emit(ctx, {
    text: () => compileReceipt({ operation: "update", task: receipt.task }, receiptTemplate),
    json: () => ({
      ok: true,
      task: serializeTaskopsTask(receipt.task),
      warnings: receipt.warnings,
    }),
  });
}

// ---------------------------------------------------------------------------
// Complete / Cancel (terminal; --yes required on every surface, D3).
// ---------------------------------------------------------------------------

interface TerminalOpts {
  taskId: string;
  yes?: boolean;
  note?: string;
}

interface ReopenOpts {
  taskId: string;
  to?: string;
  note?: string;
}

async function requireTerminalConfirmation(
  operation: "complete" | "cancel",
  opts: TerminalOpts,
): Promise<void> {
  if (opts.yes !== true) {
    // terminal_confirmation gate (W5): the --yes refusal lives entirely at
    // this CLI surface (D3 keeps confirmation out of the services layer), so
    // the gate event is recorded here — standalone and best-effort; a
    // telemetry failure never turns the clean refusal into a crash.
    const telemetry = await tryAppendGateEvent(db, {
      gate: "terminal_confirmation",
      operation,
      outcome: "blocked",
      surface: "cli",
      taskId: opts.taskId,
      detail: { reason: "missing_yes" },
    });
    if (telemetry.warning) process.stderr.write(`${telemetry.warning}\n`);
    throw new InputValidationError(
      `'taskops ${operation}' is a terminal status change and requires --yes to confirm.`,
    );
  }
}

async function loadCurrentStatus(taskId: string, toStatus: "done" | "cancelled"): Promise<string> {
  const current = await productionTaskOperationDeps.findTask(taskId);
  if (!current) {
    throw new TaskNotFoundError(taskId);
  }
  if (TERMINAL_TASK_STATUSES.has(current.status)) {
    throw new TransitionDeniedError(
      current.status,
      toStatus,
      "terminal_source",
      `Task ${taskId} is already in terminal status '${current.status}'.`,
    );
  }
  return current.status;
}

async function appendClosingNote(taskId: string, note: string | undefined): Promise<void> {
  if (note === undefined) return;
  const trimmed = note.trim();
  if (trimmed.length === 0) {
    throw new InputValidationError("Closing note must not be empty.");
  }
  await appendTaskNote(db, {
    taskId,
    noteType: "manual",
    content: trimmed,
    createdBy: "agent",
  });
}

async function runTaskopsComplete(program: Command, opts: TerminalOpts): Promise<void> {
  const ctx = ctxFromProgram(program);
  await requireTerminalConfirmation("complete", opts);

  const from = await loadCurrentStatus(opts.taskId, "done");
  const receipt = await serviceCall(() => completeTaskOperation({ taskId: opts.taskId }));
  await appendClosingNote(opts.taskId, opts.note);

  const receiptTemplate = loadTaskopsTemplate("complete", "receipt");
  emit(ctx, {
    text: () => compileReceipt({ operation: "complete", task: receipt.task, from, to: "done" }, receiptTemplate),
    json: () => ({
      ok: true,
      taskId: opts.taskId,
      from,
      to: "done",
    }),
  });
}

async function runTaskopsCancel(program: Command, opts: TerminalOpts): Promise<void> {
  const ctx = ctxFromProgram(program);
  await requireTerminalConfirmation("cancel", opts);

  const from = await loadCurrentStatus(opts.taskId, "cancelled");
  const receipt = await serviceCall(() => cancelTaskOperation({ taskId: opts.taskId }));
  await appendClosingNote(opts.taskId, opts.note);

  const receiptTemplate = loadTaskopsTemplate("cancel", "receipt");
  emit(ctx, {
    text: () => compileReceipt({ operation: "cancel", task: receipt.task, from, to: "cancelled" }, receiptTemplate),
    json: () => ({
      ok: true,
      taskId: opts.taskId,
      from,
      to: "cancelled",
    }),
  });
}

function parseReopenTarget(value: string | undefined): ReopenTargetTaskStatus | undefined {
  if (value === undefined) return undefined;
  const parsed = TaskStatusSchema.parse(value);
  if (
    parsed === "backlog" ||
    parsed === "in_progress" ||
    parsed === "blocked" ||
    parsed === "review"
  ) {
    return parsed;
  }
  throw new InputValidationError(
    `Invalid --to value '${value}'. Reopen target must be one of: backlog, in_progress, blocked, review.`,
  );
}

async function runTaskopsReopen(program: Command, opts: ReopenOpts): Promise<void> {
  const ctx = ctxFromProgram(program);
  const toStatus = parseReopenTarget(opts.to);
  const receipt = await serviceCall(() =>
    reopenTaskOperation({
      taskId: opts.taskId,
      toStatus,
      note: opts.note,
    }),
  );

  const receiptTemplate = loadTaskopsTemplate("reopen", "receipt");
  emit(ctx, {
    text: () =>
      compileReceipt(
        { operation: "reopen", task: receipt.task, from: receipt.fromStatus, to: receipt.newStatus },
        receiptTemplate,
      ),
    json: () => ({
      ok: true,
      taskId: opts.taskId,
      from: receipt.fromStatus,
      to: receipt.newStatus,
    }),
  });
}

// ---------------------------------------------------------------------------
// Delegate / Follow-up / Defer.
// ---------------------------------------------------------------------------

interface DelegateOpts {
  taskId: string;
  owner: string;
  followUp?: string;
  due?: string;
  note?: string;
  notes?: string;
}

async function runTaskopsDelegate(program: Command, opts: DelegateOpts): Promise<void> {
  const ctx = ctxFromProgram(program);
  const followUpDate = opts.followUp ? parseDatePhrase("follow-up", opts.followUp) : null;
  const dueDate = opts.due ? parseDatePhrase("due", opts.due) : undefined;
  // ISS-003: --note is the standard flag; --notes remains a back-compat alias.
  const note = opts.note ?? opts.notes;
  const result = await delegateOperation({
    taskId: opts.taskId,
    ownerText: opts.owner,
    followUpDate,
    dueDate,
    note,
  });

  if (!result.ok) {
    throw new InputValidationError(
      result.resolution.status === "ambiguous"
        ? `Owner '${opts.owner}' is ambiguous. Matches: ${result.resolution.matches.map((m) => m.slug).join(", ")}.`
        : `Owner '${opts.owner}' did not resolve to a team row. Ask Jordan which team member to use.`,
    );
  }

  const receipt = result.receipt;
  const receiptTemplate = loadTaskopsTemplate("delegate", "receipt");
  emit(ctx, {
    text: () => compileReceipt(receiptContextForDelegate(receipt), receiptTemplate),
    json: () => ({
      ok: true,
      receipt: serializeDelegateReceipt(receipt),
    }),
  });
}

interface FollowUpOpts {
  taskId: string;
  update: string;
  next: string;
  due?: string;
  status?: string;
}

async function runTaskopsFollowUp(program: Command, opts: FollowUpOpts): Promise<void> {
  const ctx = ctxFromProgram(program);
  const nextFollowUpDate = parseDatePhrase("next", opts.next);
  const dueDate = opts.due ? parseDatePhrase("due", opts.due) : undefined;
  const status = opts.status ? TaskStatusSchema.parse(opts.status) : undefined;
  const receipt = await serviceCall(() =>
    recordFollowUpOperation({
      taskId: opts.taskId,
      update: opts.update,
      nextFollowUpDate,
      dueDate,
      status,
    }),
  );

  const receiptTemplate = loadTaskopsTemplate("follow-up", "receipt");
  emit(ctx, {
    text: () => compileReceipt(receiptContextForFollowUp(receipt), receiptTemplate),
    json: () => ({
      ok: true,
      receipt: serializeFollowUpReceipt(receipt),
    }),
  });
}

interface DeferOpts {
  taskId: string;
  until: string;
}

async function runTaskopsDefer(program: Command, opts: DeferOpts): Promise<void> {
  const ctx = ctxFromProgram(program);
  const until = parseDatePhrase("until", opts.until);
  const receipt = await serviceCall(() => deferOperation({ taskId: opts.taskId, until }));

  const receiptTemplate = loadTaskopsTemplate("defer", "receipt");
  emit(ctx, {
    text: () => compileReceipt(receiptContextForDefer(receipt), receiptTemplate),
    json: () => ({
      ok: true,
      receipt: serializeDeferReceipt(receipt),
    }),
  });
}

// ---------------------------------------------------------------------------
// Dependencies + attention flags (curation services).
// ---------------------------------------------------------------------------

interface DependencyOpts {
  blocked?: string;
  taskId?: string;
  blockedBy: string;
}

async function runTaskopsDependency(
  program: Command,
  operation: "dependency-add" | "dependency-remove",
  opts: DependencyOpts,
): Promise<void> {
  const ctx = ctxFromProgram(program);
  const blockedTaskId = opts.blocked ?? opts.taskId;
  if (!blockedTaskId) {
    throw new InputValidationError(
      `'taskops ${operation}' requires the blocked task via --blocked <id> (or --task-id <id>).`,
    );
  }

  const receipt =
    operation === "dependency-add"
      ? await serviceCall(() =>
          dependencyAddOperation({ blockedTaskId, blockerTaskId: opts.blockedBy }),
        )
      : await serviceCall(() =>
          dependencyRemoveOperation({ blockedTaskId, blockerTaskId: opts.blockedBy }),
        );

  const receiptTemplate = loadTaskopsTemplate(operation, "receipt");
  emit(ctx, {
    text: () =>
      compileReceipt(
        { operation, task: receipt.task, blockedBy: receipt.blockerTaskId },
        receiptTemplate,
      ),
    json: () => ({
      ok: true,
      blockedTaskId: receipt.blockedTaskId,
      blockerTaskId: receipt.blockerTaskId,
      ...(receipt.operation === "dependency-add"
        ? { dependencyId: receipt.dependencyId, created: receipt.created }
        : { removed: true }),
      noteIds: receipt.noteIds,
      activityIds: receipt.activityIds,
    }),
  });
}

interface FlagAttentionOpts {
  taskId: string;
  reason?: string;
}

async function runTaskopsFlagAttention(program: Command, opts: FlagAttentionOpts): Promise<void> {
  const ctx = ctxFromProgram(program);
  const receipt = await serviceCall(() =>
    flagAttentionOperation({ taskId: opts.taskId, reason: opts.reason ?? null }),
  );

  const receiptTemplate = loadTaskopsTemplate("flag-attention", "receipt");
  emit(ctx, {
    text: () =>
      compileReceipt(
        { operation: "flag-attention", task: receipt.task, reason: receipt.reason ?? "" },
        receiptTemplate,
      ),
    json: () => ({
      ok: true,
      taskId: receipt.taskId,
      needsAttention: true,
      reason: receipt.reason,
      alreadyFlagged: receipt.alreadyFlagged,
      activityId: receipt.activityId,
    }),
  });
}

interface UnflagAttentionOpts {
  taskId: string;
}

async function runTaskopsUnflagAttention(
  program: Command,
  opts: UnflagAttentionOpts,
): Promise<void> {
  const ctx = ctxFromProgram(program);
  const receipt = await serviceCall(() => unflagAttentionOperation({ taskId: opts.taskId }));

  const receiptTemplate = loadTaskopsTemplate("unflag-attention", "receipt");
  emit(ctx, {
    text: () =>
      compileReceipt({ operation: "unflag-attention", task: receipt.task }, receiptTemplate),
    json: () => ({
      ok: true,
      taskId: receipt.taskId,
      needsAttention: false,
      alreadyClear: receipt.alreadyClear,
      activityId: receipt.activityId,
    }),
  });
}

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

function parseDatePhrase(label: string, phrase: string, tz?: string): Date {
  const parsed = parseNaturalDate(phrase, { defaultTimeZone: tz ?? getHostTimeZone() });
  if (!parsed.ok) {
    throw new InputValidationError(`Could not parse ${label} date phrase '${phrase}': ${parsed.reason}`);
  }
  return parsed.date;
}

/**
 * Default due date when the user gave no due signal (batch-009 ISS-008):
 * DEFAULT_DUE_BUSINESS_DAYS business days out, weekend-avoiding, at
 * end-of-day local. This is the CLI fallback only; R27's "every task has a
 * due date" invariant remains enforced at the service layer.
 */
function defaultDueDate(tz?: string): Date {
  const resolvedTz = (tz ? resolveTimeZone(tz) : null) ?? getHostTimeZone();
  return addBusinessDaysInTz(new Date(), DEFAULT_DUE_BUSINESS_DAYS, resolvedTz);
}

function receiptContextForDelegate(receipt: DelegateReceipt): Parameters<typeof compileReceipt>[0] {
  return {
    operation: "delegate",
    task: receipt.task,
    owner: receipt.ownerSlug,
    followUpDate: receipt.followUpDate,
    dueDate: receipt.dueDate,
    noteId: receipt.noteId,
    ownerOpenTasks: receipt.ownerOpenTasks,
    warnings: receipt.warnings,
  };
}

function receiptContextForFollowUp(receipt: RecordFollowUpReceipt): Parameters<typeof compileReceipt>[0] {
  return {
    operation: "follow-up",
    task: receipt.task,
    nextFollowUpDate: receipt.nextFollowUpDate,
    dueDate: receipt.dueDate,
    status: receipt.status,
    noteId: receipt.noteId,
    warnings: receipt.warnings,
  };
}

function receiptContextForDefer(receipt: DeferReceipt): Parameters<typeof compileReceipt>[0] {
  return {
    operation: "defer",
    task: receipt.task,
    followUpDate: receipt.until,
    warnings: receipt.warnings,
  };
}

// ---------------------------------------------------------------------------
// Reads (hydrate-only context; direct db reads are allowed in commands).
// ---------------------------------------------------------------------------

interface ShowOpts {
  intent?: string;
}

async function runTaskopsShow(program: Command, id: string, opts: ShowOpts): Promise<void> {
  const ctx = ctxFromProgram(program);
  const now = new Date();

  const targetTask = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1).then((rows) => rows[0] ?? null);
  if (!targetTask) {
    throw new TaskNotFoundError(id);
  }

  let targetGoal = null;
  if (targetTask.goalId) {
    targetGoal = await db.select().from(goals).where(eq(goals.id, targetTask.goalId)).limit(1).then((rows) => rows[0] ?? null);
  }

  const targetNotes = await db
    .select()
    .from(taskNotes)
    .where(and(eq(taskNotes.taskId, id), eq(taskNotes.noteType, "manual")))
    .orderBy(desc(taskNotes.createdAt))
    .limit(10);

  let matchedMemories: typeof memories.$inferSelect[] = [];
  if (opts.intent) {
    const queryEmbedding = await embed(opts.intent);
    const activeMemories = await db.select().from(memories).where(eq(memories.state, "active"));
    matchedMemories = retrieveMemories({
      queryContentEmbedding: queryEmbedding,
      queryApplicabilityEmbedding: queryEmbedding,
      memories: activeMemories,
      k: 5,
    });
  }

  const prompt = compileHydrationPrompt(
    {
      operation: "show",
      taskId: id,
      targetTask,
      targetGoal,
      targetNotes,
      memories: matchedMemories,
      now,
    },
    loadTaskopsTemplate("show", "hydrate"),
  );

  emit(ctx, {
    text: () => prompt,
    json: () => ({
      ok: true,
      prompt,
      as_of: now.toISOString(),
    }),
  });
}

async function runTaskopsList(program: Command): Promise<void> {
  const ctx = ctxFromProgram(program);
  const now = new Date();

  const activeTasks = await db
    .select()
    .from(tasks)
    .where(not(inArray(tasks.status, ["done", "cancelled"])))
    .orderBy(desc(tasks.lastStatusChangeAt));

  const activeGoals = await db
    .select()
    .from(goals)
    .where(eq(goals.status, "active"))
    .orderBy(desc(goals.id));

  const prompt = compileHydrationPrompt(
    {
      operation: "list",
      tasks: activeTasks,
      goals: activeGoals,
      now,
    },
    loadTaskopsTemplate("list", "hydrate"),
  );

  emit(ctx, {
    text: () => prompt,
    json: () => ({
      ok: true,
      prompt,
      as_of: now.toISOString(),
    }),
  });
}

interface QueueOpts {
  task: string[];
  why: string[];
  clear: boolean;
}

async function runTaskopsReRank(program: Command, opts: QueueOpts): Promise<void> {
  const ctx = ctxFromProgram(program);
  const tasks = opts.task ?? [];
  const whys = opts.why ?? [];
  const clear = opts.clear ?? false;

  if (tasks.length !== whys.length) {
    throw new InputValidationError(
      `Number of tasks (${tasks.length}) does not match number of rationales (${whys.length}). Please supply one --why for every --task.`,
    );
  }

  const entries = tasks.map((taskId, i) => ({
    taskId,
    why: whys[i],
  }));

  const receipt = await serviceCall(() =>
    queueOperation({
      entries,
      clear,
      source: "cli",
    }),
  );

  const receiptTemplate = loadTaskopsTemplate("re-rank", "receipt");
  emit(ctx, {
    text: () => compileReceipt(receipt, receiptTemplate),
    json: () => ({
      ok: true,
      receipt,
    }),
  });
}

/**
 * The re-rank hydration packet: ranked do-next candidates, anomalies, risk
 * detectors, the current queue, and (when provided) Jordan's situational
 * context plus matching memories. The packet instructs the agent to lock the
 * result with `execos taskops re-rank`.
 */
async function runHydrateReRank(
  program: Command,
  situationalContext: string | undefined,
): Promise<void> {
  const ctx = ctxFromProgram(program);
  const now = new Date();
  const settingsResult = await loadSettings();
  const stalenessThreshold =
    settingsResult.settings.needs_attention.staleness_days_threshold;
  const riskWindows = settingsResult.settings.prioritization.risk_windows;

  const { ranked } = await rankEligible(now);
  const candidates = partitionReviewCandidates(
    ranked,
    now,
    stalenessThreshold,
  );
  const activeGoals = await db
    .select()
    .from(goals)
    .where(eq(goals.status, "active"))
    .orderBy(desc(goals.id));

  const currentQueueTasks = await db
    .select()
    .from(tasks)
    .where(sql`${tasks.queueRank} IS NOT NULL`)
    .orderBy(asc(tasks.queueRank));

  // Risk detectors (change-009) run over ALL open tasks straight from the
  // tasks table, NOT the eligibility view or the owner/snooze-filtered
  // candidates: delegated, snoozed, review-status, and blocked
  // hard-deadline tasks must still surface here.
  const openRiskTasks = await selectOpenRiskTasks();
  const goalRisk = await selectGoalRiskInputs();
  const commitments = commitmentsAtRisk(
    openRiskTasks,
    now,
    riskWindows.commitment_days,
  );
  const riskedGoals = goalsAtRisk(
    goalRisk.goals,
    goalRisk.taskCountsByGoal,
    now,
    riskWindows.goal_days,
  );
  const unblocked = newlyUnblocked(openRiskTasks, now);

  // Situational context retrieval: when Jordan supplies context for today's
  // ranking, surface the memories it matches. Embedding failure degrades to
  // an empty section plus a warning; the packet must always render.
  const hydrateWarnings: string[] = [];
  let matchedMemories: typeof memories.$inferSelect[] = [];
  if (situationalContext !== undefined && situationalContext.trim() !== "") {
    try {
      const queryEmbedding = await embed(situationalContext);
      matchedMemories = await memoriesForEmbedding(queryEmbedding);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      hydrateWarnings.push(
        `Memory retrieval skipped: embedding unavailable (${message}).`,
      );
    }
  }

  const prompt = compileHydrationPrompt(
    {
      operation: "re-rank",
      intent: situationalContext,
      goals: activeGoals,
      tasks: currentQueueTasks,
      memories: matchedMemories,
      rankedCandidates: candidates.doNext,
      anomalies: {
        overdue: candidates.overdue,
        stale: candidates.stale,
        newTriage: candidates.newTriage,
        arrivedSnooze: candidates.arrivedSnooze,
      },
      commitmentsAtRisk: commitments,
      goalsAtRisk: riskedGoals,
      newlyUnblocked: unblocked,
      now,
    },
    loadTaskopsTemplate("re-rank", "hydrate"),
  );

  emitWarningLines(ctx, hydrateWarnings);
  emit(ctx, {
    text: () => prompt,
    json: () => ({
      ok: true,
      prompt,
      as_of: now.toISOString(),
      sections: {
        situational_context: situationalContext ?? null,
        commitments_at_risk: commitments.map(serializeCommitmentAtRisk),
        goals_at_risk: riskedGoals.map(serializeGoalAtRisk),
        newly_unblocked: unblocked.map(serializeNewlyUnblocked),
        queue: currentQueueTasks.map((t) => ({
          taskId: t.id,
          title: t.title,
          rank: t.queueRank,
          rationale: t.queueRationale,
          rankedAt: t.queueRankedAt,
        })),
      },
    }),
  });
}

async function runTaskopsFollowUps(
  program: Command,
  operation: "follow-ups" | "draft-follow-ups",
): Promise<void> {
  const ctx = ctxFromProgram(program);
  const now = new Date();
  const dueFollowUps = await db
    .select()
    .from(tasks)
    .where(
      and(
        not(inArray(tasks.status, ["done", "cancelled"])),
        sql`NOT (${tasks.owner} IS NULL OR btrim(${tasks.owner}) = '' OR lower(btrim(${tasks.owner})) = 'me')`,
        sql`${tasks.followUpDate} IS NOT NULL`,
        lte(tasks.followUpDate, now),
      ),
    )
    .orderBy(asc(tasks.owner), asc(tasks.followUpDate));

  const prompt = compileHydrationPrompt(
    {
      operation,
      dueFollowUps,
      now,
    },
    loadTaskopsTemplate(operation, "hydrate"),
  );

  emit(ctx, {
    text: () => prompt,
    json: () => ({
      ok: true,
      prompt,
      as_of: now.toISOString(),
    }),
  });
}

// ---------------------------------------------------------------------------
// Serializers.
// ---------------------------------------------------------------------------

function serializeDelegateReceipt(receipt: DelegateReceipt): Record<string, unknown> {
  return {
    operation: receipt.operation,
    taskId: receipt.taskId,
    owner: receipt.ownerSlug,
    ownerDisplayName: receipt.ownerDisplayName,
    followUpAt: receipt.followUpDate.toISOString(),
    dueAt: receipt.dueDate ? receipt.dueDate.toISOString() : null,
    noteId: receipt.noteId,
    activityId: receipt.activityId,
    warnings: receipt.warnings,
    defaultFollowUpApplied: receipt.defaultFollowUpApplied,
    ownerOpenTasks: receipt.ownerOpenTasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.dueDate ? task.dueDate.toISOString() : null,
      followUpAt: task.followUpDate ? task.followUpDate.toISOString() : null,
    })),
    task: serializeTaskopsTask(receipt.task),
  };
}

function serializeFollowUpReceipt(receipt: RecordFollowUpReceipt): Record<string, unknown> {
  return {
    operation: receipt.operation,
    taskId: receipt.taskId,
    nextFollowUpAt: receipt.nextFollowUpDate.toISOString(),
    dueAt: receipt.dueDate ? receipt.dueDate.toISOString() : null,
    status: receipt.status,
    noteId: receipt.noteId,
    activityId: receipt.activityId,
    warnings: receipt.warnings,
    task: serializeTaskopsTask(receipt.task),
  };
}

function serializeDeferReceipt(receipt: DeferReceipt): Record<string, unknown> {
  return {
    operation: receipt.operation,
    taskId: receipt.taskId,
    followUpAt: receipt.until.toISOString(),
    activityId: receipt.activityId,
    warnings: receipt.warnings,
    task: serializeTaskopsTask(receipt.task),
  };
}

function serializeTaskopsTask(task: typeof tasks.$inferSelect): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    category: task.category,
    priority: task.priority,
    owner: task.owner ?? "me",
    dueAt: task.dueDate ? task.dueDate.toISOString() : null,
    followUpAt: task.followUpDate ? task.followUpDate.toISOString() : null,
    goalId: task.goalId,
    status: task.status,
    hardDeadline: task.hardDeadline,
    effort: task.effort,
  };
}

// Review risk sections (change-009): each row serializes the detector
// output verbatim, Dates as ISO strings, keeping the transparency fields
// (daysLeft, windowDays, rule, counts) that explain why the row fired.

function serializeCommitmentAtRisk(row: CommitmentAtRiskRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    owner: row.owner,
    dueDate: row.dueDate.toISOString(),
    daysLeft: row.daysLeft,
    windowDays: row.windowDays,
    rule: row.rule,
  };
}

function serializeGoalAtRisk(row: GoalAtRiskRow): Record<string, unknown> {
  return {
    goalId: row.goalId,
    title: row.title,
    quarter: row.quarter,
    quarterEnd: row.quarterEnd.toISOString(),
    daysLeft: row.daysLeft,
    windowDays: row.windowDays,
    openCount: row.openCount,
    doneCount: row.doneCount,
  };
}

function serializeNewlyUnblocked(row: NewlyUnblockedRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    owner: row.owner,
    lastUnblockedAt: row.lastUnblockedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Schemas contract verification exports.
// ---------------------------------------------------------------------------

const TaskopsOutputSchema = z.object({
  ok: z.literal(true),
  prompt: z.string(),
  as_of: z.string(),
});
const TaskopsTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  priority: z.string().nullable(),
  owner: z.string(),
  dueAt: z.string().nullable(),
  followUpAt: z.string().nullable(),
  goalId: z.string().nullable(),
  status: z.string(),
  hardDeadline: z.boolean(),
  effort: z.string().nullable(),
});

const ReRankSectionsSchema = z.object({
  situational_context: z.string().nullable(),
  commitments_at_risk: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      priority: z.string().nullable(),
      owner: z.string().nullable(),
      dueDate: z.string(),
      daysLeft: z.number(),
      windowDays: z.number(),
      rule: z.enum(["overdue", "within-window"]),
    }),
  ),
  goals_at_risk: z.array(
    z.object({
      goalId: z.string(),
      title: z.string(),
      quarter: z.string(),
      quarterEnd: z.string(),
      daysLeft: z.number(),
      windowDays: z.number(),
      openCount: z.number(),
      doneCount: z.number(),
    }),
  ),
  newly_unblocked: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      priority: z.string().nullable(),
      owner: z.string().nullable(),
      lastUnblockedAt: z.string(),
    }),
  ),
  queue: z.array(
    z.object({
      taskId: z.string(),
      title: z.string(),
      rank: z.number().nullable(),
      rationale: z.string().nullable(),
      rankedAt: z.union([z.string(), z.date()]).nullable(),
    }),
  ),
});
const TaskopsReceiptBaseSchema = z.object({
  taskId: z.string(),
  activityId: z.string(),
  warnings: z.array(z.string()),
  task: TaskopsTaskSchema,
});

const TaskopsExitCodes = [EXIT_OK, EXIT_GENERIC, EXIT_INPUT_VALIDATION] as const;
const TaskopsErrorCategories = ["input_validation", "unhandled"] as const;

export const Schemas = {
  hydrate: {
    input: z.object({
      operation: z.enum([
        "create",
        "update",
        "complete",
        "cancel",
        "reopen",
        "delegate",
        "follow-up",
        "defer",
        "dependency-add",
        "dependency-remove",
        "flag-attention",
        "unflag-attention",
        "re-rank",
      ]),
      // Required for every write operation except re-rank, where it is
      // optional situational context; the CLI enforces the distinction.
      intent: z.string().optional(),
      taskId: z.string().optional(),
    }),
    output: TaskopsOutputSchema,
    exitCodes: TaskopsExitCodes,
    errorCategories: TaskopsErrorCategories,
  },
  create: {
    input: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      descriptionFile: z.string().optional(),
      note: z.string().optional(),
      noteFile: z.string().optional(),
      returnDetail: z.boolean().optional(),
      category: z.string(),
      priority: z.string().optional(),
      status: z.string().optional(),
      due: z.string(),
      goalId: z.string().optional(),
      owner: z.string().optional(),
      effort: z.enum(["S", "M", "L", "XL"]).optional(),
      hardDeadline: z.boolean().optional(),
      tz: z.string().optional(),
      allowDuplicate: z.string().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      task: TaskopsTaskSchema,
      warnings: z.array(z.string()).optional(),
      dedup: z
        .object({
          matches: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              similarity: z.number(),
              band: z.string(),
              matchedOn: z.enum(["title", "description", "both"]).optional(),
            }),
          ),
          overridden: z.boolean(),
          justification: z.string().nullable(),
        })
        .optional(),
    }),
    exitCodes: [EXIT_OK, EXIT_GENERIC, EXIT_INPUT_VALIDATION, EXIT_WIP_CAP_EXCEEDED] as const,
    errorCategories: ["input_validation", "p0_wip_cap_exceeded", "unhandled"] as const,
  },
  update: {
    input: z.object({
      taskId: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      descriptionFile: z.string().optional(),
      category: z.string().optional(),
      priority: z.string().optional(),
      status: z.string().optional(),
      due: z.string().optional(),
      owner: z.string().optional(),
      goalId: z.string().optional(),
      clearGoal: z.boolean().optional(),
      effort: z.enum(["S", "M", "L", "XL"]).optional(),
      clearEffort: z.boolean().optional(),
      hardDeadline: z.enum(["true", "false"]).optional(),
      tz: z.string().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      task: TaskopsTaskSchema,
      warnings: z.array(z.string()).optional(),
    }),
    exitCodes: [
      EXIT_OK,
      EXIT_GENERIC,
      EXIT_INPUT_VALIDATION,
      EXIT_TASK_NOT_FOUND,
      EXIT_TRANSITION_DENIED,
      EXIT_WIP_CAP_EXCEEDED,
    ] as const,
    errorCategories: [
      "input_validation",
      "task_not_found",
      "transition_denied",
      "p0_wip_cap_exceeded",
      "unhandled",
    ] as const,
  },
  complete: {
    input: z.object({
      taskId: z.string(),
      yes: z.boolean(),
      note: z.string().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      taskId: z.string(),
      from: z.string(),
      to: z.string(),
    }),
    exitCodes: [
      EXIT_OK,
      EXIT_GENERIC,
      EXIT_INPUT_VALIDATION,
      EXIT_TASK_NOT_FOUND,
      EXIT_TRANSITION_DENIED,
    ] as const,
    errorCategories: [
      "input_validation",
      "task_not_found",
      "transition_denied",
      "unhandled",
    ] as const,
  },
  reopen: {
    input: z.object({
      taskId: z.string(),
      to: z.enum(["backlog", "in_progress", "blocked", "review"]).optional(),
      note: z.string().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      taskId: z.string(),
      from: z.enum(["done", "cancelled"]),
      to: z.enum(["backlog", "in_progress", "blocked", "review"]),
    }),
    exitCodes: [
      EXIT_OK,
      EXIT_GENERIC,
      EXIT_INPUT_VALIDATION,
      EXIT_TASK_NOT_FOUND,
      EXIT_TRANSITION_DENIED,
    ] as const,
    errorCategories: [
      "input_validation",
      "task_not_found",
      "transition_denied",
      "unhandled",
    ] as const,
  },
  delegate: {
    input: z.object({
      taskId: z.string(),
      owner: z.string(),
      followUp: z.string().optional(),
      due: z.string().optional(),
      notes: z.string().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      receipt: TaskopsReceiptBaseSchema.extend({
        operation: z.literal("delegate"),
        owner: z.string(),
        ownerDisplayName: z.string(),
        followUpAt: z.string(),
        dueAt: z.string().nullable(),
        noteId: z.string().nullable(),
        defaultFollowUpApplied: z.boolean(),
        ownerOpenTasks: z.array(z.object({
          id: z.string(),
          title: z.string(),
          status: z.string(),
          dueAt: z.string().nullable(),
          followUpAt: z.string().nullable(),
        })),
      }),
    }),
    exitCodes: [EXIT_OK, EXIT_GENERIC, EXIT_INPUT_VALIDATION, EXIT_TASK_NOT_FOUND] as const,
    errorCategories: ["input_validation", "task_not_found", "unhandled"] as const,
  },
  followUp: {
    input: z.object({
      taskId: z.string(),
      update: z.string(),
      next: z.string(),
      due: z.string().optional(),
      status: z.string().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      receipt: TaskopsReceiptBaseSchema.extend({
        operation: z.literal("follow-up"),
        nextFollowUpAt: z.string(),
        dueAt: z.string().nullable(),
        status: z.string(),
        noteId: z.string(),
      }),
    }),
    exitCodes: [EXIT_OK, EXIT_GENERIC, EXIT_INPUT_VALIDATION, EXIT_TASK_NOT_FOUND] as const,
    errorCategories: ["input_validation", "task_not_found", "unhandled"] as const,
  },
  defer: {
    input: z.object({
      taskId: z.string(),
      until: z.string(),
    }),
    output: z.object({
      ok: z.literal(true),
      receipt: TaskopsReceiptBaseSchema.extend({
        operation: z.literal("defer"),
        followUpAt: z.string(),
      }),
    }),
    exitCodes: [EXIT_OK, EXIT_GENERIC, EXIT_INPUT_VALIDATION, EXIT_TASK_NOT_FOUND] as const,
    errorCategories: ["input_validation", "task_not_found", "unhandled"] as const,
  },
  show: {
    input: z.object({
      taskId: z.string(),
      intent: z.string().optional(),
    }),
    output: TaskopsOutputSchema,
    exitCodes: [EXIT_OK, EXIT_GENERIC, EXIT_INPUT_VALIDATION, EXIT_TASK_NOT_FOUND] as const,
    errorCategories: ["input_validation", "task_not_found", "unhandled"] as const,
  },
  list: {
    input: z.object({}),
    output: TaskopsOutputSchema,
    exitCodes: [EXIT_OK, EXIT_GENERIC] as const,
    errorCategories: ["unhandled"] as const,
  },
  hydrateReRank: {
    input: z.object({ intent: z.string().optional() }).strict(),
    output: z.object({
      ok: z.literal(true),
      prompt: z.string(),
      as_of: z.string(),
      sections: ReRankSectionsSchema,
    }),
    exitCodes: [EXIT_OK, EXIT_GENERIC] as const,
    errorCategories: ["unhandled"] as const,
  },
  followUps: {
    input: z.object({}),
    output: TaskopsOutputSchema,
    exitCodes: [EXIT_OK, EXIT_GENERIC] as const,
    errorCategories: ["unhandled"] as const,
  },
  draftFollowUps: {
    input: z.object({}),
    output: TaskopsOutputSchema,
    exitCodes: [EXIT_OK, EXIT_GENERIC] as const,
    errorCategories: ["unhandled"] as const,
  },
  "re-rank": {
    input: z.object({
      task: z.array(z.string()).optional(),
      why: z.array(z.string()).optional(),
      clear: z.boolean().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      receipt: z.object({
        operation: z.literal("re-rank"),
        rankedAt: z.date(),
        entries: z.array(
          z.object({
            taskId: z.string(),
            title: z.string(),
            rank: z.number(),
            rationale: z.string(),
          }),
        ),
        cleared: z.array(z.string()),
      }),
    }),
    exitCodes: [EXIT_OK, EXIT_GENERIC, EXIT_INPUT_VALIDATION] as const,
    errorCategories: ["input_validation", "unhandled"] as const,
  },
} as const;
