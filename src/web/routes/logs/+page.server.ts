import type { PageServerLoad } from "./$types.js";
import { clampLogsLimit, loadLogsPageData } from "$lib/server/logs-queries.js";

/**
 * Read-only logs page (W6): the single-source-of-truth view merging
 * task_activities (what changed) and gate_events (what was blocked,
 * overridden, warned, or skipped, and why). Reads through the anon
 * client under RLS only (R3); this route performs no writes.
 */
export const load: PageServerLoad = async ({ url }) => {
  const limit = clampLogsLimit(url.searchParams.get("limit"));
  return loadLogsPageData({ limit });
};
