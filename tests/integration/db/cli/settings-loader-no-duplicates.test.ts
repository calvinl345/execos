/**
 * Chunk-4.5 contract: every value in the typed Settings tree maps to
 * exactly one app_settings key. The legacy flat keys
 * (`task_id_prefix`, `p0_wip_cap`, etc.) are accepted for back-compat
 * and routed to their typed equivalents under `infrastructure.*`,
 * but if both a legacy key AND its typed key are present in
 * app_settings the loader emits a clear duplicate-detection warning
 * so the operator can clean up the stale row.
 *
 * Also: the seed shape produced by `deriveSeedRows(DEFAULT_SETTINGS)`
 * round-trips through the loader and reproduces DEFAULT_SETTINGS
 * exactly (chunk-4.5 round-trip AC).
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  closeDb,
  db,
  team,
} from "../../../../src/db/index.js";
import {
  loadSettings,
  resetSettingsCache,
} from "../../../../src/cli/settings-loader.js";
import {
  DEFAULT_SETTINGS,
} from "../../../../src/domain/validation.js";
import {
  DEFAULT_SEED_ROWS,
  DEFAULT_TEAM_ROWS,
  deriveSeedRows,
} from "../../../../src/cli/seed-rows.js";
import { seedDefaults } from "../../../../scripts/seed-app-settings.js";
import { resetDbData } from "../../../db/db-test-utils.js";

async function clearAppSettings(): Promise<void> {
  await db.execute(sql`DELETE FROM app_settings`);
}

async function clearTeam(): Promise<void> {
  await db.execute(sql`DELETE FROM team`);
}

async function upsertSetting(key: string, value: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `);
}

describe("settings-loader: no legacy/typed duplicates (chunk-4.5)", () => {
  beforeEach(async () => {
    resetSettingsCache();
    await resetDbData();
    await clearAppSettings();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("warns when both a legacy flat key and its typed equivalent are present", async () => {
    // Reseed the typed keys so loadSettings has a complete tree, then
    // add a stale legacy `task_id_prefix` row alongside the typed one.
    for (const row of DEFAULT_SEED_ROWS) {
      await upsertSetting(row.key, row.value);
    }
    await upsertSetting("task_id_prefix", "OLD");

    const { settings, warnings } = await loadSettings(true);
    expect(
      warnings.some(
        (w) =>
          w.includes("legacy key 'task_id_prefix'") &&
          w.includes("'infrastructure.task_id_prefix'"),
      ),
    ).toBe(true);
    // Typed value wins.
    expect(settings.infrastructure.task_id_prefix).toBe(
      DEFAULT_SETTINGS.infrastructure.task_id_prefix,
    );
  });

  it("silently routes a legacy flat key to its typed path when no duplicate exists", async () => {
    // Seed only the typed-tree minimum + one legacy key (no typed
    // equivalent for the legacy in this test).
    for (const row of DEFAULT_SEED_ROWS) {
      // Skip the typed equivalent of `task_id_prefix` so the legacy
      // is the sole source.
      if (row.key === "infrastructure.task_id_prefix") continue;
      await upsertSetting(row.key, row.value);
    }
    await upsertSetting("task_id_prefix", "FOO");

    const { settings, warnings } = await loadSettings(true);
    // No duplicate warning and no unknown-key warning for the legacy.
    expect(warnings.find((w) => w.includes("'task_id_prefix'"))).toBeUndefined();
    expect(settings.infrastructure.task_id_prefix).toBe("FOO");
  });

  it("seed -> load round-trips to DEFAULT_SETTINGS exactly", async () => {
    for (const row of DEFAULT_SEED_ROWS) {
      await upsertSetting(row.key, row.value);
    }
    const { settings, warnings } = await loadSettings(true);
    expect(warnings).toEqual([]);
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("deriveSeedRows is deterministic and produces unique keys", () => {
    const a = deriveSeedRows(DEFAULT_SETTINGS);
    const b = deriveSeedRows(DEFAULT_SETTINGS);
    expect(a).toEqual(b);
    const keys = a.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("seedDefaults bootstraps default team slugs from an empty team table", async () => {
    await clearTeam();

    await seedDefaults();

    const rows = await db
      .select({ slug: team.slug })
      .from(team)
      .orderBy(team.slug);
    const slugs = rows.map((row) => row.slug);
    expect(slugs).toEqual(
      expect.arrayContaining(["elena", "sam", "marcus", "jordan", "priya"]),
    );
    expect(new Set(slugs).size).toBe(DEFAULT_TEAM_ROWS.length);
  });

  it("seedDefaults is idempotent and preserves operator-specific team fields", async () => {
    await clearTeam();
    await db.insert(team).values({
      id: "custom-elena",
      slug: "elena",
      displayName: "Custom Elena",
      role: "Custom Role",
      slackUserId: "U-ELENA",
      email: "elena@example.com",
      notes: "Operator-specific note.",
    });

    await seedDefaults();
    const once = await db.select().from(team);
    await seedDefaults();
    const twice = await db.select().from(team);
    const elena = twice.find((row) => row.slug === "elena");

    expect(twice).toHaveLength(once.length);
    expect(elena).toMatchObject({
      id: "custom-elena",
      displayName: "Elena",
      role: "Engineering Lead",
      slackUserId: "U-ELENA",
      email: "elena@example.com",
      notes: "Operator-specific note.",
    });
  });
});
