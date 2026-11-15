import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  assertNoCycle,
  composeGoalId,
  composeTaskId,
  enforcePZeroWipCap,
  flagAttention,
  clearTaskSnooze,
  deferTask,
  delegateTask,
  recordFollowUp,
  setQueue,
  setTaskEmbedding,
  unflagAttention,
  updateTaskStatus,
  updateTaskFields,
} from "../../src/db/helpers/index.js";
import {
  AppSettingMissingError,
  PZeroWipCapExceededError,
  TaskDependencyCycleError,
  TaskNotFoundError,
} from "../../src/db/errors.js";
import {
  db,
  insertTask,
  resetDbData,
  testId,
} from "./db-test-utils.js";

describe("db TS-layer helpers", () => {
  beforeEach(async () => {
    await resetDbData();
  });

  it("composeTaskId formats sequence with the resolved prefix", async () => {
    const id = await composeTaskId("KS");
    expect(id).toMatch(/^KS-\d{3,}$/);
  });

  it("composeTaskId raises AppSettingMissingError on a malformed prefix", async () => {
    await expect(composeTaskId("bad-prefix")).rejects.toBeInstanceOf(
      AppSettingMissingError,
    );
  });

  it("composeGoalId uses G prefix + goal sequence", async () => {
    const id = await composeGoalId();
    expect(id).toMatch(/^G-\d{3,}$/);
  });

  it("flagAttention sets side-effect fields and is idempotent", async () => {
    const taskId = await insertTask();
    await flagAttention(taskId, "Needs decision");
    const first = await db.execute<{
      needs_attention: boolean;
      needs_attention_set_at: Date;
      needs_attention_reason: string;
    } & Record<string, unknown>>(sql`
      SELECT needs_attention, needs_attention_set_at, needs_attention_reason
      FROM tasks WHERE id = ${taskId}
    `);
    const firstRow = (first as unknown as Array<{
      needs_attention: boolean;
      needs_attention_set_at: Date;
      needs_attention_reason: string;
    }>)[0];
    expect(firstRow.needs_attention).toBe(true);
    expect(firstRow.needs_attention_reason).toBe("Needs decision");
    const firstSetAt = new Date(firstRow.needs_attention_set_at).toISOString();

    await flagAttention(taskId, "Updated reason");
    const second = await db.execute<{
      needs_attention_set_at: Date;
      needs_attention_reason: string;
    } & Record<string, unknown>>(sql`
      SELECT needs_attention_set_at, needs_attention_reason
      FROM tasks WHERE id = ${taskId}
    `);
    const secondRow = (second as unknown as Array<{
      needs_attention_set_at: Date;
      needs_attention_reason: string;
    }>)[0];
    expect(new Date(secondRow.needs_attention_set_at).toISOString()).toBe(firstSetAt);
    expect(secondRow.needs_attention_reason).toBe("Updated reason");
  });

  it("unflagAttention clears side-effect fields", async () => {
    const taskId = await insertTask();
    await flagAttention(taskId, "Needs decision");
    await unflagAttention(taskId);
    const rows = await db.execute<{
      needs_attention: boolean;
      needs_attention_set_at: Date | null;
      needs_attention_reason: string | null;
    } & Record<string, unknown>>(sql`
      SELECT needs_attention, needs_attention_set_at, needs_attention_reason
      FROM tasks WHERE id = ${taskId}
    `);
    const row = (rows as unknown as Array<{
      needs_attention: boolean;
      needs_attention_set_at: Date | null;
      needs_attention_reason: string | null;
    }>)[0];
    expect(row.needs_attention).toBe(false);
    expect(row.needs_attention_set_at).toBeNull();
    expect(row.needs_attention_reason).toBeNull();
  });

  it("flagAttention raises TaskNotFoundError on missing task", async () => {
    await expect(flagAttention("KS-NOPE", "missing")).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );
  });

  it("assertNoCycle permits acyclic edges and rejects cycles", async () => {
    const a = await insertTask({ id: testId("KS") });
    const b = await insertTask({ id: testId("KS") });
    const c = await insertTask({ id: testId("KS") });

    await assertNoCycle(a, b);
    await db.execute(sql`
      INSERT INTO task_dependencies (id, blocker_task_id, blocked_task_id)
      VALUES (${testId("D")}, ${a}, ${b})
    `);
    await assertNoCycle(b, c);
    await db.execute(sql`
      INSERT INTO task_dependencies (id, blocker_task_id, blocked_task_id)
      VALUES (${testId("D")}, ${b}, ${c})
    `);

    await expect(assertNoCycle(c, a)).rejects.toBeInstanceOf(
      TaskDependencyCycleError,
    );
  });

  it("updateTaskStatus updates task and writes status_change audit note atomically", async () => {
    const taskId = await insertTask({ status: "blocked" });
    const result = await updateTaskStatus(taskId, "done", "agent");
    expect(result.fromStatus).toBe("blocked");
    expect(result.toStatus).toBe("done");
    expect(result.noteId).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(result.activityId).toMatch(/^ACT-[A-Za-z0-9_-]{12}$/);

    const taskRows = await db.execute<{
      status: string;
      completed_at: Date | null;
      last_unblocked_at: Date | null;
    } & Record<string, unknown>>(sql`
      SELECT status, completed_at, last_unblocked_at FROM tasks WHERE id = ${taskId}
    `);
    const task = (taskRows as unknown as Array<{
      status: string;
      completed_at: Date | null;
      last_unblocked_at: Date | null;
    }>)[0];
    expect(task.status).toBe("done");
    expect(task.completed_at).not.toBeNull();
    expect(task.last_unblocked_at).not.toBeNull();

    const notes = await db.execute<{ content: string } & Record<string, unknown>>(sql`
      SELECT content FROM task_notes WHERE id = ${result.noteId}
    `);
    expect(JSON.parse((notes as unknown as Array<{ content: string }>)[0].content)).toMatchObject({
      from: "blocked",
      to: "done",
      by: "agent",
    });
    const activities = await db.execute<{ event_type: string; payload: Record<string, unknown> } & Record<string, unknown>>(sql`
      SELECT event_type, payload FROM task_activities WHERE id = ${result.activityId}
    `);
    const activity = (activities as unknown as Array<{ event_type: string; payload: Record<string, unknown> }>)[0];
    expect(activity.event_type).toBe("task_status_changed");
    expect(activity.payload).toMatchObject({
      from_status: "blocked",
      to_status: "done",
    });
  });

  it("updateTaskStatus clears needs-attention metadata for terminal statuses", async () => {
    const doneTaskId = await insertTask({ status: "in_progress" });
    await flagAttention(doneTaskId, "Try out the new dashboard");

    await updateTaskStatus(doneTaskId, "done", "agent");

    const doneRows = await db.execute<{
      needs_attention: boolean;
      needs_attention_set_at: Date | null;
      needs_attention_reason: string | null;
    } & Record<string, unknown>>(sql`
      SELECT needs_attention, needs_attention_set_at, needs_attention_reason
      FROM tasks WHERE id = ${doneTaskId}
    `);
    const done = (doneRows as unknown as Array<{
      needs_attention: boolean;
      needs_attention_set_at: Date | null;
      needs_attention_reason: string | null;
    }>)[0];
    expect(done.needs_attention).toBe(false);
    expect(done.needs_attention_set_at).toBeNull();
    expect(done.needs_attention_reason).toBeNull();

    const cancelledTaskId = await insertTask({ status: "in_progress" });
    await flagAttention(cancelledTaskId, "No longer needed");

    await updateTaskStatus(cancelledTaskId, "cancelled", "agent");

    const cancelledRows = await db.execute<{
      needs_attention: boolean;
      needs_attention_set_at: Date | null;
      needs_attention_reason: string | null;
    } & Record<string, unknown>>(sql`
      SELECT needs_attention, needs_attention_set_at, needs_attention_reason
      FROM tasks WHERE id = ${cancelledTaskId}
    `);
    const cancelled = (cancelledRows as unknown as Array<{
      needs_attention: boolean;
      needs_attention_set_at: Date | null;
      needs_attention_reason: string | null;
    }>)[0];
    expect(cancelled.needs_attention).toBe(false);
    expect(cancelled.needs_attention_set_at).toBeNull();
    expect(cancelled.needs_attention_reason).toBeNull();
  });

  it("updateTaskStatus clears completed_at when a done task is reopened", async () => {
    const taskId = await insertTask({ status: "in_progress" });

    // Drive into done so completed_at is populated.
    await updateTaskStatus(taskId, "done", "agent");
    const doneRows = await db.execute<{
      status: string;
      completed_at: Date | null;
    } & Record<string, unknown>>(sql`
      SELECT status, completed_at FROM tasks WHERE id = ${taskId}
    `);
    const done = (doneRows as unknown as Array<{ status: string; completed_at: Date | null }>)[0];
    expect(done.status).toBe("done");
    expect(done.completed_at).not.toBeNull();

    // Reopen done -> backlog must clear completed_at while still updating the
    // status and bumping last_status_change_at.
    const result = await updateTaskStatus(taskId, "backlog", "agent");
    expect(result.fromStatus).toBe("done");
    expect(result.toStatus).toBe("backlog");

    const reopenedRows = await db.execute<{
      status: string;
      completed_at: Date | null;
      last_status_change_at: Date | null;
    } & Record<string, unknown>>(sql`
      SELECT status, completed_at, last_status_change_at FROM tasks WHERE id = ${taskId}
    `);
    const reopened = (reopenedRows as unknown as Array<{
      status: string;
      completed_at: Date | null;
      last_status_change_at: Date | null;
    }>)[0];
    expect(reopened.status).toBe("backlog");
    expect(reopened.completed_at).toBeNull();
    expect(reopened.last_status_change_at).not.toBeNull();
  });

  it("updateTaskStatus clears cancelled_at when a cancelled task is reopened", async () => {
    const taskId = await insertTask({ status: "in_progress" });

    // Drive into cancelled so cancelled_at is populated.
    await updateTaskStatus(taskId, "cancelled", "agent");
    const cancelledRows = await db.execute<{
      status: string;
      cancelled_at: Date | null;
    } & Record<string, unknown>>(sql`
      SELECT status, cancelled_at FROM tasks WHERE id = ${taskId}
    `);
    const cancelled = (cancelledRows as unknown as Array<{ status: string; cancelled_at: Date | null }>)[0];
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelled_at).not.toBeNull();

    // cancelled -> in_progress must clear cancelled_at.
    const result = await updateTaskStatus(taskId, "in_progress", "agent");
    expect(result.fromStatus).toBe("cancelled");
    expect(result.toStatus).toBe("in_progress");

    const reopenedRows = await db.execute<{
      status: string;
      cancelled_at: Date | null;
    } & Record<string, unknown>>(sql`
      SELECT status, cancelled_at FROM tasks WHERE id = ${taskId}
    `);
    const reopened = (reopenedRows as unknown as Array<{ status: string; cancelled_at: Date | null }>)[0];
    expect(reopened.status).toBe("in_progress");
    expect(reopened.cancelled_at).toBeNull();
  });

  it("updateTaskStatus raises TaskNotFoundError on missing task", async () => {
    await expect(updateTaskStatus("KS-NOPE", "done")).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );
  });

  it("enforcePZeroWipCap raises typed error when cap is already met", async () => {
    await insertTask({ id: testId("KS"), priority: "P0" });
    await insertTask({ id: testId("KS"), priority: "P0" });
    await insertTask({ id: testId("KS"), priority: "P0" });

    await expect(
      db.transaction(async (tx) =>  enforcePZeroWipCap(tx, 3)),
    ).rejects.toBeInstanceOf(PZeroWipCapExceededError);
  });

  it("updateTaskStatus honors passed tx and rolls back row + note atomically", async () => {
    const taskId = await insertTask({ status: "triage" });
    
    // Explicitly throw inside the tx to force rollback
    await expect(
      db.transaction(async (tx) => {
        await updateTaskStatus(taskId, "in_progress", "agent", { tx });
        // Check within transaction that status is updated
        const rows = await tx.execute<{ status: string } & Record<string, unknown>>(
          sql`SELECT status FROM tasks WHERE id = ${taskId}`
        );
        expect((rows as unknown as Array<{ status: string }>)[0].status).toBe("in_progress");
        throw new Error("Force rollback");
      })
    ).rejects.toThrow("Force rollback");

    // Outside transaction, it should be rolled back (status is triage, no note/activity written)
    const rows = await db.execute<{ status: string } & Record<string, unknown>>(
      sql`SELECT status FROM tasks WHERE id = ${taskId}`
    );
    expect((rows as unknown as Array<{ status: string }>)[0].status).toBe("triage");

    const notes = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM task_notes WHERE task_id = ${taskId}`
    );
    expect((notes as unknown as unknown[]).length).toBe(0);
    const activities = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM task_activities WHERE task_id = ${taskId}`
    );
    expect((activities as unknown as unknown[]).length).toBe(0);
  });

  it("updateTaskFields writes exactly one note, no-op writes none, rollback is atomic, missing task throws", async () => {
    const taskId = await insertTask({ title: "Original Title", description: "Original description >= 10 chars" });

    // 1. Writes exactly one note on change
    const result = await updateTaskFields(taskId, { title: "Updated Title" });
    expect(result.changed).toBe(true);
    expect(result.noteId).not.toBe("");
    expect(result.activityIds).toHaveLength(1);

    const notes = await db.execute<{ content: string } & Record<string, unknown>>(
      sql`SELECT content FROM task_notes WHERE task_id = ${taskId}`
    );
    expect((notes as unknown as unknown[]).length).toBe(1);
    expect(JSON.parse((notes as unknown as Array<{ content: string }>)[0].content)).toMatchObject({
      type: "task_fields_updated",
      changes: {
        title: { from: "Original Title", to: "Updated Title" },
      },
    });
    const activities = await db.execute<{ event_type: string; payload: Record<string, unknown> } & Record<string, unknown>>(sql`
      SELECT event_type, payload FROM task_activities WHERE task_id = ${taskId}
    `);
    expect((activities as unknown as Array<{ event_type: string }>)[0].event_type).toBe("task_fields_updated");

    // 2. No-op writes none
    const resultNoop = await updateTaskFields(taskId, { title: "Updated Title" });
    expect(resultNoop.changed).toBe(false);
    expect(resultNoop.noteId).toBe("");
    expect(resultNoop.activityIds).toEqual([]);

    const notesAfterNoop = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM task_notes WHERE task_id = ${taskId}`
    );
    expect((notesAfterNoop as unknown as unknown[]).length).toBe(1); // still 1
    const activitiesAfterNoop = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM task_activities WHERE task_id = ${taskId}`
    );
    expect((activitiesAfterNoop as unknown as unknown[]).length).toBe(1);

    // 3. Rollback is atomic
    await expect(
      db.transaction(async (tx) => {
        await updateTaskFields(taskId, { title: "Rolled back Title" }, { tx });
        throw new Error("Rollback");
      })
    ).rejects.toThrow("Rollback");

    const rows = await db.execute<{ title: string } & Record<string, unknown>>(
      sql`SELECT title FROM tasks WHERE id = ${taskId}`
    );
    expect((rows as unknown as Array<{ title: string }>)[0].title).toBe("Updated Title"); // preserved
    const notesAfterRollback = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM task_notes WHERE task_id = ${taskId}`
    );
    expect((notesAfterRollback as unknown as unknown[]).length).toBe(1); // still 1
    const activitiesAfterRollback = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM task_activities WHERE task_id = ${taskId}`
    );
    expect((activitiesAfterRollback as unknown as unknown[]).length).toBe(1);

    // 4. Missing task throws TaskNotFoundError
    await expect(
      updateTaskFields("KS-NOPE", { title: "No task" })
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  it("setTaskEmbedding preserves updated_at because embeddings are derived data", async () => {
    const taskId = await insertTask();
    const originalUpdatedAt = new Date("2026-01-02T03:04:05.000Z");
    await db.execute(sql`
      UPDATE tasks SET updated_at = ${originalUpdatedAt.toISOString()}
      WHERE id = ${taskId}
    `);

    await setTaskEmbedding(taskId, Array.from({ length: 3072 }, () => 0.25));

    const rows = await db.execute<{
      updated_at: Date;
      embedding_text: string;
    } & Record<string, unknown>>(sql`
      SELECT updated_at, embedding::text AS embedding_text
      FROM tasks WHERE id = ${taskId}
    `);
    const row = (rows as unknown as Array<{
      updated_at: Date;
      embedding_text: string;
    }>)[0];
    expect(new Date(row.updated_at).toISOString()).toBe(originalUpdatedAt.toISOString());
    expect(row.embedding_text).toContain("0.25");
  });

  it("flagAttention and unflagAttention write notes on real change, silent suppresses, set_at preserved on re-flag", async () => {
    const taskId = await insertTask();

    // 1. flagAttention writes note on real change
    await flagAttention(taskId, "Reason 1");
    const notes = await db.execute<{ content: string } & Record<string, unknown>>(
      sql`SELECT content FROM task_notes WHERE task_id = ${taskId}`
    );
    expect((notes as unknown as unknown[]).length).toBe(1);
    expect(JSON.parse((notes as unknown as Array<{ content: string }>)[0].content)).toMatchObject({
      type: "task_attention_flagged",
      reason: "Reason 1",
    });
    const activities = await db.execute<{ event_type: string; payload: Record<string, unknown> } & Record<string, unknown>>(sql`
      SELECT event_type, payload FROM task_activities WHERE task_id = ${taskId}
    `);
    expect((activities as unknown as Array<{ event_type: string }>)[0].event_type).toBe("task_attention_flagged");

    // 2. re-flag no-op (boolean doesn't change) writes no new note
    await flagAttention(taskId, "Reason 2");
    const notesAfterReflag = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM task_notes WHERE task_id = ${taskId}`
    );
    expect((notesAfterReflag as unknown as unknown[]).length).toBe(1); // still 1
    const activitiesAfterReflag = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM task_activities WHERE task_id = ${taskId}`
    );
    expect((activitiesAfterReflag as unknown as unknown[]).length).toBe(1);

    // 3. needs_attention_set_at is preserved on re-flag
    const rows1 = await db.execute<{ needs_attention_set_at: string | Date | null } & Record<string, unknown>>(
      sql`SELECT needs_attention_set_at FROM tasks WHERE id = ${taskId}`
    );
    const setAt1 = (rows1 as unknown as Array<{ needs_attention_set_at: string | Date | null }>)[0].needs_attention_set_at;
    expect(setAt1).not.toBeNull();
    const time1 = new Date(setAt1!).getTime();

    // wait briefly to ensure time would change if re-flagged
    await new Promise((resolve) => setTimeout(resolve, 50));
    await flagAttention(taskId, "Reason 3");

    const rows2 = await db.execute<{ needs_attention_set_at: string | Date | null } & Record<string, unknown>>(
      sql`SELECT needs_attention_set_at FROM tasks WHERE id = ${taskId}`
    );
    const setAt2 = (rows2 as unknown as Array<{ needs_attention_set_at: string | Date | null }>)[0].needs_attention_set_at;
    const time2 = new Date(setAt2!).getTime();
    expect(time2).toBe(time1);

    // 4. unflagAttention writes note on real change
    await unflagAttention(taskId);
    const notesAfterUnflag = await db.execute<{ content: string } & Record<string, unknown>>(
      sql`SELECT content FROM task_notes WHERE task_id = ${taskId} ORDER BY created_at ASC`
    );
    expect((notesAfterUnflag as unknown as unknown[]).length).toBe(2);
    expect(JSON.parse((notesAfterUnflag as unknown as Array<{ content: string }>)[1].content)).toMatchObject({
      type: "task_attention_cleared",
    });
    const activitiesAfterUnflag = await db.execute<{ event_type: string } & Record<string, unknown>>(
      sql`SELECT event_type FROM task_activities WHERE task_id = ${taskId} ORDER BY occurred_at ASC`
    );
    expect((activitiesAfterUnflag as unknown as Array<{ event_type: string }>).map((row) => row.event_type)).toEqual([
      "task_attention_flagged",
      "task_attention_cleared",
    ]);

    // 5. re-unflag no-op writes no new note
    await unflagAttention(taskId);
    const notesAfterReunflag = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM task_notes WHERE task_id = ${taskId}`
    );
    expect((notesAfterReunflag as unknown as unknown[]).length).toBe(2);
    const activitiesAfterReunflag = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM task_activities WHERE task_id = ${taskId}`
    );
    expect((activitiesAfterReunflag as unknown as unknown[]).length).toBe(2);

    // 6. silent suppresses note writing
    await flagAttention(taskId, "Silent flag", { silent: true });
    const notesAfterSilent = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM task_notes WHERE task_id = ${taskId}`
    );
    expect((notesAfterSilent as unknown as unknown[]).length).toBe(2); // still 2
    const activitiesAfterSilent = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM task_activities WHERE task_id = ${taskId}`
    );
    expect((activitiesAfterSilent as unknown as unknown[]).length).toBe(2);

    await unflagAttention(taskId, { silent: true });
    const notesAfterSilentClear = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM task_notes WHERE task_id = ${taskId}`
    );
    expect((notesAfterSilentClear as unknown as unknown[]).length).toBe(2); // still 2
    const activitiesAfterSilentClear = await db.execute<{ id: string } & Record<string, unknown>>(
      sql`SELECT id FROM task_activities WHERE task_id = ${taskId}`
    );
    expect((activitiesAfterSilentClear as unknown as unknown[]).length).toBe(2);
  });

  it("delegateTask atomically sets owner, follow-up date, optional due date, note, and delegation activity", async () => {
    const taskId = await insertTask({ owner: "me" });
    const followUpDate = new Date("2026-06-14T12:00:00.000Z");
    const dueDate = new Date("2026-06-30T12:00:00.000Z");

    const result = await delegateTask({
      taskId,
      owner: "noah",
      followUpDate,
      dueDate,
      note: "Noah owns the first draft.",
    });

    expect(result.task.owner).toBe("noah");
    expect(result.task.followUpDate?.toISOString()).toBe(followUpDate.toISOString());
    expect(result.task.snoozedUntil).toBeNull();
    expect(result.task.handoffState).toBe("pending");
    expect(result.task.dueDate?.toISOString()).toBe(dueDate.toISOString());
    expect(result.noteId).not.toBeNull();

    const rows = await db.execute<{ event_type: string; payload: Record<string, unknown> } & Record<string, unknown>>(sql`
      SELECT event_type, payload FROM task_activities WHERE id = ${result.activityId}
    `);
    const activity = (rows as unknown as Array<{ event_type: string; payload: Record<string, unknown> }>)[0];
    expect(activity.event_type).toBe("task_delegation_updated");
    expect(activity.payload).toMatchObject({
      from_owner: "me",
      to_owner: "noah",
      follow_up_date: followUpDate.toISOString(),
      due_date: dueDate.toISOString(),
      note_id: result.noteId,
    });
  });

  it("delegateTask clears an existing queue rank and records the queue exit (R12)", async () => {
    const taskId = await insertTask({ owner: "me" });
    const rankedAt = new Date("2026-06-07T09:00:00.000Z");
    await setQueue([{ taskId, rank: 2, rationale: "Do this second" }], rankedAt);

    const followUpDate = new Date("2026-06-14T12:00:00.000Z");
    const result = await delegateTask({ taskId, owner: "noah", followUpDate });

    // Delegation removes the task from the do-next queue: rank fields are cleared.
    expect(result.task.owner).toBe("noah");
    expect(result.task.queueRank).toBeNull();
    expect(result.task.queueRationale).toBeNull();
    expect(result.task.queueRankedAt).toBeNull();

    // The most recent queue-changed activity records the exit (rank -> null).
    // (setQueue above records its own task_queue_changed when it assigns the rank,
    // so isolate the latest row, mirroring the deferTask exit test.)
    const queueExit = await db.execute<{ payload: Record<string, unknown> } & Record<string, unknown>>(sql`
      SELECT payload FROM task_activities
      WHERE task_id = ${taskId} AND event_type = 'task_queue_changed'
      ORDER BY occurred_at DESC
      LIMIT 1
    `);
    const exitRows = queueExit as unknown as Array<{ payload: Record<string, unknown> }>;
    expect(exitRows.length).toBe(1);
    expect(exitRows[0].payload).toMatchObject({ rank: null, previousRank: 2 });
  });

  it("delegateTask on an unranked task records no queue-changed activity", async () => {
    const taskId = await insertTask({ owner: "me" });
    const followUpDate = new Date("2026-06-14T12:00:00.000Z");

    const result = await delegateTask({ taskId, owner: "noah", followUpDate });

    expect(result.task.owner).toBe("noah");
    const queueChanges = await db.execute(sql`
      SELECT 1 FROM task_activities
      WHERE task_id = ${taskId} AND event_type = 'task_queue_changed'
    `);
    expect((queueChanges as unknown as unknown[]).length).toBe(0);
  });

  it("recordFollowUp atomically appends update note, advances follow-up date, revises due date, status, and activity", async () => {
    const previousFollowUpDate = new Date("2026-06-07T12:00:00.000Z");
    const taskId = await insertTask({
      owner: "noah",
      status: "in_progress",
      followUpDate: previousFollowUpDate,
    });
    const nextFollowUpDate = new Date("2026-06-14T12:00:00.000Z");
    const dueDate = new Date("2026-06-30T12:00:00.000Z");

    const result = await recordFollowUp({
      taskId,
      update: "Noah is halfway done and expects to finish next week.",
      nextFollowUpDate,
      dueDate,
      status: "blocked",
    });

    expect(result.task.status).toBe("blocked");
    expect(result.task.followUpDate?.toISOString()).toBe(nextFollowUpDate.toISOString());
    expect(result.task.dueDate?.toISOString()).toBe(dueDate.toISOString());

    const notes = await db.execute<{ content: string } & Record<string, unknown>>(sql`
      SELECT content FROM task_notes WHERE id = ${result.noteId}
    `);
    expect((notes as unknown as Array<{ content: string }>)[0].content).toContain("halfway done");

    const activities = await db.execute<{ event_type: string; payload: Record<string, unknown> } & Record<string, unknown>>(sql`
      SELECT event_type, payload FROM task_activities WHERE id = ${result.activityId}
    `);
    const activity = (activities as unknown as Array<{ event_type: string; payload: Record<string, unknown> }>)[0];
    expect(activity.event_type).toBe("task_followed_up");
    expect(activity.payload).toMatchObject({
      update_note_id: result.noteId,
      previous_follow_up_date: previousFollowUpDate.toISOString(),
      next_follow_up_date: nextFollowUpDate.toISOString(),
      due_date: dueDate.toISOString(),
      status: "blocked",
    });
  });

  it("deferTask atomically sets snoozed-until date and records defer activity", async () => {
    const previousSnoozedUntil = new Date("2026-06-07T12:00:00.000Z");
    const taskId = await insertTask({ snoozedUntil: previousSnoozedUntil });
    const until = new Date("2026-06-21T12:00:00.000Z");

    const result = await deferTask({ taskId, until });

    expect(result.task.snoozedUntil?.toISOString()).toBe(until.toISOString());
    const activities = await db.execute<{ event_type: string; payload: Record<string, unknown> } & Record<string, unknown>>(sql`
      SELECT event_type, payload FROM task_activities WHERE id = ${result.activityId}
    `);
    const activity = (activities as unknown as Array<{ event_type: string; payload: Record<string, unknown> }>)[0];
    expect(activity.event_type).toBe("task_deferred");
    expect(activity.payload).toMatchObject({
      from_snoozed_until: previousSnoozedUntil.toISOString(),
      until: until.toISOString(),
    });
  });

  it("deferTask clears an existing queue rank and records the queue exit (R12)", async () => {
    const taskId = await insertTask({ owner: "me" });
    const rankedAt = new Date("2026-06-07T09:00:00.000Z");
    await setQueue([{ taskId, rank: 1, rationale: "Do this first" }], rankedAt);

    const until = new Date("2026-06-21T12:00:00.000Z");
    const result = await deferTask({ taskId, until });

    // Snooze and rank are mutually exclusive: the rank fields are cleared.
    expect(result.task.snoozedUntil?.toISOString()).toBe(until.toISOString());
    expect(result.task.queueRank).toBeNull();
    expect(result.task.queueRationale).toBeNull();
    expect(result.task.queueRankedAt).toBeNull();

    // The most recent queue-changed activity records the exit (rank -> null).
    const queueExit = await db.execute<{ payload: Record<string, unknown> } & Record<string, unknown>>(sql`
      SELECT payload FROM task_activities
      WHERE task_id = ${taskId} AND event_type = 'task_queue_changed'
      ORDER BY occurred_at DESC
      LIMIT 1
    `);
    const exitRows = queueExit as unknown as Array<{ payload: Record<string, unknown> }>;
    expect(exitRows.length).toBe(1);
    expect(exitRows[0].payload).toMatchObject({ rank: null, previousRank: 1 });
  });

  it("deferTask on an unranked task records only the deferred activity", async () => {
    const taskId = await insertTask({ owner: "me" });
    const until = new Date("2026-06-21T12:00:00.000Z");

    const result = await deferTask({ taskId, until });

    expect(result.task.snoozedUntil?.toISOString()).toBe(until.toISOString());
    const queueChanges = await db.execute(sql`
      SELECT 1 FROM task_activities
      WHERE task_id = ${taskId} AND event_type = 'task_queue_changed'
    `);
    expect((queueChanges as unknown as unknown[]).length).toBe(0);
  });

  it("clearTaskSnooze clears snoozed_until and records a snooze-cleared activity", async () => {
    const snoozedUntil = new Date("2026-06-25T12:00:00.000Z");
    const taskId = await insertTask({ owner: "me", snoozedUntil });

    const result = await clearTaskSnooze({ taskId });

    expect(result.task.snoozedUntil).toBeNull();
    expect(result.activityId).not.toBeNull();

    const activity = await db.execute<{ event_type: string; summary: string; payload: Record<string, unknown> } & Record<string, unknown>>(sql`
      SELECT event_type, summary, payload FROM task_activities WHERE id = ${result.activityId}
    `);
    const rows = activity as unknown as Array<{ event_type: string; summary: string; payload: Record<string, unknown> }>;
    expect(rows[0].event_type).toBe("task_deferred");
    expect(rows[0].summary).toBe("Snooze cleared");
    expect(rows[0].payload).toMatchObject({
      from_snoozed_until: snoozedUntil.toISOString(),
      until: null,
    });
  });

  it("clearTaskSnooze on a non-snoozed task is a no-op with no activity", async () => {
    const taskId = await insertTask({ owner: "me" });

    const result = await clearTaskSnooze({ taskId });

    expect(result.task.snoozedUntil).toBeNull();
    expect(result.activityId).toBeNull();
  });

  it("follow-up helpers honor passed tx and roll back field writes, notes, and activities together", async () => {
    const taskId = await insertTask({ owner: "me", followUpDate: null });

    await expect(
      db.transaction(async (tx) => {
        await delegateTask({
          taskId,
          owner: "noah",
          followUpDate: new Date("2026-06-14T12:00:00.000Z"),
          note: "Rollback this delegation.",
          tx,
        });
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const tasksAfterRollback = await db.execute<{ owner: string; follow_up_date: Date | null } & Record<string, unknown>>(sql`
      SELECT owner, follow_up_date FROM tasks WHERE id = ${taskId}
    `);
    const row = (tasksAfterRollback as unknown as Array<{ owner: string; follow_up_date: Date | null }>)[0];
    expect(row.owner).toBe("me");
    expect(row.follow_up_date).toBeNull();

    const notes = await db.execute<{ id: string } & Record<string, unknown>>(sql`
      SELECT id FROM task_notes WHERE task_id = ${taskId}
    `);
    expect((notes as unknown as unknown[]).length).toBe(0);

    const activities = await db.execute<{ id: string } & Record<string, unknown>>(sql`
      SELECT id FROM task_activities WHERE task_id = ${taskId}
    `);
    expect((activities as unknown as unknown[]).length).toBe(0);
  });
});
