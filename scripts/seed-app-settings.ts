/**
 * Seed default rows required by DB helpers and runtime config.
 *
 * Usage:
 *   node --env-file=.env --import=tsx scripts/seed-app-settings.ts
 *
 * Idempotent: derives app_settings from DEFAULT_SETTINGS and bootstraps the
 * default team roster without overwriting operator-specific fields.
 */

import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { db, appSettings, closeDb, team } from "../src/db/index.js";
import { DEFAULT_SEED_ROWS, DEFAULT_TEAM_ROWS } from "../src/cli/seed-rows.js";

export async function seedDefaults(): Promise<void> {
  await db
    .insert(appSettings)
    .values([...DEFAULT_SEED_ROWS])
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        value: sql`excluded.value`,
        description: sql`excluded.description`,
      },
    });

  console.log(`[seed] app_settings upserted (${DEFAULT_SEED_ROWS.length} rows)`);

  await db
    .insert(team)
    .values([...DEFAULT_TEAM_ROWS])
    .onConflictDoUpdate({
      target: team.slug,
      set: {
        displayName: sql`excluded.display_name`,
        role: sql`excluded.role`,
      },
    });

  console.log(`[seed] team bootstrapped (${DEFAULT_TEAM_ROWS.length} rows)`);
}

async function main(): Promise<void> {
  await seedDefaults();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("[seed] FAILED");
      console.error(err);
      await closeDb().catch(() => {
        /* ignore */
      });
      process.exit(1);
    });
}
