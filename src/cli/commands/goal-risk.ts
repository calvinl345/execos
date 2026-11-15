/**
 * Data access for the change-009 review risk detectors.
 *
 * The detectors themselves (src/domain/risk-detectors.ts) are pure; this
 * module owns the two queries that feed them from the taskops review
 * runner:
 *
 *   - selectOpenRiskTasks(): ALL open tasks (status NOT IN
 *     ('done','cancelled'), ANY owner) straight from the tasks table —
 *     deliberately NOT the eligibility view and NOT the owner/snooze
 *     filtered review candidates. Delegated, snoozed, review-status, and
 *     blocked hard-deadline tasks must surface as commitments at risk and
 *     as newly unblocked even though do-next ranking excludes them.
 *   - selectGoalRiskInputs(): active goals with per-goal open/done linked
 *     task counts in one grouped query.
 *
 * Read-only; same direct service-role db reads the other CLI commands use.
 */

import { asc, eq, inArray, not, sql } from "drizzle-orm";
import { db, goals, tasks } from "../../db/index.js";
import type { TaskStatus } from "../../db/schema.js";
import type {
  GoalTaskCounts,
  RiskGoalInput,
  RiskTaskInput,
} from "../../domain/risk-detectors.js";

const TERMINAL_TASK_STATUSES: TaskStatus[] = ["done", "cancelled"];

/** Every open task, projected into the detector input shape. */
export async function selectOpenRiskTasks(): Promise<RiskTaskInput[]> {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      owner: tasks.owner,
      dueDate: tasks.dueDate,
      hardDeadline: tasks.hardDeadline,
      lastUnblockedAt: tasks.lastUnblockedAt,
    })
    .from(tasks)
    .where(not(inArray(tasks.status, TERMINAL_TASK_STATUSES)))
    .orderBy(asc(tasks.id));
}

export interface GoalRiskInputs {
  goals: RiskGoalInput[];
  taskCountsByGoal: Map<string, GoalTaskCounts>;
}

/**
 * Active goals plus per-goal linked-task counts (open = not terminal,
 * done = status 'done'), grouped in a single query. Goals with no linked
 * tasks come back with zero counts via the LEFT JOIN.
 */
export async function selectGoalRiskInputs(): Promise<GoalRiskInputs> {
  const rows = await db
    .select({
      id: goals.id,
      title: goals.title,
      quarter: goals.quarter,
      status: goals.status,
      openCount: sql<number>`count(*) filter (where ${tasks.status} not in ('done', 'cancelled'))`.mapWith(Number),
      doneCount: sql<number>`count(*) filter (where ${tasks.status} = 'done')`.mapWith(Number),
    })
    .from(goals)
    .leftJoin(tasks, eq(tasks.goalId, goals.id))
    .where(eq(goals.status, "active"))
    .groupBy(goals.id, goals.title, goals.quarter, goals.status)
    .orderBy(asc(goals.id));

  return {
    goals: rows.map((row) => ({
      id: row.id,
      title: row.title,
      quarter: row.quarter,
      status: row.status,
    })),
    taskCountsByGoal: new Map(
      rows.map((row) => [
        row.id,
        { open: row.openCount, done: row.doneCount },
      ]),
    ),
  };
}
