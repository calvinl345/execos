import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/domain/validation.js";
import { FakeSettingsLoader } from "../../src/cli/adapters/fakes.js";
import { productionSettingsLoader } from "../../src/cli/adapters/production.js";

/*
Boundary declaration:
- Mocked: none.
- Faked: FakeSettingsLoader.
- Real: production settings loader that reads app_settings.

Modules under test:
- SettingsLoader command dependency interface
*/

describe("SettingsLoader fake and production loader satisfy the SettingsLoader interface", () => {
  test("AC-6: assert settings overrides can be supplied without remote DB setup", async () => {
    const loader = new FakeSettingsLoader({
      settings: {
        ...DEFAULT_SETTINGS,
        infrastructure: {
          ...DEFAULT_SETTINGS.infrastructure,
          task_id_prefix: "QA",
        },
      },
      warnings: ["test warning"],
    });

    const result = await loader.load();
    expect(result.settings.infrastructure.task_id_prefix).toBe("QA");
    expect(result.warnings).toEqual(["test warning"]);
    expect(productionSettingsLoader.load).toEqual(expect.any(Function));
  });
});
