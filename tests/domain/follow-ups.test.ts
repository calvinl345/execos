import { describe, expect, it } from "vitest";
import {
  defaultFollowUpDate,
  dueFollowUpTasks,
  followUpAfterDueWarning,
  followUpSurfaceVerb,
  formatDraftContextBlock,
  groupFollowUpsByPerson,
  resolveOwnerToTeamSlug,
  type FollowUpTaskLike,
} from "../../src/domain/follow-ups.js";

const now = new Date("2026-06-07T12:00:00.000Z");

function task(partial: Partial<FollowUpTaskLike> & Pick<FollowUpTaskLike, "id">): FollowUpTaskLike {
  return {
    title: `Task ${partial.id}`,
    status: "in_progress",
    owner: "me",
    dueDate: null,
    followUpDate: null,
    ...partial,
  };
}

describe("domain/follow-ups due set", () => {
  it("returns non-terminal tasks whose follow-up date has arrived", () => {
    const rows = dueFollowUpTasks(
      [
        task({ id: "KS-001", owner: "Elena", followUpDate: new Date("2026-06-07T11:00:00.000Z") }),
        task({ id: "KS-002", followUpDate: new Date("2026-06-08T11:00:00.000Z") }),
        task({ id: "KS-003", owner: "Elena", status: "done", followUpDate: new Date("2026-06-06T11:00:00.000Z") }),
        task({ id: "KS-004", owner: "Elena", status: "cancelled", followUpDate: new Date("2026-06-06T11:00:00.000Z") }),
        task({ id: "KS-005", followUpDate: null }),
      ],
      now,
    );

    expect(rows.map((row) => row.id)).toEqual(["KS-001"]);
  });

  it("does not treat self-owned snoozes as delegated follow-ups", () => {
    const rows = dueFollowUpTasks(
      [
        task({
          id: "KS-SELF",
          owner: "me",
          followUpDate: new Date("2026-06-07T11:00:00.000Z"),
          snoozedUntil: new Date("2026-06-07T11:00:00.000Z"),
        }),
      ],
      now,
    );

    expect(rows).toEqual([]);
  });

  it("defer semantics make a follow-up leave the due set and return on its new date", () => {
    const deferred = task({
      id: "KS-010",
      owner: "Elena",
      followUpDate: new Date("2026-06-14T12:00:00.000Z"),
    });

    expect(dueFollowUpTasks([deferred], now)).toEqual([]);
    expect(dueFollowUpTasks([deferred], new Date("2026-06-14T12:00:00.000Z")).map((row) => row.id)).toEqual(["KS-010"]);
  });

  it("surfaces an overdue Elena blocker as a follow-up item", () => {
    const rows = dueFollowUpTasks(
      [
        task({
          id: "KS-020",
          title: "Unblock client launch",
          owner: "Elena",
          status: "blocked",
          dueDate: new Date("2026-06-06T12:00:00.000Z"),
          followUpDate: new Date("2026-06-06T12:00:00.000Z"),
        }),
      ],
      now,
    );

    expect(rows).toHaveLength(1);
    expect(followUpSurfaceVerb(rows[0])).toBe("follow up with Elena");
  });
});

describe("domain/follow-ups surface verb", () => {
  it("frames delegated work as following up with the owner", () => {
    expect(followUpSurfaceVerb({ owner: "Noah" })).toBe("follow up with Noah");
  });

  it("keeps self-owned snoozes out of follow-up copy", () => {
    expect(followUpSurfaceVerb({ owner: null })).toBe("follow up with unassigned");
  });
});

describe("domain/follow-ups default cadence", () => {
  it("chooses the midpoint between now and a far due date", () => {
    const chosen = defaultFollowUpDate({
      now,
      dueDate: new Date("2026-06-21T12:00:00.000Z"),
    });

    expect(chosen.toISOString()).toBe("2026-06-14T12:00:00.000Z");
  });

  it("falls back to tomorrow when the midpoint is less than two days away", () => {
    const chosen = defaultFollowUpDate({
      now,
      dueDate: new Date("2026-06-09T00:00:00.000Z"),
    });

    expect(chosen.toISOString()).toBe("2026-06-08T12:00:00.000Z");
  });

  it("falls back to one week out when there is no due date", () => {
    const chosen = defaultFollowUpDate({ now, dueDate: null });

    expect(chosen.toISOString()).toBe("2026-06-14T12:00:00.000Z");
  });
});

describe("domain/follow-ups grouping and draft context", () => {
  it("groups due follow-ups by person and sorts each group by task id", () => {
    const grouped = groupFollowUpsByPerson([
      task({ id: "KS-003", owner: "Grace" }),
      task({ id: "KS-001", owner: "Noah" }),
      task({ id: "KS-002", owner: "Grace" }),
    ]);

    expect(grouped).toEqual([
      { person: "Grace", items: [expect.objectContaining({ id: "KS-002" }), expect.objectContaining({ id: "KS-003" })] },
      { person: "Noah", items: [expect.objectContaining({ id: "KS-001" })] },
    ]);
  });

  it("formats a per-person context block with dates, expectations, and last contact", () => {
    const block = formatDraftContextBlock({
      person: "Grace",
      items: [
        {
          ...task({
            id: "KS-010",
            title: "Send client estimate",
            owner: "Grace",
            dueDate: new Date("2026-06-30T12:00:00.000Z"),
            followUpDate: new Date("2026-06-08T12:00:00.000Z"),
          }),
          expectation: "Need the estimate by end of month.",
          lastContact: "Promised first draft last Friday.",
        },
      ],
    });

    expect(block).toContain("## Grace");
    expect(block).toContain("KS-010: Send client estimate");
    expect(block).toContain("Surface verb: follow up with Grace");
    expect(block).toContain("Work due: 2026-06-30");
    expect(block).toContain("Follow-up due: 2026-06-08");
    expect(block).toContain("Need the estimate by end of month.");
    expect(block).toContain("Promised first draft last Friday.");
  });
});

describe("domain/follow-ups warnings", () => {
  it("returns a warning when follow-up is after due date", () => {
    const result = followUpAfterDueWarning({
      followUpDate: new Date("2026-07-01T12:00:00.000Z"),
      dueDate: new Date("2026-06-30T12:00:00.000Z"),
    });

    expect(result.warning).toBe(true);
  });

  it("does not warn without a due date", () => {
    expect(
      followUpAfterDueWarning({
        followUpDate: new Date("2026-07-01T12:00:00.000Z"),
        dueDate: null,
      }),
    ).toEqual({ warning: false });
  });
});

describe("domain/follow-ups owner resolution", () => {
  const team = [
    { slug: "noah", displayName: "Noah Brooks", email: "noah@example.com" },
    { slug: "elena-smith", displayName: "Elena Torres" },
    { slug: "elena-jones", displayName: "Elena Jones" },
  ];

  it("resolves exact slug and unique first-name matches", () => {
    expect(resolveOwnerToTeamSlug("noah", team)).toMatchObject({
      status: "resolved",
      slug: "noah",
    });
  });

  it("returns unresolved instead of silently storing free text", () => {
    expect(resolveOwnerToTeamSlug("Not A Teammate", team)).toEqual({
      status: "unresolved",
      input: "Not A Teammate",
    });
  });

  it("returns ambiguous when a first name matches multiple team rows", () => {
    expect(resolveOwnerToTeamSlug("Elena", team)).toMatchObject({
      status: "ambiguous",
      input: "Elena",
    });
  });
});
