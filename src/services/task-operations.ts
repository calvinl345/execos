/**
 * Unified task write services: create, update-fields, complete, cancel
 * (change-008, A8).
 *
 * Pattern: follow-up-operations.ts. Injectable `TaskOperationDeps`, typed
 * receipts extending the base `{ taskId, task, warnings, activityId }` shape,
 * structured refusals as `{ ok: false, outcome: ... }` unions, and a
 * `productionTaskOperationDeps` default wired to the real db/helpers
 * primitives.
 *
 * Layering (A7): commands parse input, call ONE operation here, and format
 * the receipt. This module owns write orchestration and composes ONLY
 * db/helpers primitives inside transactions; row-level task writes live in
 * src/db/helpers (see insertTask). The write-funnel scan test
 * (tests/cli/task-write-funnel-scan.test.ts) enforces this mechanically.
 *
 * Semantic decisions honored here (S3, decided 2026-06-09):
 *   - D2: priority is explicit-only; the service never infers one.
 *   - D3: terminal confirmation (--yes) lives at the CLI/transport layer;
 *     completeTaskOperation / cancelTaskOperation execute once called.
 *   - D4 (amended by decision 006): the duplicate gate embeds
 *     `title + "\n\n" + description` once and scores cosine similarity
 *     against OPEN tasks only, AND checks normalized exact
 *     title/description matches against open tasks (no embedding filter);
 *     any match refuses the create unless `allowDuplicate` carries a
 *     justification.
 *   - D5: initial status on create is kept, non-terminal states only.
 *
 * The type surface and the production deps wiring are the build contract;
 * the behavioral goldens in tests/services/task-operations.test.ts pin the
 * semantics.
 */

import { and, cosineDistance, desc, eq, inArray, isNotNull, not } from "drizzle-orm";
import { db, goals, taskActivities, tasks } from "../db/index.js";
import type {
  GateEventSurface,
  TaskCategory,
  TaskEffort,
  TaskPriority,
  TaskActivitySource,
  TaskStatus,
} from "../db/schema.js";
import { PZeroWipCapExceededError, TaskNotFoundError } from "../db/errors.js";
import {
  appendTaskNote,
  composeTaskId,
  enforcePZeroWipCap,
  formatGoalLinkNote,
  formatGoalUnlinkNote,
  formatStatusChangeNote,
  insertTask,
  recordGateEvent,
  recordTaskCreated,
  recordTaskGoalLinked,
  recordTaskGoalUnlinked,
  setTaskEmbedding,
  recordTaskStatusChanged,
  updateTaskFields,
  updateTaskStatus,
  type RecordGateEvent,
} from "../db/helpers/index.js";
import type { TaskWriteClient } from "../db/helpers/types.js";
import { embed } from "../embeddings/index.js";
import { loadSettings } from "../cli/settings-loader.js";
import type { Settings } from "../domain/validation.js";
import { canTransitionTask } from "../domain/status-transitions.js";
import { isSelfOwner } from "../domain/follow-ups.js";
import { dedupSuggestion, type DedupSuggestion } from "../domain/memory-policy.js";
import {
  dedupInputFingerprint,
  exactDuplicateMatches,
  type ExactDuplicateMatch,
  type ExactMatchField,
} from "../domain/intake.js";

// ---------------------------------------------------------------------------
// Row types.
// ---------------------------------------------------------------------------

export type TaskRow = typeof tasks.$inferSelect;
export type TaskInsertRow = typeof tasks.$inferInsert;

/** Statuses a task may be created into or transitioned to non-terminally (D5). */
export type NonTerminalTaskStatus = Exclude<TaskStatus, "done" | "cancelled">;
export type ReopenTargetTaskStatus = Exclude<TaskStatus, "triage" | "done" | "cancelled">;

const TERMINAL_STATUSES: TaskStatus[] = ["done", "cancelled"];

// ---------------------------------------------------------------------------
// Dedup gate types (D4 / A9).
// ---------------------------------------------------------------------------

/**
 * Evidence-tier classification for a dedup candidate (decision 006).
 * Similarity tiers reuse the memory-policy `dedupSuggestion` union
 * (settings threshold default 0.85; near_identical at >= 0.92 per
 * DEDUP_NEAR_IDENTICAL_THRESHOLD); `exact` is the strongest tier — a
 * normalized exact title or description match against an open task.
 */
export type DedupBand = DedupSuggestion | "exact";

/** A duplicate open task surfaced by the create duplicate gate. */
export interface DedupMatch {
  id: string;
  title: string;
  /**
   * Cosine similarity in [0, 1] against the draft embedding. Exact
   * matches report the real cosine when available and 1.0 otherwise
   * (e.g. during an embedding outage); the band is what matters.
   */
  similarity: number;
  band: DedupBand;
  /** Which field(s) matched; present only when band is "exact". */
  matchedOn?: ExactMatchField;
}

/**
 * Raw nearest-neighbour candidate returned by `TaskOperationDeps.nearestTasks`.
 * Band classification happens in the operation (it needs Settings); the dep
 * returns similarity only.
 */
export interface NearestTaskCandidate {
  id: string;
  title: string;
  /** Cosine similarity (1 - cosine distance) in [0, 1]. */
  similarity: number;
}

// ---------------------------------------------------------------------------
// Deps.
// ---------------------------------------------------------------------------

export interface TaskOperationDeps {
  now(): Date;
  /** Embedding provider seam (production: src/embeddings embed()). */
  embed(text: string): Promise<number[]>;
  findTask(taskId: string): Promise<TaskRow | null>;
  /** All tasks with status NOT IN ('done','cancelled'). */
  listActiveTasks(): Promise<TaskRow[]>;
  goalExists(goalId: string): Promise<boolean>;
  /**
   * Duplicate-gate candidate query (D4/A9): pgvector cosine similarity over
   * OPEN tasks only — `status NOT IN ('done','cancelled')` — restricted to
   * rows with a non-null embedding. Closed tasks are NEVER candidates, so
   * historical work cannot drive false positives. Null-embedding rows are
   * skipped. Returns the `limit` nearest candidates, most similar first.
   */
  nearestTasks(embedding: number[], limit: number): Promise<NearestTaskCandidate[]>;
  /**
   * Exact-match duplicate query (decision 006): open tasks only —
   * `status NOT IN ('done','cancelled')` — WITHOUT the embedding filter,
   * so tasks created during an embedding outage (null embedding) still
   * participate. Returns candidates whose normalized title or description
   * exactly matches the draft's, per-field (never cross-field), using
   * normalizeForExactMatch / exactDuplicateMatches from src/domain/intake.
   */
  findExactMatches(draft: {
    title: string;
    description: string;
  }): Promise<ExactDuplicateMatch[]>;
  /**
   * Most recent non-terminal, non-triage status before a terminal close.
   * Used only by reopen; null means fallback to backlog.
   */
  findPreviousReopenStatus(taskId: string): Promise<ReopenTargetTaskStatus | null>;
  /** Settings accessor (production: memoized loadSettings()). */
  settings(): Promise<Settings>;
  /**
   * Transaction runner. Production wraps db.transaction; operations compose
   * db-helper passthroughs against the provided tx.
   */
  runInTransaction<T>(fn: (tx: TaskWriteClient) => Promise<T>): Promise<T>;

  /**
   * Gate-decision telemetry seam (W5). Best-effort by contract: never
   * throws; a failure surfaces as `warning` in its result. Production
   * wires src/db/helpers recordGateEvent (appendGateEvent is the only
   * write path to gate_events); fakes record in memory.
   */
  recordGateEvent: RecordGateEvent;

  // db-helper passthroughs (typeof keeps signatures in lockstep with
  // src/db/helpers; fakes implement the same shapes).
  insertTask: typeof insertTask;
  composeTaskId: typeof composeTaskId;
  enforcePZeroWipCap: typeof enforcePZeroWipCap;
  updateTaskStatus: typeof updateTaskStatus;
  updateTaskFields: typeof updateTaskFields;
  setTaskEmbedding: typeof setTaskEmbedding;
  appendTaskNote: typeof appendTaskNote;
  recordTaskCreated: typeof recordTaskCreated;
  recordTaskGoalLinked: typeof recordTaskGoalLinked;
  recordTaskGoalUnlinked: typeof recordTaskGoalUnlinked;
  recordTaskStatusChanged: typeof recordTaskStatusChanged;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export type TaskServiceErrorCode =
  | "terminal_task"
  | "illegal_transition"
  | "invalid_reopen_target"
  | "not_terminal"
  | "goal_not_found"
  | "due_required"
  | "owner_not_self"
  | "validation";

export class TaskServiceError extends Error {
  constructor(
    public readonly code: TaskServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TaskServiceError";
  }
}

// ---------------------------------------------------------------------------
// Receipts (base shape mirrors FollowUpReceipt: taskId, task, warnings,
// activityId).
// ---------------------------------------------------------------------------

export interface TaskOperationReceipt {
  taskId: string;
  task: TaskRow;
  warnings: string[];
  activityId: string;
}

export interface CreateTaskReceipt extends TaskOperationReceipt {
  operation: "create";
  /**
   * Duplicate-gate outcome. `matches` lists scored open-task candidates
   * (empty when clean or when the embed step degraded); `overridden` is true
   * when `allowDuplicate` bypassed a refusal-worthy match (recorded in the
   * intake_checklist audit note).
   */
  dedup: {
    matches: DedupMatch[];
    overridden: boolean;
    /** The override justification; null when no override happened. */
    justification: string | null;
  };
}

export interface UpdateTaskReceipt extends TaskOperationReceipt {
  operation: "update";
}

export interface CompleteTaskReceipt extends TaskOperationReceipt {
  operation: "complete";
  newStatus: "done";
}

export interface CancelTaskReceipt extends TaskOperationReceipt {
  operation: "cancel";
  newStatus: "cancelled";
}

export interface ReopenTaskReceipt extends TaskOperationReceipt {
  operation: "reopen";
  fromStatus: "done" | "cancelled";
  newStatus: ReopenTargetTaskStatus;
  noteId: string | null;
}

// ---------------------------------------------------------------------------
// Inputs and result unions.
// ---------------------------------------------------------------------------

export interface CreateTaskInput {
  title: string;
  description: string;
  category: TaskCategory;
  /** D2: explicit only. The service NEVER infers a priority; omitted means none. */
  priority?: TaskPriority;
  /** D5: non-terminal states only. Defaults to "triage" when omitted. */
  status?: NonTerminalTaskStatus;
  /** Required (due_required is thrown by update paths that try to clear it). */
  dueAt: Date;
  goalId?: string;
  /**
   * Must normalize to "me" (omitted/case/whitespace variants allowed); any
   * other value is refused with TaskServiceError("owner_not_self") — create
   * the task owned by me, then use the delegate operation.
   */
  owner?: string;
  /** change-009: due date is a hard external commitment. Defaults to false. */
  hardDeadline?: boolean;
  /** change-009: t-shirt effort estimate. Never affects ranking. */
  effort?: TaskEffort;
  initialNote?: string;
  /**
   * D4 (amended by decision 006): overrides a duplicate refusal. The value
   * is the override justification and must be non-empty after trimming; it
   * is recorded in the intake_checklist audit note and surfaced in the
   * receipt. Omitted means no override.
   */
  allowDuplicate?: string;
  /**
   * Calling surface, stamped onto gate-decision telemetry (W5). The web
   * task-action dispatcher passes "web"; everything else defaults to "cli".
   */
  surface?: GateEventSurface;
}

/**
 * Mirrors delegateOperation's ask_owner refusal union: a near-duplicate is a
 * structured refusal the caller presents as options, not an error.
 */
export type CreateTaskResult =
  | { ok: true; receipt: CreateTaskReceipt }
  | { ok: false; outcome: "duplicate"; matches: DedupMatch[] };

export interface UpdateTaskInput {
  taskId: string;
  title?: string;
  description?: string;
  category?: TaskCategory;
  /** Promotion to P0 enforces the WIP cap inside the transaction. */
  priority?: TaskPriority;
  /** Non-terminal transitions only; terminal moves go through complete/cancel. */
  status?: NonTerminalTaskStatus;
  /**
   * New due date. Passing `null` (clearing) is rejected with
   * TaskServiceError("due_required") — existing rule, identical on all
   * surfaces.
   */
  dueAt?: Date | null;
  /**
   * Must normalize to "me" when provided (case/whitespace variants allowed;
   * `null` clears); any other value is refused with
   * TaskServiceError("owner_not_self") — use the delegate operation instead.
   */
  owner?: string | null;
  /**
   * Goal link absorbs the legacy link-goal / unlink-goal commands: a string
   * sets (recordTaskGoalLinked), `null` clears (recordTaskGoalUnlinked),
   * `undefined` leaves the link untouched.
   */
  goalId?: string | null;
  /** change-009: set/unset the hard-deadline marker; `undefined` leaves it. */
  hardDeadline?: boolean;
  /**
   * change-009: effort estimate. A value sets, `null` clears (mirroring
   * goalId clearing), `undefined` leaves it untouched.
   */
  effort?: TaskEffort | null;
  /**
   * Optional manual note appended in the same transaction (ISS-003: the
   * standard `--note` surface, mirroring reopen). Omitted leaves no note; an
   * explicitly-provided empty/whitespace-only note is rejected with
   * TaskServiceError("validation").
   */
  note?: string;
  /** Calling surface for gate-decision telemetry (W5). Default "cli". */
  surface?: GateEventSurface;
}

export interface CompleteTaskInput {
  taskId: string;
  /** Calling surface for gate-decision telemetry (W5). Default "cli". */
  surface?: GateEventSurface;
}

export interface CancelTaskInput {
  taskId: string;
  /** Calling surface for gate-decision telemetry (W5). Default "cli". */
  surface?: GateEventSurface;
}

export interface ReopenTaskInput {
  taskId: string;
  /**
   * Optional explicit target. Omitted restores the previous non-terminal,
   * non-triage status when activity history has one, otherwise backlog.
   */
  toStatus?: ReopenTargetTaskStatus;
  note?: string;
  /** Calling surface for gate-decision telemetry (W5). Default "cli". */
  surface?: GateEventSurface;
  source?: TaskActivitySource;
}

// ---------------------------------------------------------------------------
// Production deps.
// ---------------------------------------------------------------------------

export const productionTaskOperationDeps: TaskOperationDeps = {
  now: () => new Date(),
  embed: (text) => embed(text),
  async findTask(taskId) {
    const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    return rows[0] ?? null;
  },
  async listActiveTasks() {
    return db
      .select()
      .from(tasks)
      .where(not(inArray(tasks.status, TERMINAL_STATUSES)))
      .orderBy(desc(tasks.lastStatusChangeAt));
  },
  async goalExists(goalId) {
    const rows = await db
      .select({ id: goals.id })
      .from(goals)
      .where(eq(goals.id, goalId))
      .limit(1);
    return rows.length > 0;
  },
  async nearestTasks(embedding, limit) {
    // pgvector cosine distance (`<=>` via drizzle cosineDistance) over open
    // tasks with stored embeddings only: status NOT IN ('done','cancelled')
    // AND embedding IS NOT NULL. similarity = 1 - distance.
    const distance = cosineDistance(tasks.embedding, embedding);
    const rows = await db
      .select({ id: tasks.id, title: tasks.title, distance })
      .from(tasks)
      .where(
        and(
          not(inArray(tasks.status, TERMINAL_STATUSES)),
          isNotNull(tasks.embedding),
        ),
      )
      .orderBy(distance)
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      similarity: 1 - Number(row.distance),
    }));
  },
  async findExactMatches(draft) {
    // Open tasks only, WITHOUT the embedding IS NOT NULL filter: rows that
    // never got an embedding (created during an outage) must still be
    // exact-match candidates. Normalization and per-field comparison live
    // in the pure domain helper so production and fakes cannot drift.
    const rows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
      })
      .from(tasks)
      .where(not(inArray(tasks.status, TERMINAL_STATUSES)));
    return exactDuplicateMatches(draft, rows);
  },
  async findPreviousReopenStatus(taskId) {
    const rows = await db
      .select({ payload: taskActivities.payload })
      .from(taskActivities)
      .where(and(
        eq(taskActivities.taskId, taskId),
        eq(taskActivities.eventType, "task_status_changed"),
      ))
      .orderBy(desc(taskActivities.occurredAt))
      .limit(20);

    for (const row of rows) {
      const payload = row.payload;
      if (!isStatusPayload(payload)) continue;
      if (!isTerminalStatus(payload.to_status)) continue;
      if (isReopenTargetStatus(payload.from_status)) return payload.from_status;
    }
    return null;
  },
  async settings() {
    const { settings } = await loadSettings();
    return settings;
  },
  runInTransaction: (fn) => db.transaction(fn),
  recordGateEvent,
  insertTask,
  composeTaskId,
  enforcePZeroWipCap,
  updateTaskStatus,
  updateTaskFields,
  setTaskEmbedding,
  appendTaskNote,
  recordTaskCreated,
  recordTaskGoalLinked,
  recordTaskGoalUnlinked,
  recordTaskStatusChanged,
};

// ---------------------------------------------------------------------------
// Private helpers.
// ---------------------------------------------------------------------------

/** Candidate count requested from the dedup gate's nearest-neighbour query. */
const DEDUP_CANDIDATE_LIMIT = 5;

function isTerminalStatus(status: TaskStatus): status is "done" | "cancelled" {
  return status === "done" || status === "cancelled";
}

function isReopenTargetStatus(status: TaskStatus): status is ReopenTargetTaskStatus {
  return status === "backlog" || status === "in_progress" || status === "blocked" || status === "review";
}

function isStatusPayload(payload: unknown): payload is { from_status: TaskStatus; to_status: TaskStatus } {
  if (payload === null || typeof payload !== "object") return false;
  const maybe = payload as { from_status?: unknown; to_status?: unknown };
  return isTaskStatus(maybe.from_status) && isTaskStatus(maybe.to_status);
}

function isTaskStatus(status: unknown): status is TaskStatus {
  return (
    status === "triage" ||
    status === "backlog" ||
    status === "in_progress" ||
    status === "blocked" ||
    status === "review" ||
    status === "done" ||
    status === "cancelled"
  );
}

function assertReopenTargetStatus(status: TaskStatus): asserts status is ReopenTargetTaskStatus {
  if (isReopenTargetStatus(status)) return;
  throw new TaskServiceError(
    "invalid_reopen_target",
    `Reopen target '${status}' is not allowed. Use backlog, in_progress, blocked, or review.`,
  );
}

/**
 * Delegation is the only operation that sets a non-"me" owner. Create and
 * update refuse any owner that does not normalize to "me" (null/undefined/
 * empty/case/whitespace variants all count as self) and direct the caller to
 * `execos taskops delegate`, which resolves the owner against the team roster
 * and enforces the follow-up requirement. Runs before any write.
 */
function assertSelfOwner(
  owner: string | null | undefined,
  context: { operation: "create" } | { operation: "update"; taskId: string },
): void {
  if (owner === undefined || isSelfOwner(owner)) return;
  const remedy =
    context.operation === "create"
      ? `Create the task owned by me first, then run 'execos taskops delegate --task-id <new-task-id> --owner ${owner}'.`
      : `Use 'execos taskops delegate --task-id ${context.taskId} --owner ${owner}' instead.`;
  throw new TaskServiceError(
    "owner_not_self",
    `Owner '${owner}' is not allowed on ${context.operation}: setting a teammate owner is delegation. ${remedy}`,
  );
}

async function requireTask(
  deps: TaskOperationDeps,
  taskId: string,
): Promise<TaskRow> {
  const task = await deps.findTask(taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  return task;
}

async function requireOpenTask(
  deps: TaskOperationDeps,
  taskId: string,
): Promise<TaskRow> {
  const task = await requireTask(deps, taskId);
  if (isTerminalStatus(task.status)) {
    throw new TaskServiceError(
      "terminal_task",
      `Task ${taskId} is already terminal (${task.status}).`,
    );
  }
  return task;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** First non-empty string among the candidates; "" when none. */
function firstNonEmpty(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    if (candidate) return candidate;
  }
  return "";
}

/**
 * Composes the intake_checklist audit note content (A8/A9, D2). Field names
 * follow the IntakeAuditTrail shape from src/domain/intake.ts so existing
 * note consumers keep parsing. The service runs no inference heuristics, so
 * every value reflects exactly what the caller provided:
 *   - step_1_dedup: the gate outcome — "passed", "skipped:embed_failed"
 *     (the similarity check was skipped; the exact-match check still ran),
 *     or "overridden:<top-match-id>" when allowDuplicate bypassed a refusal
 *     (the override marker wins even when embedding also failed).
 *   - step_4_field_assignment: which fields the caller left unset (NO
 *     inferred values; priority stays exactly as provided or null per D2).
 *   - hard_deadline / effort (change-009): recorded exactly as provided
 *     (defaults false / null when omitted) so the audit trail shows the
 *     commitment marker and estimate captured at intake.
 *   - dedup_overridden: true iff allowDuplicate bypassed a refusal-worthy
 *     match (D4).
 *   - dedup_override_justification: the caller's justification when the
 *     override fired; null otherwise (decision 006).
 */
function composeIntakeAudit(args: {
  input: CreateTaskInput;
  matches: DedupMatch[];
  overridden: boolean;
  embedFailed: boolean;
  justification: string | null;
}): Record<string, unknown> {
  let step1: string;
  if (args.overridden) {
    step1 = `overridden:${args.matches[0].id}`;
  } else if (args.embedFailed) {
    step1 = "skipped:embed_failed";
  } else {
    step1 = "passed";
  }

  const missing: string[] = [];
  if (!args.input.priority) missing.push("priority");

  return {
    step_1_dedup: step1,
    step_2_complexity: "kept_single",
    step_3_dependency: "passed",
    step_4_field_assignment:
      missing.length === 0 ? "complete" : `partial:${missing.join(",")}`,
    // Create can never delegate: the owner gate refuses non-"me" owners
    // before any write, and delegation has its own audited operation.
    step_5_delegation: "not_delegated",
    step_6_downstream: "noted",
    hard_deadline: args.input.hardDeadline === true,
    effort: args.input.effort ?? null,
    duration_ms: 0,
    dedup_overridden: args.overridden,
    dedup_override_justification: args.overridden ? args.justification : null,
  };
}

// ---------------------------------------------------------------------------
// Operations.
// ---------------------------------------------------------------------------

/**
 * Create a task (replaces the inline task.ts / taskops.ts create paths).
 *
 * Flow (A8): validate -> goal existence -> embed `title + "\n\n" +
 * description` once -> duplicate gate over open tasks (D4, amended by
 * decision 006: normalized exact title/description matching plus embedding
 * similarity) unless `allowDuplicate` carries a justification -> one
 * transaction: composeTaskId; enforcePZeroWipCap when priority is P0;
 * insertTask WITH the embedding; recordTaskCreated; intake_checklist audit
 * note (provided fields, dedup outcome, dedup_overridden flag plus
 * justification, NO inferred priority per D2); status_change note plus
 * activity when status != triage; manual note when initialNote.
 *
 * Degradation: if embed() fails the create proceeds with a null embedding and
 * a "dedup check skipped" warning in the receipt — task capture is never
 * blocked by the embedding provider. The exact-match check does NOT depend on
 * the embedding and still runs (and can still refuse) during an outage.
 */
export async function createTaskOperation(
  input: CreateTaskInput,
  deps: TaskOperationDeps = productionTaskOperationDeps,
): Promise<CreateTaskResult> {
  const settings = await deps.settings();
  const warnings: string[] = [];
  const surface: GateEventSurface = input.surface ?? "cli";

  // Validate (A8): dueAt is required; initial status must be non-terminal (D5).
  if (!input.dueAt) {
    throw new TaskServiceError(
      "due_required",
      "Task creation requires a due date.",
    );
  }
  const status: NonTerminalTaskStatus = input.status ?? "triage";
  if (isTerminalStatus(status)) {
    throw new TaskServiceError(
      "validation",
      `Initial status '${status}' is terminal; tasks are created into non-terminal statuses only (D5).`,
    );
  }

  // Owner gate: create never sets a teammate owner; delegation is the only
  // path that does. Refused before any read-side work or write. The refusal
  // logs an owner_not_self gate event (standalone, best-effort).
  try {
    assertSelfOwner(input.owner, { operation: "create" });
  } catch (err) {
    if (err instanceof TaskServiceError && err.code === "owner_not_self") {
      await deps.recordGateEvent({
        gate: "owner_not_self",
        operation: "create",
        outcome: "blocked",
        surface,
        taskId: null,
        detail: { owner: input.owner ?? null },
      });
    }
    throw err;
  }

  // Override justification (decision 006): when allowDuplicate is provided
  // it must carry a non-empty justification. Validated before any read-side
  // work so a hollow override never reaches the gate.
  let justification: string | null = null;
  if (input.allowDuplicate !== undefined) {
    justification = input.allowDuplicate.trim();
    if (justification.length === 0) {
      throw new TaskServiceError(
        "validation",
        "A duplicate override requires a non-empty justification: pass --allow-duplicate \"<justification>\".",
      );
    }
  }

  // Goal existence (clean error instead of an FK violation).
  if (input.goalId) {
    const exists = await deps.goalExists(input.goalId);
    if (!exists) {
      throw new TaskServiceError(
        "goal_not_found",
        `Goal '${input.goalId}' does not exist.`,
      );
    }
  }

  // Embed `title + "\n\n" + description` exactly once (A9). Embed failure
  // degrades: null embedding, gate skipped (never guessed), warning surfaced.
  const draftText = `${input.title}\n\n${input.description}`;
  let embedding: number[] | null = null;
  let embedFailed = false;
  try {
    embedding = await deps.embed(draftText);
  } catch (err) {
    embedFailed = true;
    warnings.push(
      `Dedup check skipped: embedding unavailable (${errorMessage(err)}). Task created without a stored embedding.`,
    );
  }

  // Duplicate gate (D4, amended by decision 006). Two checks, both over
  // open tasks only:
  //   1. Exact match — normalized title/description equality via the
  //      findExactMatches seam (no embedding filter, so null-embedding rows
  //      participate). Runs even when embed() failed, so the gate still
  //      works during an embedding outage.
  //   2. Embedding similarity — the nearestTasks seam, skipped (never
  //      guessed) when the embed step degraded.
  // Any match refuses the create unless allowDuplicate carries a
  // justification.
  let semanticCandidates: NearestTaskCandidate[] = [];
  if (embedding !== null) {
    semanticCandidates = await deps.nearestTasks(embedding, DEDUP_CANDIDATE_LIMIT);
  }
  const similarityById = new Map(
    semanticCandidates.map((candidate) => [candidate.id, candidate.similarity]),
  );

  const exactMatches: DedupMatch[] = (
    await deps.findExactMatches({
      title: input.title,
      description: input.description,
    })
  ).map((match) => ({
    id: match.id,
    title: match.title,
    // Real cosine when the candidate also surfaced semantically; 1.0
    // otherwise (e.g. null embedding or embed outage). The band is what
    // matters.
    similarity: similarityById.get(match.id) ?? 1,
    band: "exact" as const,
    matchedOn: match.matchedOn,
  }));
  const exactIds = new Set(exactMatches.map((match) => match.id));

  const semanticMatches: DedupMatch[] = semanticCandidates
    .filter((candidate) => !exactIds.has(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      similarity: candidate.similarity,
      band: dedupSuggestion(candidate.similarity, settings) as DedupBand,
    }))
    .filter((match) => match.band !== "no_match");

  const matches: DedupMatch[] = [...exactMatches, ...semanticMatches];
  // Dedup-gate telemetry (W5): correlation between a blocked create and a
  // later override is server-side via the input fingerprint (sha256 of the
  // gate's own normalization), never via agent ordering.
  const fingerprint = dedupInputFingerprint(input.title, input.description);
  const dedupDetail = (): Record<string, unknown> => ({
    matches: matches.map((match) => ({
      id: match.id,
      band: match.band,
      similarity: match.similarity,
      ...(match.matchedOn !== undefined ? { matchedOn: match.matchedOn } : {}),
    })),
    embed_failed: embedFailed,
  });
  if (matches.length > 0 && justification === null) {
    // Blocked: standalone, best-effort, on the refusal path. No task row
    // exists, so task_id stays null.
    await deps.recordGateEvent({
      gate: "dedup",
      operation: "create",
      outcome: "blocked",
      surface,
      taskId: null,
      inputFingerprint: fingerprint,
      detail: dedupDetail(),
    });
    return { ok: false, outcome: "duplicate", matches };
  }
  const overridden = matches.length > 0;

  const now = deps.now();
  const priority = input.priority ?? null;
  // The owner gate above guarantees the value normalizes to "me"; store the
  // canonical form so case/whitespace variants never reach the row.
  const owner = "me";

  const createTransaction = (): Promise<{ taskId: string; activityId: string }> =>
    deps.runInTransaction(async (tx) => {
    const taskId = await deps.composeTaskId(
      settings.infrastructure.task_id_prefix,
    );

    // WIP cap inside the same transaction, BEFORE the insert (AC-073).
    if (priority === "P0") {
      await deps.enforcePZeroWipCap(tx, settings.infrastructure.p0_wip_cap);
    }

    await deps.insertTask(tx, {
      id: taskId,
      title: input.title,
      description: input.description,
      status,
      category: input.category,
      priority,
      owner,
      dueDate: input.dueAt,
      goalId: input.goalId ?? null,
      hardDeadline: input.hardDeadline ?? false,
      effort: input.effort ?? null,
      embedding,
    });

    const created = await deps.recordTaskCreated(tx, {
      taskId,
      title: input.title,
      status,
      priority,
      category: input.category,
      owner,
      dueDate: input.dueAt,
      goalId: input.goalId ?? null,
      by: "agent",
      occurredAt: now,
    });

    await deps.appendTaskNote(tx, {
      taskId,
      noteType: "intake_checklist",
      content: JSON.stringify(
        composeIntakeAudit({ input, matches, overridden, embedFailed, justification }),
      ),
      createdBy: "agent",
    });

    // Dedup-gate telemetry tied to the successful write: SAME transaction
    // (savepoint-protected, best-effort — a telemetry failure surfaces as a
    // warning, never blocks the create). Overridden wins over skipped,
    // mirroring step_1_dedup; a clean pass writes nothing.
    if (overridden) {
      const gateResult = await deps.recordGateEvent(
        {
          gate: "dedup",
          operation: "create",
          outcome: "overridden",
          surface,
          taskId,
          justification,
          inputFingerprint: fingerprint,
          detail: dedupDetail(),
        },
        { tx },
      );
      if (gateResult.warning) warnings.push(gateResult.warning);
    } else if (embedFailed) {
      const gateResult = await deps.recordGateEvent(
        {
          gate: "dedup",
          operation: "create",
          outcome: "skipped",
          surface,
          taskId,
          inputFingerprint: fingerprint,
          detail: { reason: "embed_failed" },
        },
        { tx },
      );
      if (gateResult.warning) warnings.push(gateResult.warning);
    }

    if (status !== "triage") {
      await deps.appendTaskNote(tx, {
        taskId,
        noteType: "status_change",
        content: formatStatusChangeNote("triage", status, "agent", now),
        createdBy: "agent",
      });
      await deps.recordTaskStatusChanged(tx, {
        taskId,
        fromStatus: "triage",
        toStatus: status,
        by: "agent",
        occurredAt: now,
      });
    }

    if (input.initialNote) {
      await deps.appendTaskNote(tx, {
        taskId,
        noteType: "manual",
        content: input.initialNote,
        createdBy: "agent",
      });
    }

    return { taskId, activityId: created.activityId };
  });

  let txResult: { taskId: string; activityId: string };
  try {
    txResult = await createTransaction();
  } catch (err) {
    // WIP-cap gate (AC-073): enforced inside the transaction, which rolls
    // back on refusal. The blocked event inserts standalone afterwards,
    // best-effort, with task_id null (no row was created).
    if (err instanceof PZeroWipCapExceededError) {
      await deps.recordGateEvent({
        gate: "wip_cap",
        operation: "create",
        outcome: "blocked",
        surface,
        taskId: null,
        detail: { cap: err.cap, current: err.currentCount },
      });
    }
    throw err;
  }

  const task = await requireTask(deps, txResult.taskId);

  return {
    ok: true,
    receipt: {
      operation: "create",
      taskId: txResult.taskId,
      task,
      warnings,
      activityId: txResult.activityId,
      dedup: {
        matches,
        overridden,
        justification: overridden ? justification : null,
      },
    },
  };
}

/**
 * Patch task fields, including goal link set/clear (absorbs legacy
 * link-goal / unlink-goal). One transaction: updateTaskFields, optional
 * non-terminal updateTaskStatus, recordTaskGoalLinked/Unlinked with a system
 * note when goalId changes. Re-embeds and stores the vector when title or
 * description changed (A9). WIP cap enforced on promotion to P0. Due-date
 * clearing rejected with TaskServiceError("due_required").
 */
export async function updateTaskOperation(
  input: UpdateTaskInput,
  deps: TaskOperationDeps = productionTaskOperationDeps,
): Promise<UpdateTaskReceipt> {
  const warnings: string[] = [];
  const surface: GateEventSurface = input.surface ?? "cli";
  const task = await requireOpenTask(deps, input.taskId);

  // Terminal moves never go through update (pinned: illegal_transition);
  // completeTaskOperation / cancelTaskOperation are the only terminal paths.
  // Both refusals log a status_transition gate event (standalone,
  // best-effort) before throwing.
  if (input.status !== undefined) {
    if (isTerminalStatus(input.status) || !canTransitionTask(task.status, input.status)) {
      await deps.recordGateEvent({
        gate: "status_transition",
        operation: "update",
        outcome: "blocked",
        surface,
        taskId: input.taskId,
        detail: { from: task.status, to: input.status },
      });
    }
    if (isTerminalStatus(input.status)) {
      throw new TaskServiceError(
        "illegal_transition",
        `Terminal status '${input.status}' is not allowed through update; use the complete or cancel operation.`,
      );
    }
    if (!canTransitionTask(task.status, input.status)) {
      throw new TaskServiceError(
        "illegal_transition",
        `Illegal status transition from ${task.status} to ${input.status}.`,
      );
    }
  }

  // Due-date clearing rejected (existing rule, identical on all surfaces).
  if (input.dueAt === null) {
    throw new TaskServiceError(
      "due_required",
      "Tasks must keep a due date; clearing it is not allowed.",
    );
  }

  // Manual note (ISS-003): omitted leaves no note; an explicitly-provided
  // empty/whitespace-only note is rejected before any write. A real note is
  // appended in the update transaction below (mirroring reopen).
  let noteText: string | undefined;
  if (input.note !== undefined) {
    noteText = input.note.trim();
    if (noteText.length === 0) {
      throw new TaskServiceError(
        "validation",
        "A note was provided but is empty; pass note text or omit it.",
      );
    }
  }

  // Owner gate: update never sets a teammate owner; delegation is the only
  // path that does. Refuses the WHOLE update (no partial field application)
  // before the embed step and before any write. The refusal logs an
  // owner_not_self gate event (standalone, best-effort).
  try {
    assertSelfOwner(input.owner, { operation: "update", taskId: input.taskId });
  } catch (err) {
    if (err instanceof TaskServiceError && err.code === "owner_not_self") {
      await deps.recordGateEvent({
        gate: "owner_not_self",
        operation: "update",
        outcome: "blocked",
        surface,
        taskId: input.taskId,
        detail: { owner: input.owner ?? null },
      });
    }
    throw err;
  }

  if (typeof input.goalId === "string") {
    const exists = await deps.goalExists(input.goalId);
    if (!exists) {
      throw new TaskServiceError(
        "goal_not_found",
        `Goal '${input.goalId}' does not exist.`,
      );
    }
  }
  const goalToLink =
    typeof input.goalId === "string" && task.goalId !== input.goalId
      ? input.goalId
      : null;
  const goalToUnlinkFrom =
    input.goalId === null && task.goalId !== null ? task.goalId : null;

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.category !== undefined) patch.category = input.category;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.dueAt !== undefined) patch.dueDate = input.dueAt;
  // The owner gate above guarantees any non-null value normalizes to "me";
  // store the canonical form (null passes through untouched).
  if (input.owner !== undefined) patch.owner = input.owner === null ? null : "me";
  if (input.goalId !== undefined) patch.goalId = input.goalId;
  if (input.hardDeadline !== undefined) patch.hardDeadline = input.hardDeadline;
  if (input.effort !== undefined) patch.effort = input.effort;

  // Re-embed only when title or description changed (A9); the new vector is
  // stored via the updateTaskFields patch path, not a separate write.
  if (input.title !== undefined || input.description !== undefined) {
    const text = `${input.title ?? task.title}\n\n${input.description ?? task.description}`;
    try {
      patch.embedding = await deps.embed(text);
    } catch (err) {
      warnings.push(
        `Embedding refresh skipped (${errorMessage(err)}); the stored task embedding was left unchanged.`,
      );
    }
  }

  const promoteToP0 = input.priority === "P0" && task.priority !== "P0";
  const settings = promoteToP0 ? await deps.settings() : null;
  const now = deps.now();

  const updateTransaction = (): Promise<{
    fieldsActivityId: string | null;
    statusActivityId: string | null;
    goalActivityId: string | null;
  }> =>
    deps.runInTransaction(async (tx) => {
    // WIP cap on promotion to P0, BEFORE the field write.
    if (promoteToP0 && settings) {
      await deps.enforcePZeroWipCap(tx, settings.infrastructure.p0_wip_cap);
    }

    let fieldsActivityId: string | null = null;
    if (Object.keys(patch).length > 0) {
      const fieldsResult = await deps.updateTaskFields(input.taskId, patch, {
        tx,
      });
      fieldsActivityId = fieldsResult.activityIds[0] ?? null;
    }

    let statusActivityId: string | null = null;
    if (input.status !== undefined) {
      const statusResult = await deps.updateTaskStatus(
        input.taskId,
        input.status,
        "agent",
        { tx },
      );
      statusActivityId = statusResult.activityId || null;
    }

    let goalActivityId: string | null = null;
    if (goalToLink !== null) {
      await deps.appendTaskNote(tx, {
        taskId: input.taskId,
        noteType: "system",
        content: formatGoalLinkNote(goalToLink, "agent", now),
        createdBy: "agent",
      });
      const linked = await deps.recordTaskGoalLinked(tx, {
        taskId: input.taskId,
        goalId: goalToLink,
        by: "agent",
        occurredAt: now,
      });
      goalActivityId = linked.activityId;
    } else if (goalToUnlinkFrom !== null) {
      await deps.appendTaskNote(tx, {
        taskId: input.taskId,
        noteType: "system",
        content: formatGoalUnlinkNote(goalToUnlinkFrom, "agent", now),
        createdBy: "agent",
      });
      const unlinked = await deps.recordTaskGoalUnlinked(tx, {
        taskId: input.taskId,
        fromGoalId: goalToUnlinkFrom,
        by: "agent",
        occurredAt: now,
      });
      goalActivityId = unlinked.activityId;
    }

    // Manual note in the SAME transaction (ISS-003), mirroring reopen.
    if (noteText) {
      await deps.appendTaskNote(tx, {
        taskId: input.taskId,
        noteType: "manual",
        content: noteText,
        createdBy: "agent",
      });
    }

    return { fieldsActivityId, statusActivityId, goalActivityId };
  });

  let txResult: {
    fieldsActivityId: string | null;
    statusActivityId: string | null;
    goalActivityId: string | null;
  };
  try {
    txResult = await updateTransaction();
  } catch (err) {
    // WIP-cap gate on promotion to P0: the transaction rolled back; the
    // blocked event inserts standalone afterwards, best-effort.
    if (err instanceof PZeroWipCapExceededError) {
      await deps.recordGateEvent({
        gate: "wip_cap",
        operation: "update",
        outcome: "blocked",
        surface,
        taskId: input.taskId,
        detail: { cap: err.cap, current: err.currentCount },
      });
    }
    throw err;
  }

  const updated = await requireTask(deps, input.taskId);

  return {
    operation: "update",
    taskId: input.taskId,
    task: updated,
    warnings,
    activityId: firstNonEmpty(
      txResult.fieldsActivityId,
      txResult.statusActivityId,
      txResult.goalActivityId,
    ),
  };
}

/**
 * Terminal transition to "done" via updateTaskStatus. D3's --yes
 * confirmation lives at the CLI/transport layer; this executes once called.
 */
export async function completeTaskOperation(
  input: CompleteTaskInput,
  deps: TaskOperationDeps = productionTaskOperationDeps,
): Promise<CompleteTaskReceipt> {
  const task = await requireOpenTask(deps, input.taskId);
  if (!canTransitionTask(task.status, "done")) {
    // status_transition gate: refusal logs standalone, best-effort.
    await deps.recordGateEvent({
      gate: "status_transition",
      operation: "complete",
      outcome: "blocked",
      surface: input.surface ?? "cli",
      taskId: input.taskId,
      detail: { from: task.status, to: "done" },
    });
    throw new TaskServiceError(
      "illegal_transition",
      `Illegal status transition from ${task.status} to done.`,
    );
  }

  const statusResult = await deps.runInTransaction((tx) =>
    deps.updateTaskStatus(input.taskId, "done", "agent", { tx }),
  );
  const updated = await requireTask(deps, input.taskId);

  return {
    operation: "complete",
    newStatus: "done",
    taskId: input.taskId,
    task: updated,
    warnings: [],
    activityId: statusResult.activityId,
  };
}

/**
 * Terminal transition to "cancelled" via updateTaskStatus. D3's --yes
 * confirmation lives at the CLI/transport layer; this executes once called.
 */
export async function cancelTaskOperation(
  input: CancelTaskInput,
  deps: TaskOperationDeps = productionTaskOperationDeps,
): Promise<CancelTaskReceipt> {
  const task = await requireOpenTask(deps, input.taskId);
  if (!canTransitionTask(task.status, "cancelled")) {
    // status_transition gate: refusal logs standalone, best-effort.
    await deps.recordGateEvent({
      gate: "status_transition",
      operation: "cancel",
      outcome: "blocked",
      surface: input.surface ?? "cli",
      taskId: input.taskId,
      detail: { from: task.status, to: "cancelled" },
    });
    throw new TaskServiceError(
      "illegal_transition",
      `Illegal status transition from ${task.status} to cancelled.`,
    );
  }

  const statusResult = await deps.runInTransaction((tx) =>
    deps.updateTaskStatus(input.taskId, "cancelled", "agent", { tx }),
  );
  const updated = await requireTask(deps, input.taskId);

  return {
    operation: "cancel",
    newStatus: "cancelled",
    taskId: input.taskId,
    task: updated,
    warnings: [],
    activityId: statusResult.activityId,
  };
}

export async function reopenTaskOperation(
  input: ReopenTaskInput,
  deps: TaskOperationDeps = productionTaskOperationDeps,
): Promise<ReopenTaskReceipt> {
  const surface: GateEventSurface = input.surface ?? "cli";
  const task = await requireTask(deps, input.taskId);
  if (!isTerminalStatus(task.status)) {
    await deps.recordGateEvent({
      gate: "status_transition",
      operation: "reopen",
      outcome: "blocked",
      surface,
      taskId: input.taskId,
      detail: { from: task.status, reason: "not_terminal" },
    });
    throw new TaskServiceError(
      "not_terminal",
      `Task ${input.taskId} is not terminal (${task.status}); reopen only restores done or cancelled tasks.`,
    );
  }

  if (input.toStatus !== undefined) {
    assertReopenTargetStatus(input.toStatus);
  }
  const targetStatus = input.toStatus ?? (await deps.findPreviousReopenStatus(input.taskId)) ?? "backlog";

  if (!canTransitionTask(task.status, targetStatus)) {
    await deps.recordGateEvent({
      gate: "status_transition",
      operation: "reopen",
      outcome: "blocked",
      surface,
      taskId: input.taskId,
      detail: { from: task.status, to: targetStatus },
    });
    throw new TaskServiceError(
      "illegal_transition",
      `Illegal status transition from ${task.status} to ${targetStatus}.`,
    );
  }

  const noteText = input.note?.trim();
  const warnings: string[] = [];
  let restoredEmbedding: number[] | null = null;
  if (task.embedding === null) {
    try {
      restoredEmbedding = await deps.embed(`${task.title}\n\n${task.description}`);
    } catch (err) {
      warnings.push(
        `Embedding restore skipped (${errorMessage(err)}); the reopened task still has no stored embedding.`,
      );
    }
  }

  const txResult = await deps.runInTransaction(async (tx) => {
    const statusResult = await deps.updateTaskStatus(input.taskId, targetStatus, "agent", {
      tx,
      source: input.source,
    });
    if (restoredEmbedding !== null) {
      await deps.setTaskEmbedding(input.taskId, restoredEmbedding, { tx });
    }
    let noteId: string | null = null;
    if (noteText) {
      const note = await deps.appendTaskNote(tx, {
        taskId: input.taskId,
        noteType: "manual",
        content: noteText,
        createdBy: "agent",
      });
      noteId = note.noteId;
    }
    return { statusResult, noteId };
  });

  const updated = await requireTask(deps, input.taskId);

  return {
    operation: "reopen",
    fromStatus: task.status,
    newStatus: targetStatus,
    taskId: input.taskId,
    task: updated,
    warnings,
    activityId: txResult.statusResult.activityId,
    noteId: txResult.noteId,
  };
}
