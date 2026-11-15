import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPOSABLE_WRITE_OPERATIONS,
  COMPOSED_WORK_ORDER_CAP,
  compileComposedHydration,
  parseComposedOperationSpec,
  type ComposableWriteOperation,
  type ComposedWorkOrderInput,
  type HydrationContext,
} from "../../src/domain/taskops-hydration.js";
import { loadTaskopsTemplate } from "../../src/cli/adapters/taskops-templates.js";
import type { TaskRow, GoalRow, MemoryRow } from "../../src/cli/adapters/interfaces.js";

/**
 * Conformance for the composed hydration assembly layer (W7), alongside the
 * R6 contract-conformance suite. Pins the dedup-by-section behavior: composed
 * output contains exactly ONE shared-context block, exactly ONE instruction
 * block per operation type present, and exactly N work orders for N requested
 * operations. Renders against the real authored templates so the assembly
 * layer breaks loudly when a per-operation template gains a slot the composer
 * does not know.
 */

const CONTRACT_DIR = join(process.cwd(), "OperationalContracts", "taskops");

function makeTask(id: string, overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id,
    title: `Task ${id}`,
    description: `This is the long description for ${id}.`,
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
    ...overrides,
  };
}

const fakeGoal: GoalRow = {
  id: "G-100",
  title: "Q2 Objective",
  description: "Launch composed hydration successfully.",
  quarter: "2026-Q2",
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
  closedAt: null,
};

const fakeMemory: MemoryRow = {
  id: "M-100",
  scope: "clients/acme/billing",
  content: "Acme billing goes through the invoice system.",
  applicability: "When billing questions come up",
  state: "active",
  supersededById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  prunedAt: null,
  contentEmbedding: [],
  applicabilityEmbedding: [],
};

const secondFakeMemory: MemoryRow = {
  ...fakeMemory,
  id: "M-200",
  scope: "team/delegation",
  content: "Riley owns Acme invoice escalations after handoff.",
  applicability: "When Acme billing work is delegated",
};

const fakeTeam = [
  { slug: "riley", displayName: "Riley Chen", email: "riley@example.com" },
  { slug: "raj", displayName: "Leo Grant", email: null },
];

const activeTasks = [makeTask("KS-001"), makeTask("KS-002"), makeTask("KS-003")];
const activeGoals = [fakeGoal];

function order(
  operation: ComposableWriteOperation,
  contextOverrides: Partial<HydrationContext> = {},
): ComposedWorkOrderInput {
  const needsTarget = operation !== "create";
  const targetTask = needsTarget ? activeTasks[0] : null;
  return {
    operation,
    template: loadTaskopsTemplate(operation, "hydrate", CONTRACT_DIR),
    context: {
      operation,
      intent: `Intent for ${operation}`,
      taskId: targetTask?.id,
      tasks: [],
      goals: [],
      memories: [fakeMemory],
      targetTask,
      targetNotes: [],
      team: fakeTeam,
      ownerOpenTasks: [],
      defaultFollowUpDate: needsTarget ? new Date("2026-06-20T12:00:00.000Z") : null,
      warnings: [],
      dedupMatches: [],
      ...contextOverrides,
    },
  };
}

function count(haystack: string, pattern: RegExp): number {
  return (haystack.match(pattern) ?? []).length;
}

function sliceBetween(haystack: string, start: string, end: string): string {
  const startIndex = haystack.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = haystack.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return haystack.slice(startIndex, endIndex);
}

describe("composed hydration assembly", () => {
  it("renders exactly one shared-context block and exactly N work orders for N operations", () => {
    const orders = [
      order("create", {
        intent: "Capture the Acme invoice fix",
        dedupMatches: [{ id: "KS-002", title: "Task KS-002", similarity: 0.91, band: "similar" }],
      }),
      order("create", { intent: "Capture the Trace onboarding doc" }),
      order("update", { targetTask: activeTasks[1], taskId: "KS-002" }),
      order("delegate", { targetTask: activeTasks[2], taskId: "KS-003" }),
      order("complete"),
    ];
    const prompt = compileComposedHydration({
      tasks: activeTasks,
      goals: activeGoals,
      team: fakeTeam,
      orders,
    });

    // Exactly one shared-context block, holding the shared sections once.
    expect(count(prompt, /^## Shared Context$/gm)).toBe(1);
    expect(count(prompt, /^### Active Tasks$/gm)).toBe(1);
    expect(count(prompt, /^### Active Goals$/gm)).toBe(1);
    // Roster renders once because a delegate order is present.
    expect(count(prompt, /^### Team Owner Candidates$/gm)).toBe(1);
    // Memories render once in shared context, never under each work order.
    expect(count(prompt, /^### Relevant Memories & Rules$/gm)).toBe(1);
    expect(count(prompt, /^#### Relevant Memories & Rules$/gm)).toBe(0);

    // Exactly N numbered work orders.
    expect(count(prompt, /^### Work Order \d+ of 5: /gm)).toBe(5);

    // Instruction blocks dedup by operation type: two creates, one block.
    expect(count(prompt, /^## Operation Instructions: create$/gm)).toBe(1);
    expect(count(prompt, /^## Operation Instructions: update$/gm)).toBe(1);
    expect(count(prompt, /^## Operation Instructions: delegate$/gm)).toBe(1);
    expect(count(prompt, /^## Operation Instructions: complete$/gm)).toBe(1);
    expect(count(prompt, /^## Operation Instructions: /gm)).toBe(4);

    // Closing checklist with the `;`-not-`&&` rule and the wave guidance.
    expect(prompt).toContain("## Closing Checklist");
    expect(prompt).toContain("`;`, NEVER `&&`");
    expect(prompt).toContain("5 work orders means 5 receipts");
    expect(prompt).toContain("waves");
  });

  it("renders the as-of header exactly once at the top when now is set", () => {
    const prompt = compileComposedHydration({
      tasks: activeTasks,
      goals: activeGoals,
      team: [],
      orders: [order("complete"), order("cancel")],
      now: new Date("2026-06-11T19:04:00"),
    });

    expect(prompt).toMatch(/^As of: /);
    expect(count(prompt, /^As of: /gm)).toBe(1);
    expect(prompt.indexOf("As of: ")).toBeLessThan(prompt.indexOf("# Operational Prompt"));
  });

  it("keeps per-draft data inside its own work order (dedup matches stay with their create)", () => {
    const orders = [
      order("create", {
        intent: "First draft",
        dedupMatches: [{ id: "KS-099", title: "Existing near-dup", similarity: 0.93, band: "near_identical" }],
      }),
      order("create", { intent: "Second draft" }),
    ];
    const prompt = compileComposedHydration({
      tasks: activeTasks,
      goals: activeGoals,
      team: [],
      orders,
    });

    expect(count(prompt, /KS-099 \| Existing near-dup/g)).toBe(1);
    const firstOrderStart = prompt.indexOf("### Work Order 1 of 2");
    const secondOrderStart = prompt.indexOf("### Work Order 2 of 2");
    const matchIndex = prompt.indexOf("KS-099 | Existing near-dup");
    expect(matchIndex).toBeGreaterThan(firstOrderStart);
    expect(matchIndex).toBeLessThan(secondOrderStart);
  });

  it("dedupes memories across all orders into one shared-context block", () => {
    const orders = [
      order("create", { memories: [fakeMemory] }),
      order("update", { targetTask: activeTasks[1], taskId: "KS-002", memories: [fakeMemory, secondFakeMemory] }),
      order("complete", { memories: [{ ...fakeMemory, content: "Duplicate content should not render." }] }),
    ];
    const prompt = compileComposedHydration({
      tasks: activeTasks,
      goals: activeGoals,
      team: [],
      orders,
    });

    const sharedContext = sliceBetween(prompt, "## Shared Context", "## Operation Instructions: create");
    const workOrders = sliceBetween(prompt, "## Work Orders (3)", "## Closing Checklist");

    expect(count(sharedContext, /^### Relevant Memories & Rules$/gm)).toBe(1);
    expect(count(prompt, /\*\*\[Memory M-100\]\*\*/g)).toBe(1);
    expect(count(prompt, /\*\*\[Memory M-200\]\*\*/g)).toBe(1);
    expect(prompt).not.toContain("Duplicate content should not render.");
    expect(workOrders).not.toContain("Relevant Memories & Rules");
    expect(workOrders).not.toContain("Acme billing goes through the invoice system.");
    expect(workOrders).not.toContain("Riley owns Acme invoice escalations after handoff.");
  });

  it("elides stub-only instruction sections and keeps natural referent text", () => {
    const prompt = compileComposedHydration({
      tasks: activeTasks,
      goals: activeGoals,
      team: fakeTeam,
      orders: [
        order("create", {
          dedupMatches: [{ id: "KS-099", title: "Existing near-dup", similarity: 0.93, band: "near_identical" }],
        }),
        order("update", { targetTask: activeTasks[1], taskId: "KS-002" }),
      ],
    });

    const createInstructions = sliceBetween(
      prompt,
      "## Operation Instructions: create",
      "## Operation Instructions: update",
    );
    const updateInstructions = sliceBetween(prompt, "## Operation Instructions: update", "## Work Orders (2)");

    expect(createInstructions).not.toMatch(/^#### User Intent$/m);
    expect(createInstructions).not.toMatch(/^#### Relevant Memories & Rules$/m);
    expect(updateInstructions).not.toMatch(/^#### User Intent$/m);
    expect(updateInstructions).not.toMatch(/^#### Target Task$/m);
    expect(updateInstructions).not.toMatch(/^##### Current Description$/m);
    expect(updateInstructions).not.toMatch(/^#### Relevant Memories & Rules$/m);

    expect(createInstructions).toContain("(the Active Tasks table renders once in Shared Context above)");
    expect(createInstructions).toContain("(each work order lists its own matches under Duplicate Check)");
    expect(updateInstructions).toContain("the task ID from this work order");
    expect(prompt).not.toContain("(see your work order:");
    expect(prompt).not.toContain("%%REF%%");
  });

  it("supports every write operation uniformly against the real templates", () => {
    for (const operation of COMPOSABLE_WRITE_OPERATIONS) {
      const single = order(operation);
      const prompt = compileComposedHydration({
        tasks: activeTasks,
        goals: activeGoals,
        team: fakeTeam,
        orders: [single],
      });
      expect(prompt).toContain(`## Operation Instructions: ${operation}`);
      expect(count(prompt, /^### Work Order 1 of 1: /gm)).toBe(1);
      // Each work order names the exact subcommand to run next.
      expect(prompt).toContain("#### Run Next");
      expect(prompt).toContain(`execos taskops ${operation}`);
      if (operation !== "create") {
        // The real task id is substituted into the Run Next command.
        const runNext = prompt.slice(prompt.indexOf("#### Run Next"));
        expect(runNext).toContain("KS-001");
        expect(runNext).not.toContain("{{task_id}}");
      }
      // No unfilled slots leak into composed output.
      expect(prompt).not.toMatch(/\{\{\s*[a-z_]+\s*\}\}/);
    }
  });

  it("refuses more than the cap with wave guidance instead of truncating", () => {
    const orders = Array.from({ length: COMPOSED_WORK_ORDER_CAP + 1 }, (_v, i) =>
      order("create", { intent: `Draft ${i + 1}` }),
    );
    expect(() =>
      compileComposedHydration({ tasks: activeTasks, goals: activeGoals, team: [], orders }),
    ).toThrowError(/cap is 8 .*waves/i);
  });

  it("accepts exactly the cap", () => {
    const orders = Array.from({ length: COMPOSED_WORK_ORDER_CAP }, (_v, i) =>
      order("create", { intent: `Draft ${i + 1}` }),
    );
    const prompt = compileComposedHydration({
      tasks: activeTasks,
      goals: activeGoals,
      team: [],
      orders,
    });
    expect(count(prompt, /^### Work Order \d+ of 8: /gm)).toBe(8);
  });

  it("refuses an empty batch", () => {
    expect(() =>
      compileComposedHydration({ tasks: activeTasks, goals: activeGoals, team: [], orders: [] }),
    ).toThrowError(/at least one work order/);
  });

  it("omits the team roster section when no delegate order is present", () => {
    const prompt = compileComposedHydration({
      tasks: activeTasks,
      goals: activeGoals,
      team: fakeTeam,
      orders: [order("complete")],
    });
    expect(prompt).not.toContain("### Team Owner Candidates");
  });
});

describe("parseComposedOperationSpec", () => {
  it("parses a create spec with the whole remainder as intent (colons allowed)", () => {
    expect(parseComposedOperationSpec("create:Fix the Acme invoice: phase 2")).toEqual({
      operation: "create",
      intent: "Fix the Acme invoice: phase 2",
    });
  });

  it("parses a task-op spec with task id and optional trailing intent", () => {
    expect(parseComposedOperationSpec("update:KS-012")).toEqual({
      operation: "update",
      taskId: "KS-012",
      intent: undefined,
    });
    expect(parseComposedOperationSpec("delegate:KS-014:hand off API work to Riley: urgent")).toEqual({
      operation: "delegate",
      taskId: "KS-014",
      intent: "hand off API work to Riley: urgent",
    });
  });

  it("normalizes operation casing and surrounding whitespace", () => {
    expect(parseComposedOperationSpec("  Complete:KS-007  ")).toEqual({
      operation: "complete",
      taskId: "KS-007",
      intent: undefined,
    });
  });

  it("rejects a create without an intent", () => {
    expect(() => parseComposedOperationSpec("create")).toThrowError(/requires an intent/);
    expect(() => parseComposedOperationSpec("create:")).toThrowError(/requires an intent/);
  });

  it("rejects a task-op without a task id", () => {
    expect(() => parseComposedOperationSpec("complete")).toThrowError(/requires a task id/);
    expect(() => parseComposedOperationSpec("defer: ")).toThrowError(/requires a task id/);
  });

  it("rejects read operations as terminal views", () => {
    for (const op of ["list", "show", "follow-ups", "draft-follow-ups"]) {
      expect(() => parseComposedOperationSpec(`${op}:KS-001`)).toThrowError(/read-only/);
    }
  });

  it("rejects re-rank from composed batches as an unsupported operation", () => {
    expect(() => parseComposedOperationSpec("re-rank:KS-001")).toThrowError(/Unsupported operation 're-rank'/);
  });

  it("rejects unknown operations with the supported list", () => {
    expect(() => parseComposedOperationSpec("destroy:KS-001")).toThrowError(/Unsupported operation 'destroy'/);
  });
});
