import { defineConfig } from "vitest/config";

const destructiveAck = "I_UNDERSTAND_THIS_WIPES_AN_ISOLATED_LOCAL_TEST_DATABASE";

if (process.env.EXECOS_ALLOW_DESTRUCTIVE_DB_TESTS !== destructiveAck) {
  throw new Error(
    [
      "Refusing to run destructive migration tests.",
      "Migration roundtrip tests drop and recreate tables, so they require",
      "an isolated local test database and the explicit destructive-test acknowledgement.",
    ].join(" "),
  );
}

if (process.env.EXECOS_RUN_DESTRUCTIVE_DB_TESTS !== "1") {
  throw new Error(
    "Refusing to run destructive migration tests. Set EXECOS_RUN_DESTRUCTIVE_DB_TESTS=1 and use a disposable database.",
  );
}

assertLocalTestDatabase();

function assertLocalTestDatabase(): void {
  if (process.env.EXECOS_DB_ENV !== "test") {
    throw new Error("Refusing to run destructive migration tests. EXECOS_DB_ENV must be 'test'.");
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("Refusing to run destructive migration tests. DATABASE_URL is not set.");
  }

  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";

  if (!isLocal) {
    throw new Error(
      `Refusing to run destructive migration tests. DATABASE_URL host '${parsed.hostname}' is not local.`,
    );
  }
}

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/db/migration-roundtrip.test.ts"],
    exclude: ["node_modules", "dist", ".svelte-kit"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
  },
});
