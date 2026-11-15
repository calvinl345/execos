import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  loadSettings,
  resetSettingsCache,
} from "../../../../src/cli/settings-loader.js";
import { closeDb } from "../../../../src/db/index.js";
import { resetDbData } from "../../../db/db-test-utils.js";
import { sql } from "drizzle-orm";
import { db } from "../../../../src/db/index.js";
import { DEFAULT_SETTINGS } from "../../../../src/domain/validation.js";

async function upsertSetting(key: string, value: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `);
}

describe("settings-loader", () => {
  beforeEach(async () => {
    resetSettingsCache();
    await resetDbData();
    // resetDbData seeds the v1 infra keys but does not clear test
    // overrides written by prior tests in this file. Wipe and re-seed
    // here to keep each test isolated.
    await db.execute(sql`DELETE FROM app_settings`);
    await db.execute(sql`
      INSERT INTO app_settings (key, value, description) VALUES
        ('p0_wip_cap', '3', 'Maximum number of open P0 tasks allowed at once.'),
        ('task_id_prefix', 'KS', 'Task id prefix; must match ^[A-Z]{1,4}$.')
    `);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("returns DEFAULT_SETTINGS when app_settings has only infrastructure keys", async () => {
    const { settings, warnings } = await loadSettings(true);
    expect(settings.prioritization.priority_weights).toEqual(
      DEFAULT_SETTINGS.prioritization.priority_weights,
    );
    expect(settings.intake_checklist.dedup.similarity_threshold).toBeCloseTo(
      DEFAULT_SETTINGS.intake_checklist.dedup.similarity_threshold,
    );
    // Infrastructure keys should not generate warnings.
    expect(warnings).toEqual([]);
  });

  it("memoizes per process unless force is set", async () => {
    const a = await loadSettings();
    const b = await loadSettings();
    expect(a).toBe(b); // same object reference
    const c = await loadSettings(true);
    expect(c).not.toBe(a); // forced reload returns a fresh object
  });

  it("applies a known dotted key override", async () => {
    await upsertSetting("prioritization.priority_weights.P0", "99");
    const { settings, warnings } = await loadSettings(true);
    expect(settings.prioritization.priority_weights.P0).toBe(99);
    expect(warnings).toEqual([]);
  });

  it("warns and ignores unknown keys", async () => {
    await upsertSetting("not.a.real.key", "value");
    const { warnings } = await loadSettings(true);
    expect(warnings.some((w) => w.includes("not.a.real.key"))).toBe(true);
  });

  it("warns and ignores invalid integer coercion", async () => {
    await upsertSetting("prioritization.priority_weights.P0", "banana");
    const { settings, warnings } = await loadSettings(true);
    expect(warnings.some((w) => w.includes("banana"))).toBe(true);
    // P0 falls back to default
    expect(settings.prioritization.priority_weights.P0).toBe(
      DEFAULT_SETTINGS.prioritization.priority_weights.P0,
    );
  });

  it("falls back gracefully when validation fails after merge", async () => {
    // -1 will fail the nonneg int Zod check.
    await upsertSetting("prioritization.priority_weights.P0", "-5");
    const { settings } = await loadSettings(true);
    // Either the value is rejected at coerce-time, or Zod rejects it
    // later. Either way, the loader does not crash and returns a
    // valid Settings object.
    expect(settings.prioritization).toBeDefined();
    expect(typeof settings.prioritization.priority_weights.P0).toBe("number");
  });
});
