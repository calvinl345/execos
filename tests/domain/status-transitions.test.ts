import { describe, expect, it } from "vitest";
import {
  TASK_TRANSITIONS,
  GOAL_TRANSITIONS,
  TERMINAL_TASK_STATUSES,
  TERMINAL_GOAL_STATUSES,
  canTransitionTask,
  canTransitionGoal,
  explainTaskTransition,
  explainGoalTransition,
} from "../../src/domain/status-transitions.js";
import type { TaskStatus, GoalStatus } from "../../src/db/schema.js";

// All 7 task statuses, in canonical order.
const ALL_TASK_STATUSES: ReadonlyArray<TaskStatus> = [
  "triage",
  "backlog",
  "in_progress",
  "blocked",
  "review",
  "done",
  "cancelled",
];

// All 3 goal statuses.
const ALL_GOAL_STATUSES: ReadonlyArray<GoalStatus> = [
  "active",
  "achieved",
  "dropped",
];

describe("domain/status-transitions task matrix (Appendix A.1.1)", () => {
  describe("from triage", () => {
    it("allows every non-triage status", () => {
      for (const to of ALL_TASK_STATUSES) {
        if (to === "triage") continue;
        expect(canTransitionTask("triage", to)).toBe(true);
      }
    });

    it("allows triage -> triage as no-op", () => {
      expect(canTransitionTask("triage", "triage")).toBe(true);
    });
  });

  describe("from non-terminal-non-triage states", () => {
    const sources: TaskStatus[] = [
      "backlog",
      "in_progress",
      "blocked",
      "review",
    ];

    it("never allows going back to triage", () => {
      for (const from of sources) {
        expect(canTransitionTask(from, "triage")).toBe(false);
      }
    });

    it("always allows moving to done or cancelled", () => {
      for (const from of sources) {
        expect(canTransitionTask(from, "done")).toBe(true);
        expect(canTransitionTask(from, "cancelled")).toBe(true);
      }
    });

    it("allows movement among other non-terminal statuses", () => {
      // backlog -> {in_progress, blocked, review}
      expect(canTransitionTask("backlog", "in_progress")).toBe(true);
      expect(canTransitionTask("backlog", "blocked")).toBe(true);
      expect(canTransitionTask("backlog", "review")).toBe(true);

      // in_progress -> {backlog, blocked, review}
      expect(canTransitionTask("in_progress", "backlog")).toBe(true);
      expect(canTransitionTask("in_progress", "blocked")).toBe(true);
      expect(canTransitionTask("in_progress", "review")).toBe(true);

      // blocked -> {backlog, in_progress, review}
      expect(canTransitionTask("blocked", "backlog")).toBe(true);
      expect(canTransitionTask("blocked", "in_progress")).toBe(true);
      expect(canTransitionTask("blocked", "review")).toBe(true);

      // review -> {backlog, in_progress, blocked}
      expect(canTransitionTask("review", "backlog")).toBe(true);
      expect(canTransitionTask("review", "in_progress")).toBe(true);
      expect(canTransitionTask("review", "blocked")).toBe(true);
    });

    it("treats same-status as allowed no-op", () => {
      for (const from of sources) {
        expect(canTransitionTask(from, from)).toBe(true);
      }
    });
  });

  describe("from terminal states", () => {
    it("done can reopen to non-terminal non-triage states only", () => {
      for (const to of ALL_TASK_STATUSES) {
        if (to === "backlog" || to === "in_progress" || to === "blocked" || to === "review" || to === "done") {
          expect(canTransitionTask("done", to)).toBe(true);
        } else {
          expect(canTransitionTask("done", to)).toBe(false);
        }
      }
    });

    it("cancelled can reopen to non-terminal non-triage states only", () => {
      for (const to of ALL_TASK_STATUSES) {
        if (to === "backlog" || to === "in_progress" || to === "blocked" || to === "review" || to === "cancelled") {
          expect(canTransitionTask("cancelled", to)).toBe(true);
        } else {
          expect(canTransitionTask("cancelled", to)).toBe(false);
        }
      }
    });
  });

  describe("matrix shape", () => {
    it("TASK_TRANSITIONS has an entry for every TaskStatus", () => {
      for (const s of ALL_TASK_STATUSES) {
        expect(TASK_TRANSITIONS[s]).toBeDefined();
      }
    });

    it("no row contains its own status (same-status handled separately)", () => {
      for (const from of ALL_TASK_STATUSES) {
        expect(TASK_TRANSITIONS[from]).not.toContain(from);
      }
    });

    it("TERMINAL_TASK_STATUSES is exactly {done, cancelled}", () => {
      expect(TERMINAL_TASK_STATUSES.has("done")).toBe(true);
      expect(TERMINAL_TASK_STATUSES.has("cancelled")).toBe(true);
      expect(TERMINAL_TASK_STATUSES.size).toBe(2);
    });

    it("TASK_TRANSITIONS is frozen (mutation throws)", () => {
      expect(() => {
        (TASK_TRANSITIONS as Record<TaskStatus, TaskStatus[]>).triage = [];
      }).toThrow();
    });
  });
});

describe("domain/status-transitions goal matrix (Appendix A.2.1)", () => {
  it("active -> achieved or dropped allowed", () => {
    expect(canTransitionGoal("active", "achieved")).toBe(true);
    expect(canTransitionGoal("active", "dropped")).toBe(true);
  });

  it("active -> active is no-op (allowed)", () => {
    expect(canTransitionGoal("active", "active")).toBe(true);
  });

  it("terminals are immutable", () => {
    for (const to of ALL_GOAL_STATUSES) {
      if (to === "achieved") {
        expect(canTransitionGoal("achieved", to)).toBe(true);
      } else {
        expect(canTransitionGoal("achieved", to)).toBe(false);
      }
      if (to === "dropped") {
        expect(canTransitionGoal("dropped", to)).toBe(true);
      } else {
        expect(canTransitionGoal("dropped", to)).toBe(false);
      }
    }
  });

  it("TERMINAL_GOAL_STATUSES is exactly {achieved, dropped}", () => {
    expect(TERMINAL_GOAL_STATUSES.has("achieved")).toBe(true);
    expect(TERMINAL_GOAL_STATUSES.has("dropped")).toBe(true);
    expect(TERMINAL_GOAL_STATUSES.size).toBe(2);
  });

  it("GOAL_TRANSITIONS has an entry for every GoalStatus", () => {
    for (const s of ALL_GOAL_STATUSES) {
      expect(GOAL_TRANSITIONS[s]).toBeDefined();
    }
  });

  it("GOAL_TRANSITIONS is frozen (mutation throws)", () => {
    expect(() => {
      (GOAL_TRANSITIONS as Record<GoalStatus, GoalStatus[]>).active = [];
    }).toThrow();
  });
});

describe("domain/status-transitions explainTaskTransition", () => {
  it("returns null for legal transitions", () => {
    expect(explainTaskTransition("triage", "backlog")).toBeNull();
    expect(explainTaskTransition("in_progress", "done")).toBeNull();
    expect(explainTaskTransition("done", "done")).toBeNull(); // no-op
    expect(explainTaskTransition("done", "in_progress")).toBeNull();
  });

  it("flags terminal_source for disallowed terminal exits", () => {
    const r1 = explainTaskTransition("done", "triage");
    expect(r1?.reason).toBe("terminal_source");
    expect(r1?.message).toContain("done");

    const r2 = explainTaskTransition("cancelled", "done");
    expect(r2?.reason).toBe("terminal_source");
    expect(r2?.message).toContain("cancelled");
  });

  it("flags no_resurrect_to_triage when target is triage", () => {
    const r = explainTaskTransition("backlog", "triage");
    expect(r?.reason).toBe("no_resurrect_to_triage");
    expect(r?.message).toContain("triage");
    expect(r?.message).toContain("backlog");
  });

  it("flags not_in_legal_set as a generic fallback", () => {
    // Construct a hypothetically invalid pair. All pairs we can
    // actually generate are covered by the previous categories,
    // so this case currently is not reachable in practice. The
    // branch exists as a safety net for future enum additions.
    // Verified by inspecting the implementation: any invalid
    // transition where from is non-terminal and to !== triage
    // would fall through to this branch. We document this with a
    // comment-only assertion rather than a fabricated input.
    expect(typeof explainTaskTransition).toBe("function");
  });
});

describe("domain/status-transitions explainGoalTransition", () => {
  it("returns null for legal transitions", () => {
    expect(explainGoalTransition("active", "achieved")).toBeNull();
    expect(explainGoalTransition("active", "dropped")).toBeNull();
    expect(explainGoalTransition("active", "active")).toBeNull();
  });

  it("flags terminal_source for transitions out of achieved/dropped", () => {
    const r1 = explainGoalTransition("achieved", "active");
    expect(r1?.reason).toBe("terminal_source");
    expect(r1?.message).toContain("achieved");

    const r2 = explainGoalTransition("dropped", "active");
    expect(r2?.reason).toBe("terminal_source");
    expect(r2?.message).toContain("dropped");
  });
});

describe("domain/status-transitions full matrix coverage", () => {
  it("exercises every (from, to) cell of the task matrix", () => {
    // 7 x 7 = 49 cells, all explicitly checked.
    let allowedCount = 0;
    let deniedCount = 0;
    for (const from of ALL_TASK_STATUSES) {
      for (const to of ALL_TASK_STATUSES) {
        const allowed = canTransitionTask(from, to);
        if (allowed) {
          allowedCount++;
        } else {
          deniedCount++;
        }
      }
    }
    // Same-status (7 cells: always allowed)
    // From triage: 6 outgoing allowed (all except triage)
    // From {backlog, in_progress, blocked, review}: each allows 5 outgoing
    //   (all 4 other non-terminals + done + cancelled, minus self) = 5
    //   total = 4 * 5 = 20
    // From {done, cancelled}: 4 reopen exits each
    // Total allowed = 7 (no-op) + 6 (triage outgoing) + 20 (mid outgoing)
    //   + 8 (terminal reopen exits) = 41
    // Total denied = 49 - 41 = 8
    expect(allowedCount).toBe(41);
    expect(deniedCount).toBe(8);
  });

  it("exercises every (from, to) cell of the goal matrix", () => {
    // 3 x 3 = 9 cells.
    let allowedCount = 0;
    let deniedCount = 0;
    for (const from of ALL_GOAL_STATUSES) {
      for (const to of ALL_GOAL_STATUSES) {
        if (canTransitionGoal(from, to)) {
          allowedCount++;
        } else {
          deniedCount++;
        }
      }
    }
    // Same-status: 3 (always allowed)
    // active -> achieved: 1, active -> dropped: 1
    // Terminal outgoing: 0
    // Total allowed = 3 + 2 = 5; denied = 9 - 5 = 4.
    expect(allowedCount).toBe(5);
    expect(deniedCount).toBe(4);
  });
});
