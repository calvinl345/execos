import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "tests/_meta/**/*.test.ts",
      "tests/contract/**/*.test.ts",
      "tests/domain/**/*.test.ts",
      "tests/embeddings/**/*.test.ts",
      "tests/health/**/*.test.ts",
      "tests/installer/**/*.test.mjs",
      "tests/installer/**/*.test.ts",
      "tests/lib/**/*.test.ts",
      "tests/scripts/**/*.test.mjs",
      "tests/services/**/*.test.ts",
      "tests/cli/errors.test.ts",
      "tests/cli/output-formatters.test.ts",
      "tests/cli/review-candidates.test.ts",
      "tests/cli/review-helpers.test.ts",
      "tests/cli/resource-command.test.ts",
      "tests/cli/schemas-contract.test.ts",
      "tests/cli/taskops.test.ts",
      "tests/cli/text-input.test.ts",
      "tests/cli/wip-cap-handler.test.ts",
      "tests/cli/dashboard-launcher.test.ts",
      "tests/cli/execos-launcher.test.ts",
      "tests/cli/cli-help-skill-map.test.ts",
      "tests/cli/task-write-funnel-scan.test.ts",
      "tests/cli/contract-conformance.test.ts",
      "tests/cli/composed-hydration.test.ts",
      "tests/cli/profile-guidance.test.ts",
      "tests/web/**/*.test.ts",
      "src/**/*.test.ts",
    ],
    exclude: ["node_modules", "dist", ".svelte-kit", "tests/db/**"],
    // jsdom env will be enabled per-file via /** @vitest-environment jsdom */
    // once Svelte component tests are added.
    setupFiles: ["tests/setup-fast.ts"],
  },
});
