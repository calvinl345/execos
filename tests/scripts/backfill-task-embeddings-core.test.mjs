import {
  parseBackfillArgs,
  runBackfillTaskEmbeddings,
} from "../../scripts/lib/backfill-task-embeddings-core.mjs";

const silentLogger = {
  info() {},
  error() {},
};

function makeTask(id) {
  return {
    id,
    title: `Task ${id}`,
    description: `Description for ${id}`,
  };
}

describe("task embedding backfill core", () => {
  it("parses strict mode and rejects unknown flags", () => {
    expect(parseBackfillArgs(["--strict"])).toEqual({ strict: true });
    expect(parseBackfillArgs([])).toEqual({ strict: false });
    expect(() => parseBackfillArgs(["--wat"])).toThrow("Unknown option");
  });

  it("keeps best-effort runs successful when some embeddings fail", async () => {
    const stored = [];

    const result = await runBackfillTaskEmbeddings({
      strict: false,
      listEligibleTasks: async () => [makeTask("KS-001"), makeTask("KS-002")],
      countEligibleTasks: async () => 1,
      embedText: async (text) => {
        if (text.includes("KS-002")) throw new Error("provider down");
        return [0.1, 0.2, 0.3];
      },
      storeEmbedding: async (taskId, vector) => {
        stored.push({ taskId, vector });
      },
      logger: silentLogger,
    });

    expect(result).toEqual({
      processed: 2,
      updated: 1,
      skipped: 1,
      remaining: 1,
    });
    expect(stored).toEqual([{ taskId: "KS-001", vector: [0.1, 0.2, 0.3] }]);
  });

  it("fails strict runs when a row is skipped", async () => {
    await expect(
      runBackfillTaskEmbeddings({
        strict: true,
        listEligibleTasks: async () => [makeTask("KS-001")],
        countEligibleTasks: async () => 1,
        embedText: async () => {
          throw new Error("provider down");
        },
        storeEmbedding: async () => {},
        logger: silentLogger,
      }),
    ).rejects.toThrow("strict mode failed");
  });

  it("fails strict runs when eligible rows remain after clean writes", async () => {
    await expect(
      runBackfillTaskEmbeddings({
        strict: true,
        listEligibleTasks: async () => [makeTask("KS-001")],
        countEligibleTasks: async () => 1,
        embedText: async () => [0.1],
        storeEmbedding: async () => {},
        logger: silentLogger,
      }),
    ).rejects.toThrow("1 open task(s) still have NULL embeddings");
  });

  it("passes strict runs when every eligible row is filled", async () => {
    await expect(
      runBackfillTaskEmbeddings({
        strict: true,
        listEligibleTasks: async () => [makeTask("KS-001")],
        countEligibleTasks: async () => 0,
        embedText: async () => [0.1],
        storeEmbedding: async () => {},
        logger: silentLogger,
      }),
    ).resolves.toMatchObject({
      processed: 1,
      updated: 1,
      skipped: 0,
      remaining: 0,
    });
  });
});
