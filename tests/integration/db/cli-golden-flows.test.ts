import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  parseLastJsonStdoutValidated,
  runCli,
} from "../../cli/test-utils.js";
import {
  closeDb,
  db,
  insertGoal,
  insertTask,
  resetDbData,
} from "../../db/db-test-utils.js";
import { resetSettingsCache, loadSettings } from "../../../src/cli/settings-loader.js";
import { Schemas as GoalSchemas } from "../../../src/cli/commands/goal.js";
import { Schemas as HealthSchemas } from "../../../src/cli/commands/health.js";
import { Schemas as MemorySchemas } from "../../../src/cli/commands/memory.js";
import { Schemas as ReviewSchemas } from "../../../src/cli/commands/review.js";
import { Schemas as TaskSchemas } from "../../../src/cli/commands/task.js";
import { Schemas as TaskopsSchemas } from "../../../src/cli/commands/taskops.js";
import { EXIT_OK } from "../../../src/cli/errors.js";

describe("real-DB CLI golden flows", () => {
  beforeEach(async () => {
    resetSettingsCache();
    await resetDbData();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("keeps taskops create -> task show wired through production Postgres", async () => {
    const created = await runCli(
      [
        "taskops",
        "create",
        "Golden task",
        "--description",
        "A valid golden task description",
        "--category",
        "personal",
        "--due",
        "tomorrow",
      ],
      { format: "json" },
    );
    expect(created.exitCode).toBe(EXIT_OK);
    const createdJson = parseLastJsonStdoutValidated(created, TaskopsSchemas.create.output);

    const shown = await runCli(["task", "show", createdJson.task.id], {
      format: "json",
    });
    expect(shown.exitCode).toBe(EXIT_OK);
    expect(parseLastJsonStdoutValidated(shown, TaskSchemas.show.output).task.id)
      .toBe(createdJson.task.id);
  });

  it("keeps goal create and linked-task reads wired through real FKs", async () => {
    const goal = await runCli(
      [
        "goal",
        "create",
        "Golden goal",
        "--description",
        "A valid golden goal description",
        "--quarter",
        "2026-Q2",
      ],
      { format: "json" },
    );
    expect(goal.exitCode).toBe(EXIT_OK);
    const goalId = parseLastJsonStdoutValidated(goal, GoalSchemas.create.output).goal.id;

    await insertTask({ id: "KS-GOLD", goalId, category: "personal" });
    const linked = await runCli(["goal", "linked-tasks", goalId], {
      format: "json",
    });
    const linkedJson = parseLastJsonStdoutValidated(
      linked,
      GoalSchemas.linkedTasks.output,
    );
    expect(linkedJson.tasks.map((task) => task.id)).toContain("KS-GOLD");
  });

  it("keeps memory save/recall wired through pgvector-backed rows", async () => {
    const saved = await runCli(
      [
        "memory",
        "save",
        "--scope",
        "clients/acme",
        "--content",
        "Use invoices as source of truth",
        "--applicability",
        "When billing questions come up",
      ],
      { format: "json" },
    );
    expect(saved.exitCode).toBe(EXIT_OK);
    parseLastJsonStdoutValidated(saved, MemorySchemas.save.output);

    const recalled = await runCli(
      [
        "memory",
        "recall",
        "--query",
        "billing source",
      ],
      { format: "json" },
    );
    expect(parseLastJsonStdoutValidated(recalled, MemorySchemas.recall.output).count)
      .toBe(1);

    const scoped = await runCli(
      [
        "memory",
        "recall",
        "--scope",
        "clients/acme",
        "--query",
        "billing source",
      ],
      { format: "json" },
    );
    expect(parseLastJsonStdoutValidated(scoped, MemorySchemas.recall.output).count)
      .toBe(1);
  });

  it("keeps review next wired through eligible task view and settings", async () => {
    await insertTask({
      id: "KS-REVIEW",
      status: "triage",
      priority: "P0",
      category: "personal",
    });

    const result = await runCli(["review", "next"], { format: "json" });
    const json = parseLastJsonStdoutValidated(result, ReviewSchemas.next.output);
    expect(json.top?.taskId).toBe("KS-REVIEW");
  });

  it("keeps health and settings loader real-DB smoke coverage", async () => {
    const settings = await loadSettings(true);
    expect(settings.settings.infrastructure.task_id_prefix).toBe("KS");

    const health = await runCli(["health"], { format: "json" });
    expect(parseLastJsonStdoutValidated(health, HealthSchemas.health.output).probes.length)
      .toBeGreaterThan(0);
  });

  it("keeps a real goal fixture helper available for DB-backed tests", async () => {
    const goalId = await insertGoal("G-900");
    const shown = await runCli(["goal", "show", goalId], { format: "json" });
    expect(parseLastJsonStdoutValidated(shown, GoalSchemas.show.output).goal.id)
      .toBe(goalId);
  });

  it("taskops update --priority P0 --status in_progress writes exactly one task_fields_updated plus one status_change atomically", async () => {
    const taskId = await insertTask({ id: "KS-001", status: "triage", priority: "P2" });

    // Run taskops update (the unified write path for field + status changes)
    const result = await runCli(
      [
        "taskops",
        "update",
        "--task-id",
        taskId,
        "--priority",
        "P0",
        "--status",
        "in_progress",
        "--due",
        "tomorrow",
      ],
      { format: "json" }
    );
    expect(result.exitCode).toBe(EXIT_OK);

    // Verify notes written
    const notes = await db.execute<{ note_type: string; content: string } & Record<string, unknown>>(
      sql`SELECT note_type, content FROM task_notes WHERE task_id = ${taskId} ORDER BY created_at ASC`
    );
    // Both notes are written inside ONE transaction, so created_at cannot
    // order them deterministically; assert exactly one of each instead.
    const noteRows = notes as unknown as Array<{ note_type: string; content: string }>;
    expect(noteRows.length).toBe(2);
    const fieldsNote = noteRows.find((row) => row.note_type === "system");
    const statusNote = noteRows.find((row) => row.note_type === "status_change");
    expect(fieldsNote).toBeDefined();
    expect(statusNote).toBeDefined();
    expect(JSON.parse((fieldsNote as { content: string }).content).type).toBe("task_fields_updated");

    const activities = await db.execute<{ event_type: string } & Record<string, unknown>>(
      sql`SELECT event_type FROM task_activities WHERE task_id = ${taskId} ORDER BY occurred_at ASC`
    );
    expect(
      (activities as unknown as Array<{ event_type: string }>).map((row) => row.event_type).sort(),
    ).toEqual(["task_fields_updated", "task_status_changed"]);
  });

  it("taskops update and complete return promptly (deadlock regression guard)", async () => {
    const taskId = await insertTask({ id: "KS-002", status: "triage" });

    // A. taskops update with status and title
    const updateResult = await runCli(
      [
        "taskops",
        "update",
        "--task-id",
        taskId,
        "--title",
        "Updated via taskops",
        "--status",
        "in_progress",
      ],
      { format: "json" }
    );
    expect(updateResult.exitCode).toBe(EXIT_OK);

    // B. taskops complete (terminal; --yes required on every surface, D3)
    const completeResult = await runCli(
      [
        "taskops",
        "complete",
        "--task-id",
        taskId,
        "--yes",
      ],
      { format: "json" }
    );
    expect(completeResult.exitCode).toBe(EXIT_OK);

    const activities = await db.execute<{ event_type: string } & Record<string, unknown>>(
      sql`SELECT event_type FROM task_activities WHERE task_id = ${taskId} ORDER BY occurred_at ASC`
    );
    expect((activities as unknown as Array<{ event_type: string }>).map((row) => row.event_type)).toEqual([
      "task_fields_updated",
      "task_status_changed",
      "task_status_changed",
    ]);
  });

  it("dependency add/remove write a note on BOTH tasks", async () => {
    const blockedId = await insertTask({ id: "KS-003" });
    const blockerId = await insertTask({ id: "KS-004" });

    // 1. Dependency add (writes live on taskops)
    const addResult = await runCli(
      [
        "taskops",
        "dependency-add",
        "--blocked",
        blockedId,
        "--blocked-by",
        blockerId,
      ],
      { format: "json" }
    );
    expect(addResult.exitCode).toBe(EXIT_OK);

    // Check notes on blocked task
    const blockedNotes = await db.execute<{ content: string } & Record<string, unknown>>(
      sql`SELECT content FROM task_notes WHERE task_id = ${blockedId} AND note_type = 'system'`
    );
    expect((blockedNotes as unknown as unknown[]).length).toBe(1);
    expect(JSON.parse((blockedNotes as unknown as Array<{ content: string }>)[0].content).type).toBe("task_dependency_added");

    // Check notes on blocker task
    const blockerNotes = await db.execute<{ content: string } & Record<string, unknown>>(
      sql`SELECT content FROM task_notes WHERE task_id = ${blockerId} AND note_type = 'system'`
    );
    expect((blockerNotes as unknown as unknown[]).length).toBe(1);
    expect(JSON.parse((blockerNotes as unknown as Array<{ content: string }>)[0].content).type).toBe("task_dependency_added");

    const addActivities = await db.execute<{ task_id: string; event_type: string } & Record<string, unknown>>(
      sql`SELECT task_id, event_type FROM task_activities WHERE task_id IN (${blockedId}, ${blockerId}) ORDER BY task_id ASC`
    );
    expect((addActivities as unknown as Array<{ task_id: string; event_type: string }>)).toEqual([
      { task_id: blockedId, event_type: "task_dependency_added" },
      { task_id: blockerId, event_type: "task_dependency_added" },
    ]);

    // 2. Dependency remove
    const removeResult = await runCli(
      [
        "taskops",
        "dependency-remove",
        "--blocked",
        blockedId,
        "--blocked-by",
        blockerId,
      ],
      { format: "json" }
    );
    expect(removeResult.exitCode).toBe(EXIT_OK);

    // Check notes on blocked task
    const blockedNotes2 = await db.execute<{ content: string } & Record<string, unknown>>(
      sql`SELECT content FROM task_notes WHERE task_id = ${blockedId} AND note_type = 'system' ORDER BY created_at DESC`
    );
    expect((blockedNotes2 as unknown as unknown[]).length).toBe(2);
    expect(JSON.parse((blockedNotes2 as unknown as Array<{ content: string }>)[0].content).type).toBe("task_dependency_removed");

    // Check notes on blocker task
    const blockerNotes2 = await db.execute<{ content: string } & Record<string, unknown>>(
      sql`SELECT content FROM task_notes WHERE task_id = ${blockerId} AND note_type = 'system' ORDER BY created_at DESC`
    );
    expect((blockerNotes2 as unknown as unknown[]).length).toBe(2);
    expect(JSON.parse((blockerNotes2 as unknown as Array<{ content: string }>)[0].content).type).toBe("task_dependency_removed");

    const allActivities = await db.execute<{ task_id: string; event_type: string } & Record<string, unknown>>(
      sql`SELECT task_id, event_type FROM task_activities WHERE task_id IN (${blockedId}, ${blockerId}) ORDER BY task_id ASC, occurred_at ASC`
    );
    expect((allActivities as unknown as Array<{ task_id: string; event_type: string }>)).toEqual([
      { task_id: blockedId, event_type: "task_dependency_added" },
      { task_id: blockedId, event_type: "task_dependency_removed" },
      { task_id: blockerId, event_type: "task_dependency_added" },
      { task_id: blockerId, event_type: "task_dependency_removed" },
    ]);
  });

  it("taskops create -s in_progress writes an initial status_change", async () => {
    const created = await runCli(
      [
        "taskops",
        "create",
        "Initial status task",
        "--description",
        "A valid task description for initial status",
        "--category",
        "personal",
        "--due",
        "tomorrow",
        "-s",
        "in_progress",
      ],
      { format: "json" }
    );
    expect(created.exitCode).toBe(EXIT_OK);
    const createdJson = parseLastJsonStdoutValidated(created, TaskopsSchemas.create.output);
    const taskId = createdJson.task.id;

    // Check notes
    const notes = await db.execute<{ note_type: string; content: string } & Record<string, unknown>>(
      sql`SELECT note_type, content FROM task_notes WHERE task_id = ${taskId} AND note_type = 'status_change'`
    );
    expect((notes as unknown as unknown[]).length).toBe(1);
    expect(JSON.parse((notes as unknown as Array<{ content: string }>)[0].content)).toMatchObject({
      from: "triage",
      to: "in_progress",
    });

    const activities = await db.execute<{ event_type: string } & Record<string, unknown>>(
      sql`SELECT event_type FROM task_activities WHERE task_id = ${taskId} ORDER BY occurred_at ASC`
    );
    expect((activities as unknown as Array<{ event_type: string }>).map((row) => row.event_type).sort()).toEqual([
      "task_created",
      "task_status_changed",
    ]);
  });
});
