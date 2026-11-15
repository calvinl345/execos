import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Condition =
  | { type: "and"; conditions: Condition[] }
  | { type: "eq"; column: string; value: unknown }
  | { type: "gte"; column: string; value: unknown }
  | { type: "lt"; column: string; value: unknown }
  | { type: "inArray"; column: string; values: unknown[] }
  | { type: "not"; condition: Condition };

interface MockTaskRow {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string | null;
  category: string;
  owner: string | null;
  dueDate: Date | null;
  hardDeadline: boolean;
  effort: string | null;
  followUpDate: Date | null;
  goalId: string | null;
  queueRank: number | null;
  queueRationale: string | null;
  queueRankedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  lastStatusChangeAt: Date;
  needsAttention: boolean;
  needsAttentionSetAt: Date | null;
  needsAttentionReason: string | null;
}

const mockTaskDb = vi.hoisted(() => {
  function matchesCondition(
    row: MockTaskRow,
    condition: Condition | undefined,
  ): boolean {
    if (!condition) return true;
    switch (condition.type) {
      case "and":
        return condition.conditions.every((child) => matchesCondition(row, child));
      case "eq":
        return row[condition.column as keyof MockTaskRow] === condition.value;
      case "gte": {
        const value = row[condition.column as keyof MockTaskRow];
        return value instanceof Date && condition.value instanceof Date
          ? value >= condition.value
          : false;
      }
      case "lt": {
        const value = row[condition.column as keyof MockTaskRow];
        return value instanceof Date && condition.value instanceof Date
          ? value < condition.value
          : false;
      }
      case "inArray":
        return condition.values.includes(row[condition.column as keyof MockTaskRow]);
      case "not":
        return !matchesCondition(row, condition.condition);
    }
  }

  return {
    rows: [] as MockTaskRow[],
    matchesCondition,
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: Condition[]) => ({ type: "and", conditions }),
  asc: (column: string) => ({ type: "asc", column }),
  desc: (column: string) => ({ type: "desc", column }),
  eq: (column: string, value: unknown) => ({ type: "eq", column, value }),
  gte: (column: string, value: unknown) => ({ type: "gte", column, value }),
  inArray: (column: string, values: unknown[]) => ({
    type: "inArray",
    column,
    values,
  }),
  lt: (column: string, value: unknown) => ({ type: "lt", column, value }),
  not: (condition: Condition) => ({ type: "not", condition }),
  or: (...conditions: Condition[]) => ({ type: "or", conditions }),
}));

vi.mock("../../src/db/index.js", () => {
  const tasks = {
    id: "id",
    title: "title",
    description: "description",
    status: "status",
    priority: "priority",
    category: "category",
    owner: "owner",
    dueDate: "dueDate",
    hardDeadline: "hardDeadline",
    effort: "effort",
    followUpDate: "followUpDate",
    goalId: "goalId",
    queueRank: "queueRank",
    queueRationale: "queueRationale",
    queueRankedAt: "queueRankedAt",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    completedAt: "completedAt",
    cancelledAt: "cancelledAt",
    lastStatusChangeAt: "lastStatusChangeAt",
    needsAttention: "needsAttention",
    needsAttentionSetAt: "needsAttentionSetAt",
    needsAttentionReason: "needsAttentionReason",
  };

  const makeQuery = () => {
    let whereCondition: Condition | undefined;
    const matching = () =>
      mockTaskDb.rows.filter((row) =>
        mockTaskDb.matchesCondition(row, whereCondition),
      );
    // Thenable: awaiting the chain without .limit() returns every matching
    // row, mirroring the uncapped default of `task list` (ISS-003).
    const query = {
      from: () => query,
      where: (condition: Condition | undefined) => {
        whereCondition = condition;
        return query;
      },
      orderBy: () => query,
      limit: (limit: number) => Promise.resolve(matching().slice(0, limit)),
      then: (
        resolve: (rows: MockTaskRow[]) => unknown,
        reject?: (err: unknown) => unknown,
      ) => Promise.resolve(matching()).then(resolve, reject),
    };
    return query;
  };

  return {
    db: {
      select: vi.fn(() => makeQuery()),
    },
    tasks,
    taskDependencies: {
      blockedTaskId: "blockedTaskId",
      blockerTaskId: "blockerTaskId",
      createdAt: "createdAt",
    },
    taskNotes: {
      taskId: "taskId",
      noteType: "noteType",
      createdAt: "createdAt",
    },
  };
});

let registerTaskCommand:
  | ((program: Command) => void)
  | undefined;

async function loadRegisterTaskCommand(): Promise<(program: Command) => void> {
  if (!registerTaskCommand) {
    ({ registerTaskCommand } = await import("../../src/cli/commands/task.js"));
  }
  return registerTaskCommand;
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...listFiles(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function readWorkspaceFile(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("profile and agent command guidance", () => {
  it("does not teach agents the brittle npm-run Jordan invocation", () => {
    const files = [
      "AGENTS.md",
      "CLAUDE.md",
      ...listFiles(join(process.cwd(), "Profiles")).filter((file) =>
        /\.(md|yaml|yml)$/.test(file),
      ),
      ...listFiles(join(process.cwd(), "src", "web")).filter((file) =>
        /\.(svelte|ts)$/.test(file),
      ),
    ];

    const offenders = files
      .map((file) => ({
        file,
        text: readFileSync(file, "utf8"),
      }))
      .filter(({ text }) => text.includes("npm run execos --"));

    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("routes goal workflows to goal skills instead of relying only on global prompt examples", () => {
    const productionAgents = readWorkspaceFile("Profiles/Production/System Prompts/AGENTS.md");
    const productionClaude = readWorkspaceFile("Profiles/Production/System Prompts/CLAUDE.md");
    const developerAgents = readWorkspaceFile("Profiles/Developer/System Prompts/AGENTS.md");
    const developerClaude = readWorkspaceFile("Profiles/Developer/System Prompts/CLAUDE.md");

    expect(productionAgents).toContain("goal-prod");
    expect(productionClaude).toContain("goal-prod");
    expect(developerAgents).toContain("goal-dev");
    expect(developerClaude).toContain("goal-dev");
  });
});

describe("task list command", () => {
  beforeEach(() => {
    mockTaskDb.rows = [
      taskRow("KS-001", "triage"),
      taskRow("KS-002", "done", {
        completedAt: new Date("2026-06-10T10:00:00.000Z"),
      }),
      taskRow("KS-003", "cancelled", {
        cancelledAt: new Date("2026-06-10T11:00:00.000Z"),
      }),
      taskRow("KS-004", "review"),
    ];
  });

  it("defaults to open statuses only", async () => {
    const payload = await runTaskList([]);

    expect(payload.tasks.map((task) => task.id)).toEqual(["KS-001", "KS-004"]);
    expect(payload.tasks.map((task) => task.status)).toEqual(["triage", "review"]);
  });

  it("--all includes terminal statuses", async () => {
    const payload = await runTaskList(["--all"]);

    expect(payload.tasks.map((task) => task.id)).toEqual([
      "KS-001",
      "KS-002",
      "KS-003",
      "KS-004",
    ]);
  });

  it("--status cancelled overrides the default open-status filter", async () => {
    const payload = await runTaskList(["--status", "cancelled"]);

    expect(payload.tasks.map((task) => task.id)).toEqual(["KS-003"]);
    expect(payload.tasks.map((task) => task.status)).toEqual(["cancelled"]);
  });

  it("--hard-deadline returns only hard-deadline tasks", async () => {
    mockTaskDb.rows = [
      taskRow("KS-010", "triage", {
        hardDeadline: true,
        dueDate: new Date("2026-06-12T09:00:00.000Z"),
      }),
      taskRow("KS-011", "triage", {
        dueDate: new Date("2026-06-12T09:00:00.000Z"),
      }),
    ];

    const payload = await runTaskList(["--hard-deadline"]);

    expect(payload.tasks.map((task) => task.id)).toEqual(["KS-010"]);
  });

  it("--overdue returns only open tasks due before today", async () => {
    const past = new Date("2020-01-01T09:00:00.000Z");
    const future = new Date("2099-01-01T09:00:00.000Z");
    mockTaskDb.rows = [
      taskRow("KS-020", "triage", { dueDate: past }),
      taskRow("KS-021", "triage", { dueDate: future }),
      taskRow("KS-022", "done", {
        dueDate: past,
        completedAt: new Date("2026-06-10T10:00:00.000Z"),
      }),
    ];

    const payload = await runTaskList(["--overdue"]);

    expect(payload.tasks.map((task) => task.id)).toEqual(["KS-020"]);
  });

  it("returns every matching row by default and caps only with --limit", async () => {
    mockTaskDb.rows = Array.from({ length: 75 }, (_, i) =>
      taskRow(`KS-${String(100 + i)}`, "triage"),
    );

    const uncapped = await runTaskList([]);
    expect(uncapped.tasks).toHaveLength(75);

    const capped = await runTaskList(["--limit", "10"]);
    expect(capped.tasks).toHaveLength(10);
  });
});

async function runTaskList(args: string[]): Promise<{
  tasks: Array<{ id: string; status: string }>;
}> {
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
    const register = await loadRegisterTaskCommand();
    register(program);
    await program.parseAsync([
      "node",
      "execos",
      "--format",
      "json",
      "task",
      "list",
      ...args,
    ]);
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = originalWrite;
  }

  return JSON.parse(out.join(""));
}

function taskRow(
  id: string,
  status: string,
  overrides: Partial<MockTaskRow> = {},
): MockTaskRow {
  const now = new Date("2026-06-10T09:00:00.000Z");
  return {
    id,
    title: `${status} task`,
    description: "A representative task description.",
    status,
    priority: null,
    category: "personal",
    owner: "me",
    dueDate: null,
    hardDeadline: false,
    effort: null,
    followUpDate: null,
    goalId: null,
    queueRank: null,
    queueRationale: null,
    queueRankedAt: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    cancelledAt: null,
    lastStatusChangeAt: now,
    needsAttention: false,
    needsAttentionSetAt: null,
    needsAttentionReason: null,
    ...overrides,
  };
}
