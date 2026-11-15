import {
  selectEligibleForPrioritization,
  type EligibleForPrioritizationRow,
} from "../../db/views.js";
import {
  rankTasks,
  type PrioritizationInput,
  type RankedTask,
  type TaskInput,
} from "../../domain/prioritization.js";

export interface ReviewTaskDetail {
  id: string;
  title: string;
  description: string;
  status: EligibleForPrioritizationRow["status"];
  priority: EligibleForPrioritizationRow["priority"];
  category: EligibleForPrioritizationRow["category"];
  owner: string | null;
  dueAt: string | null;
  goalId: string | null;
  needsAttention: boolean;
  needsAttentionReason: string | null;
}

export interface RankedRow {
  ranking: RankedTask;
  title: string;
  task: ReviewTaskDetail;
  taskInput: TaskInput;
  /**
   * T-shirt estimate carried for review-candidate display only (change-009).
   * Kept off ReviewTaskDetail so the `daily review` JSON shapes stay
   * untouched; effort never affects ranking.
   */
  effort: EligibleForPrioritizationRow["effort"];
}

export async function rankEligible(
  referenceTime: Date,
): Promise<{ ranked: RankedRow[]; evaluated: number }> {
  const rows = await selectEligibleForPrioritization();
  if (rows.length === 0) {
    return { ranked: [], evaluated: 0 };
  }

  const inputs: PrioritizationInput[] = rows.map((row) => ({
    task: toTaskInput(row),
  }));
  const ranked = rankTasks(inputs, referenceTime);

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const inputById = new Map(inputs.map(({ task }) => [task.id, task]));
  return {
    ranked: ranked.map((ranking) => ({
      ranking,
      title: rowById.get(ranking.taskId)?.title ?? "(unknown)",
      task: serializeReviewTask(rowById.get(ranking.taskId)),
      taskInput: inputById.get(ranking.taskId) ?? unknownTaskInput(ranking.taskId),
      effort: rowById.get(ranking.taskId)?.effort ?? null,
    })),
    evaluated: rows.length,
  };
}

function toTaskInput(row: EligibleForPrioritizationRow): TaskInput {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    description: row.description,
    dueAt: row.dueDate,
    followUpDate: row.followUpDate,
    snoozedUntil: row.snoozedUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUnblockedAt: row.lastUnblockedAt,
    goalId: row.goalId,
    hardDeadline: row.hardDeadline,
  };
}

function unknownTaskInput(taskId: string): TaskInput {
  return {
    id: taskId,
    title: "(unknown)",
    status: "triage",
    priority: null,
    description: "",
    dueAt: null,
    followUpDate: null,
    snoozedUntil: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastUnblockedAt: null,
    goalId: null,
    hardDeadline: false,
  };
}

export function serializeReviewTask(
  row: EligibleForPrioritizationRow | undefined,
): ReviewTaskDetail {
  if (row === undefined) {
    return {
      id: "(unknown)",
      title: "(unknown)",
      description: "",
      status: "triage",
      priority: null,
      category: "personal",
      owner: null,
      dueAt: null,
      goalId: null,
      needsAttention: false,
      needsAttentionReason: null,
    };
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    category: row.category,
    owner: row.owner,
    dueAt: row.dueDate === null ? null : row.dueDate.toISOString(),
    goalId: row.goalId,
    needsAttention: row.needsAttention,
    needsAttentionReason: row.needsAttentionReason,
  };
}
