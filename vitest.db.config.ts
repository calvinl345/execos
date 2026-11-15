import { defineConfig } from "vitest/config";

const destructiveAck = "I_UNDERSTAND_THIS_WIPES_AN_ISOLATED_LOCAL_TEST_DATABASE";

if (process.env.EXECOS_ALLOW_DESTRUCTIVE_DB_TESTS !== destructiveAck) {
  throw new Error(
    [
      "Refusing to run DB integration tests.",
      "This suite truncates application tables and is disabled unless it is",
      "explicitly pointed at an isolated local test database.",
      `Set EXECOS_ALLOW_DESTRUCTIVE_DB_TESTS=${destructiveAck} only after`,
      "DATABASE_URL points at localhost/127.0.0.1/::1 test infrastructure.",
    ].join(" "),
  );
}

assertLocalTestDatabase();

function assertLocalTestDatabase(): void {
  if (process.env.EXECOS_DB_ENV !== "test") {
    throw new Error("Refusing to run DB integration tests. EXECOS_DB_ENV must be 'test'.");
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("Refusing to run DB integration tests. DATABASE_URL is not set.");
  }

  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";

  if (!isLocal) {
    throw new Error(
      `Refusing to run DB integration tests. DATABASE_URL host '${parsed.hostname}' is not local.`,
    );
  }
}

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "tests/db/append-only-scan.test.ts",
      "tests/db/cleanup.test.ts",
      "tests/db/constraints.test.ts",
      "tests/db/helpers.test.ts",
      "tests/db/queue-write.test.ts",
      "tests/db/rls.test.ts",
      "tests/db/views.test.ts",
      "tests/integration/db/cli-golden-flows.test.ts",
      "tests/integration/db/cli/review-commands.test.ts",
      "tests/integration/db/cli/settings-loader-no-duplicates.test.ts",
      // Rewritten onto the taskops surface (change-008): modern reset pattern,
      // covers the live dedup gate (pgvector), WIP cap, and --yes guards.
      "tests/integration/db/cli/task-commands.test.ts",
      // Any remaining tests/integration/db/cli/**/*.test.ts files are
      // pre-chunk-5.5 real-Supabase CLI tests that were renamed (not
      // refactored) into this directory. Chunk 5.6 migrates them to
      // fake-backed contract-tier tests under tests/contract/cli/*; including
      // them here produces failures because their resetDbData() dependencies
      // no longer hold. See GOVERNANCE/chunks/5.5/DEVIATIONS.md D-004.
    ],
    exclude: ["node_modules", "dist", ".svelte-kit", "tests/db/migration-roundtrip.test.ts"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
  },
});
