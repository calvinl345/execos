/**
 * Verifies that overriding `Settings.intake_checklist.category_keywords`
 * and `Settings.intake_checklist.priority_keywords` changes the
 * inference output. Pure unit test; no DB.
 *
 * The chunk-4.5 contract: every plausibly-tunable knob lives in
 * `app_settings`. These tests guarantee the tuning surface actually
 * flows through the inference functions.
 */

import { describe, expect, it } from "vitest";
import {
  categoryInference,
  priorityInference,
} from "../../src/domain/intake.js";
import { DEFAULT_SETTINGS } from "../../src/domain/validation.js";

describe("intake keyword tuning (chunk-4.5)", () => {
  it("overriding category_keywords changes categoryInference output", () => {
    // Default keywords classify "rocket launch" as no-match.
    const baseline = categoryInference("rocket launch", DEFAULT_SETTINGS);
    expect(baseline.category).toBeNull();

    // Operator adds "rocket" to business keywords.
    const tuned = structuredClone(DEFAULT_SETTINGS) as typeof DEFAULT_SETTINGS;
    (tuned.intake_checklist.category_keywords["business"] as unknown as string[]) =
      [...DEFAULT_SETTINGS.intake_checklist.category_keywords["business"], "rocket"];
    const after = categoryInference("rocket launch", tuned);
    expect(after.category).toBe("business");
    expect(after.reasons.some((r) => r.includes("rocket"))).toBe(true);
  });

  it("removing all keywords for a category disables it", () => {
    const tuned = structuredClone(DEFAULT_SETTINGS) as typeof DEFAULT_SETTINGS;
    (tuned.intake_checklist.category_keywords.house as unknown as string[]) = [];
    const r = categoryInference("Call the landlord about the lease.", tuned);
    expect(r.category).toBeNull();
  });

  it("overriding priority_keywords changes priorityInference output", () => {
    const baseline = priorityInference("Need to ship the rocket", DEFAULT_SETTINGS);
    // No priority keywords in default set match "rocket"; baseline raw
    // priority should be null.
    expect(baseline.rawPriority).toBeNull();

    const tuned = structuredClone(DEFAULT_SETTINGS) as typeof DEFAULT_SETTINGS;
    (tuned.intake_checklist.priority_keywords.P0 as unknown as string[]) = [
      ...DEFAULT_SETTINGS.intake_checklist.priority_keywords.P0,
      "rocket",
    ];
    const after = priorityInference("Need to ship the rocket", tuned);
    expect(after.rawPriority).toBe("P0");
  });

  it("category and priority keywords are independent (changing one does not affect the other)", () => {
    const tuned = structuredClone(DEFAULT_SETTINGS) as typeof DEFAULT_SETTINGS;
    (tuned.intake_checklist.category_keywords.product as unknown as string[]) = [
      "tracing",
      "telemetry",
    ];
    // priority_keywords still default; "urgent" still resolves P0.
    const r = priorityInference("urgent telemetry telemetry telemetry telemetry", tuned);
    expect(r.priority).toBe("P0");
  });
});
