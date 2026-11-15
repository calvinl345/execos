/**
 * Logs page data loading (W6) via the Supabase anon client.
 *
 * Reads go through the anon-key path only (R3: RLS-enforced SELECT;
 * the service-role client is forbidden in `src/web/` by ESLint and
 * depcruise). Both streams carry permissive anon SELECT policies:
 * `task_activities_anon_select` (migration 0001) and
 * `gate_events_anon_select` (migration 0005).
 *
 * The window is bounded and explicit: each stream is fetched newest-first
 * capped at `limit`, the merge keeps the newest `limit` overall, and exact
 * totals come back with the same queries so the page can say exactly what
 * is and is not shown (no silent truncation).
 */

import { anonClient } from "../../../db/anon-client.js";
import {
  groupLogEventsByDay,
  mergeLogStreams,
  type LogActivityRow,
  type LogDay,
  type LogGateEventRow,
} from "../utils/logs.js";

export const DEFAULT_LOGS_LIMIT = 200;
export const MAX_LOGS_LIMIT = 2000;
export const LOAD_MORE_STEP = 200;

export interface LogsStreams {
  activities: LogActivityRow[];
  gateEvents: LogGateEventRow[];
  /** Exact row count of task_activities (not just the fetched window). */
  activitiesTotal: number;
  /** Exact row count of gate_events (not just the fetched window). */
  gateEventsTotal: number;
}

export interface LogsQueryDeps {
  /** Fetch both streams, newest first, each capped at `limit` rows. */
  fetchStreams(limit: number): Promise<LogsStreams>;
}

export interface LogsPageData {
  days: LogDay[];
  /** Events actually shown after the bounded merge. */
  shownCount: number;
  /** Exact combined total across both tables. */
  totalCount: number;
  activitiesTotal: number;
  gateEventsTotal: number;
  /** True when older events exist beyond the window. */
  hasMore: boolean;
  /** The applied (clamped) limit. */
  limit: number;
  /** Next limit for the "load more" link; null when everything is shown. */
  nextLimit: number | null;
}

export const productionLogsQueryDeps: LogsQueryDeps = {
  async fetchStreams(limit) {
    const sb = anonClient();
    const [activitiesResp, gateEventsResp] = await Promise.all([
      sb
        .from("task_activities")
        .select("*", { count: "exact" })
        .order("occurred_at", { ascending: false })
        .limit(limit),
      sb
        .from("gate_events")
        .select("*", { count: "exact" })
        .order("occurred_at", { ascending: false })
        .limit(limit),
    ]);
    if (activitiesResp.error) {
      throw new Error(`task_activities: ${activitiesResp.error.message}`);
    }
    if (gateEventsResp.error) {
      throw new Error(`gate_events: ${gateEventsResp.error.message}`);
    }
    return {
      activities: (activitiesResp.data ?? []) as LogActivityRow[],
      gateEvents: (gateEventsResp.data ?? []) as LogGateEventRow[],
      activitiesTotal: activitiesResp.count ?? (activitiesResp.data ?? []).length,
      gateEventsTotal: gateEventsResp.count ?? (gateEventsResp.data ?? []).length,
    };
  },
};

export function clampLogsLimit(raw: string | null): number {
  const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LOGS_LIMIT;
  return Math.min(parsed, MAX_LOGS_LIMIT);
}

export async function loadLogsPageData(
  opts: { limit?: number } = {},
  deps: LogsQueryDeps = productionLogsQueryDeps,
): Promise<LogsPageData> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LOGS_LIMIT, 1), MAX_LOGS_LIMIT);
  const streams = await deps.fetchStreams(limit);

  const events = mergeLogStreams(streams.activities, streams.gateEvents, limit);
  const totalCount = streams.activitiesTotal + streams.gateEventsTotal;
  const hasMore = events.length < totalCount;

  return {
    days: groupLogEventsByDay(events),
    shownCount: events.length,
    totalCount,
    activitiesTotal: streams.activitiesTotal,
    gateEventsTotal: streams.gateEventsTotal,
    hasMore,
    limit,
    nextLimit:
      hasMore && limit < MAX_LOGS_LIMIT
        ? Math.min(limit + LOAD_MORE_STEP, MAX_LOGS_LIMIT)
        : null,
  };
}
