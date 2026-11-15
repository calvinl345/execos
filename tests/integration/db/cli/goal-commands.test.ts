/**
 * End-to-end contract tests for the `execos goal` command family.
 *
 * Each test runs the production buildProgram + parseAsync path against
 * a real (dev) Supabase. stdout/stderr are captured into in-memory
 * buffers so we can assert on the exact bytes the CLI emits, and the
 * captured JSON is routed through the exported Schemas[command].output
 * so a drift between production code and the documented contract fails
 * inside the test suite.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, db } from "../../../../src/db/index.js";
import { resetDbData, insertGoal, insertTask } from "../../../db/db-test-utils.js";
import {
  runCli,
  parseLastJsonStdout,
  parseLastJsonStdoutValidated,
} from "../../../cli/test-utils.js";
import { Schemas as GoalSchemas } from "../../../../src/cli/commands/goal.js";
import {
  EXIT_GOAL_NOT_FOUND,
  EXIT_INPUT_VALIDATION,
  EXIT_OK,
  EXIT_TRANSITION_DENIED,
} from "../../../../src/cli/errors.js";

interface GoalDbRow {
  id: string;
  title: string;
  description: string;
  quarter: string;
  status: string;
  closed_at: Date | null;
}

async function fetchGoalRow(id: string): Promise<GoalDbRow | undefined> {
  const rows = await db.execute<GoalDbRow & Record<string, unknown>>(
    sql`SELECT id, title, description, quarter, status, closed_at
        FROM goals WHERE id = ${id} LIMIT 1`,
  );
  const cast = rows as unknown as GoalDbRow[];
  return cast[0];
}

async function fetchTaskStatus(id: string): Promise<string | undefined> {
  const rows = await db.execute<{ status: string } & Record<string, unknown>>(
    sql`SELECT status FROM tasks WHERE id = ${id} LIMIT 1`,
  );
  const cast = rows as unknown as Array<{ status: string }>;
  return cast[0]?.status;
}

describe("execos goal CLI", () => {
  beforeEach(async () => {
    await resetDbData();
  });

  afterAll(async () => {
    await closeDb();
  });

  // ---------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------

  describe("create", () => {
    it("creates a goal with required fields and returns the canonical row", async () => {
      const result = await runCli(
        [
          "goal",
          "create",
          "Q2 launch readiness",
          "-q",
          "2026-Q2",
          "-d",
          "A description that comfortably exceeds the ten-character minimum.",
        ],
        { format: "json" },
      );
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdoutValidated(
        result,
        GoalSchemas.create.output,
      );
      expect(parsed.ok).toBe(true);
      expect(parsed.goal.id).toMatch(/^G-\d{3,}$/);
      expect(parsed.goal.status).toBe("active");
      expect(parsed.goal.quarter).toBe("2026-Q2");
      expect(parsed.goal.closedAt).toBeNull();

      const row = await fetchGoalRow(parsed.goal.id);
      expect(row?.title).toBe("Q2 launch readiness");
      expect(row?.status).toBe("active");
    });

    it("rejects an invalid quarter code before hitting the DB", async () => {
      const result = await runCli([
        "goal",
        "create",
        "Bad quarter",
        "-q",
        "2026Q2",
        "-d",
        "A description that satisfies the ten-character minimum.",
      ]);
      expect(result.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(result.err).toMatch(/quarter/i);
    });

    it("rejects descriptions shorter than 10 chars before hitting the DB", async () => {
      const result = await runCli([
        "goal",
        "create",
        "Short desc",
        "-q",
        "2026-Q2",
        "-d",
        "too-short",
      ]);
      expect(result.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(result.err).toMatch(/at least 10 characters/);
    });

    it("requires --quarter (Commander surfaces a missing required option)", async () => {
      const result = await runCli([
        "goal",
        "create",
        "No quarter",
        "-d",
        "A description that exceeds the ten-character minimum nicely.",
      ]);
      // Commander exits non-zero when a requiredOption is missing; the
      // exact code depends on Commander's internal handling. We assert
      // the run did not succeed.
      expect(result.exitCode).not.toBe(EXIT_OK);
    });
  });

  // ---------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------

  describe("list", () => {
    it("returns active and closed goals filtered by status / quarter", async () => {
      await insertGoal("G-200");
      await insertGoal("G-201");
      // Close G-200 to dropped via SQL (faster setup than going through CLI).
      await db.execute(sql`
        UPDATE goals SET status = 'dropped', closed_at = NOW() WHERE id = 'G-200'
      `);

      const all = await runCli(["goal", "list"], { format: "json" });
      expect(all.exitCode).toBe(EXIT_OK);
      const allParsed = parseLastJsonStdoutValidated(all, GoalSchemas.list.output);
      expect(allParsed.count).toBeGreaterThanOrEqual(2);

      const activeOnly = await runCli(
        ["goal", "list", "-s", "active"],
        { format: "json" },
      );
      const activeParsed = parseLastJsonStdoutValidated(
        activeOnly,
        GoalSchemas.list.output,
      );
      expect(activeParsed.goals.every((g) => g.status === "active")).toBe(true);
      expect(activeParsed.goals.some((g) => g.id === "G-201")).toBe(true);
      expect(activeParsed.goals.some((g) => g.id === "G-200")).toBe(false);

      const byQuarter = await runCli(
        ["goal", "list", "-q", "2026-Q2"],
        { format: "json" },
      );
      const qParsed = parseLastJsonStdoutValidated(
        byQuarter,
        GoalSchemas.list.output,
      );
      expect(qParsed.goals.every((g) => g.quarter === "2026-Q2")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // show
  // ---------------------------------------------------------------------

  describe("show", () => {
    it("includes done and in-progress tasks in linkedTaskCount", async () => {
      const goalId = await insertGoal("G-300");
      const t1 = await insertTask({
        id: "KS-300",
        title: "Done task",
        description: "Linked-and-done description meeting min length.",
        status: "done",
      });
      const t2 = await insertTask({
        id: "KS-301",
        title: "In-progress task",
        description: "Linked-and-active description meeting min length.",
        status: "in_progress",
      });
      const t3 = await insertTask({
        id: "KS-302",
        title: "Triage task",
        description: "Linked-and-fresh description meeting min length.",
      });
      await db.execute(sql`UPDATE tasks SET goal_id = ${goalId} WHERE id IN (${t1}, ${t2}, ${t3})`);

      const result = await runCli(
        ["goal", "show", goalId],
        { format: "json" },
      );
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdoutValidated(
        result,
        GoalSchemas.show.output,
      );
      // Linked-task count includes terminal-status tasks (done/cancelled).
      expect(parsed.linkedTaskCount).toBe(3);
      expect(parsed.linkedTasksPreview.length).toBeGreaterThan(0);
      expect(parsed.linkedTasksPreview.length).toBeLessThanOrEqual(10);
    });

    it("returns goal_not_found for a missing id", async () => {
      const result = await runCli(["goal", "show", "G-999"]);
      expect(result.exitCode).toBe(EXIT_GOAL_NOT_FOUND);
      expect(result.err).toMatch(/G-999/);
    });
  });

  // ---------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------

  describe("update", () => {
    it("updates title / description / quarter without changing status", async () => {
      const goalId = await insertGoal("G-400");
      const result = await runCli(
        [
          "goal",
          "update",
          goalId,
          "-t",
          "Renamed",
          "-q",
          "2026-Q3",
          "-d",
          "Description after update with sufficient length.",
        ],
        { format: "json" },
      );
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdoutValidated(
        result,
        GoalSchemas.update.output,
      );
      expect(parsed.goal.title).toBe("Renamed");
      expect(parsed.goal.quarter).toBe("2026-Q3");
      expect(parsed.goal.status).toBe("active"); // unchanged
    });

    it("rejects an invalid quarter on update", async () => {
      const goalId = await insertGoal("G-401");
      const result = await runCli(["goal", "update", goalId, "-q", "Q1-2026"]);
      expect(result.exitCode).toBe(EXIT_INPUT_VALIDATION);
    });

    it("requires at least one field to mutate", async () => {
      const goalId = await insertGoal("G-402");
      const result = await runCli(["goal", "update", goalId]);
      expect(result.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(result.err).toMatch(/--title|--description|--quarter/);
    });
  });

  // ---------------------------------------------------------------------
  // close-achieved / close-dropped
  // ---------------------------------------------------------------------

  describe("close-achieved / close-dropped", () => {
    it("requires --yes to confirm a terminal status change", async () => {
      const goalId = await insertGoal("G-500");
      const result = await runCli(["goal", "close-achieved", goalId]);
      expect(result.exitCode).toBe(EXIT_INPUT_VALIDATION);
      expect(result.err).toMatch(/--yes/);
      const row = await fetchGoalRow(goalId);
      expect(row?.status).toBe("active"); // not closed
    });

    it("closes a goal as achieved when --yes is supplied", async () => {
      const goalId = await insertGoal("G-501");
      const result = await runCli(
        ["goal", "close-achieved", goalId, "--yes"],
        { format: "json" },
      );
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdoutValidated(
        result,
        GoalSchemas.closeAchieved.output,
      );
      expect(parsed.from).toBe("active");
      expect(parsed.to).toBe("achieved");

      const row = await fetchGoalRow(goalId);
      expect(row?.status).toBe("achieved");
      expect(row?.closed_at).toBeTruthy();
    });

    it("closes a goal as dropped when --yes is supplied", async () => {
      const goalId = await insertGoal("G-502");
      const result = await runCli(
        ["goal", "close-dropped", goalId, "--yes"],
        { format: "json" },
      );
      expect(result.exitCode).toBe(EXIT_OK);
      const parsed = parseLastJsonStdoutValidated(
        result,
        GoalSchemas.closeDropped.output,
      );
      expect(parsed.to).toBe("dropped");

      const row = await fetchGoalRow(goalId);
      expect(row?.status).toBe("dropped");
    });

    it("denies a transition from a terminal status", async () => {
      const goalId = await insertGoal("G-503");
      await db.execute(
        sql`UPDATE goals SET status = 'achieved', closed_at = NOW() WHERE id = ${goalId}`,
      );
      const result = await runCli(["goal", "close-dropped", goalId, "--yes"]);
      expect(result.exitCode).toBe(EXIT_TRANSITION_DENIED);
      expect(result.err).toMatch(/terminal/i);
    });

    // Linked tasks remain on their independent lifecycle when a goal
    // closes (per Appendix A.2.1 notes: no auto-cascade).
    it("does NOT auto-close linked tasks when goal closes (achieved or dropped)", async () => {
      const goalId = await insertGoal("G-504");
      const tDone = await insertTask({
        id: "KS-600",
        title: "Done already",
        description: "Already complete linked task description for cascade test.",
        status: "done",
      });
      const tOpen = await insertTask({
        id: "KS-601",
        title: "In progress",
        description: "Open linked task description that should NOT close.",
        status: "in_progress",
      });
      await db.execute(
        sql`UPDATE tasks SET goal_id = ${goalId} WHERE id IN (${tDone}, ${tOpen})`,
      );

      const result = await runCli(
        ["goal", "close-achieved", goalId, "--yes"],
        { format: "json" },
      );
      expect(result.exitCode).toBe(EXIT_OK);

      // Goal now achieved; linked tasks must NOT have moved off their
      // own lifecycle. The "done" one stays done (was always terminal),
      // the "in_progress" one stays in_progress.
      expect(await fetchTaskStatus(tDone)).toBe("done");
      expect(await fetchTaskStatus(tOpen)).toBe("in_progress");
    });
  });

  // ---------------------------------------------------------------------
  // linked-tasks
  // ---------------------------------------------------------------------

  describe("linked-tasks", () => {
    it("returns every task linked to the goal, with optional status filter", async () => {
      const goalId = await insertGoal("G-700");
      const t1 = await insertTask({
        id: "KS-700",
        title: "T1",
        description: "Linked task t1 description meeting the min length.",
        status: "in_progress",
      });
      const t2 = await insertTask({
        id: "KS-701",
        title: "T2",
        description: "Linked task t2 description meeting the min length.",
        status: "done",
      });
      const t3 = await insertTask({
        id: "KS-702",
        title: "T3",
        description: "Linked task t3 description meeting the min length.",
        status: "in_progress",
      });
      await db.execute(
        sql`UPDATE tasks SET goal_id = ${goalId} WHERE id IN (${t1}, ${t2}, ${t3})`,
      );

      const all = await runCli(
        ["goal", "linked-tasks", goalId],
        { format: "json" },
      );
      expect(all.exitCode).toBe(EXIT_OK);
      const allParsed = parseLastJsonStdoutValidated(
        all,
        GoalSchemas.linkedTasks.output,
      );
      expect(allParsed.count).toBe(3);

      const activeOnly = await runCli(
        ["goal", "linked-tasks", goalId, "-s", "in_progress"],
        { format: "json" },
      );
      const activeParsed = parseLastJsonStdoutValidated(
        activeOnly,
        GoalSchemas.linkedTasks.output,
      );
      expect(activeParsed.count).toBe(2);
      expect(activeParsed.tasks.every((t) => t.status === "in_progress")).toBe(true);
    });

    it("returns goal_not_found when the goal does not exist", async () => {
      const result = await runCli(["goal", "linked-tasks", "G-998"]);
      expect(result.exitCode).toBe(EXIT_GOAL_NOT_FOUND);
    });
  });

  // ---------------------------------------------------------------------
  // Transition matrix coverage at the CLI surface (Appendix A.2.1)
  // ---------------------------------------------------------------------

  describe("CLI-surface transition matrix coverage", () => {
    it("active -> achieved allowed; achieved -> active denied (resurrection); active -> dropped allowed", async () => {
      // active -> achieved
      const g1 = await insertGoal("G-800");
      const r1 = await runCli(["goal", "close-achieved", g1, "--yes"]);
      expect(r1.exitCode).toBe(EXIT_OK);

      // achieved -> active not exposed (no --status flag on update);
      // CLI denial is structural rather than runtime here. Assert that
      // close-* from a terminal status is denied (covered above).

      // active -> dropped
      const g2 = await insertGoal("G-801");
      const r2 = await runCli(["goal", "close-dropped", g2, "--yes"]);
      expect(r2.exitCode).toBe(EXIT_OK);
      const row = await fetchGoalRow(g2);
      expect(row?.status).toBe("dropped");
    });

    it("does not allow status mutation through `goal update` (only close-* paths)", async () => {
      // The update subcommand has no --status option. Confirm by
      // asserting that we cannot pass it.
      const goalId = await insertGoal("G-802");
      const result = await runCli([
        "goal",
        "update",
        goalId,
        "--status",
        "achieved",
      ]);
      // Commander rejects unknown options with a non-zero code.
      expect(result.exitCode).not.toBe(EXIT_OK);
      const row = await fetchGoalRow(goalId);
      expect(row?.status).toBe("active");
    });
  });

  // ---------------------------------------------------------------------
  // text-mode smoke (one representative test to confirm we render
  // something sensible without --format json)
  // ---------------------------------------------------------------------

  it("text mode renders a created goal with id, quarter, status", async () => {
    const result = await runCli([
      "goal",
      "create",
      "Text mode goal",
      "-q",
      "2026-Q2",
      "-d",
      "Text mode goal description meeting min length.",
    ]);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.out).toMatch(/Created G-\d{3,}/);
    expect(result.out).toMatch(/2026-Q2/);
    expect(result.out).toMatch(/active/);
    // Sanity: the text path did not accidentally emit a JSON document.
    expect(parseLastJsonStdout(result)).toBeNull();
  });
});
