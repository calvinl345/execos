import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  db,
  expectPgCode,
  insertGoal,
  insertMemory,
  insertTask,
  resetDbData,
  testId,
} from "./db-test-utils.js";

describe("database CHECK constraints", () => {
  beforeEach(async () => {
    await resetDbData();
  });

  async function expectCheckViolation(fn: () => Promise<unknown>): Promise<void> {
    await expect(fn()).rejects.toSatisfy((err: unknown) => {
      expectPgCode(err, "23514");
      return true;
    });
  }

  it("rejects short task descriptions", async () => {
    await expectCheckViolation(() => insertTask({ description: "too short" }));
  });

  it("rejects invalid task status", async () => {
    await expectCheckViolation(() => insertTask({ status: "invalid" }));
  });

  it("rejects invalid task priority", async () => {
    await expectCheckViolation(() => insertTask({ priority: "P9" }));
  });

  it("rejects invalid task category", async () => {
    await expectCheckViolation(() => insertTask({ category: "invalid" }));
  });

  it("rejects long needs_attention_reason", async () => {
    await expectCheckViolation(() =>
      insertTask({ needsAttentionReason: "x".repeat(201) }),
    );
  });

  it("rejects short goal descriptions", async () => {
    await expectCheckViolation(() =>
      db.execute(sql`
        INSERT INTO goals (id, title, description, quarter)
        VALUES (${testId("G")}, 'Bad Goal', 'short', '2026-Q2')
      `),
    );
  });

  it("rejects invalid goal quarters", async () => {
    await expectCheckViolation(() =>
      db.execute(sql`
        INSERT INTO goals (id, title, description, quarter)
        VALUES (${testId("G")}, 'Bad Goal', 'A valid description', '2026-Q5')
      `),
    );
  });

  it("rejects invalid goal status", async () => {
    await expectCheckViolation(() =>
      db.execute(sql`
        INSERT INTO goals (id, title, description, quarter, status)
        VALUES (${testId("G")}, 'Bad Goal', 'A valid description', '2026-Q2', 'paused')
      `),
    );
  });

  it("rejects invalid task note types", async () => {
    const taskId = await insertTask();
    await expectCheckViolation(() =>
      db.execute(sql`
        INSERT INTO task_notes (id, task_id, note_type, content, created_by)
        VALUES (${testId("N")}, ${taskId}, 'invalid', 'note', 'agent')
      `),
    );
  });

  it("rejects invalid task note created_by", async () => {
    const taskId = await insertTask();
    await expectCheckViolation(() =>
      db.execute(sql`
        INSERT INTO task_notes (id, task_id, note_type, content, created_by)
        VALUES (${testId("N")}, ${taskId}, 'manual', 'note', 'robot')
      `),
    );
  });

  it("rejects self-blocking task dependency", async () => {
    const taskId = await insertTask();
    await expectCheckViolation(() =>
      db.execute(sql`
        INSERT INTO task_dependencies (id, blocker_task_id, blocked_task_id)
        VALUES (${testId("D")}, ${taskId}, ${taskId})
      `),
    );
  });

  it("rejects invalid document category", async () => {
    await expectCheckViolation(() =>
      db.execute(sql`
        INSERT INTO documents (id, filename, category, storage_path)
        VALUES (${testId("DOC")}, 'x.pdf', 'invalid', 'invalid/x.pdf')
      `),
    );
  });

  it("rejects invalid memory state", async () => {
    await expectCheckViolation(async () => {
      const id = await insertMemory();
      await db.execute(sql`UPDATE memories SET state = 'deleted' WHERE id = ${id}`);
    });
  });

  it("rejects invalid triage_item disposition", async () => {
    await db.execute(sql`INSERT INTO triage_sessions (id) VALUES (${testId("TS")})`);
    const sessions = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM triage_sessions LIMIT 1`,
    );
    const sessionId = (sessions as unknown as Array<{ id: string }>)[0].id;
    await expectCheckViolation(() =>
      db.execute(sql`
        INSERT INTO triage_items (id, session_id, superhuman_message_id, disposition)
        VALUES (${testId("TI")}, ${sessionId}, 'msg-1', 'trash')
      `),
    );
  });

  it("rejects invalid triage_item state", async () => {
    await db.execute(sql`INSERT INTO triage_sessions (id) VALUES (${testId("TS")})`);
    const sessions = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM triage_sessions LIMIT 1`,
    );
    const sessionId = (sessions as unknown as Array<{ id: string }>)[0].id;
    await expectCheckViolation(() =>
      db.execute(sql`
        INSERT INTO triage_items (id, session_id, superhuman_message_id, disposition, state)
        VALUES (${testId("TI")}, ${sessionId}, 'msg-1', 'skipped', 'deleted')
      `),
    );
  });

  it("rejects invalid triage_item superseded_by_action", async () => {
    await db.execute(sql`INSERT INTO triage_sessions (id) VALUES (${testId("TS")})`);
    const sessions = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM triage_sessions LIMIT 1`,
    );
    const sessionId = (sessions as unknown as Array<{ id: string }>)[0].id;
    await expectCheckViolation(() =>
      db.execute(sql`
        INSERT INTO triage_items (
          id, session_id, superhuman_message_id, disposition, superseded_by_action
        ) VALUES (${testId("TI")}, ${sessionId}, 'msg-1', 'skipped', 'system')
      `),
    );
  });

  it("allows valid FK from task to goal", async () => {
    const goalId = await insertGoal();
    const taskId = await insertTask({ id: testId("KS"), goalId });
    await db.execute(sql`UPDATE tasks SET goal_id = ${goalId} WHERE id = ${taskId}`);
    const rows = await db.execute<{ goal_id: string } & Record<string, unknown>>(
      sql`SELECT goal_id FROM tasks WHERE id = ${taskId}`,
    );
    expect((rows as unknown as Array<{ goal_id: string }>)[0].goal_id).toBe(goalId);
  });
});
