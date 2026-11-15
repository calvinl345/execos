/**
 * P0 work-in-progress cap enforcement (replaces tasks_p0_wip_cap_trigger
 * per ADR-006 + Appendix A.6 #5).
 *
 * The cap value is resolved by the wiring layer from the typed Settings
 * tree (Settings.infrastructure.p0_wip_cap) and passed in as a
 * parameter. This helper does not read app_settings. The cap counts
 * tasks with priority='P0' and status NOT IN ('done', 'cancelled').
 *
 * Concurrency: a Postgres advisory transaction lock serializes concurrent
 * cap checks so two simultaneous "create P0 task" calls cannot both pass
 * the count and both INSERT, breaching the cap. The lock is released
 * automatically at transaction commit/rollback.
 *
 * Usage: call inside a transaction BEFORE the INSERT or UPDATE that would
 * make the row count as P0:
 *
 *   await db.transaction(async (tx) => {
 *     await enforcePZeroWipCap(tx, settings.infrastructure.p0_wip_cap);
 *     await tx.insert(tasks).values({ ..., priority: "P0" });
 *   });
 *
 * Raises PZeroWipCapExceededError if the cap is already met.
 */

import { sql } from "drizzle-orm";
import { PZeroWipCapExceededError } from "../errors.js";

interface DrizzleExecutor {
  execute<T extends Record<string, unknown>>(query: unknown): Promise<T[] | unknown>;
}

const ADVISORY_LOCK_KEY = "p0_wip_cap";

interface CountRow extends Record<string, unknown> {
  n: string;
}

export async function enforcePZeroWipCap(
  tx: DrizzleExecutor,
  cap: number,
): Promise<void> {
  // Acquire a transaction-scoped advisory lock keyed on a hash of
  // 'p0_wip_cap'. This serializes any concurrent transaction that calls
  // enforcePZeroWipCap so we never have two callers race past the count.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${ADVISORY_LOCK_KEY}))`,
  );

  // Count current open P0 tasks.
  const countResult = await tx.execute<CountRow>(
    sql`SELECT COUNT(*)::text AS n FROM tasks WHERE priority = 'P0' AND status NOT IN ('done', 'cancelled')`,
  );
  const countRows = countResult as unknown as CountRow[];
  const currentCount = parseInt(countRows[0].n, 10);

  if (currentCount >= cap) {
    throw new PZeroWipCapExceededError(currentCount, cap);
  }
}
