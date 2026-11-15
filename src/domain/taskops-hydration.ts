import type { TaskRow, GoalRow, MemoryRow, TaskNoteRow } from "../cli/adapters/interfaces.js";
import {
  formatDraftContextBlock,
  groupFollowUpsByPerson,
  type FollowUpDraftItem,
  type TeamMemberLike,
} from "./follow-ups.js";
import type {
  CommitmentAtRiskRow,
  GoalAtRiskRow,
  NewlyUnblockedRow,
} from "./risk-detectors.js";

export interface HydrationContext {
  operation:
    | "create"
    | "update"
    | "complete"
    | "cancel"
    | "reopen"
    | "show"
    | "list"
    | "delegate"
    | "follow-up"
    | "defer"
    | "dependency-add"
    | "dependency-remove"
    | "flag-attention"
    | "unflag-attention"
    | "follow-ups"
    | "draft-follow-ups"
    | "re-rank";
  intent?: string;
  taskId?: string;
  tasks?: TaskRow[];
  goals?: GoalRow[];
  memories?: MemoryRow[];
  targetTask?: TaskRow | null;
  targetGoal?: GoalRow | null;
  targetNotes?: TaskNoteRow[];
  team?: TeamMemberLike[];
  ownerOpenTasks?: TaskRow[];
  dueFollowUps?: FollowUpDraftItem[];
  rankedCandidates?: ReviewCandidateRow[];
  anomalies?: ReviewAnomalies;
  commitmentsAtRisk?: CommitmentAtRiskRow[];
  goalsAtRisk?: GoalAtRiskRow[];
  newlyUnblocked?: NewlyUnblockedRow[];
  defaultFollowUpDate?: Date | null;
  warnings?: string[];
  dedupMatches?: DedupMatchRow[];
  now?: Date;
}

/** One near-duplicate candidate surfaced by the create duplicate gate. */
export interface DedupMatchRow {
  id: string;
  title: string;
  similarity: number;
  band: string;
}

export interface ReviewCandidateRow {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  owner?: string | null;
  dueDate?: Date | null;
  hardDeadline?: boolean;
  followUpDate?: Date | null;
  snoozedUntil?: Date | null;
  goalId?: string | null;
  effort?: string | null;
  why?: string;
}

export interface ReviewAnomalies {
  overdue?: ReviewCandidateRow[];
  stale?: ReviewCandidateRow[];
  newTriage?: ReviewCandidateRow[];
  arrivedSnooze?: ReviewCandidateRow[];
}

// ---------------------------------------------------------------------------
// Section formatters (pure). Each returns a self-contained markdown block with
// no leading/trailing blank lines; the prompt template controls spacing around
// the slot it is substituted into.
// ---------------------------------------------------------------------------

function fmtDate(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString().slice(0, 10) : "-";
}

function formatTaskTable(tasks: TaskRow[]): string {
  if (tasks.length === 0) {
    return "No active tasks found.";
  }
  const rows = tasks.map(
    (t) =>
      `| ${t.id} | ${t.title} | ${t.status} | ${t.priority ?? "-"} | ${t.owner ?? "me"} | ${fmtDate(t.dueDate)} | ${fmtDate(t.followUpDate)} |`,
  );
  return ["| ID | Title | Status | Priority | Owner | Due Date | Follow-up Date |", "| --- | --- | --- | --- | --- | --- | --- |", ...rows].join("\n");
}

function formatCurrentQueue(rows: TaskRow[]): string {
  if (rows.length === 0) {
    return "No queue locked in yet.";
  }
  const tableRows = rows.map(
    (t) =>
      `| ${t.queueRank} | ${t.id} | ${t.title} | ${t.queueRationale ?? "-"} |`,
  );
  const table = [
    "| Rank | ID | Title | Rationale |",
    "| --- | --- | --- | --- |",
    ...tableRows,
  ].join("\n");

  const rankedAt = rows[0]?.queueRankedAt;
  if (rankedAt) {
    const timeStr = new Date(rankedAt).toISOString().replace("T", " ").slice(0, 19);
    return `${table}\n\nLast reprioritized: ${timeStr} UTC`;
  }
  return table;
}

function formatRelativeTime(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Human-readable packet timestamp in the machine's local timezone, e.g.
 * "2026-06-11 19:04 MDT (Wednesday)". Local time, not UTC: the agent uses
 * this for due-today and end-of-day reasoning.
 */
export function formatAsOf(now: Date): string {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(now);
  return `${ymd} ${time} (${weekday})`;
}

function formatRankedTable(rows: ReviewCandidateRow[]): string {
  if (rows.length === 0) {
    return "No matching tasks found.";
  }
  // Effort column appears only when at least one row carries an estimate,
  // so pre-change-009 callers and effort-less boards render unchanged.
  const withEffort = rows.some((row) => row.effort != null);
  const withHard = rows.some((row) => row.hardDeadline != null);
  const withSnooze = rows.some((row) => row.snoozedUntil != null);
  const body = rows.map((row, index) => {
    const goal = row.goalId ?? "-";
    const effortCell = withEffort ? ` ${row.effort ?? "-"} |` : "";
    const hardCell = withHard ? ` ${row.hardDeadline === true ? "yes" : "-"} |` : "";
    const snoozeCell = withSnooze ? ` ${fmtDate(row.snoozedUntil)} |` : "";
    return `| ${index + 1} | ${row.id} | ${row.title} | ${row.status} | ${row.priority ?? "-"} |${effortCell} ${row.owner ?? "me"} | ${fmtDate(row.dueDate)} |${hardCell} ${fmtDate(row.followUpDate)} |${snoozeCell} ${goal} | ${row.why ?? "-"} |`;
  });
  const effortHeader = withEffort ? " Effort |" : "";
  const effortDivider = withEffort ? " --- |" : "";
  const hardHeader = withHard ? " Hard Deadline |" : "";
  const hardDivider = withHard ? " --- |" : "";
  const snoozeHeader = withSnooze ? " Snoozed Until |" : "";
  const snoozeDivider = withSnooze ? " --- |" : "";
  return [
    `| Rank | ID | Title | Status | Current Priority |${effortHeader} Owner | Due Date |${hardHeader} Follow-up Date |${snoozeHeader} Goal | Why |`,
    `| --- | --- | --- | --- | --- |${effortDivider} --- | --- |${hardDivider} --- |${snoozeDivider} --- | --- |`,
    ...body,
  ].join("\n");
}

function formatCommitmentsAtRisk(rows: CommitmentAtRiskRow[]): string {
  if (rows.length === 0) {
    return "No commitments at risk.";
  }
  const body = rows.map(
    (row) =>
      `| ${row.id} | ${row.title} | ${row.status} | ${row.priority ?? "-"} | ${row.owner ?? "me"} | ${fmtDate(row.dueDate)} | ${row.daysLeft} | ${row.windowDays}d | ${row.rule} |`,
  );
  return [
    "| ID | Task | Status | Priority | Owner | Hard Due | Days Left | Window | Rule |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...body,
  ].join("\n");
}

function formatGoalsAtRisk(rows: GoalAtRiskRow[]): string {
  if (rows.length === 0) {
    return "No goals at risk.";
  }
  const body = rows.map(
    (row) =>
      `| ${row.goalId} | ${row.title} | ${row.quarter} | ${fmtDate(row.quarterEnd)} | ${row.daysLeft} | ${row.windowDays}d | ${row.openCount} | ${row.doneCount} |`,
  );
  return [
    "| Goal | Title | Quarter | Quarter End | Days Left | Window | Open Tasks | Done Tasks |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...body,
  ].join("\n");
}

function formatNewlyUnblocked(rows: NewlyUnblockedRow[]): string {
  if (rows.length === 0) {
    return "No newly unblocked tasks.";
  }
  const body = rows.map((row) => {
    const stamp = new Date(row.lastUnblockedAt).toISOString().replace("T", " ").slice(0, 16);
    return `| ${row.id} | ${row.title} | ${row.status} | ${row.priority ?? "-"} | ${row.owner ?? "me"} | ${stamp} |`;
  });
  return [
    "| ID | Task | Status | Priority | Owner | Unblocked At (UTC) |",
    "| --- | --- | --- | --- | --- | --- |",
    ...body,
  ].join("\n");
}

function formatGoalTable(goals: GoalRow[]): string {
  if (goals.length === 0) {
    return "No active goals found.";
  }
  const rows = goals.map((g) => `| ${g.id} | ${g.title} | ${g.quarter} | ${g.status} |`);
  return ["| ID | Title | Quarter | Status |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

function formatMemories(memories: MemoryRow[]): string {
  if (memories.length === 0) {
    return "No matching memories found.";
  }
  return memories
    .map((m) => `- **[Memory ${m.id}]** (Scope: \`${m.scope}\`): ${m.content}\n  *Applicability*: ${m.applicability}`)
    .join("\n");
}

function formatNotes(notes: TaskNoteRow[]): string {
  if (notes.length === 0) {
    return "No notes recorded on this task.";
  }
  return notes
    .map((n) => {
      const dateStr = new Date(n.createdAt).toISOString().replace("T", " ").slice(0, 19);
      return `- **[${dateStr}]** (${n.createdBy} - ${n.noteType}): ${n.content}`;
    })
    .join("\n");
}

function formatTeam(team: TeamMemberLike[]): string {
  if (team.length === 0) return "No team rows found. Ask Jordan which team member should own this.";
  return team
    .map((member) => `- ${member.slug}: ${member.displayName}${member.email ? ` (${member.email})` : ""}`)
    .join("\n");
}

function formatWarnings(warnings: string[]): string {
  if (warnings.length === 0) return "- none";
  return warnings.map((warning) => `- ${warning}`).join("\n");
}

function formatDedupMatches(matches: DedupMatchRow[]): string {
  if (matches.length === 0) return "- none";
  return matches
    .map((match) => `- ${match.id} | ${match.title} | similarity ${match.similarity.toFixed(2)} | band ${match.band}`)
    .join("\n");
}

function formatDueFollowUps(items: FollowUpDraftItem[]): string {
  const groups = groupFollowUpsByPerson(items);
  if (groups.length === 0) return "No due follow-ups found.";
  return groups
    .map((group) => {
      const rows = group.items.map(
        (item) =>
          `| ${item.id} | ${item.title} | ${item.status} | ${fmtDate(item.dueDate)} | ${fmtDate(item.followUpDate)} |`,
      );
      return [
        `## ${group.person}`,
        "| ID | Title | Status | Work Due | Follow-up Due |",
        "| --- | --- | --- | --- | --- |",
        ...rows,
      ].join("\n");
    })
    .join("\n\n");
}

function formatDraftContextBlocks(items: FollowUpDraftItem[]): string {
  const groups = groupFollowUpsByPerson(items);
  if (groups.length === 0) return "No due follow-ups found.";
  return groups.map(formatDraftContextBlock).join("\n\n");
}

// ---------------------------------------------------------------------------
// Slot binding + template rendering (pure).
// ---------------------------------------------------------------------------

/** Replace every `{{ slot }}` token in the template with its bound value. */
function renderTemplate(template: string, slots: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, key: string) => {
    if (!(key in slots)) {
      throw new Error(`Hydration template references unknown slot '{{${key}}}'.`);
    }
    return slots[key];
  });
}

function buildSlots(context: HydrationContext): Record<string, string> {
  const {
    operation,
    intent,
    tasks = [],
    goals = [],
    memories = [],
    targetTask,
    targetGoal,
    targetNotes = [],
    team = [],
    ownerOpenTasks = [],
    dueFollowUps = [],
    rankedCandidates = [],
    anomalies = {},
    commitmentsAtRisk = [],
    goalsAtRisk = [],
    newlyUnblocked = [],
    defaultFollowUpDate = null,
    warnings = [],
    dedupMatches = [],
  } = context;

  switch (operation) {
    case "create":
      return {
        intent: intent ?? "Create a new task.",
        active_tasks: formatTaskTable(tasks),
        dedup_matches: formatDedupMatches(dedupMatches),
        active_goals: formatGoalTable(goals),
        memories: formatMemories(memories),
      };
    case "update":
      return {
        intent: intent ?? "Update an existing task.",
        task_id: targetTask!.id,
        target_task: formatTaskTable([targetTask!]),
        target_description: targetTask!.description,
        active_goals: formatGoalTable(goals),
        memories: formatMemories(memories),
      };
    case "complete":
      return {
        task_id: targetTask!.id,
        target_task: formatTaskTable([targetTask!]),
        memories: formatMemories(memories),
      };
    case "delegate":
      return {
        intent: intent ?? "Delegate an existing task.",
        task_id: targetTask!.id,
        target_task: formatTaskTable([targetTask!]),
        target_description: targetTask!.description,
        owner_candidates: formatTeam(team),
        owner_open_tasks: formatTaskTable(ownerOpenTasks),
        default_follow_up: fmtDate(defaultFollowUpDate),
        warnings: formatWarnings(warnings),
        memories: formatMemories(memories),
      };
    case "follow-up":
      return {
        intent: intent ?? "Record a delegated follow-up result.",
        task_id: targetTask!.id,
        target_task: formatTaskTable([targetTask!]),
        target_description: targetTask!.description,
        notes: formatNotes(targetNotes),
        warnings: formatWarnings(warnings),
        memories: formatMemories(memories),
      };
    case "defer":
      return {
        intent: intent ?? "Defer a task or follow-up.",
        task_id: targetTask?.id ?? context.taskId ?? "",
        target_task: targetTask ? formatTaskTable([targetTask]) : "No task loaded.",
      };
    case "cancel":
      return {
        intent: intent ?? "Cancel a task.",
        task_id: targetTask?.id ?? context.taskId ?? "",
        target_task: targetTask ? formatTaskTable([targetTask]) : "No task loaded.",
      };
    case "reopen":
      return {
        intent: intent ?? "Reopen a done or cancelled task.",
        task_id: targetTask?.id ?? context.taskId ?? "",
        target_task: targetTask ? formatTaskTable([targetTask]) : "No task loaded.",
        memories: formatMemories(memories),
      };
    case "dependency-add":
      return {
        intent: intent ?? "Record a blocking dependency between tasks.",
        task_id: targetTask?.id ?? context.taskId ?? "",
        target_task: targetTask ? formatTaskTable([targetTask]) : "No task loaded.",
      };
    case "dependency-remove":
      return {
        intent: intent ?? "Remove a blocking dependency between tasks.",
        task_id: targetTask?.id ?? context.taskId ?? "",
        target_task: targetTask ? formatTaskTable([targetTask]) : "No task loaded.",
      };
    case "flag-attention":
      return {
        intent: intent ?? "Flag a task as needing attention.",
        task_id: targetTask?.id ?? context.taskId ?? "",
        target_task: targetTask ? formatTaskTable([targetTask]) : "No task loaded.",
      };
    case "unflag-attention":
      return {
        intent: intent ?? "Clear the attention flag on a task.",
        task_id: targetTask?.id ?? context.taskId ?? "",
        target_task: targetTask ? formatTaskTable([targetTask]) : "No task loaded.",
      };
    case "show": {
      const goalPart = targetGoal
        ? `Linked Goal: ${targetGoal.id} - ${targetGoal.title} (${targetGoal.quarter})`
        : "No goal linked.";
      let queueStatus = "Not queued.";
      if (targetTask!.queueRank !== null) {
        const relativeTime = targetTask!.queueRankedAt && context.now
          ? formatRelativeTime(new Date(targetTask!.queueRankedAt), context.now)
          : "unknown time";
        queueStatus = `Queued #${targetTask!.queueRank} of 5 - ${targetTask!.queueRationale ?? ""} (ranked ${relativeTime})`;
      }
      return {
        task_id: targetTask!.id,
        title: targetTask!.title,
        status: targetTask!.status,
        priority: targetTask!.priority ?? "-",
        owner: targetTask!.owner ?? "me",
        due: fmtDate(targetTask!.dueDate),
        follow_up: fmtDate(targetTask!.followUpDate),
        goal: goalPart,
        description: targetTask!.description,
        notes: formatNotes(targetNotes),
        memories: formatMemories(memories),
        queue_status: queueStatus,
      };
    }
    case "list":
      return {
        active_tasks: formatTaskTable(tasks),
        active_goals: formatGoalTable(goals),
      };
    case "follow-ups":
      return {
        due_followups: formatDueFollowUps(dueFollowUps),
      };
    case "draft-follow-ups":
      return {
        draft_context_blocks: formatDraftContextBlocks(dueFollowUps),
      };
    case "re-rank":
      return {
        situational_context:
          intent && intent.trim() !== ""
            ? intent.trim()
            : "(none provided; apply the standard heuristics)",
        candidate_tasks: formatRankedTable(rankedCandidates),
        active_goals: formatGoalTable(goals),
        overdue: formatRankedTable(anomalies.overdue ?? []),
        stale: formatRankedTable(anomalies.stale ?? []),
        new_triage: formatRankedTable(anomalies.newTriage ?? []),
        arrived_snooze: formatRankedTable(anomalies.arrivedSnooze ?? []),
        commitments_at_risk: formatCommitmentsAtRisk(commitmentsAtRisk),
        goals_at_risk: formatGoalsAtRisk(goalsAtRisk),
        newly_unblocked: formatNewlyUnblocked(newlyUnblocked),
        current_queue: formatCurrentQueue(tasks),
        memories: formatMemories(memories),
      };
  }
}

// ---------------------------------------------------------------------------
// Receipts: the text confirmation printed AFTER a write subcommand lands. A
// distinct return kind from the hydrate packet, but rendered the same way (pure
// slot fill against a loaded template). The --format json record is built
// separately by the CLI and is not templated.
// ---------------------------------------------------------------------------

export interface ReceiptTask {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string | null;
  category: string | null;
  owner: string | null;
  dueDate: Date | null;
  followUpDate?: Date | null;
  goalId: string | null;
  hardDeadline?: boolean;
  effort?: string | null;
}

export interface ReceiptContext {
  operation:
    | "create"
    | "update"
    | "complete"
    | "cancel"
    | "reopen"
    | "delegate"
    | "follow-up"
    | "defer"
    | "dependency-add"
    | "dependency-remove"
    | "flag-attention"
    | "unflag-attention"
    | "re-rank";
  task?: ReceiptTask;
  from?: string;
  to?: string;
  owner?: string;
  ownerOpenTasks?: Array<{ id: string; title: string; status: string; dueDate: Date | null }>;
  followUpDate?: Date | null;
  nextFollowUpDate?: Date | null;
  dueDate?: Date | null;
  status?: string;
  noteId?: string | null;
  warnings?: string[];
  blockedBy?: string;
  reason?: string;
  rankedAt?: Date | null;
  entries?: Array<{ taskId: string; title: string; rank: number; rationale: string }>;
  cleared?: string[];
}

function buildReceiptSlots(context: ReceiptContext): Record<string, string> {
  if (context.operation === "complete" || context.operation === "cancel" || context.operation === "reopen") {
    return {
      task_id: context.task?.id ?? "",
      from: context.from ?? "",
      to: context.to ?? "",
    };
  }

  if (context.operation === "dependency-add" || context.operation === "dependency-remove") {
    return {
      task_id: context.task?.id ?? "",
      blocked_by: context.blockedBy ?? "",
    };
  }

  if (context.operation === "flag-attention") {
    return {
      task_id: context.task?.id ?? "",
      reason: context.reason ?? "",
    };
  }

  if (context.operation === "unflag-attention") {
    return {
      task_id: context.task?.id ?? "",
    };
  }

  if (context.operation === "delegate") {
    return {
      task_id: context.task?.id ?? "",
      owner: context.owner ?? context.task?.owner ?? "",
      follow_up: fmtDate(context.followUpDate ?? context.task?.followUpDate),
      due: fmtDate(context.dueDate ?? context.task?.dueDate),
      note_id: context.noteId ?? "-",
      owner_open_tasks: formatReceiptOpenTasks(context.ownerOpenTasks ?? []),
      warnings: formatWarnings(context.warnings ?? []),
    };
  }

  if (context.operation === "follow-up") {
    return {
      task_id: context.task?.id ?? "",
      next_follow_up: fmtDate(context.nextFollowUpDate ?? context.task?.followUpDate),
      due: fmtDate(context.dueDate ?? context.task?.dueDate),
      status: context.status ?? context.task?.status ?? "",
      note_id: context.noteId ?? "-",
      warnings: formatWarnings(context.warnings ?? []),
    };
  }

  if (context.operation === "defer") {
    return {
      task_id: context.task?.id ?? "",
      follow_up: fmtDate(context.followUpDate ?? context.task?.followUpDate),
      warnings: formatWarnings(context.warnings ?? []),
    };
  }

  if (context.operation === "re-rank") {
    const formattedEntries = (context.entries ?? []).map(
      (e) => `| ${e.rank} | ${e.taskId} | ${e.title} | ${e.rationale} |`
    );
    const entriesTable = formattedEntries.length > 0
      ? [
          "| Rank | ID | Title | Rationale |",
          "| --- | --- | --- | --- |",
          ...formattedEntries
        ].join("\n")
      : "No tasks in queue.";

    return {
      ranked_at: context.rankedAt ? new Date(context.rankedAt).toISOString() : "",
      entries: entriesTable,
      cleared: (context.cleared ?? []).length > 0 ? (context.cleared ?? []).join(", ") : "none",
    };
  }

  const t = context.task!;
  return {
    task_id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority ?? "-",
    category: t.category ?? "-",
    owner: t.owner ?? "me",
    due: fmtDate(t.dueDate),
    follow_up: fmtDate(t.followUpDate),
    goal_id: t.goalId ?? "-",
    hard_deadline: t.hardDeadline === true ? "yes" : "no",
    effort: t.effort ?? "-",
  };
}

function formatReceiptOpenTasks(tasks: Array<{ id: string; title: string; status: string; dueDate: Date | null }>): string {
  if (tasks.length === 0) return "- none";
  return tasks.map((task) => `- ${task.id} ${task.status}: ${task.title} (due ${fmtDate(task.dueDate)})`).join("\n");
}

/**
 * Render a write-operation receipt by filling the loaded receipt template with
 * the resulting record. Pure; performs no I/O.
 */
export function compileReceipt(context: ReceiptContext, template: string): string {
  return renderTemplate(template, buildReceiptSlots(context));
}

// ---------------------------------------------------------------------------
// Composed hydration: one packet assembling shared context, per-operation-type
// instruction blocks, and numbered per-task work orders for up to
// COMPOSED_WORK_ORDER_CAP planned writes. This is a pure assembly layer over
// the existing per-operation templates — R6's template bijection is untouched:
// every per-operation template continues to exist and render individually, and
// this layer re-renders the same templates with referent slot values plus
// generated work-order data blocks.
// ---------------------------------------------------------------------------

/** Hard cap on work orders per composed hydrate call (refuse, never truncate). */
export const COMPOSED_WORK_ORDER_CAP = 8;

/** The write operations a composed hydrate can carry (all of them, uniformly). */
export const COMPOSABLE_WRITE_OPERATIONS = [
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
] as const;

/** Read operations are terminal views and are excluded from composition. */
export const HYDRATE_READ_OPERATION_NAMES = [
  "list",
  "show",
  "follow-ups",
  "draft-follow-ups",
] as const;

export type ComposableWriteOperation = (typeof COMPOSABLE_WRITE_OPERATIONS)[number];

/** One parsed `--op` occurrence: an operation plus its task id / intent. */
export interface ComposedOrderSpec {
  operation: ComposableWriteOperation;
  taskId?: string;
  intent?: string;
}

const COMPOSABLE_SET: ReadonlySet<string> = new Set(COMPOSABLE_WRITE_OPERATIONS);
const READ_SET: ReadonlySet<string> = new Set(HYDRATE_READ_OPERATION_NAMES);

/**
 * Parse one repeatable `--op` specifier.
 *
 * Grammar: `create:<intent>` for creates; `<operation>:<task-id>[:<intent>]`
 * for operations targeting an existing task. The intent is always the final
 * segment and may itself contain colons.
 */
export function parseComposedOperationSpec(raw: string): ComposedOrderSpec {
  const trimmed = raw.trim();
  const firstColon = trimmed.indexOf(":");
  const operation = (firstColon === -1 ? trimmed : trimmed.slice(0, firstColon)).trim().toLowerCase();
  const rest = firstColon === -1 ? "" : trimmed.slice(firstColon + 1).trim();

  if (READ_SET.has(operation)) {
    throw new Error(
      `Operation '${operation}' is a read-only request and cannot join a composed batch. Invoke 'execos taskops ${operation}' directly instead.`,
    );
  }
  if (!COMPOSABLE_SET.has(operation)) {
    throw new Error(
      `Unsupported operation '${operation}' in --op specifier. Supported operations: ${COMPOSABLE_WRITE_OPERATIONS.join(", ")}.`,
    );
  }

  if (operation === "create") {
    if (rest.length === 0) {
      throw new Error(`A create work order requires an intent: --op "create:<intent>".`);
    }
    return { operation: "create", intent: rest };
  }

  const secondColon = rest.indexOf(":");
  const taskId = (secondColon === -1 ? rest : rest.slice(0, secondColon)).trim();
  const intent = secondColon === -1 ? undefined : rest.slice(secondColon + 1).trim() || undefined;
  if (taskId.length === 0) {
    throw new Error(
      `Operation '${operation}' requires a task id: --op "${operation}:<task-id>[:<intent>]".`,
    );
  }
  return { operation: operation as ComposableWriteOperation, taskId, intent };
}

/** One work order to assemble: its operation, per-order context, and the
 * operation's own hydrate template (loaded by the caller; this stays pure). */
export interface ComposedWorkOrderInput {
  operation: ComposableWriteOperation;
  context: HydrationContext;
  template: string;
}

export interface ComposedHydrationInput {
  /** Shared context rendered exactly once. */
  tasks: TaskRow[];
  goals: GoalRow[];
  team: TeamMemberLike[];
  orders: ComposedWorkOrderInput[];
  now?: Date;
}

/** Referent values substituted into a per-operation template when it renders
 * as a once-per-type instruction block. Data lives in Shared Context or in the
 * numbered work orders; the instruction block points at it instead of
 * repeating it. Covers every slot the write hydrate templates declare; an
 * unknown slot in a template still throws via renderTemplate. */
const REFERENT_SENTINEL = "%%REF%%";

function referent(text: string): string {
  return `${REFERENT_SENTINEL}${text}`;
}

const INSTRUCTION_BLOCK_REFERENTS: Record<string, string> = {
  intent: referent("(each work order states its own user intent)"),
  task_id: referent("the task ID from this work order"),
  active_tasks: referent("(the Active Tasks table renders once in Shared Context above)"),
  active_goals: referent("(the Active Goals table renders once in Shared Context above)"),
  owner_candidates: referent("(the Team Owner Candidates list renders once in Shared Context above)"),
  dedup_matches: referent("(each work order lists its own matches under Duplicate Check)"),
  memories: referent("(the Relevant Memories & Rules block renders once in Shared Context above)"),
  target_task: referent("(each work order lists its own target task)"),
  target_description: referent("(each work order lists the current description)"),
  owner_open_tasks: referent("(each delegate work order lists owner open tasks)"),
  default_follow_up: referent("(each delegate work order lists the default follow-up date)"),
  warnings: referent("(each work order lists its own warnings)"),
  notes: referent("(each follow-up work order lists recent task notes)"),
};

/** Per-operation work-order data blocks, rendered with the same slot engine
 * and slot bindings the single-operation templates use. */
const WORK_ORDER_BODY_TEMPLATES: Record<ComposableWriteOperation, string> = {
  create: [
    "#### Duplicate Check (this draft)",
    "{{dedup_matches}}",
  ].join("\n"),
  update: [
    "#### Target Task",
    "{{target_task}}",
    "",
    "#### Current Description",
    "{{target_description}}",
  ].join("\n"),
  complete: ["#### Target Task", "{{target_task}}"].join("\n"),
  cancel: ["#### Target Task", "{{target_task}}"].join("\n"),
  reopen: ["#### Target Task", "{{target_task}}"].join("\n"),
  delegate: [
    "#### Target Task",
    "{{target_task}}",
    "",
    "#### Current Description",
    "{{target_description}}",
    "",
    "#### Resolved Owner Open Tasks",
    "{{owner_open_tasks}}",
    "",
    "#### Default Follow-up Date",
    "{{default_follow_up}}",
    "",
    "#### Warnings",
    "{{warnings}}",
  ].join("\n"),
  "follow-up": [
    "#### Target Task",
    "{{target_task}}",
    "",
    "#### Current Description",
    "{{target_description}}",
    "",
    "#### Recent Task Notes",
    "{{notes}}",
    "",
    "#### Warnings",
    "{{warnings}}",
  ].join("\n"),
  defer: ["#### Target Task", "{{target_task}}"].join("\n"),
  "dependency-add": ["#### Target Task", "{{target_task}}"].join("\n"),
  "dependency-remove": ["#### Target Task", "{{target_task}}"].join("\n"),
  "flag-attention": ["#### Target Task", "{{target_task}}"].join("\n"),
  "unflag-attention": ["#### Target Task", "{{target_task}}"].join("\n"),
};

const DEFAULT_WORK_ORDER_INTENTS: Record<ComposableWriteOperation, string> = {
  create: "Create a new task.",
  update: "Update an existing task.",
  complete: "Mark this task done.",
  cancel: "Cancel a task.",
  reopen: "Reopen a done or cancelled task.",
  delegate: "Delegate an existing task.",
  "follow-up": "Record a delegated follow-up result.",
  defer: "Defer a task or follow-up.",
  "dependency-add": "Record a blocking dependency between tasks.",
  "dependency-remove": "Remove a blocking dependency between tasks.",
  "flag-attention": "Flag a task as needing attention.",
  "unflag-attention": "Clear the attention flag on a task.",
};

/** Operations whose work order can render without a resolved target task. */
const TARGETLESS_OPERATIONS: ReadonlySet<ComposableWriteOperation> = new Set(["create"]);

/** Demote markdown headings two levels so an embedded per-operation template
 * nests under its `## Operation Instructions:` section heading. */
function demoteHeadings(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.startsWith("#") ? `##${line}` : line))
    .join("\n");
}

/** Drop the template's own `# Operational Prompt: ...` title line (the
 * instruction-block section heading replaces it). */
function stripTemplateTitle(text: string): string {
  const lines = text.split("\n");
  if (lines[0]?.startsWith("# ")) {
    let start = 1;
    while (start < lines.length && lines[start].trim() === "") start += 1;
    return lines.slice(start).join("\n");
  }
  return text;
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line);
}

function isSentinelOnlyReferentLine(line: string): boolean {
  return line.trim().startsWith(REFERENT_SENTINEL);
}

function stripReferentSentinels(line: string): string {
  return line.replaceAll(REFERENT_SENTINEL, "");
}

function elideStubOnlySections(text: string): string {
  const output: string[] = [];
  let section: string[] = [];

  const flushSection = () => {
    if (section.length === 0) return;
    const [heading, ...body] = section;
    const nonblankBody = body.filter((line) => line.trim().length > 0);
    if (isHeading(heading) && nonblankBody.length > 0 && nonblankBody.every(isSentinelOnlyReferentLine)) {
      section = [];
      return;
    }
    output.push(...section.map(stripReferentSentinels));
    section = [];
  };

  for (const line of text.split("\n")) {
    if (isHeading(line)) {
      flushSection();
      section = [line];
    } else if (section.length > 0) {
      section.push(line);
    } else {
      output.push(stripReferentSentinels(line));
    }
  }
  flushSection();

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function renderInstructionBlock(template: string): string {
  return demoteHeadings(
    elideStubOnlySections(renderTemplate(stripTemplateTitle(template), INSTRUCTION_BLOCK_REFERENTS)),
  );
}

/** Extract the operation's exact next subcommand from the first bash fence of
 * its own hydrate template, with the work order's real task id filled in. */
function extractRunNextCommand(template: string, taskId: string | undefined): string {
  const fence = /```bash\s*\n([\s\S]*?)```/.exec(template);
  const command = fence ? fence[1].trim() : "execos taskops <subcommand>";
  return taskId ? command.replace(/\{\{\s*task_id\s*\}\}/g, taskId) : command;
}

function collectSharedMemories(orders: ComposedWorkOrderInput[]): MemoryRow[] {
  const seen = new Set<string>();
  const memories: MemoryRow[] = [];
  for (const order of orders) {
    for (const memory of order.context.memories ?? []) {
      if (seen.has(memory.id)) continue;
      seen.add(memory.id);
      memories.push(memory);
    }
  }
  return memories;
}

/**
 * Assemble the composed hydration packet: one Shared Context block, one
 * instruction block per operation type present, one numbered work order per
 * requested operation, and a closing receipt checklist. Pure; performs no I/O.
 */
export function compileComposedHydration(input: ComposedHydrationInput): string {
  const { tasks, goals, team, orders, now } = input;
  if (orders.length === 0) {
    throw new Error("Composed hydrate requires at least one work order.");
  }
  if (orders.length > COMPOSED_WORK_ORDER_CAP) {
    throw new Error(
      `Composed hydrate refused: ${orders.length} work orders requested, cap is ${COMPOSED_WORK_ORDER_CAP} per call. Split the batch into waves of at most ${COMPOSED_WORK_ORDER_CAP} and run one composed hydrate per wave.`,
    );
  }

  const total = orders.length;
  const parts: string[] = [];
  const sharedMemories = collectSharedMemories(orders);

  if (now) {
    parts.push(`As of: ${formatAsOf(now)}`);
  }

  // 0. Header.
  parts.push(
    [
      "# Operational Prompt: Task Management (Composed Batch)",
      "",
      `This packet hydrates ${total} planned write operation${total === 1 ? "" : "s"} in one call.`,
      "Read the Shared Context once, read each operation type's instruction block",
      "once, then execute the numbered work orders in order. Each work order names",
      "the exact subcommand to run next, and one receipt must be verified per work",
      "order (see the Closing Checklist).",
    ].join("\n"),
  );

  // 1. Shared context, rendered exactly once.
  const sharedSections = [
    "## Shared Context",
    "",
    "### Active Tasks",
    formatTaskTable(tasks),
    "",
    "### Active Goals",
    formatGoalTable(goals),
  ];
  if (sharedMemories.length > 0) {
    sharedSections.push("", "### Relevant Memories & Rules", formatMemories(sharedMemories));
  }
  if (orders.some((order) => order.operation === "delegate")) {
    sharedSections.push("", "### Team Owner Candidates", formatTeam(team));
  }
  parts.push(sharedSections.join("\n"));

  // 2. Instruction blocks, one per operation type present (first-appearance
  // order). The operation's own hydrate template renders with referent slots
  // so the doctrine has a single authoritative source.
  const seenTypes: ComposableWriteOperation[] = [];
  for (const order of orders) {
    if (!seenTypes.includes(order.operation)) seenTypes.push(order.operation);
  }
  for (const type of seenTypes) {
    const order = orders.find((candidate) => candidate.operation === type)!;
    parts.push([`## Operation Instructions: ${type}`, "", renderInstructionBlock(order.template)].join("\n"));
  }

  // 3. Numbered per-task work orders.
  const workOrderSections: string[] = [`## Work Orders (${total})`];
  orders.forEach((order, index) => {
    const { operation, context, template } = order;
    if (!TARGETLESS_OPERATIONS.has(operation) && !context.targetTask) {
      throw new Error(
        `Work order ${index + 1} (${operation}) requires a resolved target task, but task '${context.taskId}' was not loaded.`,
      );
    }
    const taskId = context.targetTask?.id ?? context.taskId;
    const heading = `### Work Order ${index + 1} of ${total}: ${operation}${taskId ? ` ${taskId}` : ""}`;
    const intentText = context.intent ?? DEFAULT_WORK_ORDER_INTENTS[operation];
    const body = renderTemplate(WORK_ORDER_BODY_TEMPLATES[operation], buildSlots(context));
    workOrderSections.push(
      [
        heading,
        "",
        "#### User Intent",
        intentText,
        "",
        body,
        "",
        "#### Run Next",
        "```bash",
        extractRunNextCommand(template, taskId),
        "```",
        `Fill the remaining placeholders per the "Operation Instructions: ${operation}" block above, then verify this work order's receipt before moving on.`,
      ].join("\n"),
    );
  });
  parts.push(workOrderSections.join("\n\n"));

  // 4. Closing checklist.
  parts.push(
    [
      "## Closing Checklist",
      "",
      "- Run the write subcommands as independent invocations chained with `;`, NEVER `&&`: a refusal (duplicate gate, validation, WIP cap) exits nonzero and `&&` would abort every write after it.",
      `- Verify one receipt per work order: ${total} work order${total === 1 ? "" : "s"} means ${total} receipt${total === 1 ? "" : "s"}. A missing receipt means that write refused or failed; read its error, resolve that work order individually, and re-run only that command.`,
      `- Composed hydration is capped at ${COMPOSED_WORK_ORDER_CAP} work orders per call. Process larger batches in waves: complete and verify this wave's receipts before hydrating the next wave.`,
    ].join("\n"),
  );

  return parts.join("\n\n");
}

/**
 * Render an operation's hydration packet by filling the loaded prompt template
 * with context-derived slot values. The template string is supplied by the
 * caller (loaded from the materialized operational contract); this function is
 * pure and performs no I/O.
 */
export function compileHydrationPrompt(context: HydrationContext, template: string): string {
  // Target-task operations cannot render without a resolved task. In practice
  // the CLI throws TaskNotFoundError before reaching here; this is a defensive
  // guard so the renderer never dereferences a missing task.
  if (
    (
      context.operation === "update" ||
      context.operation === "complete" ||
      context.operation === "show" ||
      context.operation === "delegate" ||
      context.operation === "follow-up"
    ) &&
    !context.targetTask
  ) {
    return `Error: Operation '${context.operation}' requires a valid target task, but task '${context.taskId}' was not found.`;
  }

  const rendered = renderTemplate(template, buildSlots(context));
  return context.now ? `As of: ${formatAsOf(context.now)}\n\n${rendered}` : rendered;
}
