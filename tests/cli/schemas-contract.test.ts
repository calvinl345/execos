/**
 * Contract tests for the typed CLI command Schemas.
 *
 * Verifies for every subcommand in `task.ts`, `health.ts`, `review.ts`,
 * `goal.ts`, `memory.ts`, and `resource.ts`:
 *   1. The exported `output` Zod schema parses representative real outputs
 *      from the production code path without error.
 *   2. The exported `exitCodes` list intersects the canonical EXIT_*
 *      constants in `src/cli/errors.ts`. Every listed code is a known
 *      exit code; EXIT_OK and EXIT_GENERIC are universally present.
 *   3. The exported `errorCategories` list contains category strings the
 *      production `classifyError` mapper actually emits (or can plausibly
 *      emit via the documented error path).
 *
 * These tests do NOT exercise the Commander wiring - they read the
 * Schemas objects as data. Schemas live alongside Commander, not as a
 * replacement.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Schemas as TaskSchemas } from "../../src/cli/commands/task.js";
import { Schemas as GoalSchemas } from "../../src/cli/commands/goal.js";
import { Schemas as HealthSchemas } from "../../src/cli/commands/health.js";
import { Schemas as ReviewSchemas } from "../../src/cli/commands/review.js";
import { Schemas as MemorySchemas } from "../../src/cli/commands/memory.js";
import { Schemas as ResourceSchemas } from "../../src/cli/commands/resource.js";
import { Schemas as TaskopsSchemas } from "../../src/cli/commands/taskops.js";
import {
  EXIT_OK,
  EXIT_GENERIC,
  EXIT_INPUT_VALIDATION,
  EXIT_NOT_FOUND,
  EXIT_TASK_NOT_FOUND,
  EXIT_APP_SETTING_MISSING,
  EXIT_GOAL_NOT_FOUND,
  EXIT_POLICY,
  EXIT_TRANSITION_DENIED,
  EXIT_DEPENDENCY_CYCLE,
  EXIT_WIP_CAP_EXCEEDED,
  EXIT_HEALTH_FAIL,
  EXIT_CONFIG,
  EXIT_INPUT,
  EXIT_STORAGE,
} from "../../src/cli/errors.js";

const KNOWN_EXIT_CODES = new Set<number>([
  EXIT_OK,
  EXIT_GENERIC,
  EXIT_INPUT,
  EXIT_INPUT_VALIDATION,
  EXIT_NOT_FOUND,
  EXIT_TASK_NOT_FOUND,
  EXIT_APP_SETTING_MISSING,
  EXIT_GOAL_NOT_FOUND,
  EXIT_POLICY,
  EXIT_TRANSITION_DENIED,
  EXIT_DEPENDENCY_CYCLE,
  EXIT_WIP_CAP_EXCEEDED,
  EXIT_STORAGE,
  EXIT_HEALTH_FAIL,
  EXIT_CONFIG,
]);

const KNOWN_ERROR_CATEGORIES = new Set<string>([
  "input_validation",
  "task_not_found",
  "goal_not_found",
  "app_setting_missing",
  "transition_denied",
  "task_dependency_cycle",
  "p0_wip_cap_exceeded",
  "health_fail",
  "resource_storage",
  "unhandled",
  // DbError codes lower-cased per classifyError fallback. Allowed but not
  // required to be enumerated.
]);

interface SchemaEntry {
  input: z.ZodTypeAny;
  output: z.ZodTypeAny;
  exitCodes: readonly number[];
  errorCategories: readonly string[];
}

function assertContract(
  groupName: string,
  cmdName: string,
  entry: SchemaEntry,
): void {
  // Every Schemas entry must have all four members shaped correctly.
  expect(entry.input, `${groupName}.${cmdName}.input`).toBeDefined();
  expect(entry.output, `${groupName}.${cmdName}.output`).toBeDefined();
  expect(
    Array.isArray(entry.exitCodes),
    `${groupName}.${cmdName}.exitCodes is array`,
  ).toBe(true);
  expect(
    Array.isArray(entry.errorCategories),
    `${groupName}.${cmdName}.errorCategories is array`,
  ).toBe(true);

  // EXIT_OK and EXIT_GENERIC are universal.
  expect(
    entry.exitCodes.includes(EXIT_OK),
    `${groupName}.${cmdName} must include EXIT_OK`,
  ).toBe(true);
  expect(
    entry.exitCodes.includes(EXIT_GENERIC),
    `${groupName}.${cmdName} must include EXIT_GENERIC`,
  ).toBe(true);

  // Every exit code must be a known constant.
  for (const code of entry.exitCodes) {
    expect(
      KNOWN_EXIT_CODES.has(code),
      `${groupName}.${cmdName}: exit code ${code} is not a known EXIT_* constant`,
    ).toBe(true);
  }

  // "unhandled" is universally reachable via classifyError fallback.
  expect(
    entry.errorCategories.includes("unhandled"),
    `${groupName}.${cmdName} must include "unhandled" error category`,
  ).toBe(true);

  for (const cat of entry.errorCategories) {
    expect(
      KNOWN_ERROR_CATEGORIES.has(cat),
      `${groupName}.${cmdName}: error category "${cat}" is not in the known set`,
    ).toBe(true);
  }
}

describe("CLI command Schemas", () => {
  it("task.Schemas registers every task subcommand with full contract", () => {
    const expected = ["list", "show", "dependencyList"];
    expect(Object.keys(TaskSchemas).sort()).toEqual([...expected].sort());
    for (const name of expected) {
      assertContract("task", name, TaskSchemas[name as keyof typeof TaskSchemas]);
    }
  });

  it("health.Schemas registers the health subcommand with full contract", () => {
    expect(Object.keys(HealthSchemas)).toEqual(["health"]);
    assertContract("health", "health", HealthSchemas.health);
  });

  it("review.Schemas registers every review subcommand with full contract", () => {
    const expected = ["next", "morning", "refreshAttention", "eod", "weekly"];
    expect(Object.keys(ReviewSchemas).sort()).toEqual([...expected].sort());
    for (const name of expected) {
      assertContract(
        "review",
        name,
        ReviewSchemas[name as keyof typeof ReviewSchemas],
      );
    }
  });

  it("goal.Schemas registers every goal subcommand with full contract", () => {
    const expected = [
      "create",
      "update",
      "closeAchieved",
      "closeDropped",
      "list",
      "show",
      "linkedTasks",
    ];
    expect(Object.keys(GoalSchemas).sort()).toEqual([...expected].sort());
    for (const name of expected) {
      assertContract("goal", name, GoalSchemas[name as keyof typeof GoalSchemas]);
    }
  });

  it("memory.Schemas registers every memory subcommand with full contract", () => {
    const expected = [
      "save",
      "recall",
      "list",
      "forget",
      "audit",
      "update",
      "syncToNotion",
    ];
    expect(Object.keys(MemorySchemas).sort()).toEqual([...expected].sort());
    for (const name of expected) {
      assertContract(
        "memory",
        name,
        MemorySchemas[name as keyof typeof MemorySchemas],
      );
    }
  });

  it("resource.Schemas registers every resource subcommand with full contract", () => {
    expect(Object.keys(ResourceSchemas)).toEqual(["add"]);
    assertContract("resource", "add", ResourceSchemas.add);
  });

  it("taskops.Schemas registers every taskops subcommand with full contract", () => {
    const expected = [
      "hydrate",
      "create",
      "update",
      "complete",
      "reopen",
      "delegate",
      "followUp",
      "defer",
      "show",
      "list",
      "hydrateReRank",
      "followUps",
      "draftFollowUps",
      "re-rank",
    ];
    expect(Object.keys(TaskopsSchemas).sort()).toEqual([...expected].sort());
    for (const name of expected) {
      assertContract(
        "taskops",
        name,
        TaskopsSchemas[name as keyof typeof TaskopsSchemas],
      );
    }
  });

  // ---------------------------------------------------------------------
  // Output schemas parse representative real outputs.
  //
  // Fixtures here mirror the JSON shapes emitted by the production action
  // implementations (see runCreate / runList / runShow / runHealth /
  // runMorning / etc). When a future code change drifts the JSON shape,
  // the corresponding Schemas.output.parse() call fails, surfacing the
  // contract drift inside the test suite rather than at MCP / dashboard
  // integration time.
  // ---------------------------------------------------------------------

  describe("taskops output schemas accept representative outputs", () => {
    it("hydrate / show / list", () => {
      const nowIso = new Date().toISOString();
      TaskopsSchemas.hydrate.output.parse({ ok: true, prompt: "hydrate prompt", as_of: nowIso });
      TaskopsSchemas.show.output.parse({ ok: true, prompt: "show prompt", as_of: nowIso });
      TaskopsSchemas.list.output.parse({ ok: true, prompt: "list prompt", as_of: nowIso });
    });

    it("re-rank hydrate (empty + populated risk sections)", () => {
      const nowIso = new Date().toISOString();
      TaskopsSchemas.hydrateReRank.output.parse({
        ok: true,
        prompt: "re-rank prompt",
        as_of: nowIso,
        sections: {
          situational_context: null,
          commitments_at_risk: [],
          goals_at_risk: [],
          newly_unblocked: [],
          queue: [],
        },
      });
      TaskopsSchemas.hydrateReRank.output.parse({
        ok: true,
        prompt: "re-rank prompt",
        as_of: nowIso,
        sections: {
          situational_context: "marketing is urgent today",
          queue: [
            {
              taskId: "KS-009",
              title: "Queued task",
              rank: 1,
              rationale: "P1, due today",
              rankedAt: nowIso,
            },
          ],
          commitments_at_risk: [
            {
              id: "KS-001",
              title: "Ship the Acme export",
              status: "blocked",
              priority: "P1",
              owner: "noah",
              dueDate: nowIso,
              daysLeft: -2,
              windowDays: 3,
              rule: "overdue",
            },
            {
              id: "KS-002",
              title: "File the quarterly report",
              status: "in_progress",
              priority: null,
              owner: null,
              dueDate: nowIso,
              daysLeft: 2,
              windowDays: 3,
              rule: "within-window",
            },
          ],
          goals_at_risk: [
            {
              goalId: "G-001",
              title: "Q2 launch",
              quarter: "2026-Q2",
              quarterEnd: nowIso,
              daysLeft: 10,
              windowDays: 14,
              openCount: 4,
              doneCount: 7,
            },
          ],
          newly_unblocked: [
            {
              id: "KS-003",
              title: "Resume the migration",
              status: "blocked",
              priority: "P2",
              owner: "me",
              lastUnblockedAt: nowIso,
            },
          ],
        },
      });
    });

    it("create", () => {
      TaskopsSchemas.create.output.parse({
        ok: true,
        task: {
          id: "KS-001",
          title: "Test",
          description: "Long test description",
          category: "personal",
          priority: null,
          owner: "me",
          dueAt: new Date().toISOString(),
          followUpAt: null,
          goalId: null,
          status: "triage",
          hardDeadline: true,
          effort: "M",
        },
      });
    });

    it("update", () => {
      TaskopsSchemas.update.output.parse({
        ok: true,
        task: {
          id: "KS-001",
          title: "Test",
          description: "Long test description",
          category: "personal",
          priority: null,
          owner: "me",
          dueAt: new Date().toISOString(),
          followUpAt: null,
          goalId: null,
          status: "in_progress",
          hardDeadline: false,
          effort: null,
        },
      });
    });

    it("delegate / followUp / defer", () => {
      const nowIso = new Date().toISOString();
      const task = {
        id: "KS-001",
        title: "Test",
        description: "Long test description",
        category: "personal",
        priority: null,
        owner: "noah",
        dueAt: nowIso,
        followUpAt: nowIso,
        goalId: null,
        status: "in_progress",
        hardDeadline: false,
        effort: "L",
      };

      TaskopsSchemas.delegate.output.parse({
        ok: true,
        receipt: {
          operation: "delegate",
          taskId: "KS-001",
          owner: "noah",
          ownerDisplayName: "Noah Brooks",
          followUpAt: nowIso,
          dueAt: nowIso,
          noteId: null,
          activityId: "ACT-001",
          warnings: [],
          defaultFollowUpApplied: false,
          ownerOpenTasks: [{ id: "KS-002", title: "Other", status: "blocked", dueAt: null, followUpAt: null }],
          task,
        },
      });

      TaskopsSchemas.followUp.output.parse({
        ok: true,
        receipt: {
          operation: "follow-up",
          taskId: "KS-001",
          nextFollowUpAt: nowIso,
          dueAt: nowIso,
          status: "blocked",
          noteId: "N-001",
          activityId: "ACT-002",
          warnings: [],
          task: { ...task, status: "blocked" },
        },
      });

      TaskopsSchemas.defer.output.parse({
        ok: true,
        receipt: {
          operation: "defer",
          taskId: "KS-001",
          followUpAt: nowIso,
          activityId: "ACT-003",
          warnings: [],
          task,
        },
      });
    });

    it("complete", () => {
      TaskopsSchemas.complete.output.parse({
        ok: true,
        taskId: "KS-001",
        from: "in_progress",
        to: "done",
      });
      TaskopsSchemas.reopen.output.parse({
        ok: true,
        taskId: "KS-001",
        from: "done",
        to: "in_progress",
      });
    });
  });

  describe("task output schemas accept representative outputs", () => {
    const nowIso = new Date("2026-04-28T12:00:00.000Z").toISOString();
    const baseTask = {
      id: "KS-001",
      title: "Test task",
      description: "Test description that is long enough",
      status: "triage" as const,
      priority: null,
      category: "business" as const,
      owner: "me",
      dueAt: nowIso,
      hardDeadline: false,
      effort: null,
      followUpAt: null,
      snoozedUntil: null,
      handoffState: "not_applicable" as const,
      handoffCopiedAt: null,
      handoffLastCopiedAt: null,
      handoffLastNudgeCopiedAt: null,
      goalId: null,
      queueRank: null,
      queueRationale: null,
      queueRankedAt: null,
      needsAttention: false,
      needsAttentionReason: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastStatusChangeAt: nowIso,
      completedAt: null,
      cancelledAt: null,
    };

    it("list (empty + populated)", () => {
      TaskSchemas.list.output.parse({ ok: true, count: 0, tasks: [] });
      TaskSchemas.list.output.parse({
        ok: true,
        count: 1,
        tasks: [baseTask],
      });
    });

    it("show", () => {
      TaskSchemas.show.output.parse({
        ok: true,
        task: baseTask,
        recentNotes: [
          {
            id: "abc123",
            type: "intake_checklist",
            createdAt: nowIso,
            createdBy: "agent",
            content: "{}",
          },
        ],
      });
    });

    it("dependency list", () => {
      const dependency = {
        id: "dep123",
        blockerTaskId: "KS-001",
        blockedTaskId: "KS-002",
        createdAt: nowIso,
      };
      TaskSchemas.dependencyList.output.parse({
        ok: true,
        taskId: "KS-001",
        blockedBy: [],
        blocks: [dependency],
      });
    });
  });

  describe("health output schema accepts representative outputs", () => {
    const ranAt = new Date("2026-04-28T12:00:00.000Z").toISOString();

    it("clean install (all not_configured)", () => {
      HealthSchemas.health.output.parse({
        ok: true,
        status: "not_configured",
        ranAt,
        probes: [
          {
            name: "supabase",
            status: "ok",
            durationMs: 24,
            details: { extensions: ["vector", "pg_trgm"] },
          },
          {
            name: "embed",
            status: "not_configured",
            durationMs: 0,
            reason: "Embedding provider probe is not configured.",
          },
        ],
      });
    });

    it("hard fail", () => {
      HealthSchemas.health.output.parse({
        ok: false,
        status: "fail",
        ranAt,
        probes: [
          {
            name: "supabase",
            status: "fail",
            durationMs: 0,
            error: "ECONNREFUSED",
          },
        ],
      });
    });
  });

  describe("review output schemas accept representative outputs", () => {
    const nowIso = new Date("2026-04-28T12:00:00.000Z").toISOString();
    const ranked = {
      taskId: "KS-001",
      title: "Test",
      reasons: {
        tier: "P1",
        overdue: false,
        dueToday: true,
        goalLinked: false,
      },
      task: {
        id: "KS-001",
        title: "Test",
        description: "Representative task description.",
        status: "triage",
        priority: "P1",
        category: "personal",
        owner: "execos",
        dueAt: nowIso,
        goalId: null,
        needsAttention: false,
        needsAttentionReason: null,
      },
    };

    it("next (empty + populated)", () => {
      ReviewSchemas.next.output.parse({ ok: true, top: null, evaluated: 0 });
      ReviewSchemas.next.output.parse({
        ok: true,
        top: ranked,
        evaluated: 5,
      });
    });

    it("morning", () => {
      ReviewSchemas.morning.output.parse({
        ok: true,
        generatedAt: nowIso,
        evaluated: 3,
        top: [ranked],
        activeGoals: [{ id: "G-001", title: "Q2 goal", quarter: "2026-Q2" }],
        needsAttention: [
          {
            taskId: "KS-002",
            title: "Stuck",
            description: "Representative stuck task description.",
            needsAttentionSetAt: nowIso,
            reason: "blocked",
          },
        ],
        calendar: {
          status: "not_configured",
          reason: "Calendar enrichment is not configured.",
        },
      });
    });

    it("refreshAttention", () => {
      ReviewSchemas.refreshAttention.output.parse({
        ok: true,
        generatedAt: nowIso,
        evaluated: 3,
        selected: [
          {
            taskId: "KS-001",
            title: "Focus",
            task: ranked.task,
            reasons: ranked.reasons,
            reason: "daily focus: P1, due today",
            action: "flagged",
          },
        ],
        cleared: [
          {
            taskId: "KS-002",
            title: "Old focus",
            previousReason: "stale",
          },
        ],
      });
    });

    it("eod", () => {
      ReviewSchemas.eod.output.parse({
        ok: true,
        scope: "eod",
        timeZone: "America/Los_Angeles",
        date: "2026-04-28",
        windowStart: nowIso,
        windowEnd: nowIso,
        changedTaskCount: 2,
        items: [
          {
            taskId: "KS-001",
            title: "Test",
            description: "Representative task description.",
            statusChain: ["triage", "in_progress", "done"],
          },
        ],
        completedToday: [
          {
            taskId: "KS-001",
            title: "Test",
            description: "Representative task description.",
            completedAt: nowIso,
          },
        ],
        newlyStalled: [
          {
            taskId: "KS-002",
            title: "Stuck",
            description: "Representative stalled task description.",
            status: "in_progress",
            updatedAt: nowIso,
            daysSinceUpdate: 7,
          },
        ],
        tomorrowTop: [ranked],
        tomorrowProjectionReferenceTime: nowIso,
      });
    });

    it("weekly", () => {
      ReviewSchemas.weekly.output.parse({
        ok: true,
        scope: "weekly",
        timeZone: "America/Los_Angeles",
        windowStart: nowIso,
        windowEnd: nowIso,
        changedTaskCount: 0,
        items: [],
        shippedThisWeek: [],
        atRisk: [
          {
            taskId: "KS-003",
            title: "Overdue",
            task: {
              ...ranked.task,
              id: "KS-003",
              title: "Overdue",
              description: "Representative overdue task description.",
            },
            reason: "overdue+stale",
          },
        ],
        goalSummary: [
          {
            goalId: "G-001",
            title: "Q2",
            quarter: "2026-Q2",
            advanced: 2,
            stalled: 1,
            totalLinked: 5,
          },
        ],
        nextWeekFocus: [ranked],
        nextWeekProjectionReferenceTime: nowIso,
      });
    });
  });

  describe("memory output schemas accept representative outputs", () => {
    const nowIso = new Date("2026-04-28T12:00:00.000Z").toISOString();
    const memory = {
      id: "M-abc123",
      scope: "clients/larkspur/billing",
      content: "Larkspur billing memory",
      applicability: "When billing Larkspur",
      state: "active" as const,
      supersededById: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      prunedAt: null,
    };

    it("save", () => {
      MemorySchemas.save.output.parse({
        ok: true,
        memory: {
          id: memory.id,
          scope: memory.scope,
          content: memory.content,
          applicability: memory.applicability,
          state: "active",
        },
        dedup: null,
        decisionCapture: null,
      });
      MemorySchemas.save.output.parse({
        ok: true,
        memory: {
          id: "M-decision",
          scope: "decisions/general",
          content: "Going with OpenAI over Voyage.",
          applicability: "When reviewing provider choices.",
          state: "active",
        },
        dedup: {
          matchedId: "M-old",
          similarity: 0.93,
          action: "replace",
        },
        decisionCapture: {
          matchedPattern: "going_with_over",
          scope: "decisions/general",
        },
      });
    });

    it("recall / list / audit", () => {
      MemorySchemas.recall.output.parse({
        ok: true,
        count: 1,
        memories: [{ ...memory, score: 0.91 }],
      });
      MemorySchemas.recall.input.parse({
        query: "billing source of truth",
      });
      MemorySchemas.recall.input.parse({
        scope: "clients/larkspur",
        query: "billing source of truth",
      });
      MemorySchemas.list.output.parse({ ok: true, count: 1, memories: [memory] });
      MemorySchemas.audit.output.parse({
        ok: true,
        count: 1,
        memories: [{ ...memory, state: "superseded", supersededById: "M-next" }],
      });
    });

    it("forget / update / sync-to-notion", () => {
      MemorySchemas.forget.output.parse({
        ok: true,
        memoryId: "M-abc123",
        state: "pruned",
      });
      MemorySchemas.update.output.parse({
        ok: true,
        memoryId: "M-next",
        supersededMemoryId: "M-abc123",
        state: "active",
      });
      MemorySchemas.syncToNotion.output.parse({
        ok: true,
        memoryId: "M-abc123",
        synced: false,
        target: "notion",
        reason: "Notion MCP unreachable; memory saved locally - say 'sync to Notion' again later to retry.",
      });
    });
  });

  describe("resource output schemas accept representative outputs", () => {
    it("add", () => {
      ResourceSchemas.add.output.parse({
        ok: true,
        document: {
          id: "DOC-abc123",
          filename: "resources-page-smoke.txt",
          category: "personal",
          storagePath: "personal/2026-04-30/DOC-abc123-resources-page-smoke.txt",
          sizeBytes: 100,
          mimeType: "text/plain",
          linkedTaskIds: ["KS-143"],
        },
        storage: {
          bucket: "documents",
          bucketCreated: false,
        },
      });
    });
  });

  // ---------------------------------------------------------------------
  // Input schemas reject malformed inputs (bounded sanity check).
  // ---------------------------------------------------------------------

  it("input schemas reject malformed inputs", () => {
    expect(() =>
      TaskSchemas.show.input.parse({ id: "not-a-task-id" }),
    ).toThrow();
    expect(() =>
      TaskSchemas.list.input.parse({ status: "not-a-status" }),
    ).toThrow();
    expect(() =>
      TaskSchemas.dependencyList.input.parse({ taskId: "not-a-task-id" }),
    ).toThrow();
    expect(() =>
      MemorySchemas.save.input.parse({
        scope: "Clients/Bad",
        content: "ok",
        applicability: "ok",
      }),
    ).toThrow();
    expect(() =>
      MemorySchemas.save.input.parse({
        scope: "clients/good",
        content: "ok",
        applicability: "ok",
        onDuplicate: "overwrite",
      }),
    ).toThrow();
    expect(() =>
      MemorySchemas.recall.input.parse({
        scope: "Clients/Bad",
        query: "ok",
      }),
    ).toThrow();
    expect(() =>
      ResourceSchemas.add.input.parse({
        path: "C:/tmp/file.pdf",
        category: "not-a-category",
      }),
    ).toThrow();
    expect(() =>
      ResourceSchemas.add.input.parse({
        path: "C:/tmp/file.pdf",
        category: "personal",
        task: ["not-a-task-id"],
      }),
    ).toThrow();
  });

  // ---------------------------------------------------------------------
  // Goal output schemas accept representative outputs.
  // ---------------------------------------------------------------------

  describe("goal output schemas accept representative outputs", () => {
    const nowIso = new Date("2026-04-28T12:00:00.000Z").toISOString();
    const baseGoal = {
      id: "G-001",
      title: "Q2 launch",
      description: "Description that exceeds the ten-character minimum.",
      quarter: "2026-Q2",
      status: "active" as const,
      createdAt: nowIso,
      updatedAt: nowIso,
      closedAt: null,
    };

    it("create", () => {
      GoalSchemas.create.output.parse({ ok: true, goal: baseGoal });
    });

    it("update", () => {
      GoalSchemas.update.output.parse({
        ok: true,
        goal: { ...baseGoal, title: "Renamed" },
      });
    });

    it("close-achieved / close-dropped", () => {
      GoalSchemas.closeAchieved.output.parse({
        ok: true,
        goalId: "G-001",
        from: "active",
        to: "achieved",
        changedAt: nowIso,
      });
      GoalSchemas.closeDropped.output.parse({
        ok: true,
        goalId: "G-001",
        from: "active",
        to: "dropped",
        changedAt: nowIso,
      });
    });

    it("list (empty + populated)", () => {
      GoalSchemas.list.output.parse({ ok: true, count: 0, goals: [] });
      GoalSchemas.list.output.parse({
        ok: true,
        count: 1,
        goals: [baseGoal],
      });
    });

    it("show with linked-task preview", () => {
      GoalSchemas.show.output.parse({
        ok: true,
        goal: baseGoal,
        linkedTaskCount: 3,
        linkedTasksPreview: [
          {
            id: "KS-001",
            title: "Linked",
            status: "in_progress",
            priority: "P1",
            needsAttention: false,
          },
          {
            id: "KS-002",
            title: "Done linked",
            status: "done",
            priority: null,
            needsAttention: false,
          },
        ],
      });
    });

    it("linked-tasks (empty + populated)", () => {
      GoalSchemas.linkedTasks.output.parse({
        ok: true,
        goalId: "G-001",
        count: 0,
        tasks: [],
      });
      GoalSchemas.linkedTasks.output.parse({
        ok: true,
        goalId: "G-001",
        count: 1,
        tasks: [
          {
            id: "KS-001",
            title: "Linked task",
            status: "in_progress",
            priority: "P0",
            category: "business",
            owner: "me",
            dueAt: null,
            needsAttention: false,
            lastStatusChangeAt: nowIso,
          },
        ],
      });
    });
  });

  it("goal input schemas reject malformed inputs", () => {
    // create: empty title
    expect(() =>
      GoalSchemas.create.input.parse({ title: "", quarter: "2026-Q2" }),
    ).toThrow();
    // create: bad quarter
    expect(() =>
      GoalSchemas.create.input.parse({ title: "ok", quarter: "Q2-2026" }),
    ).toThrow();
    // create: short description
    expect(() =>
      GoalSchemas.create.input.parse({
        title: "ok",
        description: "too-short",
        quarter: "2026-Q2",
      }),
    ).toThrow();
    // update: bad goal id format
    expect(() =>
      GoalSchemas.update.input.parse({ id: "X-001", title: "ok" }),
    ).toThrow();
    // close-achieved: bad goal id format
    expect(() =>
      GoalSchemas.closeAchieved.input.parse({ id: "G_001", yes: true }),
    ).toThrow();
    // show: bad id
    expect(() =>
      GoalSchemas.show.input.parse({ id: "G-1" }),
    ).toThrow();
    // linked-tasks: bad task status filter
    expect(() =>
      GoalSchemas.linkedTasks.input.parse({ id: "G-001", status: "wibble" }),
    ).toThrow();
  });

  it("goal output schemas reject non-canonical quarter, priority, category", () => {
    const nowIso = new Date("2026-04-28T12:00:00.000Z").toISOString();
    const validGoal = {
      id: "G-001",
      title: "Q2 launch",
      description: "Description that exceeds the ten-character minimum.",
      quarter: "2026-Q2",
      status: "active" as const,
      createdAt: nowIso,
      updatedAt: nowIso,
      closedAt: null,
    };

    // create.output: malformed quarter ("Q2-2026" is not YYYY-Q[1-4])
    expect(() =>
      GoalSchemas.create.output.parse({
        ok: true,
        goal: { ...validGoal, quarter: "Q2-2026" },
      }),
    ).toThrow();

    // show.output: linked-task preview with non-canonical priority
    expect(() =>
      GoalSchemas.show.output.parse({
        ok: true,
        goal: validGoal,
        linkedTaskCount: 1,
        linkedTasksPreview: [
          {
            id: "KS-001",
            title: "Linked",
            status: "in_progress",
            priority: "P9",
            needsAttention: false,
          },
        ],
      }),
    ).toThrow();

    // linkedTasks.output: non-canonical priority
    expect(() =>
      GoalSchemas.linkedTasks.output.parse({
        ok: true,
        goalId: "G-001",
        count: 1,
        tasks: [
          {
            id: "KS-001",
            title: "Linked task",
            status: "in_progress",
            priority: "URGENT",
            category: "business",
            owner: null,
            dueAt: null,
            needsAttention: false,
            lastStatusChangeAt: nowIso,
          },
        ],
      }),
    ).toThrow();

    // linkedTasks.output: non-canonical category
    expect(() =>
      GoalSchemas.linkedTasks.output.parse({
        ok: true,
        goalId: "G-001",
        count: 1,
        tasks: [
          {
            id: "KS-001",
            title: "Linked task",
            status: "in_progress",
            priority: "P0",
            category: "made-up-category",
            owner: null,
            dueAt: null,
            needsAttention: false,
            lastStatusChangeAt: nowIso,
          },
        ],
      }),
    ).toThrow();
  });
});
