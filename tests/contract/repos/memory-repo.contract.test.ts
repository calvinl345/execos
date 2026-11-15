import { describe, expect, test } from "vitest";
import { FakeMemoryRepo } from "../../../src/cli/adapters/fakes.js";
import { drizzleMemoryRepo } from "../../../src/cli/adapters/production.js";
import type { MemoryInsert } from "../../../src/cli/adapters/interfaces.js";

/*
Boundary declaration:
- Mocked: none.
- Faked: FakeMemoryRepo for command behavior assertions.
- Real: pgvector / search / embedding invariants stay in DB integration tier; production
  adapter shape verified by structural typing only.
*/

const ZERO_VEC: number[] = new Array(3072).fill(0);

function makeMemoryInsert(over: Partial<MemoryInsert> & { id: string; scope: string }): MemoryInsert {
  return {
    id: over.id,
    scope: over.scope,
    content: over.content ?? `content for ${over.id}`,
    applicability: over.applicability ?? `applicability for ${over.id}`,
    contentEmbedding: over.contentEmbedding ?? ZERO_VEC,
    applicabilityEmbedding: over.applicabilityEmbedding ?? ZERO_VEC,
    state: over.state ?? "active",
    supersededById: over.supersededById,
    createdAt: over.createdAt,
    updatedAt: over.updatedAt,
    prunedAt: over.prunedAt,
  };
}

describe("MemoryRepo: round-trip create/findById/update", () => {
  test("create round-trips through findById; update merges patch fields", async () => {
    const repo = new FakeMemoryRepo();
    await repo.create(makeMemoryInsert({ id: "M-001", scope: "clients/acme/billing" }));

    const created = await repo.findById("M-001");
    expect(created).toMatchObject({ id: "M-001", scope: "clients/acme/billing", state: "active" });

    await repo.update("M-001", { state: "superseded", supersededById: "M-002" });
    const updated = await repo.findById("M-001");
    expect(updated).toMatchObject({ id: "M-001", state: "superseded", supersededById: "M-002" });
    // Untouched fields persist
    expect(updated?.scope).toBe("clients/acme/billing");
  });

  test("findById returns null for unknown id", async () => {
    const repo = new FakeMemoryRepo();
    expect(await repo.findById("M-999")).toBeNull();
  });
});

describe("MemoryRepo.list: typed filters apply", () => {
  async function seed(): Promise<FakeMemoryRepo> {
    const repo = new FakeMemoryRepo();
    await repo.create(
      makeMemoryInsert({
        id: "M-001",
        scope: "clients/acme",
        state: "active",
        createdAt: new Date("2026-04-25T10:00:00Z"),
      }),
    );
    await repo.create(
      makeMemoryInsert({
        id: "M-002",
        scope: "clients/acme/billing",
        state: "active",
        createdAt: new Date("2026-04-26T10:00:00Z"),
      }),
    );
    await repo.create(
      makeMemoryInsert({
        id: "M-003",
        scope: "clients/acme-corp",
        state: "active",
        createdAt: new Date("2026-04-27T10:00:00Z"),
      }),
    );
    await repo.create(
      makeMemoryInsert({
        id: "M-004",
        scope: "clients/other",
        state: "superseded",
        createdAt: new Date("2026-04-28T10:00:00Z"),
      }),
    );
    await repo.create(
      makeMemoryInsert({
        id: "M-005",
        scope: "clients/acme/billing/late",
        state: "pruned",
        createdAt: new Date("2026-04-29T10:00:00Z"),
      }),
    );
    return repo;
  }

  test("filter by state", async () => {
    const repo = await seed();
    const active = await repo.list({ state: "active" });
    expect(active.map((m) => m.id).sort()).toEqual(["M-001", "M-002", "M-003"]);
    const pruned = await repo.list({ state: "pruned" });
    expect(pruned.map((m) => m.id)).toEqual(["M-005"]);
  });

  test("exactScope matches only the literal scope", async () => {
    const repo = await seed();
    const rows = await repo.list({ exactScope: "clients/acme" });
    expect(rows.map((m) => m.id)).toEqual(["M-001"]);
  });

  test("scopePrefix is segment-aligned (Appendix A.5): does NOT match clients/acme-corp", async () => {
    const repo = await seed();
    const rows = await repo.list({ scopePrefix: "clients/acme" });
    // Includes exact match plus deeper segments; excludes "clients/acme-corp" (different segment).
    expect(rows.map((m) => m.id).sort()).toEqual(["M-001", "M-002", "M-005"]);
  });

  test("scopePrefix combines with state filter", async () => {
    const repo = await seed();
    const rows = await repo.list({ scopePrefix: "clients/acme", state: "active" });
    expect(rows.map((m) => m.id).sort()).toEqual(["M-001", "M-002"]);
  });

  test("default sort: createdAt descending (newest first)", async () => {
    const repo = await seed();
    const rows = await repo.list();
    expect(rows.map((m) => m.id)).toEqual(["M-005", "M-004", "M-003", "M-002", "M-001"]);
  });

  test("limit caps result count without breaking sort", async () => {
    const repo = await seed();
    const rows = await repo.list({ limit: 2 });
    expect(rows.map((m) => m.id)).toEqual(["M-005", "M-004"]);
  });
});

describe("MemoryRepo: drizzle production adapter satisfies the interface shape", () => {
  test("every interface method is a function on the production adapter", () => {
    expect(typeof drizzleMemoryRepo.findById).toBe("function");
    expect(typeof drizzleMemoryRepo.list).toBe("function");
    expect(typeof drizzleMemoryRepo.create).toBe("function");
    expect(typeof drizzleMemoryRepo.update).toBe("function");
  });
});
