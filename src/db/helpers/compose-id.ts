/**
 * Task and goal ID composition (replaces tasks_id_trigger / goals_id_trigger
 * per ADR-006).
 *
 *   composeTaskId(prefix): pulls the next value from `task_id_sequence`,
 *     returns `${prefix}-${n.toString().padStart(3, '0')}` (e.g. "KS-001").
 *     The caller resolves `prefix` from the typed Settings tree
 *     (Settings.infrastructure.task_id_prefix) and passes it in. The
 *     helper does not read app_settings.
 *
 *   composeGoalId(): pulls the next value from `goal_id_sequence`,
 *     returns `G-${n.toString().padStart(3, '0')}` (e.g. "G-001").
 *     Goal prefix is hardcoded "G" per Appendix G.2.
 *
 * Both helpers run inside the same transaction as their consumer's
 * INSERT (caller passes the active Drizzle client via the optional
 * `tx` parameter). When tx is omitted, the default service-role db is
 * used.
 *
 * Idempotency: each call advances the sequence by one. If the calling
 * INSERT fails the sequence value is "lost" (Postgres sequences do
 * not roll back). This is acceptable; gaps in task IDs are explicitly
 * permitted by Appendix G.1.
 */

import { sql } from "drizzle-orm";
import { db as defaultDb } from "../index.js";
import { formatGoalId, formatTaskId } from "./formatters.js";

type DrizzleClient = typeof defaultDb;

interface SequenceRow extends Record<string, unknown> {
  nextval: string;
}

export async function composeTaskId(
  prefix: string,
  tx?: DrizzleClient,
): Promise<string> {
  const client = tx ?? defaultDb;
  const seqResult = await client.execute<SequenceRow>(
    sql`SELECT nextval('task_id_sequence') AS nextval`,
  );
  const seqRows = seqResult as unknown as SequenceRow[];
  const n = Number(seqRows[0].nextval);
  return formatTaskId(prefix, n);
}

export async function composeGoalId(tx?: DrizzleClient): Promise<string> {
  const client = tx ?? defaultDb;
  const seqResult = await client.execute<SequenceRow>(
    sql`SELECT nextval('goal_id_sequence') AS nextval`,
  );
  const seqRows = seqResult as unknown as SequenceRow[];
  const n = Number(seqRows[0].nextval);
  return formatGoalId(n);
}
