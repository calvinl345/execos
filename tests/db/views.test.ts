import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, insertTask, resetDbData } from "./db-test-utils.js";

const TASK_VIEW_COLUMNS = [
  "id",
  "title",
  "description",
  "status",
  "priority",
  "category",
  "owner",
  "due_date",
  "follow_up_date",
  "snoozed_until",
  "handoff_state",
  "handoff_copied_at",
  "handoff_last_copied_at",
  "handoff_last_nudge_copied_at",
  "goal_id",
  "created_at",
  "updated_at",
  "completed_at",
  "cancelled_at",
  "last_status_change_at",
  "last_unblocked_at",
  "needs_attention",
  "needs_attention_set_at",
  "needs_attention_reason",
  // change-008: the views project all task columns by construction
  // (qb.select().from(tasks)), so the dedup-gate embedding flows through.
  // Dashboard/CLI consumers select explicit columns and never haul the vector.
  "embedding",
  "hard_deadline",
  "effort",
  "queue_rank",
  "queue_rationale",
  "queue_ranked_at",
];

describe("view contracts", () => {
  beforeEach(async () => {
    await resetDbData();
  });

  async function columnsFor(viewName: string): Promise<string[]> {
    const rows = await db.execute<{ column_name: string } & Record<string, unknown>>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${viewName}
      ORDER BY ordinal_position
    `);
    return (rows as unknown as Array<{ column_name: string }>).map(
      (r) => r.column_name,
    );
  }

  it("v_eligible_for_prioritization exposes stable task column list", async () => {
    await expect(columnsFor("v_eligible_for_prioritization")).resolves.toEqual(
      TASK_VIEW_COLUMNS,
    );
  });

  it("v_recent_wins exposes stable task column list", async () => {
    await expect(columnsFor("v_recent_wins")).resolves.toEqual(TASK_VIEW_COLUMNS);
  });

  it("v_eligible_for_prioritization includes actionable statuses only", async () => {
    const triage = await insertTask({ status: "triage" });
    const review = await insertTask({ status: "review" });
    const done = await insertTask({ status: "done" });
    await db.execute(sql`UPDATE tasks SET completed_at = now() WHERE id = ${done}`);

    const rows = await db.execute<{ id: string } & Record<string, unknown>>(sql`
      SELECT id FROM v_eligible_for_prioritization ORDER BY id
    `);
    const ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(triage);
    expect(ids).not.toContain(review);
    expect(ids).not.toContain(done);
  });

  it("v_recent_wins includes tasks completed in the last 7 days", async () => {
    const done = await insertTask({ status: "done" });
    await db.execute(sql`UPDATE tasks SET completed_at = now() WHERE id = ${done}`);
    const rows = await db.execute<{ id: string } & Record<string, unknown>>(sql`
      SELECT id FROM v_recent_wins
    `);
    expect((rows as unknown as Array<{ id: string }>).map((r) => r.id)).toContain(
      done,
    );
  });
});
