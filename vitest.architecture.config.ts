import { defineConfig } from "vitest/config";

/**
 * arch:check tier — architecture governance checks only (constitution
 * enforcement). Includes the architecture-owned conventions and behavioral
 * tests plus the constitution-linked scan tests that live in the general
 * suite (all file-based, no database).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "architecture/tests/**/*.test.ts",
      "tests/cli/task-write-funnel-scan.test.ts",
      "tests/cli/contract-conformance.test.ts",
      "tests/cli/cli-help-skill-map.test.ts",
      "tests/db/append-only-scan.test.ts",
    ],
    exclude: ["node_modules", "dist", ".svelte-kit"],
    setupFiles: ["tests/setup-fast.ts"],
    testTimeout: 60_000,
  },
});
