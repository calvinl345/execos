import type {
  GoalStatus,
  MemoryState,
  TaskCategory,
  TaskPriority,
  TaskStatus,
} from "../../db/schema.js";
import {
  goals,
  memories,
  taskNotes,
  tasks,
} from "../../db/schema.js";
import type { FormatterContext } from "../output-formatters/index.js";
import type { Settings } from "../../domain/validation.js";

export const DECLARED_COMMAND_SEAMS = [
  "taskRepo",
  "goalRepo",
  "memoryRepo",
  "settingsLoader",
  "clockProvider",
  "embeddingAdapter",
  "outputContext",
] as const;

export type CommandSeam = (typeof DECLARED_COMMAND_SEAMS)[number];

/* ----------------------------------------------------------------------- */
/* Row + insert types (single source of truth: drizzle schema)             */
/* ----------------------------------------------------------------------- */

export type TaskRow = typeof tasks.$inferSelect;
export type TaskInsert = typeof tasks.$inferInsert;
export type TaskNoteRow = typeof taskNotes.$inferSelect;
export type TaskNoteInsert = typeof taskNotes.$inferInsert;
export type GoalRow = typeof goals.$inferSelect;
export type GoalInsert = typeof goals.$inferInsert;
export type MemoryRow = typeof memories.$inferSelect;
export type MemoryInsert = typeof memories.$inferInsert;

/* ----------------------------------------------------------------------- */
/* Filter shapes (mirror what command code actually filters on today)      */
/* ----------------------------------------------------------------------- */

export interface TaskListFilters {
  status?: TaskStatus;
  priority?: TaskPriority;
  category?: TaskCategory;
  goalId?: string | null;
  needsAttention?: boolean;
  /** Maximum rows returned. Caller-side default is 50; production caps at 1000. */
  limit?: number;
}

export interface GoalListFilters {
  status?: GoalStatus;
  quarter?: string;
  limit?: number;
}

export interface MemoryListFilters {
  state?: MemoryState;
  exactScope?: string;
  /**
   * Segment-aligned scope prefix per Appendix A.5: "clients/acme" matches
   * "clients/acme" and "clients/acme/billing" but not "clients/acme-corp".
   */
  scopePrefix?: string;
  limit?: number;
}

/* ----------------------------------------------------------------------- */
/* Repo seams                                                              */
/* ----------------------------------------------------------------------- */

export interface TaskRepo {
  findById(id: string): Promise<TaskRow | null>;
  list(filters?: TaskListFilters): Promise<TaskRow[]>;
  recentNotes(taskId: string, limit: number): Promise<TaskNoteRow[]>;
  dueFollowUps(now: Date): Promise<TaskRow[]>;
  appendNote(input: TaskNoteInsert): Promise<void>;
}

export interface GoalRepo {
  findById(id: string): Promise<GoalRow | null>;
  list(filters?: GoalListFilters): Promise<GoalRow[]>;
  create(input: GoalInsert): Promise<GoalRow>;
  update(id: string, patch: Partial<GoalInsert>): Promise<void>;
  /** Tasks linked to a goal, optionally filtered by status. */
  linkedTasks(goalId: string, filters?: { status?: TaskStatus }): Promise<TaskRow[]>;
}

export interface MemoryRepo {
  findById(id: string): Promise<MemoryRow | null>;
  list(filters?: MemoryListFilters): Promise<MemoryRow[]>;
  create(input: MemoryInsert): Promise<MemoryRow>;
  update(id: string, patch: Partial<MemoryInsert>): Promise<void>;
}

/* ----------------------------------------------------------------------- */
/* Cross-cutting seams                                                     */
/* ----------------------------------------------------------------------- */

export interface SettingsLoader {
  load(options?: { force?: boolean }): Promise<{
    settings: Settings;
    warnings: string[];
  }>;
}

export interface ClockProvider {
  now(): Date;
  nowMs(): number;
}

export interface EmbeddingAdapter {
  embed(text: string): Promise<number[]>;
}

export type OutputContext = FormatterContext;

export interface CommandAdapters {
  taskRepo: TaskRepo;
  goalRepo: GoalRepo;
  memoryRepo: MemoryRepo;
  settingsLoader: SettingsLoader;
  clockProvider: ClockProvider;
  embeddingAdapter: EmbeddingAdapter;
  outputContext: OutputContext;
}

/* ----------------------------------------------------------------------- */
/* Helpers                                                                  */
/* ----------------------------------------------------------------------- */

/**
 * Segment-aligned scope-prefix match per Appendix A.5 / `domain/memory-policy.ts`.
 * Exposed here so fake and production adapters compute the same predicate.
 */
export function scopeMatchesPrefix(scope: string, prefix: string): boolean {
  if (scope === prefix) return true;
  return scope.startsWith(prefix + "/");
}
