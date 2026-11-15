/**
 * End-to-end contract tests for the task CLI surface after change-008:
 * reads stay on `execos task` (list / show / dependency list); every write
 * lives on `execos taskops` (create, update, complete, cancel,
 * dependency-add/remove, flag-attention/unflag-attention). The legacy
 * `execos task` write subcommands have been removed entirely.
 *
 * Each test runs the production buildProgram + parseAsync path against
 * a real (dev) Supabase. stdout/stderr are captured into in-memory
 * buffers so we can assert on the exact bytes the CLI emits.
 *
 * Embeddings: tests/setup.ts sets EXECOS_TEST_EMBEDDINGS=1, so (absent an
 * OPENAI_API_KEY) the create-path duplicate gate runs on deterministic
 * hash-based vectors — identical text scores 1.0, distinct text scores
 * ~0. Helper creates pass --allow-duplicate so multi-create fixtures can
 * never trip the gate; the dedicated dedup tests use identical text.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, db } from "../../../../src/db/index.js";
import { resetDbData, insertGoal } from "../../../db/db-test-utils.js";
import { resetSettingsCache } from "../../../../src/cli/settings-loader.js";
import {
  runCli,
  parseLastJsonStdout,
  parseLastJsonStdoutValidated,
} from "../../../cli/test-utils.js";
import { Schemas as TaskSchemas } from "../../../../src/cli/commands/task.js";
import { Schemas as TaskopsSchemas } from "../../../../src/cli/commands/taskops.js";
import {
  EXIT_INPUT_VALIDATION,
  EXIT_OK,
  EXIT_TASK_NOT_FOUND,
  EXIT_TRANSITION_DENIED,
  EXIT_DEPENDENCY_CYCLE,
  EXIT_WIP_CAP_EXCEEDED,
} from "../../../../src/cli/errors.js";

interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string | null;
  category: string;
  goal_id: string | null;
  due_date: Date | null;
  needs_attention: boolean;
  needs_attention_reason: string | null;
  hard_deadline: boolean;
  effort: string | null;
}

async function fetchRow(id: string): Promise<TaskRow | undefined> {
  const rows = await db.execute<TaskRow & Record<string, unknown>>(
    sql`SELECT id, title, description, status, priority, category, goal_id, due_date,
              needs_attention, needs_attention_reason, hard_deadline, effort
        FROM tasks WHERE id = ${id} LIMIT 1`,
  );
  const cast = rows as unknown as TaskRow[];
  return cast[0];
}

async function noteCount(taskId: string, type?: string): Promise<number> {
  const rows = type
    ? await db.execute<{ n: string } & Record<string, unknown>>(
        sql`SELECT COUNT(*)::text AS n FROM task_notes
            WHERE task_id = ${taskId} AND note_type = ${type}`,
      )
    : await db.execute<{ n: string } & Record<string, unknown>>(
        sql`SELECT COUNT(*)::text AS n FROM task_notes WHERE task_id = ${taskId}`,
      );
  const cast = rows as unknown as Array<{ n: string }>;
  return parseInt(cast[0].n, 10);
}

async function intakeNote(taskId: string): Promise<Record<string, unknown>> {
  const rows = await db.execute<{ content: string } & Record<string, unknown>>(
    sql`SELECT content FROM task_notes
        WHERE task_id = ${taskId} AND note_type = 'intake_checklist' LIMIT 1`,
  );
  const cast = rows as unknown as Array<{ content: string }>;
  expect(cast.length).toBe(1);
  return JSON.parse(cast[0].content) as Record<string, unknown>;
}

async function dependencyCount(
  blockerTaskId: string,
  blockedTaskId: string,
): Promise<number> {
  const rows = await db.execute<{ n: string } & Record<string, unknown>>(
    sql`SELECT COUNT(*)::text AS n FROM task_dependencies
        WHERE blocker_task_id = ${blockerTaskId}
          AND blocked_task_id = ${blockedTaskId}`,
  );
  const cast = rows as unknown as Array<{ n: string }>;
  return parseInt(cast[0].n, 10);
}

async function tasksWithTitle(title: string): Promise<number> {
  const rows = await db.execute<{ n: string } & Record<string, unknown>>(
    sql`SELECT COUNT(*)::text AS n FROM tasks WHERE title = ${title}`,
  );
  const cast = rows as unknown as Array<{ n: string }>;
  return parseInt(cast[0].n, 10);
}

/** Last JSON document on stderr (errors are emitted there in JSON mode). */
function parseLastJsonStderr(result: { err: string }): unknown {
  const lines = result.err
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.startsWith("{"));
  if (lines.length === 0) return null;
  return JSON.parse(lines[lines.length - 1]);
}

/**
 * Fixture create through the sanctioned write path. Descriptions derive from
 * the title (so distinct fixtures stay dissimilar) and --allow-duplicate
 * keeps multi-create fixtures immune to the dedup gate.
 */
async function createTaskViaTaskops(
  title: string,
  extraArgs: string[] = [],
): Promise<string> {
  const created = await runCli(
    [
      "taskops",
      "create",
      title,
      "-d",
      `${title} description that is comfortably above the ten-character minimum.`,
      "-c",
      "personal",
      "--due",
      "tomorrow",
      "--allow-duplicate",
      "test fixture seed; duplicate gate intentionally bypassed",
      ...extraArgs,
    ],
    { format: "json" },
  );
  expect(created.exitCode).toBe(EXIT_OK);
  return (parseLastJsonStdout(created) as { task: { id: string } }).task.id;
}

describe("execos task/taskops CLI", () => {
  beforeEach(async () => {
    resetSettingsCache();
    await resetDbData();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe("taskops create", () => {
    it("creates a task with required fields and writes intake_checklist note", async () => {
      const result = await runCli(
        [
          "taskops",
          "create",
          "Validate the create path",
          "-d",
          "A description that is comfortably above the ten-character minimum.",
          "-c",
          "personal",
          "--due",
          "tomorrow",
        ],
        { format: "json" },
      );
      expect(result.exitCode).toBe(EXIT_OK);
      // Validates the captured JSON against the exported `taskops create`
      // output schema before asserting fields. If the production emitter
      // ever drifts from the documented Schemas shape, this test fails
      // at THIS line with a precise Zod error path.
      const parsed = parseLastJsonStdoutValidated(
        result,
        TaskopsSchemas.create.output,
      );
      expect(parsed.ok).toBe(true);
      expect(parsed.task.id).toMatch(/^KS-\d{3,}$/);
      expect(parsed.task.status).toBe("triage");
      expect(parsed.task.category).toBe("personal");
      expect(parsed.dedup).toEqual({ matches: [], overridden: false, justification: null });

      const row = await fetchRow(parsed.task.id);
      expect(row?.title).toBe("Validate the create path");
      expect(await noteCount(parsed.task.id, "intake_checklist")).toBe(1);
      const audit = await intakeNote(parsed.task.id);
      expect(audit.step_1_dedup).toBe("passed");
      expect(audit.dedup_overridden).toBe(false);
    });

    it("accepts --title with description and note text loaded from files", async () => {
      const dir = await mkdtemp(join(tmpdir(), "execos-taskops-cli-"));
      try {
        const descriptionPath = join(dir, "description.txt");
        const notePath = join(dir, "note.txt");
        await writeFile(
          descriptionPath,
          "File-backed description that is comfortably above the minimum.",
          "utf8",
        );
        await writeFile(
          notePath,
          "Original pasted context belongs in a manual task note.",
          "utf8",
        );

        const result = await runCli(
          [
            "taskops",
            "create",
            "--title",
            "Create from files",
            "--description-file",
            descriptionPath,
            "--note-file",
            notePath,
            "-c",
            "personal",
            "--due",
            "tomorrow",
            "--return-detail",
          ],
          { format: "json" },
        );
        expect(result.exitCode).toBe(EXIT_OK);
        const parsed = parseLastJsonStdout(result) as {
          task: { id: string; title: string; description: string };
          detail: {
            recentNotes: Array<{ type: string; content: string }>;
          };
        };
        expect(parsed.task.title).toBe("Create from files");
        expect(parsed.task.description).toMatch(/File-backed description/);
        expect(parsed.detail.recentNotes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "manual",
              content: "Original pasted context belongs in a manual task note.",
            }),
          ]),
        );
        expect(await noteCount(parsed.task.id, "intake_checklist")).toBe(1);
        expect(await noteCount(parsed.task.id, "manual")).toBe(1);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("accepts a task description from stdin", async () => {
      const result = await runCli(
        [
          "taskops",
          "create",
          "--title",
          "Create from stdin",
          "-d",
          "-",
          "-c",
          "personal",
          "--due",
          "tomorrow",
        ],
        {
          format: "json",
          stdin: "Stdin-backed description\n\nwith useful internal spacing.\r\n",
        },
      );

      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdoutValidated(
        result,
        TaskopsSchemas.create.output,
      );
      const row = await fetchRow(parsed.task.id);
      expect(row?.description).toBe(
        "Stdin-backed description\n\nwith useful internal spacing.",
      );
    });

    it("accepts non-terminal initial status on create", async () => {
      const result = await runCli(
        [
          "taskops",
          "create",
          "--title",
          "Create directly in backlog",
          "-d",
          "A backlog-ready description that meets the minimum comfortably.",
          "-c",
          "personal",
          "--due",
          "tomorrow",
          "--status",
          "backlog",
        ],
        { format: "json" },
      );

      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdoutValidated(
        result,
        TaskopsSchemas.create.output,
      );
      expect(parsed.task.status).toBe("backlog");
      const row = await fetchRow(parsed.task.id);
      expect(row?.status).toBe("backlog");
    });

    it("rejects terminal initial status on create", async () => {
      const result = await runCli([
        "taskops",
        "create",
        "--title",
        "Terminal create attempt",
        "-d",
        "A description that is well above the ten-character minimum.",
        "-c",
        "personal",
        "--due",
        "tomorrow",
        "--status",
        "done",
      ]);

      expect(result.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(result.err).toMatch(/non-terminal statuses only/i);
      expect(await tasksWithTitle("Terminal create attempt")).toBe(0);
    });

    it("rejects descriptions shorter than 10 chars before hitting the DB", async () => {
      const result = await runCli([
        "taskops",
        "create",
        "Short desc",
        "-d",
        "too-short",
        "-c",
        "personal",
        "--due",
        "tomorrow",
      ]);
      expect(result.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(result.err).toMatch(/at least 10 characters/);
    });

    it("rejects unknown category", async () => {
      const result = await runCli([
        "taskops",
        "create",
        "Unknown category",
        "-d",
        "A description that is well above the ten-character minimum.",
        "-c",
        "imaginary",
        "--due",
        "tomorrow",
      ]);
      expect(result.exitCode).not.toBe(EXIT_OK);
      expect(await tasksWithTitle("Unknown category")).toBe(0);
    });

    it("defaults the due date to ~3 business days out when --due is omitted (ISS-008)", async () => {
      // Decision 021 (R27) keeps "every task has a due date"; batch-009 ISS-008
      // Option A satisfies it by defaulting at the CLI instead of refusing, so
      // create now SUCCEEDS without --due. (The service still refuses an
      // undefined dueAt; that golden lives in the architecture suite.)
      const result = await runCli(
        [
          "taskops",
          "create",
          "No due date",
          "-d",
          "A description that is well above the ten-character minimum.",
          "-c",
          "personal",
        ],
        { format: "json" },
      );
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdout(result) as {
        task: { id: string; dueAt: string | null };
        warnings: string[];
      };

      // A due date was applied, in the near future (3 business days spans at
      // most ~5 calendar days; the 17:00-local anchor can nudge the UTC day,
      // so assert a generous window rather than an exact weekday here — the
      // weekend-avoiding property is unit-tested in dates.test.ts).
      expect(parsed.task.dueAt).not.toBeNull();
      const daysAhead =
        (new Date(parsed.task.dueAt as string).getTime() - Date.now()) /
        86_400_000;
      expect(daysAhead).toBeGreaterThan(0);
      expect(daysAhead).toBeLessThan(8);

      // The receipt flags that the due date was defaulted so Jordan can adjust.
      expect(parsed.warnings.some((w) => /default/i.test(w))).toBe(true);

      const row = await fetchRow(parsed.task.id);
      expect(row?.due_date).toBeTruthy();
    });

    it("parses --due Thursday at 3pm and stores a UTC instant", async () => {
      const result = await runCli(
        [
          "taskops",
          "create",
          "Due-date phrase",
          "-d",
          "A description that satisfies the ten-character minimum nicely.",
          "-c",
          "personal",
          "--due",
          "Thursday at 3pm",
        ],
        { format: "json" },
      );
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdout(result) as {
        task: { id: string; dueAt: string | null };
      };
      expect(parsed.task.dueAt).not.toBeNull();
      const row = await fetchRow(parsed.task.id);
      expect(row?.due_date).toBeTruthy();
    });

    it("links to a goal when --goal-id is supplied and the goal exists", async () => {
      const goalId = await insertGoal("G-100");
      const result = await runCli(
        [
          "taskops",
          "create",
          "Goal linked",
          "-d",
          "A description that is well above the ten-character minimum.",
          "-c",
          "business",
          "--goal-id",
          goalId,
          "--due",
          "tomorrow",
        ],
        { format: "json" },
      );
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdout(result) as {
        task: { id: string; goalId: string | null };
      };
      expect(parsed.task.goalId).toBe(goalId);
    });

    it("rejects --goal-id that does not exist with input validation error", async () => {
      const result = await runCli([
        "taskops",
        "create",
        "No such goal",
        "-d",
        "A description that satisfies the ten-character minimum.",
        "-c",
        "personal",
        "--goal-id",
        "G-404",
        "--due",
        "tomorrow",
      ]);
      expect(result.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(result.err).toMatch(/G-404/);
    });

    it("enforces the P0 WIP cap inside the create transaction", async () => {
      // Cap is 3 by default. Fill it with 3 P0 tasks first.
      for (let i = 0; i < 3; i++) {
        await createTaskViaTaskops(`Existing P-zero number ${i}`, ["-p", "P0"]);
      }
      const result = await runCli(
        [
          "taskops",
          "create",
          "Fourth P0",
          "-d",
          "A fourth P0 description that exceeds the cap and triggers the guard.",
          "-c",
          "business",
          "-p",
          "P0",
          "--due",
          "tomorrow",
          "--allow-duplicate",
          "test fixture seed; duplicate gate intentionally bypassed",
        ],
        { format: "json" },
      );
      expect(result.exitCode).toBe(EXIT_WIP_CAP_EXCEEDED);
      const parsed = parseLastJsonStderr(result) as {
        ok: boolean;
        error: { category: string; details: { cap: number; currentCount: number } };
      };
      expect(parsed.ok).toBe(false);
      expect(parsed.error.category).toBe("p0_wip_cap_exceeded");
      expect(parsed.error.details.cap).toBe(3);
      expect(parsed.error.details.currentCount).toBeGreaterThanOrEqual(3);
      // The refused create must not have committed.
      expect(await tasksWithTitle("Fourth P0")).toBe(0);
    });

    it("stores --effort and --hard-deadline on the row, JSON output, and intake audit (change-009)", async () => {
      const result = await runCli(
        [
          "taskops",
          "create",
          "Effort and hard deadline create",
          "-d",
          "A description that is comfortably above the ten-character minimum.",
          "-c",
          "personal",
          "--due",
          "tomorrow",
          "--effort",
          "M",
          "--hard-deadline",
        ],
        { format: "json" },
      );
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdoutValidated(
        result,
        TaskopsSchemas.create.output,
      );
      expect(parsed.task.effort).toBe("M");
      expect(parsed.task.hardDeadline).toBe(true);

      const row = await fetchRow(parsed.task.id);
      expect(row?.effort).toBe("M");
      expect(row?.hard_deadline).toBe(true);

      const audit = await intakeNote(parsed.task.id);
      expect(audit.effort).toBe("M");
      expect(audit.hard_deadline).toBe(true);
    });

    it("defaults effort null and hard_deadline false when flags are omitted", async () => {
      const id = await createTaskViaTaskops("Plain create without estimate");
      const row = await fetchRow(id);
      expect(row?.effort).toBeNull();
      expect(row?.hard_deadline).toBe(false);
    });

    it("rejects an invalid --effort value before the DB", async () => {
      const result = await runCli([
        "taskops",
        "create",
        "Bad effort value",
        "-d",
        "A description that is well above the ten-character minimum.",
        "-c",
        "personal",
        "--due",
        "tomorrow",
        "--effort",
        "XXL",
      ]);
      expect(result.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(result.err).toMatch(/S, M, L, XL/);
      expect(await tasksWithTitle("Bad effort value")).toBe(0);
    });

    it("refuses a near-duplicate create and accepts the --allow-duplicate override (D4)", async () => {
      const title = "Duplicate gate target";
      const args = [
        "taskops",
        "create",
        title,
        "-d",
        "Identical description used twice to trigger the duplicate gate.",
        "-c",
        "personal",
        "--due",
        "tomorrow",
      ];

      const first = await runCli(args, { format: "json" });
      expect(first.exitCode).toBe(EXIT_OK);
      const firstId = (
        parseLastJsonStdout(first) as { task: { id: string } }
      ).task.id;

      // Identical title + description embeds to the identical vector, so the
      // gate refuses regardless of the embedding provider in play.
      const refused = await runCli(args, { format: "json" });
      expect(refused.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(refused.err).toMatch(/near-duplicate/i);
      expect(refused.err).toContain(firstId);
      expect(refused.err).toMatch(/--allow-duplicate/);
      expect(await tasksWithTitle(title)).toBe(1);

      const justification = "Deliberate twin: exercising the audited override path.";
      const overridden = await runCli([...args, "--allow-duplicate", justification], {
        format: "json",
      });
      expect(overridden.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdoutValidated(
        overridden,
        TaskopsSchemas.create.output,
      );
      expect(parsed.task.id).not.toBe(firstId);
      expect(parsed.dedup?.overridden).toBe(true);
      expect(parsed.dedup?.matches.map((m) => m.id)).toContain(firstId);
      expect(parsed.dedup?.justification).toBe(justification);
      expect(await tasksWithTitle(title)).toBe(2);

      // The override is audited in the intake note with its justification.
      const audit = await intakeNote(parsed.task.id);
      expect(String(audit.step_1_dedup)).toMatch(/^overridden:/);
      expect(audit.dedup_overridden).toBe(true);
      expect(audit.dedup_override_justification).toBe(justification);
    });
  });

  describe("taskops update", () => {
    it("updates priority field on an existing task", async () => {
      const id = await createTaskViaTaskops("Update target");

      const upd = await runCli(
        ["taskops", "update", "--task-id", id, "-p", "P2"],
        { format: "json" },
      );
      expect(upd.exitCode).toBe(EXIT_OK);
      parseLastJsonStdoutValidated(upd, TaskopsSchemas.update.output);
      const row = await fetchRow(id);
      expect(row?.priority).toBe("P2");
    });

    it("accepts replacement description from --description-file -", async () => {
      const id = await createTaskViaTaskops("Stdin update target");

      const upd = await runCli(
        ["taskops", "update", "--task-id", id, "--description-file", "-"],
        {
          format: "json",
          stdin: "Replacement description streamed through stdin.\n",
        },
      );

      expect(upd.exitCode).toBe(EXIT_OK);
      const row = await fetchRow(id);
      expect(row?.description).toBe(
        "Replacement description streamed through stdin.",
      );
    });

    it("denies forbidden status transitions once a task is terminal", async () => {
      const id = await createTaskViaTaskops("Done first");
      await runCli(["taskops", "complete", "--task-id", id, "--yes"]);

      const denied = await runCli([
        "taskops",
        "update",
        "--task-id",
        id,
        "-s",
        "in_progress",
      ]);
      expect(denied.exitCode).toBe(EXIT_TRANSITION_DENIED);
      expect(denied.err).toMatch(/terminal/i);
    });

    it("refuses update -s done and points to taskops complete (D3)", async () => {
      const id = await createTaskViaTaskops("Update bypass done");

      const denied = await runCli([
        "taskops",
        "update",
        "--task-id",
        id,
        "-s",
        "done",
      ]);
      expect(denied.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(denied.err).toMatch(/taskops complete/);

      // The DB row must remain in its starting status; the bypass must
      // not commit a terminal transition.
      const row = await fetchRow(id);
      expect(row?.status).toBe("triage");
    });

    it("refuses update -s cancelled and points to taskops cancel (D3)", async () => {
      const id = await createTaskViaTaskops("Update bypass cancelled");

      const denied = await runCli([
        "taskops",
        "update",
        "--task-id",
        id,
        "-s",
        "cancelled",
      ]);
      expect(denied.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(denied.err).toMatch(/taskops cancel/);

      const row = await fetchRow(id);
      expect(row?.status).toBe("triage");
    });

    it("links and unlinks a goal via --goal-id / --clear-goal with system notes", async () => {
      const goalId = await insertGoal("G-200");
      const id = await createTaskViaTaskops("Goal link target");

      const link = await runCli(
        ["taskops", "update", "--task-id", id, "--goal-id", goalId],
        { format: "json" },
      );
      expect(link.exitCode).toBe(EXIT_OK);
      expect((await fetchRow(id))?.goal_id).toBe(goalId);
      // Each goal change writes TWO system notes: the generic
      // task_fields_updated note from updateTaskFields plus the specific
      // goal link/unlink note from the service.
      expect(await noteCount(id, "system")).toBe(2);

      const unlink = await runCli(
        ["taskops", "update", "--task-id", id, "--clear-goal"],
        { format: "json" },
      );
      expect(unlink.exitCode).toBe(EXIT_OK);
      expect((await fetchRow(id))?.goal_id).toBeNull();
      expect(await noteCount(id, "system")).toBe(4);
    });

    it("rejects --goal-id and --clear-goal together", async () => {
      const id = await createTaskViaTaskops("Goal flag clash");
      const result = await runCli([
        "taskops",
        "update",
        "--task-id",
        id,
        "--goal-id",
        "G-200",
        "--clear-goal",
      ]);
      expect(result.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(result.err).toMatch(/choose one/i);
    });

    it("sets, clears, and toggles effort / hard-deadline via update (change-009)", async () => {
      const id = await createTaskViaTaskops("Effort update target", [
        "--effort",
        "S",
        "--hard-deadline",
      ]);

      const upd = await runCli(
        [
          "taskops",
          "update",
          "--task-id",
          id,
          "--effort",
          "XL",
          "--hard-deadline",
          "false",
        ],
        { format: "json" },
      );
      expect(upd.exitCode).toBe(EXIT_OK);
      const updated = parseLastJsonStdoutValidated(
        upd,
        TaskopsSchemas.update.output,
      );
      expect(updated.task.effort).toBe("XL");
      expect(updated.task.hardDeadline).toBe(false);
      const afterSet = await fetchRow(id);
      expect(afterSet?.effort).toBe("XL");
      expect(afterSet?.hard_deadline).toBe(false);

      const cleared = await runCli(
        ["taskops", "update", "--task-id", id, "--clear-effort"],
        { format: "json" },
      );
      expect(cleared.exitCode).toBe(EXIT_OK);
      const clearedParsed = parseLastJsonStdoutValidated(
        cleared,
        TaskopsSchemas.update.output,
      );
      expect(clearedParsed.task.effort).toBeNull();
      const afterClear = await fetchRow(id);
      expect(afterClear?.effort).toBeNull();
    });

    it("rejects --effort and --clear-effort together", async () => {
      const id = await createTaskViaTaskops("Effort flag clash");
      const result = await runCli([
        "taskops",
        "update",
        "--task-id",
        id,
        "--effort",
        "M",
        "--clear-effort",
      ]);
      expect(result.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(result.err).toMatch(/choose one/i);
    });

    it("rejects --hard-deadline values other than true/false", async () => {
      const id = await createTaskViaTaskops("Hard deadline coercion");
      const result = await runCli([
        "taskops",
        "update",
        "--task-id",
        id,
        "--hard-deadline",
        "yes",
      ]);
      expect(result.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(result.err).toMatch(/'true' or 'false'/);
      const row = await fetchRow(id);
      expect(row?.hard_deadline).toBe(false);
    });

    it("rejects linking a non-existent goal", async () => {
      const id = await createTaskViaTaskops("No goal yet");
      const result = await runCli([
        "taskops",
        "update",
        "--task-id",
        id,
        "--goal-id",
        "G-404",
      ]);
      expect(result.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(result.err).toMatch(/G-404/);
    });
  });

  describe("taskops cancel", () => {
    it("requires --yes and refuses without it (D3)", async () => {
      const id = await createTaskViaTaskops("Cancel gate");

      const denied = await runCli(["taskops", "cancel", "--task-id", id]);
      expect(denied.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(denied.err).toMatch(/--yes/);

      const row = await fetchRow(id);
      expect(row?.status).toBe("triage");
    });

    it("with --yes marks cancelled and writes a status_change note", async () => {
      const id = await createTaskViaTaskops("Mark cancelled");
      const cancelled = await runCli(
        ["taskops", "cancel", "--task-id", id, "--yes"],
        { format: "json" },
      );
      expect(cancelled.exitCode).toBe(EXIT_OK);
      const row = await fetchRow(id);
      expect(row?.status).toBe("cancelled");
      expect(await noteCount(id, "status_change")).toBe(1);
    });

    it("refuses to cancel a task already in a terminal status", async () => {
      const id = await createTaskViaTaskops("Already done");
      await runCli(["taskops", "complete", "--task-id", id, "--yes"]);

      const denied = await runCli(["taskops", "cancel", "--task-id", id, "--yes"]);
      expect(denied.exitCode).toBe(EXIT_TRANSITION_DENIED);
      expect(denied.err).toMatch(/terminal/i);
    });
  });

  describe("taskops complete", () => {
    it("requires --yes and refuses without it (D3)", async () => {
      const id = await createTaskViaTaskops("Confirm gate");

      const denied = await runCli(["taskops", "complete", "--task-id", id]);
      expect(denied.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(denied.err).toMatch(/--yes/);

      const row = await fetchRow(id);
      expect(row?.status).toBe("triage");
    });

    it("with --yes marks done and writes a status_change note", async () => {
      const id = await createTaskViaTaskops("Mark done");
      const done = await runCli(
        ["taskops", "complete", "--task-id", id, "--yes"],
        { format: "json" },
      );
      expect(done.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdoutValidated(
        done,
        TaskopsSchemas.complete.output,
      );
      expect(parsed.from).toBe("triage");
      expect(parsed.to).toBe("done");
      const row = await fetchRow(id);
      expect(row?.status).toBe("done");
      expect(await noteCount(id, "status_change")).toBe(1);
    });

    it("appends a closing manual note when --note is supplied", async () => {
      const id = await createTaskViaTaskops("Done with note");
      const done = await runCli(
        [
          "taskops",
          "complete",
          "--task-id",
          id,
          "--yes",
          "--note",
          "Shipped; see PR #42.",
        ],
        { format: "json" },
      );
      expect(done.exitCode).toBe(EXIT_OK);
      expect(await noteCount(id, "manual")).toBe(1);
    });

    it("with --yes clears needs-attention so completed tasks leave the panel", async () => {
      const id = await createTaskViaTaskops("Dashboard trial");
      await runCli([
        "taskops",
        "flag-attention",
        "--task-id",
        id,
        "-r",
        "try out the new dashboard",
      ]);

      const done = await runCli(
        ["taskops", "complete", "--task-id", id, "--yes"],
        { format: "json" },
      );

      expect(done.exitCode).toBe(EXIT_OK);
      const row = await fetchRow(id);
      expect(row?.status).toBe("done");
      expect(row?.needs_attention).toBe(false);
      expect(row?.needs_attention_reason).toBeNull();
    });
  });

  describe("task list and show (reads stay on `execos task`)", () => {
    it("lists tasks with --status filter applied", async () => {
      await createTaskViaTaskops("List fixture one");
      await createTaskViaTaskops("List fixture two", ["-c", "business"]);

      const result = await runCli(
        ["task", "list", "--status", "triage"],
        { format: "json" },
      );
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdoutValidated(
        result,
        TaskSchemas.list.output,
      );
      expect(parsed.count).toBeGreaterThanOrEqual(2);
      expect(parsed.tasks.every((t) => t.status === "triage")).toBe(true);
    });

    it("filters tasks by due-on and due-by calendar days", async () => {
      const tomorrowId = await createTaskViaTaskops("Due tomorrow");
      const laterId = await createTaskViaTaskops("Due much later", [
        "--due",
        "2099-12-31",
      ]);

      const dueOn = await runCli(
        ["task", "list", "--due-on", "tomorrow", "--limit", "50"],
        { format: "json" },
      );
      expect(dueOn.exitCode).toBe(EXIT_OK);
      const dueOnParsed = parseLastJsonStdout(dueOn) as {
        tasks: Array<{ id: string }>;
      };
      const dueOnIds = dueOnParsed.tasks.map((t) => t.id);
      expect(dueOnIds).toContain(tomorrowId);
      expect(dueOnIds).not.toContain(laterId);

      const dueAlias = await runCli(
        ["task", "list", "--due", "tomorrow", "--limit", "50"],
        { format: "json" },
      );
      expect(dueAlias.exitCode).toBe(EXIT_OK);
      const dueAliasParsed = parseLastJsonStdout(dueAlias) as {
        tasks: Array<{ id: string }>;
      };
      const dueAliasIds = dueAliasParsed.tasks.map((t) => t.id);
      expect(dueAliasIds).toContain(tomorrowId);
      expect(dueAliasIds).not.toContain(laterId);

      const dueBy = await runCli(
        ["task", "list", "--due-by", "tomorrow", "--limit", "50"],
        { format: "json" },
      );
      expect(dueBy.exitCode).toBe(EXIT_OK);
      const dueByParsed = parseLastJsonStdout(dueBy) as {
        tasks: Array<{ id: string }>;
      };
      const dueByIds = dueByParsed.tasks.map((t) => t.id);
      expect(dueByIds).toContain(tomorrowId);
      expect(dueByIds).not.toContain(laterId);
    });

    it("show returns a task with its recent manual notes; intake audit lands in task_notes", async () => {
      const id = await createTaskViaTaskops("Show me", ["--note", "First manual note"]);

      // task show surfaces MANUAL notes only (fetchTaskDetail filters
      // noteType = "manual"); the intake audit is verified via the table.
      const result = await runCli(["task", "show", id], { format: "json" });
      const parsed = parseLastJsonStdoutValidated(
        result,
        TaskSchemas.show.output,
      );
      expect(parsed.task.id).toBe(id);
      expect(parsed.recentNotes.some((n) => n.type === "manual")).toBe(true);
      expect(await noteCount(id, "intake_checklist")).toBe(1);
    });

    it("show on a missing task returns EXIT_TASK_NOT_FOUND", async () => {
      const result = await runCli(["task", "show", "KS-99999"]);
      expect(result.exitCode).toBe(EXIT_TASK_NOT_FOUND);
    });

    it("show exposes handoffState=pending after a delegate (ISS-005)", async () => {
      const id = await createTaskViaTaskops("Delegate observability fixture");

      // Delegation resolves the owner against the team table, which
      // resetDbData() truncates; seed a roster row the slug can resolve to.
      await db.execute(
        sql`INSERT INTO team (id, slug, display_name)
            VALUES ('TM-001', 'noah', 'Noah Brooks')`,
      );

      const delegated = await runCli(
        [
          "taskops",
          "delegate",
          "--task-id",
          id,
          "--owner",
          "noah",
          "--follow-up",
          "in 3 days",
        ],
        { format: "json" },
      );
      expect(delegated.exitCode).toBe(EXIT_OK);

      const result = await runCli(["task", "show", id], { format: "json" });
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdoutValidated(
        result,
        TaskSchemas.show.output,
      );
      expect(parsed.task.handoffState).toBe("pending");
      expect(parsed.task.snoozedUntil).toBeNull();
    });

    it("show exposes snoozedUntil after a defer (ISS-005)", async () => {
      const id = await createTaskViaTaskops("Defer observability fixture");

      // Mid-year date so the asserted year is timezone-robust: an end-of-day
      // local snooze near Dec 31 serializes to the next year in UTC.
      const deferred = await runCli(
        ["taskops", "defer", "--task-id", id, "--until", "2099-06-15"],
        { format: "json" },
      );
      expect(deferred.exitCode).toBe(EXIT_OK);

      const result = await runCli(["task", "show", id], { format: "json" });
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdoutValidated(
        result,
        TaskSchemas.show.output,
      );
      expect(parsed.task.snoozedUntil).not.toBeNull();
      expect(parsed.task.snoozedUntil?.slice(0, 4)).toBe("2099");
    });
  });

  describe("taskops dependency-add / dependency-remove", () => {
    it("adds, lists, and removes a dependency edge with audit notes on BOTH tasks", async () => {
      const blocker = await createTaskViaTaskops("Dependency blocker fixture");
      const blocked = await createTaskViaTaskops("Blocked downstream fixture");

      const add = await runCli(
        [
          "taskops",
          "dependency-add",
          "--blocked",
          blocked,
          "--blocked-by",
          blocker,
        ],
        { format: "json" },
      );
      expect(add.exitCode).toBe(EXIT_OK);
      const added = parseLastJsonStdout(add) as {
        ok: boolean;
        blockedTaskId: string;
        blockerTaskId: string;
        created: boolean;
      };
      expect(added.created).toBe(true);
      expect(added.blockerTaskId).toBe(blocker);
      expect(added.blockedTaskId).toBe(blocked);
      expect(await dependencyCount(blocker, blocked)).toBe(1);
      expect(await noteCount(blocked, "system")).toBe(1);
      expect(await noteCount(blocker, "system")).toBe(1);

      const list = await runCli(
        ["task", "dependency", "list", blocked],
        { format: "json" },
      );
      expect(list.exitCode).toBe(EXIT_OK);
      const listed = parseLastJsonStdoutValidated(
        list,
        TaskSchemas.dependencyList.output,
      );
      expect(listed.blockedBy).toHaveLength(1);
      expect(listed.blockedBy[0]?.blockerTaskId).toBe(blocker);

      const duplicate = await runCli(
        [
          "taskops",
          "dependency-add",
          "--blocked",
          blocked,
          "--blocked-by",
          blocker,
        ],
        { format: "json" },
      );
      expect(duplicate.exitCode).toBe(EXIT_OK);
      const duplicateParsed = parseLastJsonStdout(duplicate) as {
        created: boolean;
      };
      expect(duplicateParsed.created).toBe(false);
      expect(await dependencyCount(blocker, blocked)).toBe(1);

      const remove = await runCli(
        [
          "taskops",
          "dependency-remove",
          "--blocked",
          blocked,
          "--blocked-by",
          blocker,
        ],
        { format: "json" },
      );
      expect(remove.exitCode).toBe(EXIT_OK);
      const removed = parseLastJsonStdout(remove) as { removed: boolean };
      expect(removed.removed).toBe(true);
      expect(await dependencyCount(blocker, blocked)).toBe(0);
      expect(await noteCount(blocked, "system")).toBe(2);
      expect(await noteCount(blocker, "system")).toBe(2);
    });

    it("rejects removing a dependency edge that does not exist", async () => {
      const a = await createTaskViaTaskops("Edgeless first fixture");
      const b = await createTaskViaTaskops("Edgeless second fixture");

      const result = await runCli([
        "taskops",
        "dependency-remove",
        "--blocked",
        a,
        "--blocked-by",
        b,
      ]);
      expect(result.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(result.err).toMatch(/does not exist/i);
    });

    it("rejects dependency cycles through the no-cycle helper", async () => {
      const a = await createTaskViaTaskops("Cycle fixture alpha");
      const b = await createTaskViaTaskops("Cycle fixture beta");

      const first = await runCli([
        "taskops",
        "dependency-add",
        "--blocked",
        b,
        "--blocked-by",
        a,
      ]);
      expect(first.exitCode).toBe(EXIT_OK);

      const cycle = await runCli([
        "taskops",
        "dependency-add",
        "--blocked",
        a,
        "--blocked-by",
        b,
      ]);
      expect(cycle.exitCode).toBe(EXIT_DEPENDENCY_CYCLE);
      expect(await dependencyCount(b, a)).toBe(0);
    });

    it("requires the blocked task via --blocked or --task-id", async () => {
      const result = await runCli([
        "taskops",
        "dependency-add",
        "--blocked-by",
        "KS-001",
      ]);
      expect(result.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(result.err).toMatch(/--blocked/);
    });
  });

  describe("taskops flag-attention / unflag-attention", () => {
    it("flags and unflags a task with an optional reason", async () => {
      const id = await createTaskViaTaskops("Attention fixture");

      const flag = await runCli(
        [
          "taskops",
          "flag-attention",
          "--task-id",
          id,
          "-r",
          "needs operator decision",
        ],
        { format: "json" },
      );
      expect(flag.exitCode).toBe(EXIT_OK);
      const flagged = await fetchRow(id);
      expect(flagged?.needs_attention).toBe(true);
      expect(flagged?.needs_attention_reason).toBe("needs operator decision");

      const unflag = await runCli(
        ["taskops", "unflag-attention", "--task-id", id],
        { format: "json" },
      );
      expect(unflag.exitCode).toBe(EXIT_OK);
      const unflagged = await fetchRow(id);
      expect(unflagged?.needs_attention).toBe(false);
      expect(unflagged?.needs_attention_reason).toBeNull();
    });

    it("rejects --reason longer than 200 chars before the DB", async () => {
      const id = await createTaskViaTaskops("Reason cap fixture");
      const tooLong = "x".repeat(201);
      const result = await runCli([
        "taskops",
        "flag-attention",
        "--task-id",
        id,
        "-r",
        tooLong,
      ]);
      expect(result.exitCode).not.toBe(EXIT_OK);
      expect(result.err).toMatch(/200/);
      const row = await fetchRow(id);
      expect(row?.needs_attention).toBe(false);
    });
  });
});
