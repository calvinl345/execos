/**
 * Cycle prevention for task_dependencies (replaces the no-cycle trigger
 * per ADR-006).
 *
 * Before inserting a dependency edge `(blocker, blocked)`, we check
 * whether a path already exists from `blocked` back to `blocker`. If yes,
 * adding the new edge would create a cycle.
 *
 * Implementation: recursive CTE walking the existing dependency graph
 * starting from `blockedTaskId`, following blocker -> blocked edges,
 * looking for `blockerTaskId`. If found, the cycle is real.
 *
 * Self-edges (blocker == blocked) are caught by the
 * task_dependencies_no_self_block CHECK constraint at the DB layer; we
 * do not duplicate that here.
 */

import { sql } from "drizzle-orm";
import { db } from "../index.js";
import { TaskDependencyCycleError } from "../errors.js";

interface CycleHit extends Record<string, unknown> {
  hit: number;
}

export async function assertNoCycle(
  blockerTaskId: string,
  blockedTaskId: string,
): Promise<void> {
  if (blockerTaskId === blockedTaskId) {
    // Defense in depth; the DB CHECK also rejects this.
    throw new TaskDependencyCycleError(blockerTaskId, blockedTaskId);
  }

  const result = await db.execute<CycleHit>(sql`
    WITH RECURSIVE forward(current_id) AS (
      SELECT ${blockedTaskId}::text AS current_id
      UNION
      SELECT td.blocked_task_id
      FROM forward f
      JOIN task_dependencies td ON td.blocker_task_id = f.current_id
    )
    SELECT 1 AS hit FROM forward WHERE current_id = ${blockerTaskId} LIMIT 1
  `);

  const rows = result as unknown as CycleHit[];
  if (rows.length > 0) {
    throw new TaskDependencyCycleError(blockerTaskId, blockedTaskId);
  }
}
