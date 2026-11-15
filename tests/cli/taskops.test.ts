import { join } from "node:path";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { compileHydrationPrompt, compileReceipt, formatAsOf } from "../../src/domain/taskops-hydration.js";
import {
  loadTaskopsContract,
  loadTaskopsTemplate,
  type TaskopsOperation,
} from "../../src/cli/adapters/taskops-templates.js";
import type { TaskRow, GoalRow, MemoryRow, TaskNoteRow } from "../../src/cli/adapters/interfaces.js";
import type {
  CommitmentAtRiskRow,
  GoalAtRiskRow,
  NewlyUnblockedRow,
} from "../../src/domain/risk-detectors.js";

// ISS-003 CLI wiring tests: spy on the two service entry points the update and
// delegate commands call, leaving every other export (and TaskServiceError /
// FollowUpServiceError mapping) real. importActual preserves the rest of the
// module so the command file's other imports keep working.
const updateTaskOperationSpy = vi.fn();
const delegateOperationSpy = vi.fn();

vi.mock("../../src/services/task-operations.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/services/task-operations.js")>();
  return { ...actual, updateTaskOperation: updateTaskOperationSpy };
});

vi.mock("../../src/services/follow-up-operations.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/services/follow-up-operations.js")>();
  return { ...actual, delegateOperation: delegateOperationSpy };
});

// Render against the real authored templates in the repo-root
// OperationalContracts dir (the same single source the runtime loads) so this
// suite exercises the manifest + template files + pure compiler together.
const CONTRACT_DIR = join(process.cwd(), "OperationalContracts", "taskops");

function render(op: TaskopsOperation, context: Parameters<typeof compileHydrationPrompt>[0]): string {
  return compileHydrationPrompt(context, loadTaskopsTemplate(op, "hydrate", CONTRACT_DIR));
}

describe("taskops operational contract", () => {
  const fakeTask: TaskRow = {
    id: "KS-100",
    title: "Test Task",
    description: "This is a test task with a long description",
    status: "in_progress",
    priority: "P1",
    category: "personal",
    owner: "me",
    dueDate: new Date("2026-05-30T12:00:00.000Z"),
    followUpDate: null,
    snoozedUntil: null,
    handoffState: "not_applicable",
    handoffCopiedAt: null,
    handoffLastCopiedAt: null,
    handoffLastNudgeCopiedAt: null,
    goalId: "G-100",
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    cancelledAt: null,
    lastStatusChangeAt: new Date(),
    lastUnblockedAt: null,
    needsAttention: false,
    needsAttentionSetAt: null,
    needsAttentionReason: null,
    embedding: null,
    hardDeadline: false,
    effort: null,
    queueRank: null,
    queueRationale: null,
    queueRankedAt: null,
  };

  const fakeGoal: GoalRow = {
    id: "G-100",
    title: "Q2 Objective",
    description: "Launch the context hydration feature successfully.",
    quarter: "2026-Q2",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    closedAt: null,
  };

  const fakeMemory: MemoryRow = {
    id: "M-100",
    scope: "clients/acme/billing",
    content: "Acme billing goes through invoice system.",
    applicability: "When billing questions come up",
    state: "active",
    supersededById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    prunedAt: null,
    contentEmbedding: [],
    applicabilityEmbedding: [],
  };

  const fakeNote: TaskNoteRow = {
    id: "N-100",
    taskId: "KS-100",
    noteType: "manual",
    content: "Spoke with client regarding timeline.",
    createdAt: new Date("2026-05-25T12:00:00.000Z"),
    createdBy: "agent",
  };

  const fakeReviewCandidate = {
    id: "KS-100",
    title: "Test Task",
    status: "in_progress",
    priority: "P1",
    owner: "me",
    dueDate: new Date("2026-05-30T12:00:00.000Z"),
    followUpDate: null,
    snoozedUntil: null,
    goalId: "G-100",
    why: "P1, goal-linked",
  };

  const fakeCommitmentAtRisk: CommitmentAtRiskRow = {
    id: "KS-110",
    title: "Send invoice to Acme",
    status: "in_progress",
    priority: "P1",
    owner: "me",
    dueDate: new Date("2026-05-28T12:00:00.000Z"),
    daysLeft: -2,
    windowDays: 3,
    rule: "overdue",
  };

  const fakeGoalAtRisk: GoalAtRiskRow = {
    goalId: "G-100",
    title: "Q2 Objective",
    quarter: "2026-Q2",
    quarterEnd: new Date("2026-06-30T00:00:00.000Z"),
    daysLeft: 12,
    windowDays: 21,
    openCount: 3,
    doneCount: 5,
  };

  const fakeNewlyUnblocked: NewlyUnblockedRow = {
    id: "KS-120",
    title: "Draft onboarding checklist",
    status: "backlog",
    priority: "P2",
    owner: "me",
    lastUnblockedAt: new Date("2026-06-09T15:30:00.000Z"),
  };

  describe("contract manifest", () => {
    it("maps every taskops operation to a hydrate template that exists", () => {
      const contract = loadTaskopsContract(CONTRACT_DIR);
      const ops: TaskopsOperation[] = [
        "create",
        "update",
        "complete",
        "cancel",
        "reopen",
        "show",
        "list",
        "re-rank",
        "delegate",
        "follow-up",
        "defer",
        "dependency-add",
        "dependency-remove",
        "flag-attention",
        "unflag-attention",
        "follow-ups",
        "draft-follow-ups",
      ];
      for (const op of ops) {
        expect(contract.operations[op]).toBeDefined();
        // loadTaskopsTemplate throws if the mapped file is missing.
        expect(loadTaskopsTemplate(op, "hydrate", CONTRACT_DIR).length).toBeGreaterThan(0);
      }
    });

    it("maps write operations to a receipt template, and read operations to none", () => {
      const contract = loadTaskopsContract(CONTRACT_DIR);
      for (const op of [
        "create",
        "update",
        "complete",
        "cancel",
        "reopen",
        "delegate",
        "follow-up",
        "defer",
        "dependency-add",
        "dependency-remove",
        "flag-attention",
        "unflag-attention",
        "re-rank",
      ] as const) {
        expect(contract.operations[op].receipt).toBeDefined();
        expect(loadTaskopsTemplate(op, "receipt", CONTRACT_DIR).length).toBeGreaterThan(0);
      }
      expect(contract.operations.show.receipt).toBeUndefined();
      expect(contract.operations.list.receipt).toBeUndefined();
      expect(contract.operations["follow-ups"].receipt).toBeUndefined();
      expect(contract.operations["draft-follow-ups"].receipt).toBeUndefined();
      expect(() => loadTaskopsTemplate("show", "receipt", CONTRACT_DIR)).toThrow();
    });

    it("marks write hydrate packets as returning a subcommand and reads as terminal", () => {
      const contract = loadTaskopsContract(CONTRACT_DIR);
      expect(contract.operations.create.hydrate.returns_subcommand).toBe(true);
      expect(contract.operations.update.hydrate.returns_subcommand).toBe(true);
      expect(contract.operations.complete.hydrate.returns_subcommand).toBe(true);
      expect(contract.operations.cancel.hydrate.returns_subcommand).toBe(true);
      expect(contract.operations.reopen.hydrate.returns_subcommand).toBe(true);
      expect(contract.operations.delegate.hydrate.returns_subcommand).toBe(true);
      expect(contract.operations["follow-up"].hydrate.returns_subcommand).toBe(true);
      expect(contract.operations.defer.hydrate.returns_subcommand).toBe(true);
      expect(contract.operations["dependency-add"].hydrate.returns_subcommand).toBe(true);
      expect(contract.operations["dependency-remove"].hydrate.returns_subcommand).toBe(true);
      expect(contract.operations["flag-attention"].hydrate.returns_subcommand).toBe(true);
      expect(contract.operations["unflag-attention"].hydrate.returns_subcommand).toBe(true);
      expect(contract.operations["re-rank"].hydrate.returns_subcommand).toBe(true);
      expect(contract.operations.show.hydrate.returns_subcommand).toBe(false);
      expect(contract.operations.list.hydrate.returns_subcommand).toBe(false);
      expect(contract.operations["follow-ups"].hydrate.returns_subcommand).toBe(false);
      expect(contract.operations["draft-follow-ups"].hydrate.returns_subcommand).toBe(false);
    });
  });

  describe("compileReceipt", () => {
    it("renders create / update / complete receipts from their templates", () => {
      const createReceipt = compileReceipt(
        { operation: "create", task: fakeTask },
        loadTaskopsTemplate("create", "receipt", CONTRACT_DIR),
      );
      expect(createReceipt).toContain("task KS-100 created successfully");
      expect(createReceipt).toContain("hard deadline: no");
      expect(createReceipt).toContain("effort: -");

      const updateReceipt = compileReceipt(
        { operation: "update", task: { ...fakeTask, hardDeadline: true, effort: "M" } },
        loadTaskopsTemplate("update", "receipt", CONTRACT_DIR),
      );
      expect(updateReceipt).toContain("task KS-100 updated successfully");
      expect(updateReceipt).toContain("hard deadline: yes");
      expect(updateReceipt).toContain("effort: M");

      const completeReceipt = compileReceipt(
        { operation: "complete", task: fakeTask, from: "in_progress", to: "done" },
        loadTaskopsTemplate("complete", "receipt", CONTRACT_DIR),
      );
      expect(completeReceipt).toContain("task KS-100 marked done successfully");

      const delegateReceipt = compileReceipt(
        {
          operation: "delegate",
          task: fakeTask,
          owner: "noah",
          followUpDate: new Date("2026-06-14T12:00:00.000Z"),
          ownerOpenTasks: [{ id: "KS-101", title: "Other", status: "blocked", dueDate: null }],
          warnings: [],
        },
        loadTaskopsTemplate("delegate", "receipt", CONTRACT_DIR),
      );
      expect(delegateReceipt).toContain("delegated to noah");

      const followUpReceipt = compileReceipt(
        {
          operation: "follow-up",
          task: fakeTask,
          nextFollowUpDate: new Date("2026-06-14T12:00:00.000Z"),
          status: "blocked",
          noteId: "N-200",
          warnings: [],
        },
        loadTaskopsTemplate("follow-up", "receipt", CONTRACT_DIR),
      );
      expect(followUpReceipt).toContain("follow-up logged for KS-100");

      const deferReceipt = compileReceipt(
        {
          operation: "defer",
          task: fakeTask,
          followUpDate: new Date("2026-06-14T12:00:00.000Z"),
          warnings: [],
        },
        loadTaskopsTemplate("defer", "receipt", CONTRACT_DIR),
      );
      expect(deferReceipt).toContain("Task deferred, next follow-up date set to 2026-06-14");
    });

    it("renders cancel / dependency / attention receipts from their templates", () => {
      const cancelReceipt = compileReceipt(
        { operation: "cancel", task: fakeTask, from: "in_progress", to: "cancelled" },
        loadTaskopsTemplate("cancel", "receipt", CONTRACT_DIR),
      );
      expect(cancelReceipt).toContain("task KS-100 cancelled successfully");

      const reopenReceipt = compileReceipt(
        { operation: "reopen", task: fakeTask, from: "done", to: "in_progress" },
        loadTaskopsTemplate("reopen", "receipt", CONTRACT_DIR),
      );
      expect(reopenReceipt).toContain("task KS-100 reopened successfully");
      expect(reopenReceipt).toContain("done -> in_progress");

      const dependencyAddReceipt = compileReceipt(
        { operation: "dependency-add", task: fakeTask, blockedBy: "KS-200" },
        loadTaskopsTemplate("dependency-add", "receipt", CONTRACT_DIR),
      );
      expect(dependencyAddReceipt).toContain("Task KS-100 is now blocked by KS-200");

      const dependencyRemoveReceipt = compileReceipt(
        { operation: "dependency-remove", task: fakeTask, blockedBy: "KS-200" },
        loadTaskopsTemplate("dependency-remove", "receipt", CONTRACT_DIR),
      );
      expect(dependencyRemoveReceipt).toContain("Task KS-100 is no longer blocked by KS-200");

      const flagReceipt = compileReceipt(
        { operation: "flag-attention", task: fakeTask, reason: "Client escalation" },
        loadTaskopsTemplate("flag-attention", "receipt", CONTRACT_DIR),
      );
      expect(flagReceipt).toContain("task KS-100 flagged for attention");
      expect(flagReceipt).toContain("Reason: Client escalation");

      const unflagReceipt = compileReceipt(
        { operation: "unflag-attention", task: fakeTask },
        loadTaskopsTemplate("unflag-attention", "receipt", CONTRACT_DIR),
      );
      expect(unflagReceipt).toContain("attention flag cleared on task KS-100");
    });

    it("includes the Action Ledger response contract in every write receipt", () => {
      const contract = loadTaskopsContract(CONTRACT_DIR);
      for (const [operation, spec] of Object.entries(contract.operations)) {
        if (!spec.receipt) continue;
        const receiptTemplate = loadTaskopsTemplate(operation as TaskopsOperation, "receipt", CONTRACT_DIR);
        expect(receiptTemplate).toContain("Report to Jordan: response contract:");
        expect(receiptTemplate).toContain("Lead your reply with an Action Ledger");
        expect(receiptTemplate).toContain("No action:");
      }
    });
  });

  describe("compileHydrationPrompt", () => {
    it("formats packet timestamps for local as-of headers", () => {
      expect(formatAsOf(new Date("2026-06-11T19:04:00"))).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \S+ \(\w+\)$/,
      );
    });

    it("prepends an as-of header only when now is set", () => {
      const context = {
        operation: "list" as const,
        tasks: [fakeTask],
        goals: [fakeGoal],
      };
      const template = loadTaskopsTemplate("list", "hydrate", CONTRACT_DIR);
      const withoutNow = compileHydrationPrompt(context, template);
      const withNow = compileHydrationPrompt(
        { ...context, now: new Date("2026-06-11T19:04:00") },
        template,
      );

      expect(withNow).toMatch(/^As of: /);
      expect(withNow.endsWith(withoutNow)).toBe(true);
      expect(withoutNow).not.toMatch(/^As of: /);
    });

    it("renders a create prompt with tasks, goals, and matching memories", () => {
      const prompt = render("create", {
        operation: "create",
        intent: "Add a task to check Acme billing invoices",
        tasks: [fakeTask],
        goals: [fakeGoal],
        memories: [fakeMemory],
      });

      expect(prompt).toContain("# Operational Prompt: Task Management (Create)");
      expect(prompt).toContain("Add a task to check Acme billing invoices");
      expect(prompt).toContain("KS-100");
      expect(prompt).toContain("G-100");
      expect(prompt).toContain("M-100");
      expect(prompt).toContain("execos taskops create");
      // ISS-007/008: the packet carries the explicit-only priority and
      // hard-deadline rules plus the 3-business-day due default.
      expect(prompt).toContain("expressed priority intent");
      expect(prompt).toContain("3 business days out");
      expect(prompt).toContain("explicitly calls it a hard deadline");
    });

    it("renders an update prompt with target task details and goal link references", () => {
      const prompt = render("update", {
        operation: "update",
        intent: "Move Acme billing task to in progress",
        targetTask: fakeTask,
        goals: [fakeGoal],
        memories: [fakeMemory],
      });

      expect(prompt).toContain("# Operational Prompt: Task Management (Update)");
      expect(prompt).toContain("Move Acme billing task to in progress");
      expect(prompt).toContain("KS-100");
      expect(prompt).toContain("G-100");
      expect(prompt).toContain('execos taskops update --task-id "KS-100"');
      // ISS-007: explicit-only priority and hard-deadline guidance in the packet.
      expect(prompt).toContain("expressed priority intent");
      expect(prompt).toContain("explicitly calls it a hard deadline");
    });

    it("renders a complete prompt with target task and instructions", () => {
      const prompt = render("complete", {
        operation: "complete",
        intent: "Mark Acme task as complete",
        targetTask: fakeTask,
        memories: [fakeMemory],
      });

      expect(prompt).toContain("# Operational Prompt: Task Management (Complete)");
      expect(prompt).toContain("KS-100");
      expect(prompt).toContain('execos taskops complete --task-id "KS-100"');
    });

    it("renders a show prompt with task details, goal, notes, and memories", () => {
      const prompt = render("show", {
        operation: "show",
        taskId: "KS-100",
        targetTask: fakeTask,
        targetGoal: fakeGoal,
        targetNotes: [fakeNote],
        memories: [fakeMemory],
      });

      expect(prompt).toContain("# TASK DETAILS (HYDRATED)");
      expect(prompt).toContain("KS-100");
      expect(prompt).toContain("Q2 Objective");
      expect(prompt).toContain("Spoke with client regarding timeline");
      expect(prompt).toContain("M-100");
      expect(prompt).not.toContain("execos taskops show");
    });

    it("renders a list prompt containing active tasks and goals", () => {
      const prompt = render("list", {
        operation: "list",
        tasks: [fakeTask],
        goals: [fakeGoal],
      });

      expect(prompt).toContain("# ACTIVE TASKS & GOALS (HYDRATED)");
      expect(prompt).toContain("KS-100");
      expect(prompt).toContain("G-100");
    });

    it("renders a re-rank prompt containing candidates, goals, anomalies, and situational context", () => {
      const prompt = render("re-rank", {
        operation: "re-rank",
        intent: "marketing is urgent today",
        goals: [fakeGoal],
        rankedCandidates: [fakeReviewCandidate],
        anomalies: {
          overdue: [fakeReviewCandidate],
          stale: [fakeReviewCandidate],
          newTriage: [fakeReviewCandidate],
          arrivedSnooze: [fakeReviewCandidate],
        },
        commitmentsAtRisk: [fakeCommitmentAtRisk],
        goalsAtRisk: [fakeGoalAtRisk],
        newlyUnblocked: [fakeNewlyUnblocked],
      });

      expect(prompt).toContain("# TASK RE-RANK (HYDRATED)");
      expect(prompt).toContain("## Situational Context From Jordan");
      expect(prompt).toContain("marketing is urgent today");
      expect(prompt).toContain("execos taskops re-rank --task");
      expect(prompt).toContain("KS-100");
      expect(prompt).toContain("Current Priority");
      expect(prompt).toContain("Q2 Objective");
      expect(prompt).toContain("P0 promotion requires explicit Jordan confirmation");

      expect(prompt).toContain("## Commitments At Risk");
      expect(prompt).toContain(
        "| KS-110 | Send invoice to Acme | in_progress | P1 | me | 2026-05-28 | -2 | 3d | overdue |",
      );
      expect(prompt).toContain("## Goals At Risk");
      expect(prompt).toContain(
        "| G-100 | Q2 Objective | 2026-Q2 | 2026-06-30 | 12 | 21d | 3 | 5 |",
      );
      expect(prompt).toContain("## Newly Unblocked");
      expect(prompt).toContain(
        "| KS-120 | Draft onboarding checklist | backlog | P2 | me | 2026-06-09 15:30 |",
      );
      expect(prompt).toContain("Queue rationale quality floor");
      expect(prompt).toContain("why this task, why now, and why this rank");
      expect(prompt).toContain("urgency, leverage, current context, sequencing");
    });

    it("renders re-rank risk-section empty states when the context omits the arrays", () => {
      const prompt = render("re-rank", {
        operation: "re-rank",
        goals: [fakeGoal],
        rankedCandidates: [fakeReviewCandidate],
        anomalies: {},
      });

      expect(prompt).toContain("(none provided; apply the standard heuristics)");
      expect(prompt).toContain("No commitments at risk.");
      expect(prompt).toContain("No goals at risk.");
      expect(prompt).toContain("No newly unblocked tasks.");
    });

    it("renders delegate / follow-up / defer / follow-up read prompts", () => {
      const delegatePrompt = render("delegate", {
        operation: "delegate",
        intent: "Delegate to Noah",
        targetTask: fakeTask,
        team: [{ slug: "noah", displayName: "Noah Brooks" }],
        ownerOpenTasks: [fakeTask],
        defaultFollowUpDate: new Date("2026-06-14T12:00:00.000Z"),
        memories: [fakeMemory],
      });
      expect(delegatePrompt).toContain("Task Management (Delegate)");
      expect(delegatePrompt).toContain("noah");
      expect(delegatePrompt).toContain("execos taskops delegate");

      const followUpPrompt = render("follow-up", {
        operation: "follow-up",
        intent: "Elena says it is blocked",
        targetTask: fakeTask,
        targetNotes: [fakeNote],
        memories: [fakeMemory],
      });
      expect(followUpPrompt).toContain("Task Management (Follow-up)");
      expect(followUpPrompt).toContain("execos taskops follow-up");

      const deferPrompt = render("defer", {
        operation: "defer",
        intent: "push this a week",
        targetTask: fakeTask,
      });
      expect(deferPrompt).toContain("execos taskops defer");

      const followUpsPrompt = render("follow-ups", {
        operation: "follow-ups",
        dueFollowUps: [fakeTask],
      });
      expect(followUpsPrompt).toContain("DUE FOLLOW-UPS");
      expect(followUpsPrompt).toContain("KS-100");

      const draftPrompt = render("draft-follow-ups", {
        operation: "draft-follow-ups",
        dueFollowUps: [fakeTask],
      });
      expect(draftPrompt).toContain("FOLLOW-UP DRAFT CONTEXT");
      expect(draftPrompt).toContain("Surface verb");
    });

    it("renders cancel / dependency / attention prompts with target task and exact commands", () => {
      const cancelPrompt = render("cancel", {
        operation: "cancel",
        intent: "Cancel the Acme onboarding task",
        targetTask: fakeTask,
      });
      expect(cancelPrompt).toContain("# Operational Prompt: Task Management (Cancel)");
      expect(cancelPrompt).toContain("KS-100");
      expect(cancelPrompt).toContain('execos taskops cancel --task-id "KS-100" --yes');

      const dependencyAddPrompt = render("dependency-add", {
        operation: "dependency-add",
        intent: "Block this on the contract review",
        targetTask: fakeTask,
      });
      expect(dependencyAddPrompt).toContain("# Operational Prompt: Task Management (Dependency Add)");
      expect(dependencyAddPrompt).toContain('execos taskops dependency-add --task-id "KS-100"');

      const dependencyRemovePrompt = render("dependency-remove", {
        operation: "dependency-remove",
        intent: "Unblock this task",
        targetTask: fakeTask,
      });
      expect(dependencyRemovePrompt).toContain("# Operational Prompt: Task Management (Dependency Remove)");
      expect(dependencyRemovePrompt).toContain('execos taskops dependency-remove --task-id "KS-100"');

      const flagPrompt = render("flag-attention", {
        operation: "flag-attention",
        intent: "Flag this for attention",
        targetTask: fakeTask,
      });
      expect(flagPrompt).toContain("# Operational Prompt: Task Management (Flag Attention)");
      expect(flagPrompt).toContain('execos taskops flag-attention --task-id "KS-100"');
      expect(flagPrompt).toContain("--reason");

      const unflagPrompt = render("unflag-attention", {
        operation: "unflag-attention",
        intent: "Clear the attention flag",
        targetTask: fakeTask,
      });
      expect(unflagPrompt).toContain("# Operational Prompt: Task Management (Unflag Attention)");
      expect(unflagPrompt).toContain('execos taskops unflag-attention --task-id "KS-100"');
    });

    it("renders the create duplicate-check slot for empty and populated matches", () => {
      const cleanPrompt = render("create", {
        operation: "create",
        intent: "Add a task to check Acme billing invoices",
        tasks: [fakeTask],
        goals: [fakeGoal],
        memories: [fakeMemory],
        dedupMatches: [],
      });
      expect(cleanPrompt).toContain("## Duplicate Check");
      expect(cleanPrompt).toContain("- none");

      const dirtyPrompt = render("create", {
        operation: "create",
        intent: "Add a task to check Acme billing invoices",
        tasks: [fakeTask],
        goals: [fakeGoal],
        memories: [fakeMemory],
        dedupMatches: [
          { id: "KS-101", title: "Existing Acme billing task", similarity: 0.93, band: "near_identical" },
          { id: "KS-102", title: "Acme invoice check", similarity: 0.87, band: "similar" },
        ],
      });
      expect(dirtyPrompt).toContain(
        "- KS-101 | Existing Acme billing task | similarity 0.93 | band near_identical",
      );
      expect(dirtyPrompt).toContain(
        "- KS-102 | Acme invoice check | similarity 0.87 | band similar",
      );
      expect(dirtyPrompt).toContain("--allow-duplicate");
      expect(dirtyPrompt).not.toContain("- none");
    });

    it("leaves no unfilled slots in any rendered prompt", () => {
      const prompts = [
        render("create", { operation: "create", intent: "x", tasks: [fakeTask], goals: [fakeGoal], memories: [fakeMemory] }),
        render("update", { operation: "update", intent: "x", targetTask: fakeTask, goals: [fakeGoal], memories: [fakeMemory] }),
        render("complete", { operation: "complete", targetTask: fakeTask, memories: [fakeMemory] }),
        render("show", { operation: "show", taskId: "KS-100", targetTask: fakeTask, targetGoal: fakeGoal, targetNotes: [fakeNote], memories: [fakeMemory] }),
        render("list", { operation: "list", tasks: [fakeTask], goals: [fakeGoal] }),
        render("re-rank", { operation: "re-rank", intent: "marketing is urgent today", goals: [fakeGoal], rankedCandidates: [fakeReviewCandidate], anomalies: { overdue: [fakeReviewCandidate], stale: [fakeReviewCandidate], newTriage: [fakeReviewCandidate], arrivedSnooze: [fakeReviewCandidate] }, commitmentsAtRisk: [fakeCommitmentAtRisk], goalsAtRisk: [fakeGoalAtRisk], newlyUnblocked: [fakeNewlyUnblocked], memories: [fakeMemory] }),
        render("re-rank", { operation: "re-rank", goals: [fakeGoal], rankedCandidates: [fakeReviewCandidate], anomalies: {} }),
        render("delegate", { operation: "delegate", intent: "x", targetTask: fakeTask, team: [{ slug: "noah", displayName: "Noah Brooks" }], ownerOpenTasks: [fakeTask], memories: [fakeMemory] }),
        render("follow-up", { operation: "follow-up", intent: "x", targetTask: fakeTask, targetNotes: [fakeNote], memories: [fakeMemory] }),
        render("defer", { operation: "defer", intent: "x", targetTask: fakeTask }),
        render("cancel", { operation: "cancel", intent: "x", targetTask: fakeTask }),
        render("dependency-add", { operation: "dependency-add", intent: "x", targetTask: fakeTask }),
        render("dependency-remove", { operation: "dependency-remove", intent: "x", targetTask: fakeTask }),
        render("flag-attention", { operation: "flag-attention", intent: "x", targetTask: fakeTask }),
        render("unflag-attention", { operation: "unflag-attention", intent: "x", targetTask: fakeTask }),
        render("create", {
          operation: "create",
          intent: "x",
          tasks: [fakeTask],
          goals: [fakeGoal],
          memories: [fakeMemory],
          dedupMatches: [{ id: "KS-101", title: "Existing", similarity: 0.93, band: "near_identical" }],
        }),
      ];
      for (const prompt of prompts) {
        expect(prompt).not.toMatch(/\{\{.*?\}\}/);
      }
    });

    it("renders empty-context fallbacks for create", () => {
      const prompt = render("create", { operation: "create", intent: "first task" });
      expect(prompt).toContain("No active tasks found.");
      expect(prompt).toContain("No active goals found.");
      expect(prompt).toContain("No matching memories found.");
    });
  });
});

// ---------------------------------------------------------------------------
// ISS-003: --note flag consistency across taskops subcommands.
//
// These exercise the commander wiring + handler resolution by registering the
// real taskops command on a fresh program and parsing argv. The service entry
// points are spied (see vi.mock above) so the assertions are on exactly what
// the CLI resolved and forwarded to the service.
// ---------------------------------------------------------------------------

describe("taskops --note flag consistency (ISS-003)", () => {
  const cliFakeTask: TaskRow = {
    id: "KS-011",
    title: "Wiring fixture task",
    description: "A task fixture used by the ISS-003 CLI wiring tests.",
    status: "in_progress",
    priority: "P1",
    category: "personal",
    owner: "me",
    dueDate: new Date("2026-06-30T12:00:00.000Z"),
    followUpDate: null,
    snoozedUntil: null,
    handoffState: "not_applicable",
    handoffCopiedAt: null,
    handoffLastCopiedAt: null,
    handoffLastNudgeCopiedAt: null,
    goalId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    cancelledAt: null,
    lastStatusChangeAt: new Date(),
    lastUnblockedAt: null,
    needsAttention: false,
    needsAttentionSetAt: null,
    needsAttentionReason: null,
    embedding: null,
    hardDeadline: false,
    effort: null,
    queueRank: null,
    queueRationale: null,
    queueRankedAt: null,
  };

  async function runTaskops(argv: string[]): Promise<void> {
    const out: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = (chunk: string | Uint8Array): boolean => {
      out.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    };
    try {
      const program = new Command();
      program.exitOverride();
      program.option("--format <format>");
      const { registerTaskopsCommand } = await import("../../src/cli/commands/taskops.js");
      registerTaskopsCommand(program);
      await program.parseAsync(["node", "execos", "taskops", ...argv]);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stdout as any).write = originalWrite;
    }
  }

  it("accepts 'taskops update --note' and forwards the note to the update service", async () => {
    updateTaskOperationSpy.mockReset();
    updateTaskOperationSpy.mockResolvedValue({
      operation: "update",
      taskId: "KS-011",
      task: cliFakeTask,
      warnings: [],
      activityId: "ACT-fields-1",
    });

    await runTaskops(["update", "--task-id", "KS-011", "--note", "Reprioritized after the client call."]);

    expect(updateTaskOperationSpy).toHaveBeenCalledTimes(1);
    const arg = updateTaskOperationSpy.mock.calls[0][0] as { taskId: string; note?: string };
    expect(arg.taskId).toBe("KS-011");
    expect(arg.note).toBe("Reprioritized after the client call.");
  });

  it("trims the update note before forwarding it", async () => {
    updateTaskOperationSpy.mockReset();
    updateTaskOperationSpy.mockResolvedValue({
      operation: "update",
      taskId: "KS-011",
      task: cliFakeTask,
      warnings: [],
      activityId: "ACT-fields-1",
    });

    await runTaskops(["update", "--task-id", "KS-011", "--note", "   padded   "]);

    const arg = updateTaskOperationSpy.mock.calls[0][0] as { note?: string };
    expect(arg.note).toBe("padded");
  });

  it("rejects 'taskops update --note' with an empty value before calling the service", async () => {
    updateTaskOperationSpy.mockReset();

    await expect(
      runTaskops(["update", "--task-id", "KS-011", "--note", "   "]),
    ).rejects.toThrow(/empty/i);
    expect(updateTaskOperationSpy).not.toHaveBeenCalled();
  });

  function delegateResult() {
    return {
      ok: true as const,
      receipt: {
        operation: "delegate" as const,
        taskId: "KS-011",
        task: cliFakeTask,
        ownerSlug: "elena",
        ownerDisplayName: "Elena",
        followUpDate: new Date("2026-06-20T12:00:00.000Z"),
        dueDate: null,
        noteId: "N-1",
        activityId: "ACT-delegate",
        warnings: [],
        defaultFollowUpApplied: false,
        ownerOpenTasks: [],
      },
    };
  }

  it("accepts 'taskops delegate --note' and forwards it as the delegation note", async () => {
    delegateOperationSpy.mockReset();
    delegateOperationSpy.mockResolvedValue(delegateResult());

    await runTaskops(["delegate", "--task-id", "KS-011", "--owner", "elena", "--note", "Hand off to Elena."]);

    expect(delegateOperationSpy).toHaveBeenCalledTimes(1);
    const arg = delegateOperationSpy.mock.calls[0][0] as { note?: string | null };
    expect(arg.note).toBe("Hand off to Elena.");
  });

  it("still accepts 'taskops delegate --notes' as a back-compat alias", async () => {
    delegateOperationSpy.mockReset();
    delegateOperationSpy.mockResolvedValue(delegateResult());

    await runTaskops(["delegate", "--task-id", "KS-011", "--owner", "elena", "--notes", "Legacy spelling note."]);

    expect(delegateOperationSpy).toHaveBeenCalledTimes(1);
    const arg = delegateOperationSpy.mock.calls[0][0] as { note?: string | null };
    expect(arg.note).toBe("Legacy spelling note.");
  });

  it("prefers --note over --notes when both are supplied (resolution order opts.note ?? opts.notes)", async () => {
    delegateOperationSpy.mockReset();
    delegateOperationSpy.mockResolvedValue(delegateResult());

    await runTaskops([
      "delegate",
      "--task-id",
      "KS-011",
      "--owner",
      "elena",
      "--note",
      "standard wins",
      "--notes",
      "alias loses",
    ]);

    const arg = delegateOperationSpy.mock.calls[0][0] as { note?: string | null };
    expect(arg.note).toBe("standard wins");
  });
});
