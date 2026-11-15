import { describe, expect, test } from "vitest";
import { FakeTaskRepo } from "../../../src/cli/adapters/fakes.js";
import { drizzleTaskRepo } from "../../../src/cli/adapters/production.js";
import type { TaskRow } from "../../../src/cli/adapters/interfaces.js";

/*
Boundary declaration:
- Mocked: none.
- Faked: FakeTaskRepo for command behavior assertions.
- Real: Drizzle/Postgres TaskRepo adapter shape verified by structural typing only;
  the production adapter is exercised against real Postgres in `tests/integration/db/cli-golden-flows.test.ts`.

Modules under test:
- TaskRepo interface as the command-DI seam introduced in chunk 5.5.
- FakeTaskRepo behavior must match the production adapter's filter / sort / list contract.

change-008 (A14): TaskRepo.create/update were REMOVED from the seam; all task
writes route through src/services/task-operations.ts. The remaining contract is
reads (findById, list, recentNotes, dueFollowUps) plus appendNote. FakeTaskRepo
keeps its rows in a private map with no public mutator, so these tests seed it
through the runtime map directly (TypeScript privacy is compile-time only and
the map is the only storage that exists). If FakeTaskRepo ever grows a public
seeding affordance, switch these helpers to it.
*/

const DEFAULT_TS = new Date("2026-04-25T10:00:00Z");

function makeRow(over: Partial<TaskRow> & { id: string }): TaskRow {
  return {
    id: over.id,
    title: over.title ?? `Task ${over.id}`,
    description: over.description ?? `Long enough description for ${over.id} to satisfy DB CHECK`,
    category: over.category ?? "personal",
    owner: over.owner ?? "me",
    dueDate: over.dueDate ?? null,
    priority: over.priority ?? null,
    status: over.status ?? "triage",
    goalId: over.goalId ?? null,
    needsAttention: over.needsAttention ?? false,
    followUpDate: over.followUpDate ?? null,
    lastStatusChangeAt: over.lastStatusChangeAt ?? DEFAULT_TS,
    createdAt: over.createdAt ?? DEFAULT_TS,
    updatedAt: over.updatedAt ?? DEFAULT_TS,
  } as TaskRow;
}

function seedTask(repo: FakeTaskRepo, over: Partial<TaskRow> & { id: string }): void {
  const row = makeRow(over);
  (repo as unknown as { tasksById: Map<string, TaskRow> }).tasksById.set(row.id, row);
}

describe("TaskRepo.findById", () => {
  test("returns the seeded row by id", async () => {
    const repo = new FakeTaskRepo();
    seedTask(repo, { id: "KS-001", title: "Write tests", priority: "P1" });

    const found = await repo.findById("KS-001");
    expect(found).toMatchObject({
      id: "KS-001",
      title: "Write tests",
      priority: "P1",
      status: "triage",
    });
  });

  test("returns null for unknown id", async () => {
    const repo = new FakeTaskRepo();
    expect(await repo.findById("KS-999")).toBeNull();
  });
});

describe("TaskRepo.dueFollowUps", () => {
  test("returns open tasks whose follow-up date has arrived", async () => {
    const repo = new FakeTaskRepo();
    seedTask(repo, {
      id: "KS-001",
      owner: "noah",
      followUpDate: new Date("2026-06-07T10:00:00.000Z"),
    });
    seedTask(repo, {
      id: "KS-002",
      owner: "noah",
      followUpDate: new Date("2026-06-08T10:00:00.000Z"),
    });
    seedTask(repo, {
      id: "KS-003",
      status: "done",
      followUpDate: new Date("2026-06-06T10:00:00.000Z"),
    });
    seedTask(repo, {
      id: "KS-004",
      owner: "me",
      followUpDate: new Date("2026-06-06T10:00:00.000Z"),
    });

    const rows = await repo.dueFollowUps(new Date("2026-06-07T12:00:00.000Z"));

    expect(rows.map((row) => row.id)).toEqual(["KS-004", "KS-001"]);
  });
});

describe("TaskRepo.list: typed filters apply", () => {
  function seed(): FakeTaskRepo {
    const repo = new FakeTaskRepo();
    seedTask(repo, {
      id: "KS-001",
      priority: "P0",
      status: "in_progress",
      category: "client",
      lastStatusChangeAt: new Date("2026-04-25T10:00:00Z"),
    });
    seedTask(repo, {
      id: "KS-002",
      priority: "P1",
      status: "triage",
      category: "personal",
      goalId: "G-001",
      lastStatusChangeAt: new Date("2026-04-26T10:00:00Z"),
    });
    seedTask(repo, {
      id: "KS-003",
      priority: "P0",
      status: "done",
      category: "business",
      needsAttention: true,
      lastStatusChangeAt: new Date("2026-04-27T10:00:00Z"),
    });
    return repo;
  }

  test("filter by status", async () => {
    const repo = seed();
    const rows = await repo.list({ status: "triage" });
    expect(rows.map((r) => r.id)).toEqual(["KS-002"]);
  });

  test("filter by priority", async () => {
    const repo = seed();
    const rows = await repo.list({ priority: "P0" });
    expect(rows.map((r) => r.id).sort()).toEqual(["KS-001", "KS-003"]);
  });

  test("filter by category", async () => {
    const repo = seed();
    const rows = await repo.list({ category: "personal" });
    expect(rows.map((r) => r.id)).toEqual(["KS-002"]);
  });

  test("filter by goalId", async () => {
    const repo = seed();
    const rows = await repo.list({ goalId: "G-001" });
    expect(rows.map((r) => r.id)).toEqual(["KS-002"]);
  });

  test("filter by needsAttention=true", async () => {
    const repo = seed();
    const rows = await repo.list({ needsAttention: true });
    expect(rows.map((r) => r.id)).toEqual(["KS-003"]);
  });

  test("sort by lastStatusChangeAt desc", async () => {
    const repo = seed();
    const rows = await repo.list();
    expect(rows.map((r) => r.id)).toEqual(["KS-003", "KS-002", "KS-001"]);
  });

  test("limit caps result count", async () => {
    const repo = seed();
    const rows = await repo.list({ limit: 2 });
    expect(rows).toHaveLength(2);
    // Ordering preserved before slice
    expect(rows.map((r) => r.id)).toEqual(["KS-003", "KS-002"]);
  });

  test("combined filters AND together", async () => {
    const repo = seed();
    const rows = await repo.list({ priority: "P0", status: "in_progress" });
    expect(rows.map((r) => r.id)).toEqual(["KS-001"]);
  });
});

describe("TaskRepo.appendNote and recentNotes", () => {
  test("notes accumulate per task; recentNotes returns N most-recent for a task", async () => {
    const repo = new FakeTaskRepo();
    seedTask(repo, { id: "KS-001" });
    await repo.appendNote({
      id: "n-1",
      taskId: "KS-001",
      noteType: "manual",
      content: "first note",
      createdAt: new Date("2026-04-25T10:00:00Z"),
    });
    await repo.appendNote({
      id: "n-2",
      taskId: "KS-001",
      noteType: "status_change",
      content: "second note",
      createdAt: new Date("2026-04-26T10:00:00Z"),
    });
    await repo.appendNote({
      id: "n-3",
      taskId: "KS-001",
      noteType: "manual",
      content: "third note",
      createdAt: new Date("2026-04-27T10:00:00Z"),
    });
    await repo.appendNote({
      id: "n-4",
      taskId: "KS-002",
      noteType: "manual",
      content: "different task",
      createdAt: new Date("2026-04-26T10:00:00Z"),
    });

    const notes = await repo.recentNotes("KS-001", 2);
    expect(notes.map((n) => n.id)).toEqual(["n-3", "n-2"]);

    const all = repo.allNotes();
    expect(all).toHaveLength(4);
  });

  test("recentNotes returns empty array for unknown taskId", async () => {
    const repo = new FakeTaskRepo();
    expect(await repo.recentNotes("KS-999", 5)).toEqual([]);
  });
});

describe("TaskRepo: drizzle production adapter satisfies the interface shape", () => {
  test("every interface method is a function on the production adapter", () => {
    expect(typeof drizzleTaskRepo.findById).toBe("function");
    expect(typeof drizzleTaskRepo.list).toBe("function");
    expect(typeof drizzleTaskRepo.recentNotes).toBe("function");
    expect(typeof drizzleTaskRepo.dueFollowUps).toBe("function");
    expect(typeof drizzleTaskRepo.appendNote).toBe("function");
  });

  test("create/update were removed from the seam (change-008 A14)", () => {
    // Task writes route through src/services/task-operations.ts; the repo
    // seam must not regrow ad-hoc write methods.
    expect((drizzleTaskRepo as unknown as Record<string, unknown>).create).toBeUndefined();
    expect((drizzleTaskRepo as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((new FakeTaskRepo() as unknown as Record<string, unknown>).create).toBeUndefined();
    expect((new FakeTaskRepo() as unknown as Record<string, unknown>).update).toBeUndefined();
  });
});
