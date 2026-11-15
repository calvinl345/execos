import { and, asc, desc, eq, inArray, isNull, like, lte, not, or, sql, type SQL } from "drizzle-orm";
import { db, goals, memories, taskNotes, tasks } from "../../db/index.js";
import { embed } from "../../embeddings/index.js";
import { loadSettings } from "../settings-loader.js";
import { defaultContext } from "../output-formatters/index.js";
import type {
  ClockProvider,
  CommandAdapters,
  EmbeddingAdapter,
  GoalListFilters,
  GoalRepo,
  MemoryListFilters,
  MemoryRepo,
  SettingsLoader,
  TaskListFilters,
  TaskRepo,
} from "./interfaces.js";

const DEFAULT_LIST_LIMIT = 50;

function combine(conditions: (SQL | undefined)[]): SQL | undefined {
  const filtered = conditions.filter((c): c is SQL => c !== undefined);
  if (filtered.length === 0) return undefined;
  if (filtered.length === 1) return filtered[0];
  return and(...filtered);
}

/* ----------------------------------------------------------------------- */
/* TaskRepo                                                                */
/* ----------------------------------------------------------------------- */

export const drizzleTaskRepo: TaskRepo = {
  async findById(id) {
    const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return rows[0] ?? null;
  },
  async list(filters: TaskListFilters = {}) {
    const where = combine([
      filters.status !== undefined ? eq(tasks.status, filters.status) : undefined,
      filters.priority !== undefined ? eq(tasks.priority, filters.priority) : undefined,
      filters.category !== undefined ? eq(tasks.category, filters.category) : undefined,
      filters.goalId === undefined
        ? undefined
        : filters.goalId === null
          ? isNull(tasks.goalId)
          : eq(tasks.goalId, filters.goalId),
      filters.needsAttention !== undefined
        ? eq(tasks.needsAttention, filters.needsAttention)
        : undefined,
    ]);
    const limit = filters.limit ?? DEFAULT_LIST_LIMIT;
    return db
      .select()
      .from(tasks)
      .where(where)
      .orderBy(desc(tasks.lastStatusChangeAt))
      .limit(limit);
  },
  async recentNotes(taskId, limit) {
    return db
      .select()
      .from(taskNotes)
      .where(and(eq(taskNotes.taskId, taskId), eq(taskNotes.noteType, "manual")))
      .orderBy(desc(taskNotes.createdAt))
      .limit(limit);
  },
  async dueFollowUps(now) {
    return db
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
  },
  async appendNote(input) {
    await db.insert(taskNotes).values(input);
  },
};

/* ----------------------------------------------------------------------- */
/* GoalRepo                                                                */
/* ----------------------------------------------------------------------- */

export const drizzleGoalRepo: GoalRepo = {
  async findById(id) {
    const rows = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
    return rows[0] ?? null;
  },
  async list(filters: GoalListFilters = {}) {
    const where = combine([
      filters.status !== undefined ? eq(goals.status, filters.status) : undefined,
      filters.quarter !== undefined ? eq(goals.quarter, filters.quarter) : undefined,
    ]);
    const limit = filters.limit ?? DEFAULT_LIST_LIMIT;
    return db
      .select()
      .from(goals)
      .where(where)
      .orderBy(desc(goals.id))
      .limit(limit);
  },
  async create(input) {
    await db.insert(goals).values(input);
    const rows = await db.select().from(goals).where(eq(goals.id, input.id)).limit(1);
    return rows[0]!;
  },
  async update(id, patch) {
    await db.update(goals).set(patch).where(eq(goals.id, id));
  },
  async linkedTasks(goalId, filters = {}) {
    const where = combine([
      eq(tasks.goalId, goalId),
      filters.status !== undefined ? eq(tasks.status, filters.status) : undefined,
    ]);
    return db
      .select()
      .from(tasks)
      .where(where)
      .orderBy(asc(tasks.id));
  },
};

/* ----------------------------------------------------------------------- */
/* MemoryRepo                                                              */
/* ----------------------------------------------------------------------- */

export const drizzleMemoryRepo: MemoryRepo = {
  async findById(id) {
    const rows = await db.select().from(memories).where(eq(memories.id, id)).limit(1);
    return rows[0] ?? null;
  },
  async list(filters: MemoryListFilters = {}) {
    const conditions: (SQL | undefined)[] = [
      filters.state !== undefined ? eq(memories.state, filters.state) : undefined,
    ];
    if (filters.exactScope !== undefined) {
      conditions.push(eq(memories.scope, filters.exactScope));
    } else if (filters.scopePrefix !== undefined) {
      // Segment-aligned: exact match OR starts with "<prefix>/"
      const exact = eq(memories.scope, filters.scopePrefix);
      const child = like(memories.scope, `${filters.scopePrefix}/%`);
      conditions.push(or(exact, child));
    }
    const where = combine(conditions);
    const limit = filters.limit ?? DEFAULT_LIST_LIMIT;
    return db
      .select()
      .from(memories)
      .where(where)
      .orderBy(desc(memories.createdAt))
      .limit(limit);
  },
  async create(input) {
    await db.insert(memories).values(input);
    const rows = await db.select().from(memories).where(eq(memories.id, input.id)).limit(1);
    return rows[0]!;
  },
  async update(id, patch) {
    await db.update(memories).set(patch).where(eq(memories.id, id));
  },
};

/* ----------------------------------------------------------------------- */
/* Cross-cutting production adapters                                        */
/* ----------------------------------------------------------------------- */

export const productionSettingsLoader: SettingsLoader = {
  load: (options) => loadSettings(options?.force),
};

export const systemClockProvider: ClockProvider = {
  now: () => new Date(),
  nowMs: () => Date.now(),
};

export const productionEmbeddingAdapter: EmbeddingAdapter = {
  embed,
};

export function createProductionAdapters(): CommandAdapters {
  return {
    taskRepo: drizzleTaskRepo,
    goalRepo: drizzleGoalRepo,
    memoryRepo: drizzleMemoryRepo,
    settingsLoader: productionSettingsLoader,
    clockProvider: systemClockProvider,
    embeddingAdapter: productionEmbeddingAdapter,
    outputContext: defaultContext("text"),
  };
}
