import { describe, it, expect } from "vitest";
import { diffSnapshots } from "../../scripts/lib/db-introspect.mjs";

const table = (rows, columns) => ({ rows, columns });

describe("diffSnapshots", () => {
  it("reports no problems for an additive migration", () => {
    const before = { tasks: table(3, ["id", "title"]) };
    const after = {
      tasks: table(3, ["id", "title", "owner"]),
      goals: table(0, ["id"]),
    };
    const { problems } = diffSnapshots(before, after);
    expect(problems).toEqual([]);
  });

  it("flags deleted rows", () => {
    const before = { tasks: table(10, ["id"]) };
    const after = { tasks: table(7, ["id"]) };
    const { problems } = diffSnapshots(before, after);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("lost 3 row(s)");
  });

  it("flags a dropped table and counts its rows as lost", () => {
    const before = { tasks: table(5, ["id"]), legacy: table(42, ["id"]) };
    const after = { tasks: table(5, ["id"]) };
    const { problems } = diffSnapshots(before, after);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('table "legacy" was dropped');
    expect(problems[0]).toContain("42 row(s) lost");
  });

  it("flags a dropped column even when the row count is unchanged", () => {
    const before = { tasks: table(8, ["id", "title", "owner"]) };
    const after = { tasks: table(8, ["id", "title"]) };
    const { problems, rows } = diffSnapshots(before, after);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('column "tasks"."owner" was dropped');
    expect(rows[0].droppedColumns).toEqual(["owner"]);
  });

  it("reports multiple problems together", () => {
    const before = { tasks: table(10, ["id", "owner"]), notes: table(4, ["id"]) };
    const after = { tasks: table(9, ["id"]) };
    const { problems } = diffSnapshots(before, after);
    // tasks lost a row, tasks dropped a column, notes dropped entirely.
    expect(problems).toHaveLength(3);
  });

  it("treats a brand-new table as additive, not a problem", () => {
    const before = {};
    const after = { tasks: table(0, ["id"]) };
    const { problems, rows } = diffSnapshots(before, after);
    expect(problems).toEqual([]);
    expect(rows[0].kind).toBe("added");
  });
});
