import { describe, expect, test } from "vitest";
import { DECLARED_COMMAND_SEAMS } from "../../src/cli/adapters/interfaces.js";
import { createProductionAdapters } from "../../src/cli/adapters/production.js";
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
- Faked: declared test adapters.
- Real: declared production adapters.

Modules under test:
- adapter registry for command execution dependencies
*/

describe("every declared seam has both a production adapter and fake adapter", () => {
  test("AC-7: assert each DI seam is backed by both real and fake adapters or removed from the plan", () => {
    const production = createProductionAdapters();
    const fakes = {
      taskRepo: new FakeTaskRepo(),
      goalRepo: new FakeGoalRepo(),
      memoryRepo: new FakeMemoryRepo(),
      settingsLoader: new FakeSettingsLoader(),
      clockProvider: new FakeClockProvider(),
      embeddingAdapter: new FakeEmbeddingAdapter(),
      outputContext: createCaptureOutputContext(),
    };

    for (const seam of DECLARED_COMMAND_SEAMS) {
      expect(production[seam], `production adapter missing ${seam}`).toBeTruthy();
      expect(fakes[seam], `fake adapter missing ${seam}`).toBeTruthy();
    }
  });
});
