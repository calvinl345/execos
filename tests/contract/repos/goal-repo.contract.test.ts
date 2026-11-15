import { describe, expect, test } from "vitest";
import { FakeGoalRepo, FakeTaskRepo } from "../../../src/cli/adapters/fakes.js";
import { drizzleGoalRepo } from "../../../src/cli/adapters/production.js";
import type { GoalInsert, TaskRow } from "../../../src/cli/adapters/interfaces.js";

/*
Boundary declaration:
- Mocked: none.
- Faked: FakeGoalRepo for command behavior assertions.
- Real: Drizzle/Postgres GoalRepo adapter shape verified by structural typing only;
  the production adapter is exercised against real Postgres in `tests/integration/db/cli-golden-flows.test.ts`.
*/

function makeGoalInsert(over: Partial<GoalInsert> & { id: string }): GoalInsert {
  return {
    id: over.id,
    title: over.title ?? `Goal ${over.id}`,
    description: over.description ?? `Long-enough description for ${over.id} satisfying CHECK length >= 10`,
    quarter: over.quarter ?? "2026-Q2",
    status: over.status ?? "active",
    createdAt: over.createdAt,
    updatedAt: over.updatedAt,
    closedAt: over.closedAt,
  };
}

describe("GoalRepo: round-trip create/findById/update", () => {
  test("create round-trips through findById; update merges patch fields", async () => {
    const repo = new FakeGoalRepo();
    await repo.create(makeGoalInsert({ id: "G-001", title: "Q2 Focus" }));

    const created = await repo.findById("G-001");
    expect(created).toMatchObject({ id: "G-001", title: "Q2 Focus", status: "active", quarter: "2026-Q2" });

    await repo.update("G-001", { status: "achieved", closedAt: new Date("2026-06-30T00:00:00Z") });
    const updated = await repo.findById("G-001");
    expect(updated).toMatchObject({ id: "G-001", status: "achieved" });
    expect(updated?.closedAt).toEqual(new Date("2026-06-30T00:00:00Z"));
    expect(updated?.title).toBe("Q2 Focus");
  });

  test("findById returns null for unknown id", async () => {
    const repo = new FakeGoalRepo();
    expect(await repo.findById("G-999")).toBeNull();
  });
});

describe("GoalRepo.list: typed filters apply", () => {
  async function seed(): Promise<FakeGoalRepo> {
    const repo = new FakeGoalRepo();
    await repo.create(makeGoalInsert({ id: "G-001", quarter: "2026-Q1", status: "achieved" }));
    await repo.create(makeGoalInsert({ id: "G-002", quarter: "2026-Q2", status: "active" }));
    await repo.create(makeGoalInsert({ id: "G-003", quarter: "2026-Q2", status: "active" }));
    await repo.create(makeGoalInsert({ id: "G-004", quarter: "2026-Q2", status: "dropped" }));
    return repo;
  }

  test("filter by status", async () => {
    const repo = await seed();
    const rows = await repo.list({ status: "active" });
    expect(rows.map((r) => r.id).sort()).toEqual(["G-002", "G-003"]);
  });

  test("filter by quarter", async () => {
    const repo = await seed();
    const rows = await repo.list({ quarter: "2026-Q2" });
    expect(rows.map((r) => r.id).sort()).toEqual(["G-002", "G-003", "G-004"]);
  });

  test("combined filters AND together", async () => {
    const repo = await seed();
    const rows = await repo.list({ quarter: "2026-Q2", status: "active" });
    expect(rows.map((r) => r.id).sort()).toEqual(["G-002", "G-003"]);
  });

  test("default sort: id descending (newest-first under KS-/G-NNN convention)", async () => {
    const repo = await seed();
    const rows = await repo.list();
    expect(rows.map((r) => r.id)).toEqual(["G-004", "G-003", "G-002", "G-001"]);
  });

  test("limit caps result count without losing sort order", async () => {
    const repo = await seed();
    const rows = await repo.list({ limit: 2 });
    expect(rows.map((r) => r.id)).toEqual(["G-004", "G-003"]);
  });
});

describe("GoalRepo.linkedTasks", () => {
  test("returns tasks for the requested goal only; optional status filter", async () => {
    const goalRepo = new FakeGoalRepo();
    const taskFixtures: TaskRow[] = [
      {
        id: "KS-001",
        goalId: "G-001",
        status: "in_progress",
        title: "t1",
        description: "task one description",
        category: "personal",
        priority: null,
        owner: "me",
        dueDate: null,
        followUpDate: null,
        snoozedUntil: null,
        handoffState: "not_applicable",
        handoffCopiedAt: null,
        handoffLastCopiedAt: null,
        handoffLastNudgeCopiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        cancelledAt: null,
        lastStatusChangeAt: new Date(),
        lastUnblockedAt: null,
        needsAttention: false,
        needsAttentionSetAt: null,
        needsAttentionReason: null,
        embedding: null,
        hardDeadline: false,
        effort: null,
        queueRank: null,
        queueRationale: null,
        queueRankedAt: null,
      },
      {
        id: "KS-002",
        goalId: "G-001",
        status: "done",
        title: "t2",
        description: "task two description",
        category: "personal",
        priority: null,
        owner: "me",
        dueDate: null,
        followUpDate: null,
        snoozedUntil: null,
        handoffState: "not_applicable",
        handoffCopiedAt: null,
        handoffLastCopiedAt: null,
        handoffLastNudgeCopiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        cancelledAt: null,
        lastStatusChangeAt: new Date(),
        lastUnblockedAt: null,
        needsAttention: false,
        needsAttentionSetAt: null,
        needsAttentionReason: null,
        embedding: null,
        hardDeadline: false,
        effort: null,
        queueRank: null,
        queueRationale: null,
        queueRankedAt: null,
      },
      {
        id: "KS-003",
        goalId: "G-002",
        status: "in_progress",
        title: "t3",
        description: "task three description",
        category: "personal",
        priority: null,
        owner: "me",
        dueDate: null,
        followUpDate: null,
        snoozedUntil: null,
        handoffState: "not_applicable",
        handoffCopiedAt: null,
        handoffLastCopiedAt: null,
        handoffLastNudgeCopiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        cancelledAt: null,
        lastStatusChangeAt: new Date(),
        lastUnblockedAt: null,
        needsAttention: false,
        needsAttentionSetAt: null,
        needsAttentionReason: null,
        embedding: null,
        hardDeadline: false,
        effort: null,
        queueRank: null,
        queueRationale: null,
        queueRankedAt: null,
      },
    ];
    goalRepo.linkedTaskRows.push(...taskFixtures);

    const all = await goalRepo.linkedTasks("G-001");
    expect(all.map((t) => t.id).sort()).toEqual(["KS-001", "KS-002"]);

    const inProgressOnly = await goalRepo.linkedTasks("G-001", { status: "in_progress" });
    expect(inProgressOnly.map((t) => t.id)).toEqual(["KS-001"]);

    const otherGoal = await goalRepo.linkedTasks("G-002");
    expect(otherGoal.map((t) => t.id)).toEqual(["KS-003"]);

    const noGoal = await goalRepo.linkedTasks("G-999");
    expect(noGoal).toEqual([]);
  });

  test("FakeTaskRepo and FakeGoalRepo coexist without cross-state leakage", async () => {
    // Sanity: independent maps; updating one repo does not affect the other's view.
    const goalRepo = new FakeGoalRepo();
    const taskRepo = new FakeTaskRepo();
    await goalRepo.create(makeGoalInsert({ id: "G-001" }));
    expect(await taskRepo.findById("G-001")).toBeNull();
    expect(await goalRepo.findById("G-001")).not.toBeNull();
  });
});

describe("GoalRepo: drizzle production adapter satisfies the interface shape", () => {
  test("every interface method is a function on the production adapter", () => {
    expect(typeof drizzleGoalRepo.findById).toBe("function");
    expect(typeof drizzleGoalRepo.list).toBe("function");
    expect(typeof drizzleGoalRepo.create).toBe("function");
    expect(typeof drizzleGoalRepo.update).toBe("function");
    expect(typeof drizzleGoalRepo.linkedTasks).toBe("function");
  });
});
