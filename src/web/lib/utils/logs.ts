/**
 * Logs page pure logic (W6): merge the two log streams (task_activities and
 * gate_events) into one chronological view, group by local calendar day, and
 * build the per-day "Copy prompt" payload.
 *
 * Calvin's ruling (plan, decision 11): unify at the page, NOT the table.
 * Sources stay separate; this module only assembles the read-side view.
 * Scope is state changes plus gate decisions; reads are never logged.
 *
 * No DB imports here on purpose: this module is fast-suite testable.
 */

/** Raw task_activities row as returned by the anon client (snake_case). */
export interface LogActivityRow {
  id: string;
  task_id: string;
  event_type: string;
  summary: string;
  actor_type: string;
  actor_label: string;
  source: string;
  occurred_at: string;
  payload: Record<string, unknown>;
  schema_version: number;
}

/** Raw gate_events row as returned by the anon client (snake_case). */
export interface LogGateEventRow {
  id: string;
  occurred_at: string;
  gate: string;
  operation: string;
  outcome: string;
  task_id: string | null;
  surface: string;
  justification: string | null;
  input_fingerprint: string | null;
  detail: Record<string, unknown>;
}

export type LogRecordKind = "activity" | "gate";

/** One row in the unified logs view. `raw` is the full source record. */
export interface LogEvent {
  kind: LogRecordKind;
  id: string;
  /** ISO timestamp; merge order key. */
  occurredAt: string;
  /** Human label for the event type (activities) or gate (gate events). */
  name: string;
  /** One-line summary shown on the row. */
  summary: string;
  /** Actor label for activities; "n/a" for gate events (no actor column). */
  actor: string;
  /** Originating surface: activity `source` or gate event `surface`. */
  surface: string;
  taskId: string | null;
  raw: Record<string, unknown>;
}

/** One local-calendar-day section of the logs page. */
export interface LogDay {
  /** Stable local-day key, e.g. "2026-06-10". */
  key: string;
  /** Human label, e.g. "Wed, Jun 10, 2026". */
  label: string;
  /** Events within the day, newest first. */
  events: LogEvent[];
}

const GATE_LABELS: Record<string, string> = {
  dedup: "Duplicate gate",
  owner_not_self: "Owner gate",
  owner_follow_up: "Owner follow-up gate",
  owner_resolution: "Owner resolution gate",
  wip_cap: "WIP cap gate",
  status_transition: "Status transition gate",
  terminal_confirmation: "Terminal confirmation gate",
  dependency_cycle: "Dependency cycle gate",
};

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

/** "task_status_changed" -> "Status changed"; unknown types degrade legibly. */
export function activityEventLabel(eventType: string): string {
  const stripped = eventType.replace(/^task_/, "").replaceAll("_", " ");
  return capitalize(stripped);
}

export function gateLabel(gate: string): string {
  return GATE_LABELS[gate] ?? capitalize(gate.replaceAll("_", " "));
}

/** One-line summary for a gate event, e.g. "Blocked create on KS-12". */
export function gateEventSummary(row: LogGateEventRow): string {
  let summary = `${capitalize(row.outcome)} ${row.operation}`;
  if (row.task_id) summary += ` on ${row.task_id}`;
  if (row.justification) summary += `; justification: ${row.justification}`;
  return summary;
}

export function activityToLogEvent(row: LogActivityRow): LogEvent {
  return {
    kind: "activity",
    id: row.id,
    occurredAt: row.occurred_at,
    name: activityEventLabel(row.event_type),
    summary: row.summary,
    actor: row.actor_label,
    surface: row.source,
    taskId: row.task_id,
    raw: row as unknown as Record<string, unknown>,
  };
}

export function gateEventToLogEvent(row: LogGateEventRow): LogEvent {
  return {
    kind: "gate",
    id: row.id,
    occurredAt: row.occurred_at,
    name: gateLabel(row.gate),
    summary: gateEventSummary(row),
    // gate_events has no actor column; the decision belongs to the gate, and
    // attribution is the surface. Recording an actor is a follow-up if needed.
    actor: "n/a",
    surface: row.surface,
    taskId: row.task_id,
    raw: row as unknown as Record<string, unknown>,
  };
}

/**
 * Merge both streams chronologically descending and apply the bounded
 * window. Each input stream must itself be capped at `limit` rows (newest
 * first) by the caller; the top `limit` merged events are then guaranteed
 * to be globally correct, because the k-th merged event can be at most the
 * k-th newest of its own stream.
 *
 * Ties (identical timestamps) break deterministically: activities before
 * gate events, then by id, so reloading never reshuffles rows.
 */
export function mergeLogStreams(
  activities: LogActivityRow[],
  gateEvents: LogGateEventRow[],
  limit: number,
): LogEvent[] {
  const merged = [
    ...activities.map(activityToLogEvent),
    ...gateEvents.map(gateEventToLogEvent),
  ];
  merged.sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) return b.occurredAt.localeCompare(a.occurredAt);
    if (a.kind !== b.kind) return a.kind === "activity" ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  return merged.slice(0, Math.max(0, limit));
}

/** Local-calendar-day key for a timestamp, e.g. "2026-06-10". */
export function localDayKey(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function localDayLabel(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Group an already merged-descending event list into local-calendar-day
 * sections, newest day first. Input order is preserved within each day.
 */
export function groupLogEventsByDay(events: LogEvent[]): LogDay[] {
  const days: LogDay[] = [];
  const byKey = new Map<string, LogDay>();
  for (const event of events) {
    const key = localDayKey(event.occurredAt);
    let day = byKey.get(key);
    if (!day) {
      day = { key, label: localDayLabel(event.occurredAt), events: [] };
      byKey.set(key, day);
      days.push(day);
    }
    day.events.push(event);
  }
  return days;
}

/**
 * Build the per-day "Copy prompt" clipboard payload: a one-line analysis
 * instruction followed by the day's raw JSON events (newest first), for
 * pasting into Claude Code.
 */
export function buildDayAnalysisPrompt(day: LogDay): string {
  const records = day.events.map((event) => ({
    record_type: event.kind === "activity" ? "task_activity" : "gate_event",
    ...event.raw,
  }));
  return [
    "Please help me analyze what happened this day.",
    "",
    `Day: ${day.label} (${day.key}); ${day.events.length} event${day.events.length === 1 ? "" : "s"}.`,
    "",
    JSON.stringify(records, null, 2),
  ].join("\n");
}
