import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { anonClient } from "../../src/db/anon-client.js";
import { setQueue, type SetQueueEntry } from "../../src/db/helpers/index.js";
import {
  closeDb,
  db,
  expectPgCode,
  insertTask,
  resetDbData,
} from "./db-test-utils.js";

type QueueRow = {
  id: string;
  queue_rank: number | null;
  queue_rationale: string | null;
  queue_ranked_at: Date | string | null;
};

type ActivityRow = {
  event_type: string;
  summary: string;
  payload: {
    rank?: number | null;
    previousRank?: number | null;
    rationale?: string | null;
  };
};

describe.sequential("queue write DB goldens", () => {
  beforeEach(async () => {
    await resetDbData();
  });

  afterAll(async () => {
    await closeDb();
  });

  async function queueRows(): Promise<QueueRow[]> {
    const rows = await db.execute<QueueRow & Record<string, unknown>>(sql`
      SELECT id, queue_rank, queue_rationale, queue_ranked_at
      FROM tasks
      WHERE queue_rank IS NOT NULL
      ORDER BY queue_rank ASC, id ASC
    `);
    return rows as unknown as QueueRow[];
  }

  async function taskQueueRow(taskId: string): Promise<QueueRow> {
    const rows = await db.execute<QueueRow & Record<string, unknown>>(sql`
      SELECT id, queue_rank, queue_rationale, queue_ranked_at
      FROM tasks
      WHERE id = ${taskId}
    `);
    return (rows as unknown as QueueRow[])[0];
  }

  async function activityRows(taskId: string): Promise<ActivityRow[]> {
    const rows = await db.execute<ActivityRow & Record<string, unknown>>(sql`
      SELECT event_type, summary, payload
      FROM task_activities
      WHERE task_id = ${taskId}
      ORDER BY occurred_at ASC, id ASC
    `);
    return rows as unknown as ActivityRow[];
  }

  async function expectPgViolation(
    code: string,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    await expect(fn()).rejects.toSatisfy((err: unknown) => {
      expectPgCode(err, code);
      return true;
    });
  }

  function entry(taskId: string, rank: number, rationale: string): SetQueueEntry {
    return { taskId, rank, rationale };
  }

  it("replaces the full queue atomically; the second list is the exact final list", async () => {
    const a = await insertTask({ title: "Queue replace A" });
    const b = await insertTask({ title: "Queue replace B" });
    const c = await insertTask({ title: "Queue replace C" });
    const d = await insertTask({ title: "Queue replace D" });

    await setQueue(
      [
        entry(a, 1, "first pass A"),
        entry(b, 2, "first pass B"),
        entry(c, 3, "first pass C"),
      ],
      new Date("2026-06-11T18:00:00.000Z"),
    );
    await setQueue(
      [entry(c, 1, "second pass C"), entry(d, 2, "second pass D")],
      new Date("2026-06-11T18:05:00.000Z"),
    );

    expect(await queueRows()).toMatchObject([
      { id: c, queue_rank: 1, queue_rationale: "second pass C" },
      { id: d, queue_rank: 2, queue_rationale: "second pass D" },
    ]);
    expect((await taskQueueRow(a)).queue_rank).toBeNull();
    expect((await taskQueueRow(b)).queue_rank).toBeNull();
  });

  it("allows two staying tasks to swap ranks without tripping the unique rank index", async () => {
    const a = await insertTask({ title: "Queue swap A" });
    const b = await insertTask({ title: "Queue swap B" });

    await setQueue(
      [entry(a, 1, "A first"), entry(b, 2, "B second")],
      new Date("2026-06-11T18:10:00.000Z"),
    );
    await setQueue(
      [entry(b, 1, "B now first"), entry(a, 2, "A now second")],
      new Date("2026-06-11T18:11:00.000Z"),
    );

    expect(await queueRows()).toMatchObject([
      { id: b, queue_rank: 1, queue_rationale: "B now first" },
      { id: a, queue_rank: 2, queue_rationale: "A now second" },
    ]);
  });

  it("restamps queue_ranked_at on no-change replace without adding activity", async () => {
    const taskId = await insertTask({ title: "Queue no-op restamp" });
    const firstRankedAt = new Date("2026-06-11T18:20:00.000Z");
    const secondRankedAt = new Date("2026-06-11T18:25:00.000Z");

    await setQueue([entry(taskId, 1, "same rationale")], firstRankedAt);
    expect(await activityRows(taskId)).toHaveLength(1);

    await setQueue([entry(taskId, 1, "same rationale")], secondRankedAt);

    const row = await taskQueueRow(taskId);
    expect(row.queue_rank).toBe(1);
    expect(row.queue_rationale).toBe("same rationale");
    expect(new Date(row.queue_ranked_at!).toISOString()).toBe(secondRankedAt.toISOString());
    expect(await activityRows(taskId)).toHaveLength(1);
  });

  it("serializes concurrent replacements with an advisory lock into one coherent final list", async () => {
    const a = await insertTask({ title: "Concurrent queue A" });
    const b = await insertTask({ title: "Concurrent queue B" });
    const c = await insertTask({ title: "Concurrent queue C" });
    const d = await insertTask({ title: "Concurrent queue D" });
    const rankedAtOne = new Date("2026-06-11T18:30:00.000Z");
    const rankedAtTwo = new Date("2026-06-11T18:31:00.000Z");

    await Promise.all([
      setQueue([entry(a, 1, "one A"), entry(b, 2, "one B")], rankedAtOne),
      setQueue([entry(c, 1, "two C"), entry(d, 2, "two D")], rankedAtTwo),
    ]);

    const rows = await queueRows();
    const finalIds = rows.map((row) => row.id);
    const finalRankedAt = [
      ...new Set(rows.map((row) => new Date(row.queue_ranked_at!).toISOString())),
    ];

    expect(rows.map((row) => row.queue_rank)).toEqual([1, 2]);
    expect(finalRankedAt).toHaveLength(1);
    expect(
      (finalIds[0] === a && finalIds[1] === b) ||
        (finalIds[0] === c && finalIds[1] === d),
    ).toBe(true);
    expect(finalRankedAt[0] === rankedAtOne.toISOString() || finalRankedAt[0] === rankedAtTwo.toISOString()).toBe(true);
  });

  it("records queue activity payloads in the same transaction as queue field writes", async () => {
    const taskId = await insertTask({ title: "Queue activity payload" });
    const rankedAt = new Date("2026-06-11T18:40:00.000Z");

    await db.transaction(async (tx) => {
      await setQueue([entry(taskId, 1, "activity rationale")], rankedAt, { tx });

      const inTxTask = await tx.execute<QueueRow & Record<string, unknown>>(sql`
        SELECT queue_rank, queue_rationale, queue_ranked_at
        FROM tasks
        WHERE id = ${taskId}
      `);
      const inTxActivity = await tx.execute<ActivityRow & Record<string, unknown>>(sql`
        SELECT event_type, summary, payload
        FROM task_activities
        WHERE task_id = ${taskId}
      `);

      expect((inTxTask as unknown as QueueRow[])[0]).toMatchObject({
        queue_rank: 1,
        queue_rationale: "activity rationale",
      });
      expect((inTxActivity as unknown as ActivityRow[])[0]).toMatchObject({
        event_type: "task_queue_changed",
        summary: "Queued at #1 - activity rationale",
        payload: {
          rank: 1,
          previousRank: null,
          rationale: "activity rationale",
        },
      });
    });

    await db.transaction(async (tx) => {
      await setQueue(
        [entry(taskId, 2, "moved rationale")],
        new Date("2026-06-11T18:41:00.000Z"),
        { tx },
      );
      const rows = await tx.execute<ActivityRow & Record<string, unknown>>(sql`
        SELECT event_type, payload
        FROM task_activities
        WHERE task_id = ${taskId}
        ORDER BY occurred_at ASC, id ASC
      `);
      const moved = (rows as unknown as ActivityRow[]).find(
        (row) => row.payload.rank === 2,
      );
      expect(moved?.payload).toMatchObject({
        rank: 2,
        previousRank: 1,
        rationale: "moved rationale",
      });
      throw new Error("rollback queue move");
    }).catch((error: unknown) => {
      expect((error as Error).message).toBe("rollback queue move");
    });

    const rowAfterRollback = await taskQueueRow(taskId);
    expect(rowAfterRollback.queue_rank).toBe(1);
    expect(rowAfterRollback.queue_rationale).toBe("activity rationale");
    expect(await activityRows(taskId)).toHaveLength(1);
  });

  it("never bumps updated_at for entering, moving, or leaving tasks (ISS-001)", async () => {
    const a = await insertTask({ title: "Updated-at probe A" });
    const b = await insertTask({ title: "Updated-at probe B" });

    async function updatedAt(taskId: string): Promise<string> {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT updated_at FROM tasks WHERE id = ${taskId}
      `);
      return new Date(
        (rows as unknown as Array<{ updated_at: Date | string }>)[0].updated_at,
      ).toISOString();
    }

    const aBefore = await updatedAt(a);
    const bBefore = await updatedAt(b);

    // a and b enter the queue.
    await setQueue(
      [entry(a, 1, "enter A"), entry(b, 2, "enter B")],
      new Date("2026-06-11T18:55:00.000Z"),
    );
    // a moves, b leaves.
    await setQueue([entry(a, 2, "move A")], new Date("2026-06-11T18:56:00.000Z"));
    // a leaves via clear.
    await setQueue([], new Date("2026-06-11T18:57:00.000Z"));

    expect(await updatedAt(a)).toBe(aBefore);
    expect(await updatedAt(b)).toBe(bBefore);
  });

  it("rejects invalid queue constraints at the database layer", async () => {
    const a = await insertTask({ title: "Constraint A" });
    const b = await insertTask({ title: "Constraint B" });

    await expectPgViolation("23514", () =>
      setQueue([entry(a, 0, "rank zero")], new Date("2026-06-11T18:50:00.000Z")),
    );
    await expectPgViolation("23514", () =>
      setQueue([entry(a, 6, "rank six")], new Date("2026-06-11T18:51:00.000Z")),
    );
    await expectPgViolation("23505", () =>
      setQueue(
        [entry(a, 1, "duplicate one"), entry(b, 1, "duplicate two")],
        new Date("2026-06-11T18:52:00.000Z"),
      ),
    );
    await expectPgViolation("23514", () =>
      setQueue(
        [entry(a, 1, "x".repeat(201))],
        new Date("2026-06-11T18:53:00.000Z"),
      ),
    );
    await expectPgViolation("23514", () =>
      setQueue(
        [{ taskId: a, rank: 1, rationale: null as unknown as string }],
        new Date("2026-06-11T18:54:00.000Z"),
      ),
    );

    expect(await queueRows()).toEqual([]);
  });

  it("exposes queue columns through anon RLS SELECT", async () => {
    const taskId = await insertTask({ title: "Anon queue read" });
    const rankedAt = new Date("2026-06-11T19:00:00.000Z");
    await setQueue([entry(taskId, 1, "visible to anon")], rankedAt);

    const result = await anonClient()
      .from("tasks")
      .select("id,queue_rank,queue_rationale,queue_ranked_at")
      .eq("id", taskId)
      .single();

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      id: taskId,
      queue_rank: 1,
      queue_rationale: "visible to anon",
    });
    expect(new Date(result.data!.queue_ranked_at as string).toISOString()).toBe(
      rankedAt.toISOString(),
    );
  });

  it("keeps both derived task views selectable with queue columns", async () => {
    await insertTask({ title: "Eligible queue view task", status: "triage" });
    const done = await insertTask({ title: "Recent win queue view task", status: "done" });
    await db.execute(sql`
      UPDATE tasks
      SET completed_at = now()
      WHERE id = ${done}
    `);

    const eligible = await db.execute<QueueRow & Record<string, unknown>>(sql`
      SELECT id, queue_rank, queue_rationale, queue_ranked_at
      FROM v_eligible_for_prioritization
      LIMIT 1
    `);
    const recentWins = await db.execute<QueueRow & Record<string, unknown>>(sql`
      SELECT id, queue_rank, queue_rationale, queue_ranked_at
      FROM v_recent_wins
      LIMIT 1
    `);

    expect((eligible as unknown as QueueRow[]).length).toBeGreaterThan(0);
    expect((recentWins as unknown as QueueRow[]).length).toBeGreaterThan(0);
  });
});
