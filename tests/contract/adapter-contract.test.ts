import { describe, expect, test } from "vitest";
import { DECLARED_COMMAND_SEAMS } from "../../src/cli/adapters/interfaces.js";
import {
  FakeClockProvider,
  FakeEmbeddingAdapter,
  FakeGoalRepo,
  FakeMemoryRepo,
  FakeSettingsLoader,
  FakeTaskRepo,
  createCaptureOutputContext,
} from "../../src/cli/adapters/fakes.js";

/*
Boundary declaration:
- Mocked: none.
- Faked: TaskRepo, GoalRepo, MemoryRepo, SettingsLoader, ClockProvider, EmbeddingAdapter, OutputContext.
- Real: production adapters are checked against the same public interfaces.

Modules under test:
- command dependency interfaces
- production and fake adapter contracts
*/

describe("adapter contract index", () => {
  test("AC-6: prove every declared command dependency interface has a contract test", () => {
    expect([...DECLARED_COMMAND_SEAMS].sort()).toEqual([
      "clockProvider",
      "embeddingAdapter",
      "goalRepo",
      "memoryRepo",
      "outputContext",
      "settingsLoader",
      "taskRepo",
    ]);
  });

  test("AC-6: fake adapters expose the command-facing method surface", () => {
    const adapters = {
      taskRepo: new FakeTaskRepo(),
      goalRepo: new FakeGoalRepo(),
      memoryRepo: new FakeMemoryRepo(),
      settingsLoader: new FakeSettingsLoader(),
      clockProvider: new FakeClockProvider(),
      embeddingAdapter: new FakeEmbeddingAdapter(),
      outputContext: createCaptureOutputContext(),
    };

    // change-008 (A14): TaskRepo is a read seam plus appendNote; create/update
    // were removed — task writes route through src/services/task-operations.ts.
    expect(adapters.taskRepo).toMatchObject({
      findById: expect.any(Function),
      list: expect.any(Function),
      recentNotes: expect.any(Function),
      dueFollowUps: expect.any(Function),
      appendNote: expect.any(Function),
    });
    expect(adapters.goalRepo).toMatchObject({
      findById: expect.any(Function),
      list: expect.any(Function),
      create: expect.any(Function),
      update: expect.any(Function),
      linkedTasks: expect.any(Function),
    });
    expect(adapters.memoryRepo).toMatchObject({
      findById: expect.any(Function),
      list: expect.any(Function),
      create: expect.any(Function),
      update: expect.any(Function),
    });
    expect(adapters.settingsLoader.load).toEqual(expect.any(Function));
    expect(adapters.clockProvider.now).toEqual(expect.any(Function));
    expect(adapters.clockProvider.nowMs).toEqual(expect.any(Function));
    expect(adapters.embeddingAdapter.embed).toEqual(expect.any(Function));
    expect(adapters.outputContext.out).toEqual(expect.any(Function));
    expect(adapters.outputContext.err).toEqual(expect.any(Function));
  });
});
