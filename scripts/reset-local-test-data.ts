import { sql } from "drizzle-orm";
import { closeDb, db } from "../src/db/index.js";
import { seedDefaults } from "./seed-app-settings.js";

const DESTRUCTIVE_TEST_ACK =
  "I_UNDERSTAND_THIS_WIPES_AN_ISOLATED_LOCAL_TEST_DATABASE";

function isLocalHost(rawUrl: string): boolean {
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}

function assertLocalTestDatabase(): void {
  if (process.env.EXECOS_ALLOW_DESTRUCTIVE_DB_TESTS !== DESTRUCTIVE_TEST_ACK) {
    throw new Error(
      "Refusing local test cleanup without the destructive-test acknowledgement.",
    );
  }

  if (process.env.EXECOS_DB_ENV !== "test") {
    throw new Error("Refusing local test cleanup: EXECOS_DB_ENV must be 'test'.");
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("Refusing local test cleanup: DATABASE_URL is not set.");
  }

  if (!isLocalHost(rawUrl)) {
    const parsed = new URL(rawUrl);
    throw new Error(
      `Refusing local test cleanup: DATABASE_URL host '${parsed.hostname}' is not local.`,
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  if (supabaseUrl && !isLocalHost(supabaseUrl)) {
    const parsed = new URL(supabaseUrl);
    throw new Error(
      `Refusing local test cleanup: SUPABASE_URL host '${parsed.hostname}' is not local.`,
    );
  }
}

async function clearData(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE
    triage_items,
    triage_sessions,
    document_tasks,
    documents,
    memories,
    task_dependencies,
    task_activities,
    task_notes,
    tasks,
    goals,
    team
    CASCADE`);
}

async function main(): Promise<void> {
  assertLocalTestDatabase();
  await clearData();
  await seedDefaults();
  console.log("[local-db-tests] local test data reset complete");
}

main()
  .then(async () => {
    await closeDb();
  })
  .catch(async (err) => {
    console.error("[local-db-tests] local test data reset failed");
    console.error(err);
    await closeDb().catch(() => {
      /* ignore close errors during failure */
    });
    process.exit(1);
  });
