import { describe, expect, it } from "vitest";
import {
  activityEventLabel,
  buildDayAnalysisPrompt,
  gateEventSummary,
  gateLabel,
  groupLogEventsByDay,
  localDayKey,
  mergeLogStreams,
  type LogActivityRow,
  type LogGateEventRow,
} from "../../src/web/lib/utils/logs.js";
import {
  clampLogsLimit,
  DEFAULT_LOGS_LIMIT,
  loadLogsPageData,
  MAX_LOGS_LIMIT,
  type LogsStreams,
} from "../../src/web/lib/server/logs-queries.js";

/** Local-time ISO timestamp so day grouping is timezone-stable in tests. */
function localIso(
  year: number,
  month: number,
  day: number,
  hour = 12,
  minute = 0,
  second = 0,
): string {
  return new Date(year, month - 1, day, hour, minute, second).toISOString();
}

function activity(overrides: Partial<LogActivityRow> = {}): LogActivityRow {
  return {
    id: "ACT-1",
    task_id: "KS-001",
    event_type: "task_status_changed",
    summary: "Status changed from triage to in progress",
    actor_type: "agent",
    actor_label: "ExecOS agent",
    source: "cli",
    occurred_at: localIso(2026, 6, 10, 9),
    payload: { from_status: "triage", to_status: "in_progress" },
    schema_version: 1,
    ...overrides,
  };
}

function gateEvent(overrides: Partial<LogGateEventRow> = {}): LogGateEventRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    occurred_at: localIso(2026, 6, 10, 10),
    gate: "dedup",
    operation: "create",
    outcome: "blocked",
    task_id: null,
    surface: "cli",
    justification: null,
    input_fingerprint: "abc123",
    detail: { matched_on: "title" },
    ...overrides,
  };
}

describe("logs merge ordering", () => {
  it("merges both streams chronologically descending", () => {
    const events = mergeLogStreams(
      [
        activity({ id: "ACT-old", occurred_at: localIso(2026, 6, 9, 8) }),
        activity({ id: "ACT-new", occurred_at: localIso(2026, 6, 10, 11) }),
      ],
      [
        gateEvent({ id: "g-mid", occurred_at: localIso(2026, 6, 10, 9, 30) }),
        gateEvent({ id: "g-oldest", occurred_at: localIso(2026, 6, 8, 23) }),
      ],
      50,
    );

    expect(events.map((e) => e.id)).toEqual(["ACT-new", "g-mid", "ACT-old", "g-oldest"]);
    expect(events.map((e) => e.kind)).toEqual(["activity", "gate", "activity", "gate"]);
  });

  it("breaks timestamp ties deterministically: activities first, then by id", () => {
    const at = localIso(2026, 6, 10, 9);
    const events = mergeLogStreams(
      [activity({ id: "ACT-b", occurred_at: at }), activity({ id: "ACT-a", occurred_at: at })],
      [gateEvent({ id: "g-1", occurred_at: at })],
      50,
    );
    expect(events.map((e) => e.id)).toEqual(["ACT-a", "ACT-b", "g-1"]);
  });

  it("applies the bounded window after merging", () => {
    const events = mergeLogStreams(
      [
        activity({ id: "ACT-1", occurred_at: localIso(2026, 6, 10, 12) }),
        activity({ id: "ACT-2", occurred_at: localIso(2026, 6, 10, 10) }),
      ],
      [gateEvent({ id: "g-1", occurred_at: localIso(2026, 6, 10, 11) })],
      2,
    );
    expect(events.map((e) => e.id)).toEqual(["ACT-1", "g-1"]);
  });

  it("carries actor and surface attribution per record type", () => {
    const [act, gate] = mergeLogStreams(
      [activity({ source: "dashboard", actor_label: "ExecOS agent" })],
      [gateEvent({ surface: "web", occurred_at: localIso(2026, 6, 10, 8) })],
      10,
    );
    expect(act.actor).toBe("ExecOS agent");
    expect(act.surface).toBe("dashboard");
    expect(gate.actor).toBe("n/a");
    expect(gate.surface).toBe("web");
  });
});

describe("logs day grouping", () => {
  it("groups merged events into local calendar days, newest day first", () => {
    const events = mergeLogStreams(
      [
        activity({ id: "ACT-1", occurred_at: localIso(2026, 6, 10, 9) }),
        activity({ id: "ACT-2", occurred_at: localIso(2026, 6, 9, 23, 59) }),
      ],
      [
        gateEvent({ id: "g-1", occurred_at: localIso(2026, 6, 10, 0, 0, 1) }),
        gateEvent({ id: "g-2", occurred_at: localIso(2026, 6, 7, 12) }),
      ],
      50,
    );
    const days = groupLogEventsByDay(events);

    expect(days.map((d) => d.key)).toEqual(["2026-06-10", "2026-06-09", "2026-06-07"]);
    expect(days[0].events.map((e) => e.id)).toEqual(["ACT-1", "g-1"]);
    expect(days[1].events.map((e) => e.id)).toEqual(["ACT-2"]);
    expect(days[2].events.map((e) => e.id)).toEqual(["g-2"]);
  });

  it("splits midnight-adjacent events into the correct local days", () => {
    const justBeforeMidnight = localIso(2026, 6, 9, 23, 59, 59);
    const justAfterMidnight = localIso(2026, 6, 10, 0, 0, 0);
    expect(localDayKey(justBeforeMidnight)).toBe("2026-06-09");
    expect(localDayKey(justAfterMidnight)).toBe("2026-06-10");
  });
});

describe("logs labels and summaries", () => {
  it("labels activity event types legibly, including unknown types", () => {
    expect(activityEventLabel("task_status_changed")).toBe("Status changed");
    expect(activityEventLabel("task_followed_up")).toBe("Followed up");
    expect(activityEventLabel("task_future_event")).toBe("Future event");
  });

  it("labels gates, including unknown gates", () => {
    expect(gateLabel("dedup")).toBe("Duplicate gate");
    expect(gateLabel("wip_cap")).toBe("WIP cap gate");
    expect(gateLabel("future_gate")).toBe("Future gate");
  });

  it("summarizes gate events with task id and justification when present", () => {
    expect(gateEventSummary(gateEvent())).toBe("Blocked create");
    expect(
      gateEventSummary(
        gateEvent({
          outcome: "overridden",
          task_id: "KS-042",
          justification: "intentional re-run",
        }),
      ),
    ).toBe("Overridden create on KS-042; justification: intentional re-run");
  });
});

describe("day analysis prompt", () => {
  it("starts with the analysis instruction and includes the raw JSON events", () => {
    const days = groupLogEventsByDay(
      mergeLogStreams([activity({ id: "ACT-9" })], [gateEvent({ id: "g-9" })], 50),
    );
    const prompt = buildDayAnalysisPrompt(days[0]);

    expect(prompt.startsWith("Please help me analyze what happened this day.")).toBe(true);
    expect(prompt).toContain(days[0].label);
    expect(prompt).toContain("2 events");

    const jsonStart = prompt.indexOf("[");
    const records = JSON.parse(prompt.slice(jsonStart)) as Record<string, unknown>[];
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.record_type)).toEqual(["gate_event", "task_activity"]);
    expect(records[1].id).toBe("ACT-9");
    expect(records[0].input_fingerprint).toBe("abc123");
  });
});

describe("loadLogsPageData (mocked anon reads)", () => {
  function fakeDeps(streams: Partial<LogsStreams>) {
    const calls: number[] = [];
    return {
      calls,
      deps: {
        async fetchStreams(limit: number): Promise<LogsStreams> {
          calls.push(limit);
          return {
            activities: [],
            gateEvents: [],
            activitiesTotal: 0,
            gateEventsTotal: 0,
            ...streams,
          };
        },
      },
    };
  }

  it("merges, groups, and reports an exact bounded-window indicator", async () => {
    const { deps, calls } = fakeDeps({
      activities: [
        activity({ id: "ACT-1", occurred_at: localIso(2026, 6, 10, 9) }),
        activity({ id: "ACT-2", occurred_at: localIso(2026, 6, 9, 9) }),
      ],
      gateEvents: [gateEvent({ id: "g-1", occurred_at: localIso(2026, 6, 10, 10) })],
      activitiesTotal: 40,
      gateEventsTotal: 10,
    });

    const data = await loadLogsPageData({ limit: 3 }, deps);

    expect(calls).toEqual([3]);
    expect(data.shownCount).toBe(3);
    expect(data.totalCount).toBe(50);
    expect(data.activitiesTotal).toBe(40);
    expect(data.gateEventsTotal).toBe(10);
    expect(data.hasMore).toBe(true);
    expect(data.nextLimit).toBeGreaterThan(3);
    expect(data.days.map((d) => d.key)).toEqual(["2026-06-10", "2026-06-09"]);
    expect(data.days[0].events.map((e) => e.id)).toEqual(["g-1", "ACT-1"]);
  });

  it("reports no-more when everything fits in the window", async () => {
    const { deps } = fakeDeps({
      activities: [activity()],
      gateEvents: [gateEvent()],
      activitiesTotal: 1,
      gateEventsTotal: 1,
    });

    const data = await loadLogsPageData({ limit: 100 }, deps);

    expect(data.shownCount).toBe(2);
    expect(data.totalCount).toBe(2);
    expect(data.hasMore).toBe(false);
    expect(data.nextLimit).toBeNull();
  });

  it("truncates the merge to the limit even when streams return more", async () => {
    const { deps } = fakeDeps({
      activities: [
        activity({ id: "ACT-1", occurred_at: localIso(2026, 6, 10, 12) }),
        activity({ id: "ACT-2", occurred_at: localIso(2026, 6, 10, 11) }),
      ],
      gateEvents: [
        gateEvent({ id: "g-1", occurred_at: localIso(2026, 6, 10, 11, 30) }),
        gateEvent({ id: "g-2", occurred_at: localIso(2026, 6, 10, 10) }),
      ],
      activitiesTotal: 2,
      gateEventsTotal: 2,
    });

    const data = await loadLogsPageData({ limit: 2 }, deps);

    expect(data.shownCount).toBe(2);
    expect(data.days[0].events.map((e) => e.id)).toEqual(["ACT-1", "g-1"]);
    expect(data.hasMore).toBe(true);
  });

  it("clamps the limit query parameter", () => {
    expect(clampLogsLimit(null)).toBe(DEFAULT_LOGS_LIMIT);
    expect(clampLogsLimit("not-a-number")).toBe(DEFAULT_LOGS_LIMIT);
    expect(clampLogsLimit("0")).toBe(DEFAULT_LOGS_LIMIT);
    expect(clampLogsLimit("-5")).toBe(DEFAULT_LOGS_LIMIT);
    expect(clampLogsLimit("250")).toBe(250);
    expect(clampLogsLimit(String(MAX_LOGS_LIMIT + 1))).toBe(MAX_LOGS_LIMIT);
  });
});
