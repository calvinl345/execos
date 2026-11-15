/**
 * Behavioral goldens for src/services/task-operations.ts (change-008, T5/A13c).
 *
 * EXPECTED RED until the implementation task (T6) lands: the operation bodies
 * in src/services/task-operations.ts are skeletons that throw
 * `new Error("not implemented")`. These tests are LOCKED enforcement goldens
 * written against the skeleton signatures and the decided semantics
 * (S3 D2-D5, A8, A9); the build agent must satisfy them, never edit them.
 *
 * Pattern: tests/services/follow-up-operations.test.ts — fully fake deps with
 * in-memory state and spy-style recorders. No DB, no real embeddings (the
 * embed seam is faked directly; deterministic test embeddings are active in
 * the fast suite via EXECOS_TEST_EMBEDDINGS=1 in tests/setup-fast.ts).
 */

import { describe, expect, it } from "vitest";
import { PZeroWipCapExceededError } from "../../src/db/errors.js";
import {
  computeTaskFieldDiff,
  formatTaskFieldUpdateNote,
} from "../../src/db/helpers/formatters.js";
import type { TaskWriteClient } from "../../src/db/helpers/types.js";
import type {
  AppendGateEventInput,
  RecordGateEventOptions,
} from "../../src/db/helpers/gate-events.js";
import { DEFAULT_SETTINGS, type Settings } from "../../src/domain/validation.js";
import { dedupInputFingerprint, exactDuplicateMatches } from "../../src/domain/intake.js";
import {
  TaskServiceError,
  cancelTaskOperation,
  completeTaskOperation,
  createTaskOperation,
  reopenTaskOperation,
  updateTaskOperation,
  type CreateTaskInput,
  type NearestTaskCandidate,
  type NonTerminalTaskStatus,
  type ReopenTargetTaskStatus,
  type TaskInsertRow,
  type TaskOperationDeps,
  type TaskRow,
} from "../../src/services/task-operations.js";

// ---------------------------------------------------------------------------
// Deterministic embedding fixtures. The fake embed() returns a configurable
// vector; candidate tasks carry stored vectors whose cosine similarity to the
// draft vector is known exactly:
//   IDENTICAL_VEC -> 1.00 (near_identical, >= 0.92)
//   NEAR_VEC      -> 0.90 (similar, >= settings threshold 0.85)
//   FAR_VEC       -> 0.50 (no_match, below threshold)
// The exact band comes from normalized title/description matching, not from
// any similarity score (decision 006).
// ---------------------------------------------------------------------------

const DRAFT_VEC = [1, 0, 0];
const IDENTICAL_VEC = [1, 0, 0];
const NEAR_VEC = [0.9, Math.sqrt(1 - 0.81), 0];
const FAR_VEC = [0.5, Math.sqrt(0.75), 0];

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------------------------------------------------------------------
// Task fixture.
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date("2026-06-09T12:00:00.000Z");

function makeTask(partial: Partial<TaskRow> & Pick<TaskRow, "id">): TaskRow {
  return {
    id: partial.id,
    title: partial.title ?? `Task ${partial.id}`,
    description: partial.description ?? "A valid test task description",
    status: partial.status ?? "in_progress",
    priority: partial.priority ?? null,
    category: partial.category ?? "client",
    owner: partial.owner ?? "me",
    dueDate: partial.dueDate ?? new Date("2026-06-30T12:00:00.000Z"),
    followUpDate: partial.followUpDate ?? null,
    snoozedUntil: partial.snoozedUntil ?? null,
    handoffState: partial.handoffState ?? "not_applicable",
    handoffCopiedAt: partial.handoffCopiedAt ?? null,
    handoffLastCopiedAt: partial.handoffLastCopiedAt ?? null,
    handoffLastNudgeCopiedAt: partial.handoffLastNudgeCopiedAt ?? null,
    goalId: partial.goalId ?? null,
    createdAt: partial.createdAt ?? FIXED_NOW,
    updatedAt: partial.updatedAt ?? FIXED_NOW,
    completedAt: partial.completedAt ?? null,
    cancelledAt: partial.cancelledAt ?? null,
    lastStatusChangeAt: partial.lastStatusChangeAt ?? FIXED_NOW,
    lastUnblockedAt: partial.lastUnblockedAt ?? null,
    needsAttention: partial.needsAttention ?? false,
    needsAttentionSetAt: partial.needsAttentionSetAt ?? null,
    needsAttentionReason: partial.needsAttentionReason ?? null,
    embedding: partial.embedding ?? null,
    hardDeadline: partial.hardDeadline ?? false,
    effort: partial.effort ?? null,
    queueRank: null,
    queueRationale: null,
    queueRankedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Fake deps: in-memory state + spy recorders, mirroring the production
// contracts. nearestTasks implements the OPEN-ONLY filter over the task store
// (status NOT IN done/cancelled AND embedding non-null), mirroring the
// production SQL contract, so closed tasks are structurally never candidates.
// ---------------------------------------------------------------------------

interface RecordedCall {
  name: string;
  tx?: unknown;
}

interface FakeState {
  tasksById: Map<string, TaskRow>;
  goalIds: Set<string>;
  inserted: TaskInsertRow[];
  notes: Array<{ tx: unknown; taskId: string; noteType: string; content: string; createdBy: string }>;
  activities: Array<{ tx: unknown; kind: string; input: Record<string, unknown> }>;
  callLog: RecordedCall[];
  embedTexts: string[];
  nearestCalls: Array<{ embedding: number[]; limit: number; returned: NearestTaskCandidate[] }>;
  exactMatchCalls: Array<{ title: string; description: string }>;
  previousReopenStatusCalls: string[];
  txs: unknown[];
  statusCalls: Array<{ tx: unknown; taskId: string; status: string }>;
  fieldsCalls: Array<{ tx: unknown; taskId: string; patch: Record<string, unknown> }>;
  embeddingWrites: Array<{ tx: unknown; taskId: string; vector: number[] }>;
  wipCapCalls: Array<{ tx: unknown; cap: number }>;
  gateEvents: Array<{ input: AppendGateEventInput; tx: unknown }>;
}

interface MakeDepsOptions {
  tasks?: TaskRow[];
  goals?: string[];
  embedVector?: number[];
  embedError?: Error;
  wipCapError?: Error;
  /**
   * Simulates a gate-event telemetry failure: the fake recordGateEvent
   * still records the attempt but reports the degradation warning instead
   * of an id (the best-effort contract — it never throws).
   */
  gateEventWarning?: string;
}

function makeDeps(opts: MakeDepsOptions = {}): {
  deps: TaskOperationDeps;
  state: FakeState;
  settings: Settings;
} {
  const settings = DEFAULT_SETTINGS as Settings;
  const state: FakeState = {
    tasksById: new Map((opts.tasks ?? []).map((task) => [task.id, task])),
    goalIds: new Set(opts.goals ?? []),
    inserted: [],
    notes: [],
    activities: [],
    callLog: [],
    embedTexts: [],
    nearestCalls: [],
    exactMatchCalls: [],
    previousReopenStatusCalls: [],
    txs: [],
    statusCalls: [],
    fieldsCalls: [],
    embeddingWrites: [],
    wipCapCalls: [],
    gateEvents: [],
  };
  let txSeq = 0;
  let noteSeq = 0;

  function rowFromInsert(row: TaskInsertRow): TaskRow {
    return makeTask({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status ?? "triage",
      priority: row.priority ?? null,
      category: row.category,
      owner: row.owner ?? "me",
      dueDate: row.dueDate ?? null,
      followUpDate: row.followUpDate ?? null,
      goalId: row.goalId ?? null,
      embedding: row.embedding ?? null,
      hardDeadline: row.hardDeadline ?? false,
      effort: row.effort ?? null,
    });
  }

  const deps: TaskOperationDeps = {
    now: () => FIXED_NOW,
    async embed(text) {
      state.callLog.push({ name: "embed" });
      state.embedTexts.push(text);
      if (opts.embedError) throw opts.embedError;
      return opts.embedVector ?? DRAFT_VEC;
    },
    async findTask(taskId) {
      return state.tasksById.get(taskId) ?? null;
    },
    async listActiveTasks() {
      return [...state.tasksById.values()].filter(
        (task) => task.status !== "done" && task.status !== "cancelled",
      );
    },
    async goalExists(goalId) {
      return state.goalIds.has(goalId);
    },
    async nearestTasks(embedding, limit) {
      // Open-only candidate query, mirroring the production pgvector SQL:
      // status NOT IN ('done','cancelled') AND embedding IS NOT NULL.
      const returned = [...state.tasksById.values()]
        .filter(
          (task) =>
            task.status !== "done" &&
            task.status !== "cancelled" &&
            task.embedding != null,
        )
        .map((task) => ({
          id: task.id,
          title: task.title,
          similarity: cosine(embedding, task.embedding as number[]),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
      state.callLog.push({ name: "nearestTasks" });
      state.nearestCalls.push({ embedding, limit, returned });
      return returned;
    },
    async findExactMatches(draft) {
      // Open-only candidate query WITHOUT the embedding filter, mirroring
      // the production seam contract: null-embedding rows participate.
      // Comparison goes through the same pure domain helper production uses.
      state.callLog.push({ name: "findExactMatches" });
      state.exactMatchCalls.push({ title: draft.title, description: draft.description });
      const candidates = [...state.tasksById.values()]
        .filter((task) => task.status !== "done" && task.status !== "cancelled")
        .map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description,
        }));
      return exactDuplicateMatches(draft, candidates);
    },
    async findPreviousReopenStatus(taskId) {
      state.callLog.push({ name: "findPreviousReopenStatus" });
      state.previousReopenStatusCalls.push(taskId);
      const statusEvents = state.activities
        .filter((activity) => activity.kind === "task_status_changed" && activity.input.taskId === taskId)
        .reverse();
      for (const event of statusEvents) {
        const fromStatus = event.input.fromStatus as ReopenTargetTaskStatus | undefined;
        const toStatus = event.input.toStatus;
        if (
          (toStatus === "done" || toStatus === "cancelled") &&
          (fromStatus === "backlog" ||
            fromStatus === "in_progress" ||
            fromStatus === "blocked" ||
            fromStatus === "review")
        ) {
          return fromStatus;
        }
      }
      return null;
    },
    async settings() {
      return settings;
    },
    async runInTransaction<T>(fn: (tx: TaskWriteClient) => Promise<T>): Promise<T> {
      txSeq += 1;
      const tx = { __fakeTx: txSeq } as unknown as TaskWriteClient;
      state.txs.push(tx);
      state.callLog.push({ name: "tx:begin", tx });
      return fn(tx);
    },
    async recordGateEvent(input: AppendGateEventInput, options: RecordGateEventOptions = {}) {
      state.callLog.push({ name: "recordGateEvent", tx: options.tx });
      state.gateEvents.push({ input, tx: options.tx });
      if (opts.gateEventWarning) {
        return { gateEventId: null, warning: opts.gateEventWarning };
      }
      return { gateEventId: `gate-${state.gateEvents.length}`, warning: null };
    },
    async insertTask(tx, row) {
      state.callLog.push({ name: "insertTask", tx });
      state.inserted.push(row);
      state.tasksById.set(row.id, rowFromInsert(row));
    },
    async composeTaskId(prefix) {
      state.callLog.push({ name: "composeTaskId" });
      return `${prefix}-901`;
    },
    async enforcePZeroWipCap(tx, cap) {
      state.callLog.push({ name: "enforcePZeroWipCap", tx });
      state.wipCapCalls.push({ tx, cap });
      if (opts.wipCapError) throw opts.wipCapError;
    },
    async updateTaskStatus(taskId, newStatus, _by = "agent", statusOpts = {}) {
      state.callLog.push({ name: "updateTaskStatus", tx: statusOpts.tx });
      state.statusCalls.push({ tx: statusOpts.tx, taskId, status: newStatus });
      const current = state.tasksById.get(taskId);
      if (!current) throw new Error(`fake updateTaskStatus: missing task ${taskId}`);
      const fromStatus = current.status;
      const updated: TaskRow = {
        ...current,
        status: newStatus,
        completedAt: newStatus === "done" ? FIXED_NOW : current.completedAt,
        cancelledAt: newStatus === "cancelled" ? FIXED_NOW : current.cancelledAt,
        lastStatusChangeAt: FIXED_NOW,
      };
      state.tasksById.set(taskId, updated);
      return {
        taskId,
        fromStatus,
        toStatus: newStatus,
        noteId: `note-status-${newStatus}`,
        activityId: `ACT-status-${newStatus}`,
        changedAt: FIXED_NOW,
      };
    },
    async updateTaskFields(taskId, patch, fieldsOpts = {}) {
      state.callLog.push({ name: "updateTaskFields", tx: fieldsOpts.tx });
      state.fieldsCalls.push({ tx: fieldsOpts.tx, taskId, patch });
      const current = state.tasksById.get(taskId);
      if (!current) throw new Error(`fake updateTaskFields: missing task ${taskId}`);
      const before = current as unknown as Record<string, unknown>;
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of Object.keys(patch)) {
        if (before[key] !== patch[key]) {
          changes[key] = { from: before[key], to: patch[key] };
        }
      }
      const updated = { ...current, ...patch } as TaskRow;
      state.tasksById.set(taskId, updated);
      return {
        taskId,
        diff: { changes },
        noteId: "note-fields",
        activityIds: ["ACT-fields-1"],
        changed: Object.keys(changes).length > 0,
      };
    },
    async setTaskEmbedding(taskId, vector, embeddingOpts = {}) {
      state.callLog.push({ name: "setTaskEmbedding", tx: embeddingOpts.tx });
      state.embeddingWrites.push({ tx: embeddingOpts.tx, taskId, vector });
      const current = state.tasksById.get(taskId);
      if (!current) throw new Error(`fake setTaskEmbedding: missing task ${taskId}`);
      state.tasksById.set(taskId, { ...current, embedding: vector });
    },
    async appendTaskNote(tx, input) {
      noteSeq += 1;
      state.callLog.push({ name: "appendTaskNote", tx });
      state.notes.push({
        tx,
        taskId: input.taskId,
        noteType: input.noteType,
        content: input.content,
        createdBy: input.createdBy,
      });
      return { noteId: `note-${noteSeq}` };
    },
    async recordTaskCreated(tx, input) {
      state.callLog.push({ name: "recordTaskCreated", tx });
      state.activities.push({ tx, kind: "task_created", input: input as unknown as Record<string, unknown> });
      return { activityId: "ACT-task_created" };
    },
    async recordTaskGoalLinked(tx, input) {
      state.callLog.push({ name: "recordTaskGoalLinked", tx });
      state.activities.push({ tx, kind: "task_goal_linked", input: input as unknown as Record<string, unknown> });
      return { activityId: "ACT-goal-linked" };
    },
    async recordTaskGoalUnlinked(tx, input) {
      state.callLog.push({ name: "recordTaskGoalUnlinked", tx });
      state.activities.push({ tx, kind: "task_goal_unlinked", input: input as unknown as Record<string, unknown> });
      return { activityId: "ACT-goal-unlinked" };
    },
    async recordTaskStatusChanged(tx, input) {
      state.callLog.push({ name: "recordTaskStatusChanged", tx });
      state.activities.push({ tx, kind: "task_status_changed", input: input as unknown as Record<string, unknown> });
      return { activityId: "ACT-status-changed" };
    },
  };

  return { deps, state, settings };
}

function callIndex(state: FakeState, name: string): number {
  return state.callLog.findIndex((call) => call.name === name);
}

function baseCreateInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    title: "Prepare the Acme onboarding checklist",
    description: "Draft the onboarding checklist for the Acme rollout call",
    category: "client",
    dueAt: new Date("2026-06-20T12:00:00.000Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createTaskOperation
// ---------------------------------------------------------------------------

describe("createTaskOperation", () => {
  it("creates a task with the full receipt shape and embeds title + description once", async () => {
    const { deps, state, settings } = makeDeps();
    const input = baseCreateInput({ initialNote: "Captured from Slack" });

    const result = await createTaskOperation(input, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected create success");
    const receipt = result.receipt;

    // Receipt shape (golden 11).
    expect(receipt.operation).toBe("create");
    expect(receipt.taskId).toBe(`${settings.infrastructure.task_id_prefix}-901`);
    expect(receipt.task.id).toBe(receipt.taskId);
    expect(receipt.task.title).toBe(input.title);
    expect(Array.isArray(receipt.warnings)).toBe(true);
    expect(receipt.activityId).toBe("ACT-task_created");
    expect(receipt.dedup).toEqual({ matches: [], overridden: false, justification: null });

    // A9: embed `title + "\n\n" + description` exactly once.
    expect(state.embedTexts).toEqual([`${input.title}\n\n${input.description}`]);

    // The accepted create stores the vector on the row (A9).
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].embedding).toEqual(DRAFT_VEC);

    // Audit trail inside the same transaction: intake_checklist note,
    // recordTaskCreated, and the manual note for initialNote (A8).
    expect(state.txs).toHaveLength(1);
    const tx = state.txs[0];
    const insertCall = state.callLog.find((call) => call.name === "insertTask");
    expect(insertCall?.tx).toBe(tx);
    const created = state.activities.filter((a) => a.kind === "task_created");
    expect(created).toHaveLength(1);
    expect(created[0].tx).toBe(tx);
    const intakeNotes = state.notes.filter((n) => n.noteType === "intake_checklist");
    expect(intakeNotes).toHaveLength(1);
    expect(intakeNotes[0].taskId).toBe(receipt.taskId);
    const manualNotes = state.notes.filter((n) => n.noteType === "manual");
    expect(manualNotes).toHaveLength(1);
    expect(manualNotes[0].content).toContain("Captured from Slack");

    // No P0 -> no WIP-cap enforcement.
    expect(state.wipCapCalls).toHaveLength(0);
  });

  it("keeps an explicit non-terminal initial status and goal link (D5)", async () => {
    const { deps, state } = makeDeps({ goals: ["G-001"] });

    const result = await createTaskOperation(
      baseCreateInput({ status: "in_progress", goalId: "G-001" }),
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected create success");
    expect(result.receipt.task.status).toBe("in_progress");
    expect(result.receipt.task.goalId).toBe("G-001");
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].goalId).toBe("G-001");
  });

  it("refuses a near-duplicate open task, listing matches with id/title/similarity/band (D4)", async () => {
    const { deps, state } = makeDeps({
      tasks: [
        makeTask({ id: "KS-001", title: "Prepare Acme onboarding checklist", embedding: IDENTICAL_VEC }),
        makeTask({ id: "KS-002", title: "Acme onboarding checklist draft", embedding: NEAR_VEC }),
        makeTask({ id: "KS-003", title: "Unrelated trace cleanup", embedding: FAR_VEC }),
      ],
    });

    const result = await createTaskOperation(baseCreateInput(), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected duplicate refusal");
    expect(result.outcome).toBe("duplicate");

    const byId = new Map(result.matches.map((m) => [m.id, m]));
    const identical = byId.get("KS-001");
    expect(identical).toBeDefined();
    expect(identical!.title).toBe("Prepare Acme onboarding checklist");
    expect(identical!.similarity).toBeCloseTo(1, 5);
    // Evidence-tier band values pinned (decision 006 rename).
    expect(identical!.band).toBe("near_identical");
    const near = byId.get("KS-002");
    expect(near).toBeDefined();
    expect(near!.similarity).toBeCloseTo(0.9, 5);
    expect(near!.band).toBe("similar");

    // Below-threshold candidates are not refusal matches.
    expect(byId.has("KS-003")).toBe(false);
    for (const match of result.matches) {
      expect(match.band).not.toBe("no_match");
    }

    // A refusal writes nothing.
    expect(state.inserted).toHaveLength(0);
    expect(state.notes).toHaveLength(0);
    expect(state.activities).toHaveLength(0);
  });

  it("allowDuplicate overrides the refusal, creates the task, and audits the override with its justification", async () => {
    const { deps, state } = makeDeps({
      tasks: [
        makeTask({ id: "KS-001", title: "Prepare Acme onboarding checklist", embedding: IDENTICAL_VEC }),
      ],
    });

    const justification = "Recurring onboarding round; KS-001 covers the previous cohort only.";
    const result = await createTaskOperation(
      baseCreateInput({ allowDuplicate: justification }),
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected override create success");
    expect(result.receipt.dedup.overridden).toBe(true);
    expect(result.receipt.dedup.matches.map((m) => m.id)).toContain("KS-001");
    // The justification surfaces in the receipt's dedup section.
    expect(result.receipt.dedup.justification).toBe(justification);
    expect(state.inserted).toHaveLength(1);

    // The intake_checklist audit note records the override marker AND the
    // justification alongside it (decision 006).
    const intakeNotes = state.notes.filter((n) => n.noteType === "intake_checklist");
    expect(intakeNotes).toHaveLength(1);
    const audit = JSON.parse(intakeNotes[0].content) as Record<string, unknown>;
    expect(audit.dedup_overridden).toBe(true);
    expect(audit.step_1_dedup).toBe("overridden:KS-001");
    expect(audit.dedup_override_justification).toBe(justification);
  });

  it("rejects an empty or whitespace-only override justification before any work", async () => {
    for (const hollow of ["", "   ", "\t\n"]) {
      const { deps, state } = makeDeps();

      await expect(
        createTaskOperation(baseCreateInput({ allowDuplicate: hollow }), deps),
      ).rejects.toMatchObject({ name: "TaskServiceError", code: "validation" });

      expect(state.embedTexts).toHaveLength(0);
      expect(state.exactMatchCalls).toHaveLength(0);
      expect(state.inserted).toHaveLength(0);
      expect(state.notes).toHaveLength(0);
    }
  });

  it("a justification without any duplicate match records no override", async () => {
    const { deps, state } = makeDeps();

    const result = await createTaskOperation(
      baseCreateInput({ allowDuplicate: "Just in case there is a twin." }),
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected create success");
    expect(result.receipt.dedup).toEqual({ matches: [], overridden: false, justification: null });
    const audit = JSON.parse(
      state.notes.filter((n) => n.noteType === "intake_checklist")[0].content,
    ) as Record<string, unknown>;
    expect(audit.step_1_dedup).toBe("passed");
    expect(audit.dedup_overridden).toBe(false);
    expect(audit.dedup_override_justification).toBeNull();
  });

  it("refuses an exact title match (normalized) even when embeddings score below threshold", async () => {
    const { deps, state } = makeDeps({
      tasks: [
        makeTask({
          id: "KS-050",
          title: "  prepare THE Acme   onboarding checklist ",
          description: "Some completely different description body",
          embedding: FAR_VEC,
        }),
      ],
    });

    const result = await createTaskOperation(baseCreateInput(), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected exact-title refusal");
    expect(result.outcome).toBe("duplicate");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].id).toBe("KS-050");
    expect(result.matches[0].band).toBe("exact");
    expect(result.matches[0].matchedOn).toBe("title");
    // Real cosine reported when available (FAR_VEC scores 0.5 vs the draft).
    expect(result.matches[0].similarity).toBeCloseTo(0.5, 5);
    expect(state.inserted).toHaveLength(0);
    expect(state.notes).toHaveLength(0);
  });

  it("refuses an exact description match from a null-embedding open task (outage gap closed)", async () => {
    const { deps, state } = makeDeps({
      tasks: [
        makeTask({
          id: "KS-051",
          title: "Entirely different headline",
          description: "DRAFT the onboarding   checklist for the acme rollout call",
          embedding: null,
        }),
      ],
    });

    const result = await createTaskOperation(baseCreateInput(), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected exact-description refusal");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].id).toBe("KS-051");
    expect(result.matches[0].band).toBe("exact");
    expect(result.matches[0].matchedOn).toBe("description");
    // No stored embedding -> no real cosine -> 1.0 fallback.
    expect(result.matches[0].similarity).toBe(1);
    expect(state.inserted).toHaveLength(0);
  });

  it("reports matched_on 'both' when title and description both match exactly", async () => {
    const { deps } = makeDeps({
      tasks: [
        makeTask({
          id: "KS-052",
          title: "Prepare the Acme onboarding checklist",
          description: "Draft the onboarding checklist for the Acme rollout call",
          embedding: null,
        }),
      ],
    });

    const result = await createTaskOperation(baseCreateInput(), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected exact refusal");
    expect(result.matches[0].band).toBe("exact");
    expect(result.matches[0].matchedOn).toBe("both");
  });

  it("substantive edits never count as exact matches (normalization is case/whitespace only)", async () => {
    const { deps, state } = makeDeps({
      tasks: [
        makeTask({
          id: "KS-053",
          // One real word of difference: not an exact match.
          title: "Prepare the Acme onboarding checklists",
          description: "Draft the onboarding checklist for the Acme rollout calls",
          embedding: FAR_VEC,
        }),
      ],
    });

    const result = await createTaskOperation(baseCreateInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected create success for a substantive edit");
    expect(result.receipt.dedup.matches).toEqual([]);
    expect(state.inserted).toHaveLength(1);
  });

  it("the exact-match gate still refuses when embed() throws (works through an embedding outage)", async () => {
    const { deps, state } = makeDeps({
      tasks: [
        makeTask({
          id: "KS-054",
          title: "Prepare the ACME onboarding checklist",
          description: "Unrelated description text entirely",
          embedding: null,
        }),
      ],
      embedError: new Error("embedding provider down"),
    });

    const result = await createTaskOperation(baseCreateInput(), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("exact match must refuse even during an embed outage");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].id).toBe("KS-054");
    expect(result.matches[0].band).toBe("exact");
    expect(result.matches[0].matchedOn).toBe("title");
    expect(result.matches[0].similarity).toBe(1);
    // The similarity check was skipped, the exact check ran, nothing wrote.
    expect(state.nearestCalls).toHaveLength(0);
    expect(state.exactMatchCalls).toHaveLength(1);
    expect(state.inserted).toHaveLength(0);
  });

  it("an exact-match override during an embed outage creates with warning, audit marker, and justification", async () => {
    const { deps, state } = makeDeps({
      tasks: [
        makeTask({
          id: "KS-055",
          title: "Prepare the Acme onboarding checklist",
          description: "Unrelated description text entirely",
          embedding: null,
        }),
      ],
      embedError: new Error("embedding provider down"),
    });

    const justification = "Confirmed new cohort; KS-055 is last quarter's run.";
    const result = await createTaskOperation(
      baseCreateInput({ allowDuplicate: justification }),
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected override create success");
    expect(result.receipt.dedup.overridden).toBe(true);
    expect(result.receipt.dedup.justification).toBe(justification);
    expect(
      result.receipt.warnings.some((w) => /dedup/i.test(w) && /skip/i.test(w)),
    ).toBe(true);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].embedding ?? null).toBeNull();

    const audit = JSON.parse(
      state.notes.filter((n) => n.noteType === "intake_checklist")[0].content,
    ) as Record<string, unknown>;
    // The override marker wins over the embed-skip marker.
    expect(audit.step_1_dedup).toBe("overridden:KS-055");
    expect(audit.dedup_override_justification).toBe(justification);
  });

  it("never treats closed tasks as dedup candidates, even with identical embeddings or exact text", async () => {
    const { deps, state } = makeDeps({
      tasks: [
        makeTask({ id: "KS-010", status: "done", embedding: IDENTICAL_VEC }),
        makeTask({ id: "KS-011", status: "cancelled", embedding: IDENTICAL_VEC }),
        // An exact text twin that is closed: also never a candidate.
        makeTask({
          id: "KS-012",
          status: "done",
          title: "Prepare the Acme onboarding checklist",
          description: "Draft the onboarding checklist for the Acme rollout call",
          embedding: null,
        }),
      ],
    });

    const result = await createTaskOperation(baseCreateInput(), deps);

    // The gate must run through the open-only nearestTasks seam...
    expect(state.nearestCalls).toHaveLength(1);
    expect(state.nearestCalls[0].embedding).toEqual(DRAFT_VEC);
    // ...and the open-only candidate set excludes the closed twins.
    expect(state.nearestCalls[0].returned).toEqual([]);

    // Verdict: no refusal, clean dedup block.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected create success despite closed twins");
    expect(result.receipt.dedup.matches).toEqual([]);
    expect(result.receipt.dedup.overridden).toBe(false);
    expect(state.inserted).toHaveLength(1);
  });

  it("never infers priority, even from screaming urgency text (D2)", async () => {
    const { deps, state } = makeDeps();

    const result = await createTaskOperation(
      baseCreateInput({
        title: "URGENT server down",
        description: "URGENT ASAP critical P0 emergency everything is broken right now",
      }),
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected create success");
    expect(result.receipt.task.priority).toBeNull();
    expect(state.inserted[0].priority ?? null).toBeNull();
    expect(state.wipCapCalls).toHaveLength(0);
  });

  it("degrades to a warning with a null embedding when embed() fails; never refuses", async () => {
    const { deps, state } = makeDeps({
      tasks: [
        // Even an open identical twin cannot refuse when the embed step failed:
        // the gate is skipped, not guessed.
        makeTask({ id: "KS-001", embedding: IDENTICAL_VEC }),
      ],
      embedError: new Error("embedding provider down"),
    });

    const result = await createTaskOperation(baseCreateInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("embed failure must never block task capture");
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].embedding ?? null).toBeNull();
    expect(state.nearestCalls).toHaveLength(0);
    // The exact-match check still ran (it does not depend on the embedding).
    expect(state.exactMatchCalls).toHaveLength(1);
    expect(result.receipt.dedup.matches).toEqual([]);
    expect(
      result.receipt.warnings.some((w) => /dedup/i.test(w) && /skip/i.test(w)),
    ).toBe(true);
  });

  it("enforces the P0 WIP cap inside the create transaction, before the insert", async () => {
    const { deps, state, settings } = makeDeps();

    const result = await createTaskOperation(baseCreateInput({ priority: "P0" }), deps);

    expect(result.ok).toBe(true);
    expect(state.wipCapCalls).toHaveLength(1);
    expect(state.wipCapCalls[0].cap).toBe(settings.infrastructure.p0_wip_cap);
    // Same transaction identity as the insert.
    expect(state.txs).toHaveLength(1);
    expect(state.wipCapCalls[0].tx).toBe(state.txs[0]);
    // Cap check happens inside the tx and before the row insert.
    const txIdx = callIndex(state, "tx:begin");
    const capIdx = callIndex(state, "enforcePZeroWipCap");
    const insertIdx = callIndex(state, "insertTask");
    expect(capIdx).toBeGreaterThan(txIdx);
    expect(capIdx).toBeLessThan(insertIdx);
  });

  it("propagates PZeroWipCapExceededError from a P0 create without inserting", async () => {
    const { deps, state } = makeDeps({ wipCapError: new PZeroWipCapExceededError(3, 3) });

    await expect(
      createTaskOperation(baseCreateInput({ priority: "P0" }), deps),
    ).rejects.toBeInstanceOf(PZeroWipCapExceededError);
    expect(state.inserted).toHaveLength(0);
  });

  it("rejects a non-existent goal with goal_not_found", async () => {
    const { deps, state } = makeDeps({ goals: [] });

    await expect(
      createTaskOperation(baseCreateInput({ goalId: "G-404" }), deps),
    ).rejects.toMatchObject({ name: "TaskServiceError", code: "goal_not_found" });
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses a teammate owner before any work: no embed, no writes, error names delegate", async () => {
    const { deps, state } = makeDeps({ goals: ["G-001"] });

    const err: unknown = await createTaskOperation(
      baseCreateInput({ owner: "elena", goalId: "G-001" }),
      deps,
    ).then(
      () => {
        throw new Error("create with a teammate owner must reject");
      },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(TaskServiceError);
    expect((err as TaskServiceError).code).toBe("owner_not_self");
    expect((err as TaskServiceError).message).toContain("execos taskops delegate");
    expect((err as TaskServiceError).message).toContain("--owner elena");

    // Refused before any write OR read-side work: no embed, no dedup query,
    // no transaction, no row, no notes, no activities.
    expect(state.embedTexts).toHaveLength(0);
    expect(state.nearestCalls).toHaveLength(0);
    expect(state.txs).toHaveLength(0);
    expect(state.inserted).toHaveLength(0);
    expect(state.notes).toHaveLength(0);
    expect(state.activities).toHaveLength(0);
  });

  it("accepts owner variants that normalize to me and stores the canonical 'me'", async () => {
    for (const owner of [undefined, "me", "ME", " me "]) {
      const { deps, state } = makeDeps();

      const result = await createTaskOperation(baseCreateInput({ owner }), deps);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected create success for owner ${JSON.stringify(owner)}`);
      expect(state.inserted).toHaveLength(1);
      expect(state.inserted[0].owner).toBe("me");
      expect(result.receipt.task.owner).toBe("me");
    }
  });

  it("passes hardDeadline and effort onto the inserted row, receipt, and intake audit (change-009)", async () => {
    const { deps, state } = makeDeps();

    const result = await createTaskOperation(
      baseCreateInput({ hardDeadline: true, effort: "M" }),
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected create success");
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].hardDeadline).toBe(true);
    expect(state.inserted[0].effort).toBe("M");
    expect(result.receipt.task.hardDeadline).toBe(true);
    expect(result.receipt.task.effort).toBe("M");

    const intakeNotes = state.notes.filter((n) => n.noteType === "intake_checklist");
    expect(intakeNotes).toHaveLength(1);
    const audit = JSON.parse(intakeNotes[0].content) as Record<string, unknown>;
    expect(audit.hard_deadline).toBe(true);
    expect(audit.effort).toBe("M");
  });

  it("defaults hardDeadline false and effort null when omitted, and audits the defaults", async () => {
    const { deps, state } = makeDeps();

    const result = await createTaskOperation(baseCreateInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected create success");
    expect(state.inserted[0].hardDeadline).toBe(false);
    expect(state.inserted[0].effort).toBeNull();

    const intakeNotes = state.notes.filter((n) => n.noteType === "intake_checklist");
    const audit = JSON.parse(intakeNotes[0].content) as Record<string, unknown>;
    expect(audit.hard_deadline).toBe(false);
    expect(audit.effort).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateTaskOperation
// ---------------------------------------------------------------------------

describe("updateTaskOperation", () => {
  it("re-embeds and stores a new vector when the title changes", async () => {
    const NEW_VEC = [0, 1, 0];
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", embedding: FAR_VEC })],
      embedVector: NEW_VEC,
    });

    const receipt = await updateTaskOperation(
      { taskId: "KS-100", title: "Renamed task title" },
      deps,
    );

    expect(receipt.operation).toBe("update");
    expect(receipt.taskId).toBe("KS-100");
    expect(receipt.task.title).toBe("Renamed task title");
    expect(Array.isArray(receipt.warnings)).toBe(true);
    expect(typeof receipt.activityId).toBe("string");
    expect(receipt.activityId.length).toBeGreaterThan(0);

    expect(state.embedTexts).toHaveLength(1);
    expect(state.embedTexts[0]).toContain("Renamed task title");
    expect(state.tasksById.get("KS-100")?.embedding).toEqual(NEW_VEC);
  });

  it("re-embeds when the description changes", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", embedding: FAR_VEC })],
      embedVector: [0, 0, 1],
    });

    await updateTaskOperation(
      { taskId: "KS-100", description: "A completely rewritten description body" },
      deps,
    );

    expect(state.embedTexts).toHaveLength(1);
    expect(state.tasksById.get("KS-100")?.embedding).toEqual([0, 0, 1]);
  });

  it("does not re-embed on a pure priority change", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", priority: "P1", embedding: FAR_VEC })],
    });

    await updateTaskOperation({ taskId: "KS-100", priority: "P2" }, deps);

    expect(state.embedTexts).toHaveLength(0);
    expect(state.tasksById.get("KS-100")?.embedding).toEqual(FAR_VEC);
    expect(state.wipCapCalls).toHaveLength(0);
  });

  it("enforces the WIP cap inside the same transaction on promotion to P0", async () => {
    const { deps, state, settings } = makeDeps({
      tasks: [makeTask({ id: "KS-100", priority: "P1" })],
    });

    await updateTaskOperation({ taskId: "KS-100", priority: "P0" }, deps);

    expect(state.wipCapCalls).toHaveLength(1);
    expect(state.wipCapCalls[0].cap).toBe(settings.infrastructure.p0_wip_cap);
    expect(state.wipCapCalls[0].tx).toBeTruthy();
    expect(state.fieldsCalls).toHaveLength(1);
    // Same transaction identity, cap check before the field write.
    expect(state.wipCapCalls[0].tx).toBe(state.fieldsCalls[0].tx);
    expect(callIndex(state, "enforcePZeroWipCap")).toBeLessThan(
      callIndex(state, "updateTaskFields"),
    );
  });

  it("propagates PZeroWipCapExceededError on promotion to P0 without writing", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", priority: "P1" })],
      wipCapError: new PZeroWipCapExceededError(3, 3),
    });

    await expect(
      updateTaskOperation({ taskId: "KS-100", priority: "P0" }, deps),
    ).rejects.toBeInstanceOf(PZeroWipCapExceededError);
    expect(state.fieldsCalls).toHaveLength(0);
  });

  it("rejects terminal statuses through update; complete/cancel are the only terminal paths", async () => {
    const { deps, state } = makeDeps({ tasks: [makeTask({ id: "KS-100" })] });

    for (const terminal of ["done", "cancelled"]) {
      const err: unknown = await updateTaskOperation(
        { taskId: "KS-100", status: terminal as unknown as NonTerminalTaskStatus },
        deps,
      ).then(
        () => {
          throw new Error(`update with status '${terminal}' must reject`);
        },
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(TaskServiceError);
      // Pinned (change-008): terminal status via update is an illegal
      // transition; use completeTaskOperation / cancelTaskOperation instead.
      expect((err as TaskServiceError).code).toBe("illegal_transition");
    }

    expect(state.statusCalls).toHaveLength(0);
    expect(state.fieldsCalls).toHaveLength(0);
  });

  it("applies non-terminal status transitions via updateTaskStatus in the same transaction", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", status: "in_progress" })],
    });

    const receipt = await updateTaskOperation({ taskId: "KS-100", status: "blocked" }, deps);

    expect(state.statusCalls).toHaveLength(1);
    expect(state.statusCalls[0].taskId).toBe("KS-100");
    expect(state.statusCalls[0].status).toBe("blocked");
    expect(state.txs).toHaveLength(1);
    expect(state.statusCalls[0].tx).toBe(state.txs[0]);
    expect(receipt.task.status).toBe("blocked");
  });

  it("records recordTaskGoalLinked plus a system note when goalId is set", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", goalId: null })],
      goals: ["G-001"],
    });

    const receipt = await updateTaskOperation({ taskId: "KS-100", goalId: "G-001" }, deps);

    const linked = state.activities.filter((a) => a.kind === "task_goal_linked");
    expect(linked).toHaveLength(1);
    expect(linked[0].input.taskId).toBe("KS-100");
    expect(linked[0].input.goalId).toBe("G-001");
    expect(
      state.notes.some((n) => n.noteType === "system" && n.content.includes("G-001")),
    ).toBe(true);
    expect(receipt.task.goalId).toBe("G-001");
  });

  it("records recordTaskGoalUnlinked plus a system note when goalId is cleared", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", goalId: "G-001" })],
      goals: ["G-001"],
    });

    const receipt = await updateTaskOperation({ taskId: "KS-100", goalId: null }, deps);

    const unlinked = state.activities.filter((a) => a.kind === "task_goal_unlinked");
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0].input.taskId).toBe("KS-100");
    expect(unlinked[0].input.fromGoalId).toBe("G-001");
    expect(
      state.notes.some((n) => n.noteType === "system" && n.content.includes("G-001")),
    ).toBe(true);
    expect(receipt.task.goalId).toBeNull();
  });

  it("rejects an unknown goal with goal_not_found", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100" })],
      goals: [],
    });

    await expect(
      updateTaskOperation({ taskId: "KS-100", goalId: "G-404" }, deps),
    ).rejects.toMatchObject({ name: "TaskServiceError", code: "goal_not_found" });
    expect(state.fieldsCalls).toHaveLength(0);
  });

  it("rejects due-date clearing with due_required", async () => {
    const { deps, state } = makeDeps({ tasks: [makeTask({ id: "KS-100" })] });

    await expect(
      updateTaskOperation({ taskId: "KS-100", dueAt: null }, deps),
    ).rejects.toMatchObject({ name: "TaskServiceError", code: "due_required" });
    expect(state.fieldsCalls).toHaveLength(0);
  });

  it("refuses a teammate owner with zero writes, even combined with other field changes", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", embedding: FAR_VEC })],
    });

    const err: unknown = await updateTaskOperation(
      {
        taskId: "KS-100",
        owner: "elena",
        title: "Renamed alongside the owner change",
        priority: "P2",
      },
      deps,
    ).then(
      () => {
        throw new Error("update with a teammate owner must reject");
      },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(TaskServiceError);
    expect((err as TaskServiceError).code).toBe("owner_not_self");
    expect((err as TaskServiceError).message).toContain(
      "execos taskops delegate --task-id KS-100 --owner elena",
    );

    // The WHOLE update refuses: no partial application of title/priority,
    // no re-embed, no transaction, no notes, no activities.
    expect(state.embedTexts).toHaveLength(0);
    expect(state.txs).toHaveLength(0);
    expect(state.fieldsCalls).toHaveLength(0);
    expect(state.statusCalls).toHaveLength(0);
    expect(state.notes).toHaveLength(0);
    expect(state.activities).toHaveLength(0);
    expect(state.tasksById.get("KS-100")?.title).toBe("Task KS-100");
  });

  it("accepts owner values that normalize to me and patches the canonical 'me'", async () => {
    for (const owner of ["me", "ME", " me "]) {
      const { deps, state } = makeDeps({ tasks: [makeTask({ id: "KS-100" })] });

      const receipt = await updateTaskOperation({ taskId: "KS-100", owner }, deps);

      expect(state.fieldsCalls).toHaveLength(1);
      expect(state.fieldsCalls[0].patch).toEqual({ owner: "me" });
      expect(receipt.task.owner).toBe("me");
    }
  });

  it("sets owner back to me on a currently-delegated task (known seam; undelegate is the proper path)", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", owner: "elena" })],
    });

    const receipt = await updateTaskOperation({ taskId: "KS-100", owner: "me" }, deps);

    expect(state.fieldsCalls).toHaveLength(1);
    expect(state.fieldsCalls[0].patch).toEqual({ owner: "me" });
    expect(receipt.task.owner).toBe("me");
  });

  it("sets hardDeadline and effort through the field patch without re-embedding (change-009)", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", embedding: FAR_VEC })],
    });

    const receipt = await updateTaskOperation(
      { taskId: "KS-100", hardDeadline: true, effort: "L" },
      deps,
    );

    expect(state.fieldsCalls).toHaveLength(1);
    expect(state.fieldsCalls[0].patch).toEqual({ hardDeadline: true, effort: "L" });
    expect(receipt.task.hardDeadline).toBe(true);
    expect(receipt.task.effort).toBe("L");
    // Neither field is part of the embedded text; no re-embed.
    expect(state.embedTexts).toHaveLength(0);
    expect(state.tasksById.get("KS-100")?.embedding).toEqual(FAR_VEC);
  });

  it("clears effort with null and round-trips hardDeadline false", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", hardDeadline: true, effort: "XL" })],
    });

    const receipt = await updateTaskOperation(
      { taskId: "KS-100", hardDeadline: false, effort: null },
      deps,
    );

    expect(state.fieldsCalls).toHaveLength(1);
    expect(state.fieldsCalls[0].patch).toEqual({ hardDeadline: false, effort: null });
    expect(receipt.task.hardDeadline).toBe(false);
    expect(receipt.task.effort).toBeNull();
  });

  it("flows hardDeadline and effort changes into the system diff-note content", () => {
    // computeTaskFieldDiff is key-generic over the patch; the production
    // updateTaskFields helper writes formatTaskFieldUpdateNote(diff) as the
    // system note, so pinning the formatter pins the audit content.
    const before: Record<string, unknown> = { hardDeadline: false, effort: null };
    const diff = computeTaskFieldDiff(before, { hardDeadline: true, effort: "M" });
    expect(diff.changes.hardDeadline).toEqual({ from: false, to: true });
    expect(diff.changes.effort).toEqual({ from: null, to: "M" });

    const note = formatTaskFieldUpdateNote(diff, "agent", FIXED_NOW);
    expect(note).toContain('"hardDeadline":{"from":false,"to":true}');
    expect(note).toContain('"effort":{"from":null,"to":"M"}');
  });

  it("appends a manual note via appendTaskNote in the same transaction when note is provided (ISS-003)", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", status: "in_progress" })],
    });

    const receipt = await updateTaskOperation(
      { taskId: "KS-100", priority: "P2", note: "Reprioritized after the client call." },
      deps,
    );

    expect(receipt.operation).toBe("update");
    const manualNotes = state.notes.filter((n) => n.noteType === "manual");
    expect(manualNotes).toHaveLength(1);
    expect(manualNotes[0].taskId).toBe("KS-100");
    expect(manualNotes[0].content).toBe("Reprioritized after the client call.");
    expect(manualNotes[0].createdBy).toBe("agent");
    // Same transaction identity as the field write (mirrors reopen).
    expect(state.txs).toHaveLength(1);
    expect(manualNotes[0].tx).toBe(state.txs[0]);
  });

  it("trims a manual note before appending it", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", status: "in_progress" })],
    });

    await updateTaskOperation({ taskId: "KS-100", note: "   padded note   " }, deps);

    const manualNotes = state.notes.filter((n) => n.noteType === "manual");
    expect(manualNotes).toHaveLength(1);
    expect(manualNotes[0].content).toBe("padded note");
  });

  it("appends no manual note when note is omitted", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", status: "in_progress" })],
    });

    await updateTaskOperation({ taskId: "KS-100", priority: "P2" }, deps);

    expect(state.notes.filter((n) => n.noteType === "manual")).toHaveLength(0);
  });

  it("rejects an explicitly-provided empty/whitespace note with validation, writing nothing", async () => {
    for (const hollow of ["", "   ", "\t\n"]) {
      const { deps, state } = makeDeps({
        tasks: [makeTask({ id: "KS-100", status: "in_progress" })],
      });

      await expect(
        updateTaskOperation({ taskId: "KS-100", note: hollow }, deps),
      ).rejects.toMatchObject({ name: "TaskServiceError", code: "validation" });

      expect(state.txs).toHaveLength(0);
      expect(state.fieldsCalls).toHaveLength(0);
      expect(state.notes).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// completeTaskOperation / cancelTaskOperation
// ---------------------------------------------------------------------------

describe("completeTaskOperation / cancelTaskOperation", () => {
  it("completes via updateTaskStatus('done') with the full receipt shape", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", status: "in_progress" })],
    });

    const receipt = await completeTaskOperation({ taskId: "KS-100" }, deps);

    expect(state.statusCalls).toHaveLength(1);
    expect(state.statusCalls[0].taskId).toBe("KS-100");
    expect(state.statusCalls[0].status).toBe("done");

    expect(receipt.operation).toBe("complete");
    expect(receipt.newStatus).toBe("done");
    expect(receipt.taskId).toBe("KS-100");
    expect(receipt.task.status).toBe("done");
    expect(Array.isArray(receipt.warnings)).toBe(true);
    expect(receipt.activityId).toBe("ACT-status-done");
  });

  it("cancels via updateTaskStatus('cancelled') with the full receipt shape", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", status: "in_progress" })],
    });

    const receipt = await cancelTaskOperation({ taskId: "KS-100" }, deps);

    expect(state.statusCalls).toHaveLength(1);
    expect(state.statusCalls[0].taskId).toBe("KS-100");
    expect(state.statusCalls[0].status).toBe("cancelled");

    expect(receipt.operation).toBe("cancel");
    expect(receipt.newStatus).toBe("cancelled");
    expect(receipt.taskId).toBe("KS-100");
    expect(receipt.task.status).toBe("cancelled");
    expect(Array.isArray(receipt.warnings)).toBe(true);
    expect(receipt.activityId).toBe("ACT-status-cancelled");
  });
});

// ---------------------------------------------------------------------------
// reopenTaskOperation
// ---------------------------------------------------------------------------

describe("reopenTaskOperation", () => {
  it("restores a done task to the previous non-terminal status in one transaction", async () => {
    const previous = makeTask({ id: "KS-100", status: "in_progress" });
    const done = makeTask({ id: "KS-100", status: "done", completedAt: FIXED_NOW });
    const { deps, state } = makeDeps({ tasks: [done] });
    state.activities.push({
      tx: { historical: true },
      kind: "task_status_changed",
      input: {
        taskId: "KS-100",
        fromStatus: previous.status,
        toStatus: "done",
      },
    });

    const receipt = await reopenTaskOperation({ taskId: "KS-100", note: "Undo accidental completion" }, deps);

    expect(state.previousReopenStatusCalls).toEqual(["KS-100"]);
    expect(state.statusCalls).toHaveLength(1);
    expect(state.statusCalls[0]).toMatchObject({
      taskId: "KS-100",
      status: "in_progress",
    });
    expect(state.statusCalls[0].tx).toBe(state.txs[0]);
    expect(state.notes.some((note) => note.content === "Undo accidental completion")).toBe(true);
    expect(receipt.operation).toBe("reopen");
    expect(receipt.fromStatus).toBe("done");
    expect(receipt.newStatus).toBe("in_progress");
    expect(receipt.task.status).toBe("in_progress");
    expect(receipt.activityId).toBe("ACT-status-in_progress");
  });

  it("falls back to backlog when history has no reopenable previous status", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", status: "cancelled" })],
    });

    const receipt = await reopenTaskOperation({ taskId: "KS-100" }, deps);

    expect(state.statusCalls[0].status).toBe("backlog");
    expect(receipt.fromStatus).toBe("cancelled");
    expect(receipt.newStatus).toBe("backlog");
    expect(receipt.noteId).toBeNull();
  });

  it("honors an explicit reopen target and rejects open tasks", async () => {
    const { deps, state } = makeDeps({
      tasks: [
        makeTask({ id: "KS-100", status: "done" }),
        makeTask({ id: "KS-101", status: "in_progress" }),
      ],
    });

    const receipt = await reopenTaskOperation({ taskId: "KS-100", toStatus: "review" }, deps);
    expect(receipt.newStatus).toBe("review");
    expect(state.statusCalls[0].status).toBe("review");

    await expect(reopenTaskOperation({ taskId: "KS-101" }, deps)).rejects.toMatchObject({
      code: "not_terminal",
    });
    expect(state.gateEvents[0].input).toMatchObject({
      gate: "status_transition",
      operation: "reopen",
      outcome: "blocked",
      taskId: "KS-101",
    });
  });

  it("restores a missing embedding inside the reopen transaction", async () => {
    const done = makeTask({
      id: "KS-100",
      title: "Renew CRP driver's license",
      description: "Schedule the renewal and collect the required documents",
      status: "done",
      embedding: null,
    });
    const restoredVec = [0, 1, 0];
    const { deps, state } = makeDeps({ tasks: [done], embedVector: restoredVec });

    const receipt = await reopenTaskOperation({ taskId: "KS-100" }, deps);

    expect(state.embedTexts).toEqual([`${done.title}\n\n${done.description}`]);
    expect(state.embeddingWrites).toHaveLength(1);
    expect(state.embeddingWrites[0]).toMatchObject({
      taskId: "KS-100",
      vector: restoredVec,
    });
    expect(state.embeddingWrites[0].tx).toBe(state.txs[0]);
    expect(receipt.task.embedding).toEqual(restoredVec);
    expect(receipt.warnings).toEqual([]);
  });

  it("reopens with a warning when a missing embedding cannot be restored", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", status: "cancelled", embedding: null })],
      embedError: new Error("provider unavailable"),
    });

    const receipt = await reopenTaskOperation({ taskId: "KS-100" }, deps);

    expect(receipt.task.status).toBe("backlog");
    expect(receipt.task.embedding).toBeNull();
    expect(receipt.warnings).toEqual([
      "Embedding restore skipped (provider unavailable); the reopened task still has no stored embedding.",
    ]);
    expect(state.embeddingWrites).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Gate-decision telemetry (W5 gate_events instrumentation).
// One event per gate DECISION; a clean pass writes nothing. Blocked events
// insert standalone on the refusal path; events tied to a successful write
// (overridden / skipped) insert in the same transaction. The recordGateEvent
// seam is best-effort by contract: a telemetry failure surfaces as a warning
// and never breaks a refusal or a write.
// ---------------------------------------------------------------------------

describe("gate event instrumentation (gate_events telemetry)", () => {
  const EXACT_DUP_TASK = makeTask({
    id: "KS-050",
    title: "Prepare the Acme onboarding checklist",
    description: "Some completely different description body",
    embedding: FAR_VEC,
  });

  it("a blocked create logs one dedup event with the input fingerprint and a null task id", async () => {
    const { deps, state } = makeDeps({ tasks: [EXACT_DUP_TASK] });
    const input = baseCreateInput();

    const result = await createTaskOperation(input, deps);

    expect(result.ok).toBe(false);
    expect(state.gateEvents).toHaveLength(1);
    const event = state.gateEvents[0];
    expect(event.input.gate).toBe("dedup");
    expect(event.input.operation).toBe("create");
    expect(event.input.outcome).toBe("blocked");
    expect(event.input.surface).toBe("cli");
    expect(event.input.taskId).toBeNull();
    expect(event.input.justification).toBeUndefined();
    expect(event.input.inputFingerprint).toBe(
      dedupInputFingerprint(input.title, input.description),
    );
    expect((event.input.detail as { matches: Array<{ id: string }> }).matches[0].id).toBe(
      "KS-050",
    );
    // Standalone on the refusal path: NOT inside a write transaction.
    expect(event.tx).toBeUndefined();
    expect(state.txs).toHaveLength(0);
  });

  it("an overridden create logs the justification in the same transaction as the write", async () => {
    const { deps, state } = makeDeps({ tasks: [EXACT_DUP_TASK] });
    const input = baseCreateInput({ allowDuplicate: "recurring weekly task" });

    const result = await createTaskOperation(input, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected create success");
    expect(state.gateEvents).toHaveLength(1);
    const event = state.gateEvents[0];
    expect(event.input.gate).toBe("dedup");
    expect(event.input.outcome).toBe("overridden");
    expect(event.input.justification).toBe("recurring weekly task");
    expect(event.input.taskId).toBe(result.receipt.taskId);
    expect(event.input.inputFingerprint).toBe(
      dedupInputFingerprint(input.title, input.description),
    );
    // Same transaction as the insert (R12 ethos).
    expect(state.txs).toHaveLength(1);
    expect(event.tx).toBe(state.txs[0]);
  });

  it("an embed-outage create logs one dedup 'skipped' event in the write transaction", async () => {
    const { deps, state } = makeDeps({ embedError: new Error("provider down") });
    const input = baseCreateInput();

    const result = await createTaskOperation(input, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected create success");
    expect(state.gateEvents).toHaveLength(1);
    const event = state.gateEvents[0];
    expect(event.input.gate).toBe("dedup");
    expect(event.input.outcome).toBe("skipped");
    expect(event.input.taskId).toBe(result.receipt.taskId);
    expect(event.input.detail).toMatchObject({ reason: "embed_failed" });
    expect(event.tx).toBe(state.txs[0]);
  });

  it("a clean create logs NO gate event", async () => {
    const { deps, state } = makeDeps();
    const result = await createTaskOperation(baseCreateInput(), deps);
    expect(result.ok).toBe(true);
    expect(state.gateEvents).toHaveLength(0);
  });

  it("a clean update / complete / cancel logs NO gate event", async () => {
    const { deps, state } = makeDeps({
      tasks: [
        makeTask({ id: "KS-100", status: "in_progress" }),
        makeTask({ id: "KS-101", status: "in_progress" }),
        makeTask({ id: "KS-102", status: "in_progress" }),
      ],
    });
    await updateTaskOperation({ taskId: "KS-100", title: "Renamed task title" }, deps);
    await completeTaskOperation({ taskId: "KS-101" }, deps);
    await cancelTaskOperation({ taskId: "KS-102" }, deps);
    expect(state.gateEvents).toHaveLength(0);
  });

  it("a telemetry failure never breaks the write: the override still succeeds and surfaces the warning", async () => {
    const { deps, state } = makeDeps({
      tasks: [EXACT_DUP_TASK],
      gateEventWarning: "Gate-event telemetry skipped (dedup/overridden): table missing",
    });

    const result = await createTaskOperation(
      baseCreateInput({ allowDuplicate: "recurring weekly task" }),
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected create success");
    expect(state.inserted).toHaveLength(1);
    expect(result.receipt.warnings).toContain(
      "Gate-event telemetry skipped (dedup/overridden): table missing",
    );
    expect(state.gateEvents).toHaveLength(1);
  });

  it("a telemetry failure never breaks the refusal: the blocked create still refuses cleanly", async () => {
    const { deps, state } = makeDeps({
      tasks: [EXACT_DUP_TASK],
      gateEventWarning: "Gate-event telemetry skipped (dedup/blocked): table missing",
    });

    const result = await createTaskOperation(baseCreateInput(), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected duplicate refusal");
    expect(result.outcome).toBe("duplicate");
    expect(state.inserted).toHaveLength(0);
  });

  it("an owner_not_self refusal on create logs a blocked event with a null task id", async () => {
    const { deps, state } = makeDeps();

    await expect(
      createTaskOperation(baseCreateInput({ owner: "noah" }), deps),
    ).rejects.toMatchObject({ code: "owner_not_self" });

    expect(state.gateEvents).toHaveLength(1);
    expect(state.gateEvents[0].input).toMatchObject({
      gate: "owner_not_self",
      operation: "create",
      outcome: "blocked",
      surface: "cli",
      taskId: null,
      detail: { owner: "noah" },
    });
    expect(state.inserted).toHaveLength(0);
  });

  it("an owner_not_self refusal on update logs a blocked event carrying the task id", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", status: "in_progress" })],
    });

    await expect(
      updateTaskOperation({ taskId: "KS-100", owner: "noah" }, deps),
    ).rejects.toMatchObject({ code: "owner_not_self" });

    expect(state.gateEvents).toHaveLength(1);
    expect(state.gateEvents[0].input).toMatchObject({
      gate: "owner_not_self",
      operation: "update",
      outcome: "blocked",
      taskId: "KS-100",
    });
  });

  it("a WIP-cap refusal on create logs a blocked wip_cap event after the rollback", async () => {
    const { deps, state } = makeDeps({
      wipCapError: new PZeroWipCapExceededError(2, 2),
    });

    await expect(
      createTaskOperation(baseCreateInput({ priority: "P0" }), deps),
    ).rejects.toBeInstanceOf(PZeroWipCapExceededError);

    expect(state.gateEvents).toHaveLength(1);
    expect(state.gateEvents[0].input).toMatchObject({
      gate: "wip_cap",
      operation: "create",
      outcome: "blocked",
      taskId: null,
      detail: { cap: 2, current: 2 },
    });
    // Standalone: recorded outside the rolled-back transaction.
    expect(state.gateEvents[0].tx).toBeUndefined();
  });

  it("a WIP-cap refusal on update (promotion to P0) logs a blocked wip_cap event with the task id", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", status: "in_progress", priority: "P1" })],
      wipCapError: new PZeroWipCapExceededError(2, 2),
    });

    await expect(
      updateTaskOperation({ taskId: "KS-100", priority: "P0" }, deps),
    ).rejects.toBeInstanceOf(PZeroWipCapExceededError);

    expect(state.gateEvents).toHaveLength(1);
    expect(state.gateEvents[0].input).toMatchObject({
      gate: "wip_cap",
      operation: "update",
      outcome: "blocked",
      taskId: "KS-100",
    });
  });

  it("an illegal status transition on update logs a blocked status_transition event", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", status: "in_progress" })],
    });

    await expect(
      updateTaskOperation(
        { taskId: "KS-100", status: "triage" as NonTerminalTaskStatus },
        deps,
      ),
    ).rejects.toMatchObject({ code: "illegal_transition" });

    expect(state.gateEvents).toHaveLength(1);
    expect(state.gateEvents[0].input).toMatchObject({
      gate: "status_transition",
      operation: "update",
      outcome: "blocked",
      taskId: "KS-100",
      detail: { from: "in_progress", to: "triage" },
    });
  });

  it("a terminal status routed through update logs a blocked status_transition event", async () => {
    const { deps, state } = makeDeps({
      tasks: [makeTask({ id: "KS-100", status: "in_progress" })],
    });

    await expect(
      updateTaskOperation(
        { taskId: "KS-100", status: "done" as unknown as NonTerminalTaskStatus },
        deps,
      ),
    ).rejects.toMatchObject({ code: "illegal_transition" });

    expect(state.gateEvents).toHaveLength(1);
    expect(state.gateEvents[0].input).toMatchObject({
      gate: "status_transition",
      operation: "update",
      outcome: "blocked",
      detail: { from: "in_progress", to: "done" },
    });
  });

  it("the surface input is stamped onto the event (web caller)", async () => {
    const { deps, state } = makeDeps({ tasks: [EXACT_DUP_TASK] });

    const result = await createTaskOperation(
      baseCreateInput({ surface: "web" }),
      deps,
    );

    expect(result.ok).toBe(false);
    expect(state.gateEvents).toHaveLength(1);
    expect(state.gateEvents[0].input.surface).toBe("web");
  });
});
