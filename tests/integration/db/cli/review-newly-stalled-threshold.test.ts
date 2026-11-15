/**
 * Verifies that `Settings.needs_attention.staleness_days_threshold`
 * is the only knob driving the `execos review eod` newlyStalled
 * surface, and that it is independent of
 * `Settings.prioritization.staleness.days_per_penalty`.
 *
 * Chunk-4.5 contract: an operator can tune the EOD review's
 * staleness window without touching the prioritization formula's
 * scoring cadence.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, db } from "../../../../src/db/index.js";
import { resetDbData, insertTask } from "../../../db/db-test-utils.js";
import { resetSettingsCache, loadSettings } from "../../../../src/cli/settings-loader.js";
import { runCli, parseLastJsonStdout } from "../../../cli/test-utils.js";

interface EodResponse {
  ok: boolean;
  newlyStalled: Array<{
    taskId: string;
    daysSinceUpdate: number;
  }>;
}

async function setSetting(key: string, value: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `);
}

describe("review eod newlyStalled threshold (chunk-4.5)", () => {
  beforeEach(async () => {
    resetSettingsCache();
    await resetDbData();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("uses needs_attention.staleness_days_threshold, not prioritization.staleness.days_per_penalty", async () => {
    // Default threshold is 7. Insert a task whose updatedAt sits at
    // 5 days ago: it should NOT be newly stalled at threshold=7, but
    // SHOULD be newly stalled at threshold=4.
    const id = await insertTask({
      id: "KS-NS-001",
      status: "in_progress",
      category: "personal",
    });
    await db.execute(sql`
      UPDATE tasks SET updated_at = now() - interval '5 days' WHERE id = ${id}
    `);

    // Baseline: default threshold (7) -> not newly stalled.
    let result = await runCli(["review", "eod"], { format: "json" });
    let parsed = parseLastJsonStdout(result) as EodResponse;
    expect(parsed.newlyStalled.map((t) => t.taskId)).not.toContain(id);

    // Lower the threshold to 4. The 5-days-stale row should now be
    // newly stalled (4 <= 5 < 8). prioritization.staleness.days_per_penalty
    // stays at 7 -- the prioritization formula is unaffected.
    await setSetting("needs_attention.staleness_days_threshold", "4");
    resetSettingsCache();
    const settings = (await loadSettings(true)).settings;
    expect(settings.needs_attention.staleness_days_threshold).toBe(4);
    expect(settings.prioritization.staleness.days_per_penalty).toBe(7);

    result = await runCli(["review", "eod"], { format: "json" });
    parsed = parseLastJsonStdout(result) as EodResponse;
    expect(parsed.newlyStalled.map((t) => t.taskId)).toContain(id);
  });

  it("changing prioritization.staleness.days_per_penalty in isolation does NOT change newlyStalled output", async () => {
    // 5-days-stale row, default threshold (7).
    const id = await insertTask({
      id: "KS-NS-002",
      status: "in_progress",
      category: "personal",
    });
    await db.execute(sql`
      UPDATE tasks SET updated_at = now() - interval '5 days' WHERE id = ${id}
    `);

    // Set prioritization.staleness.days_per_penalty to 3 (which would
    // surface this task in the legacy behavior). Threshold stays 7.
    await setSetting("prioritization.staleness.days_per_penalty", "3");
    resetSettingsCache();
    const result = await runCli(["review", "eod"], { format: "json" });
    const parsed = parseLastJsonStdout(result) as EodResponse;
    // newlyStalled is now driven by needs_attention.*, NOT prioritization.*,
    // so the row stays out.
    expect(parsed.newlyStalled.map((t) => t.taskId)).not.toContain(id);
  });
});
