import { sql } from "drizzle-orm";
import { closeDb, db } from "../src/db/index.js";

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
      "Refusing local test DB preparation without the destructive-test acknowledgement.",
    );
  }

  if (process.env.EXECOS_DB_ENV !== "test") {
    throw new Error("Refusing local test DB preparation: EXECOS_DB_ENV must be 'test'.");
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("Refusing local test DB preparation: DATABASE_URL is not set.");
  }

  if (!isLocalHost(rawUrl)) {
    const parsed = new URL(rawUrl);
    throw new Error(
      `Refusing local test DB preparation: DATABASE_URL host '${parsed.hostname}' is not local.`,
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  if (supabaseUrl && !isLocalHost(supabaseUrl)) {
    const parsed = new URL(supabaseUrl);
    throw new Error(
      `Refusing local test DB preparation: SUPABASE_URL host '${parsed.hostname}' is not local.`,
    );
  }
}

async function main(): Promise<void> {
  assertLocalTestDatabase();
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  console.log("[local-db-tests] local test DB extensions ready");
}

main()
  .then(async () => {
    await closeDb();
  })
  .catch(async (err) => {
    console.error("[local-db-tests] local test DB preparation failed");
    console.error(err);
    await closeDb().catch(() => {
      /* ignore close errors during failure */
    });
    process.exit(1);
  });
