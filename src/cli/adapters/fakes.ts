import type {
  ClockProvider,
  EmbeddingAdapter,
  GoalInsert,
  GoalListFilters,
  GoalRepo,
  GoalRow,
  MemoryInsert,
  MemoryListFilters,
  MemoryRepo,
  MemoryRow,
  OutputContext,
  SettingsLoader,
  TaskListFilters,
  TaskNoteInsert,
  TaskNoteRow,
  TaskRepo,
  TaskRow,
} from "./interfaces.js";
import { scopeMatchesPrefix } from "./interfaces.js";
import { DEFAULT_SETTINGS } from "../../domain/validation.js";
import type { TaskStatus } from "../../db/schema.js";

/* ----------------------------------------------------------------------- */
/* FakeTaskRepo                                                            */
/* ----------------------------------------------------------------------- */

export class FakeTaskRepo implements TaskRepo {
  private readonly tasksById = new Map<string, TaskRow>();
  private readonly notesByTask = new Map<string, TaskNoteRow[]>();

  async findById(id: string): Promise<TaskRow | null> {
    return this.tasksById.get(id) ?? null;
  }

  async list(filters: TaskListFilters = {}): Promise<TaskRow[]> {
    let rows = Array.from(this.tasksById.values());
    if (filters.status !== undefined) rows = rows.filter((r) => r.status === filters.status);
    if (filters.priority !== undefined) rows = rows.filter((r) => r.priority === filters.priority);
    if (filters.category !== undefined) rows = rows.filter((r) => r.category === filters.category);
    if (filters.goalId !== undefined) rows = rows.filter((r) => r.goalId === filters.goalId);
    if (filters.needsAttention !== undefined) {
      rows = rows.filter((r) => r.needsAttention === filters.needsAttention);
    }
    rows = rows.sort(
      (a, b) =>
        new Date(b.lastStatusChangeAt).getTime() - new Date(a.lastStatusChangeAt).getTime(),
    );
    if (filters.limit !== undefined) rows = rows.slice(0, filters.limit);
    return rows;
  }

  async recentNotes(taskId: string, limit: number): Promise<TaskNoteRow[]> {
    const notes = this.notesByTask.get(taskId) ?? [];
    return notes
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  async dueFollowUps(now: Date): Promise<TaskRow[]> {
    return Array.from(this.tasksById.values())
      .filter(
        (task) =>
          task.status !== "done" &&
          task.status !== "cancelled" &&
          task.followUpDate !== null &&
          task.followUpDate.getTime() <= now.getTime(),
      )
      .sort((a, b) => {
        const owner = (a.owner ?? "me").localeCompare(b.owner ?? "me");
        if (owner !== 0) return owner;
        return (a.followUpDate?.getTime() ?? 0) - (b.followUpDate?.getTime() ?? 0);
      });
  }

  async appendNote(input: TaskNoteInsert): Promise<void> {
    const row = materializeTaskNote(input);
    const list = this.notesByTask.get(row.taskId) ?? [];
    list.push(row);
    this.notesByTask.set(row.taskId, list);
  }

  /** Test affordance — read-only snapshot of all stored notes. */
  allNotes(): TaskNoteRow[] {
    return Array.from(this.notesByTask.values()).flat();
  }
}

/* ----------------------------------------------------------------------- */
/* FakeGoalRepo                                                            */
/* ----------------------------------------------------------------------- */

export class FakeGoalRepo implements GoalRepo {
  private readonly goalsById = new Map<string, GoalRow>();
  /** Linked tasks — tests populate this directly, then `linkedTasks(goalId)` filters by goalId. */
  readonly linkedTaskRows: TaskRow[] = [];

  async findById(id: string): Promise<GoalRow | null> {
    return this.goalsById.get(id) ?? null;
  }

  async list(filters: GoalListFilters = {}): Promise<GoalRow[]> {
    let rows = Array.from(this.goalsById.values());
    if (filters.status !== undefined) rows = rows.filter((r) => r.status === filters.status);
    if (filters.quarter !== undefined) rows = rows.filter((r) => r.quarter === filters.quarter);
    rows = rows.sort((a, b) => b.id.localeCompare(a.id));
    if (filters.limit !== undefined) rows = rows.slice(0, filters.limit);
    return rows;
  }

  async create(input: GoalInsert): Promise<GoalRow> {
    const row = materializeGoal(input);
    this.goalsById.set(row.id, row);
    return row;
  }

  async update(id: string, patch: Partial<GoalInsert>): Promise<void> {
    const current = this.goalsById.get(id);
    if (!current) return;
    this.goalsById.set(id, { ...current, ...patch } as GoalRow);
  }

  async linkedTasks(
    goalId: string,
    filters: { status?: TaskStatus } = {},
  ): Promise<TaskRow[]> {
    let rows = this.linkedTaskRows.filter((row) => row.goalId === goalId);
    if (filters.status !== undefined) rows = rows.filter((r) => r.status === filters.status);
    return rows;
  }
}

/* ----------------------------------------------------------------------- */
/* FakeMemoryRepo                                                          */
/* ----------------------------------------------------------------------- */

export class FakeMemoryRepo implements MemoryRepo {
  private readonly memoriesById = new Map<string, MemoryRow>();

  async findById(id: string): Promise<MemoryRow | null> {
    return this.memoriesById.get(id) ?? null;
  }

  async list(filters: MemoryListFilters = {}): Promise<MemoryRow[]> {
    let rows = Array.from(this.memoriesById.values());
    if (filters.state !== undefined) rows = rows.filter((r) => r.state === filters.state);
    if (filters.exactScope !== undefined) {
      rows = rows.filter((r) => r.scope === filters.exactScope);
    }
    if (filters.scopePrefix !== undefined) {
      const prefix = filters.scopePrefix;
      rows = rows.filter((r) => scopeMatchesPrefix(r.scope, prefix));
    }
    rows = rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (filters.limit !== undefined) rows = rows.slice(0, filters.limit);
    return rows;
  }

  async create(input: MemoryInsert): Promise<MemoryRow> {
    const row = materializeMemory(input);
    this.memoriesById.set(row.id, row);
    return row;
  }

  async update(id: string, patch: Partial<MemoryInsert>): Promise<void> {
    const current = this.memoriesById.get(id);
    if (!current) return;
    this.memoriesById.set(id, { ...current, ...patch } as MemoryRow);
  }
}

/* ----------------------------------------------------------------------- */
/* Cross-cutting fakes                                                     */
/* ----------------------------------------------------------------------- */

export class FakeSettingsLoader implements SettingsLoader {
  constructor(
    private readonly result = { settings: DEFAULT_SETTINGS, warnings: [] as string[] },
  ) {}

  async load(): Promise<{ settings: typeof DEFAULT_SETTINGS; warnings: string[] }> {
    return this.result;
  }
}

export class FakeClockProvider implements ClockProvider {
  constructor(private readonly value = new Date("2026-04-28T12:00:00.000Z")) {}

  now(): Date {
    return new Date(this.value);
  }

  nowMs(): number {
    return this.value.getTime();
  }
}

export class FakeEmbeddingAdapter implements EmbeddingAdapter {
  /** Per-call invocation log so tests can assert "embed was called with X". */
  readonly calls: string[] = [];
  /** Default vector returned for any text. */
  vector: number[] = [0, 1, 0];
  /** Optional error mode for tests asserting failure paths. */
  failureMode: "ok" | "throw" = "ok";

  constructor(opts: { vector?: number[]; failureMode?: "ok" | "throw" } = {}) {
    if (opts.vector) this.vector = opts.vector;
    if (opts.failureMode) this.failureMode = opts.failureMode;
  }

  async embed(text: string): Promise<number[]> {
    this.calls.push(text);
    if (this.failureMode === "throw") {
      throw new Error("FakeEmbeddingAdapter: failureMode=throw");
    }
    return [...this.vector];
  }
}

export function createCaptureOutputContext(): OutputContext & {
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    format: "json",
    out: (chunk) => stdout.push(chunk),
    err: (chunk) => stderr.push(chunk),
    stdout,
    stderr,
  };
}

/* ----------------------------------------------------------------------- */
/* Materialization helpers — fakes accept Insert types and synthesize       */
/* sensible defaults for nullable / DB-defaulted columns so tests do not    */
/* need to spell out every column on create().                              */
/* ----------------------------------------------------------------------- */

function materializeTaskNote(input: TaskNoteInsert): TaskNoteRow {
  const now = new Date();
  return {
    id: input.id ?? `note-${cheapRandom()}`,
    taskId: input.taskId,
    noteType: input.noteType ?? "manual",
    content: input.content,
    createdAt: input.createdAt ?? now,
    createdBy: input.createdBy ?? "agent",
  } as TaskNoteRow;
}

function materializeGoal(input: GoalInsert): GoalRow {
  const now = new Date();
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    quarter: input.quarter,
    status: input.status ?? "active",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    closedAt: input.closedAt ?? null,
  } as GoalRow;
}

function materializeMemory(input: MemoryInsert): MemoryRow {
  const now = new Date();
  return {
    id: input.id,
    scope: input.scope,
    content: input.content,
    applicability: input.applicability,
    contentEmbedding: input.contentEmbedding,
    applicabilityEmbedding: input.applicabilityEmbedding,
    state: input.state ?? "active",
    supersededById: input.supersededById ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    prunedAt: input.prunedAt ?? null,
  } as MemoryRow;
}

function cheapRandom(): string {
  return Math.random().toString(36).slice(2, 10);
}
