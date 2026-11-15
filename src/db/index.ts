/**
 * Drizzle client (service-role).
 *
 * Reads DATABASE_URL from the environment. Service-role access bypasses
 * Supabase RLS at the Postgres layer (the role has BYPASSRLS), so this
 * client is the unrestricted writer used by the CLI and migrations.
 *
 * For RLS-restricted reads (used in denial tests and the SvelteKit page
 * loader signed-URL seam), see ./anon-client.ts.
 *
 * Usage:
 *
 *   import { db, tasks, closeDb } from "../db/index.js";
 *   const rows = await db.select().from(tasks);
 *   await closeDb();
 *
 * Connection lifecycle: a single postgres-js pool is created on first
 * import. Tests and short-lived scripts must call closeDb() before exit
 * or postgres-js will hold the process open.
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill in " +
        "the Supabase Drizzle DATABASE_URL from the project header Connect dialog.",
    );
  }
  return url;
}

type SqlClient = ReturnType<typeof postgres>;

let sqlClientInstance: SqlClient | undefined;
let dbInstance: PostgresJsDatabase<typeof schema> | undefined;

function getSqlClient(): SqlClient {
  if (!sqlClientInstance) {
    /**
     * `prepare: false` is set because Supabase's pgBouncer in transaction
     * pooling mode does not support prepared statements; the session pooler
     * (port 5432) does, but we keep prepared off for portability across both
     * connection modes.
     *
     * `max: 5` keeps the pool small (single-user CLI; not a high-traffic
     * server). Tests can override via env if needed.
     */
    sqlClientInstance = postgres(requireDatabaseUrl(), {
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      onnotice: () => {
        /* swallow Postgres NOTICE messages (extension installs etc.) */
      },
    });
  }
  return sqlClientInstance;
}

function getDb(): PostgresJsDatabase<typeof schema> {
  if (!dbInstance) {
    dbInstance = drizzle(getSqlClient(), { schema });
  }
  return dbInstance;
}

const sqlClientTarget = ((
  strings: TemplateStringsArray,
  ...values: never[]
) => getSqlClient()(strings, ...values)) as unknown as SqlClient;

/**
 * Lazy postgres-js client. Importing this module does not require
 * DATABASE_URL; the connection is created only when a caller executes a
 * query. That keeps fast unit/contract tests from touching DB state
 * while preserving fail-fast behavior for real DB calls.
 */
export const sqlClient = new Proxy(sqlClientTarget, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getSqlClient(), prop, receiver);
    return typeof value === "function" ? value.bind(getSqlClient()) : value;
  },
}) as SqlClient;

/**
 * Drizzle ORM wrapper. Pass `schema` so relational queries and types
 * resolve. Snake-case mode is default in postgres-js; we use camelCase
 * field names in our table definitions and let Drizzle map.
 */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getDb(), prop, receiver);
    return typeof value === "function" ? value.bind(getDb()) : value;
  },
}) as PostgresJsDatabase<typeof schema>;

/**
 * Close the postgres-js pool. Call from test teardown and from any
 * short-lived script before process exit.
 */
export async function closeDb(): Promise<void> {
  if (!sqlClientInstance) return;
  await sqlClientInstance.end({ timeout: 5 });
  sqlClientInstance = undefined;
  dbInstance = undefined;
}

// Re-export schema for ergonomic imports:
//   import { db, tasks, goals } from "./db/index.js";
export * from "./schema.js";
