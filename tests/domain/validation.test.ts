import { describe, expect, it } from "vitest";
import {
  TaskStatusSchema,
  TaskPrioritySchema,
  TaskCategorySchema,
  GoalStatusSchema,
  MemoryStateSchema,
  MemoryScopeSchema,
  QuarterCodeSchema,
  nonEmptyString,
  SettingsSchema,
  DEFAULT_SETTINGS,
  parseSettings,
  safeParseSettings,
} from "../../src/domain/validation.js";

describe("domain/validation enum schemas", () => {
  describe("TaskStatusSchema", () => {
    it("accepts every canonical task status", () => {
      const all = [
        "triage",
        "backlog",
        "in_progress",
        "blocked",
        "review",
        "done",
        "cancelled",
      ] as const;
      for (const v of all) {
        expect(TaskStatusSchema.parse(v)).toBe(v);
      }
    });

    it("rejects unknown statuses", () => {
      expect(() => TaskStatusSchema.parse("doing")).toThrow();
      expect(() => TaskStatusSchema.parse("DONE")).toThrow();
      expect(() => TaskStatusSchema.parse("")).toThrow();
    });
  });

  describe("TaskPrioritySchema", () => {
    it("accepts P0..P3", () => {
      for (const v of ["P0", "P1", "P2", "P3"]) {
        expect(TaskPrioritySchema.parse(v)).toBe(v);
      }
    });

    it("rejects p0 (lowercase) and out-of-range", () => {
      expect(() => TaskPrioritySchema.parse("p0")).toThrow();
      expect(() => TaskPrioritySchema.parse("P4")).toThrow();
      expect(() => TaskPrioritySchema.parse(0)).toThrow();
    });
  });

  describe("TaskCategorySchema", () => {
    it("accepts every canonical category", () => {
      for (const v of [
        "client",
        "business",
        "product",
        "house",
        "personal",
      ]) {
        expect(TaskCategorySchema.parse(v)).toBe(v);
      }
    });

    it("rejects unknown categories", () => {
      expect(() => TaskCategorySchema.parse("work")).toThrow();
      expect(() => TaskCategorySchema.parse("Acme-Client")).toThrow();
    });
  });

  describe("GoalStatusSchema", () => {
    it("accepts active/achieved/dropped only", () => {
      expect(GoalStatusSchema.parse("active")).toBe("active");
      expect(GoalStatusSchema.parse("achieved")).toBe("achieved");
      expect(GoalStatusSchema.parse("dropped")).toBe("dropped");
      expect(() => GoalStatusSchema.parse("done")).toThrow();
      expect(() => GoalStatusSchema.parse("cancelled")).toThrow();
    });
  });

  describe("MemoryStateSchema", () => {
    it("accepts active/superseded/pruned only", () => {
      expect(MemoryStateSchema.parse("active")).toBe("active");
      expect(MemoryStateSchema.parse("superseded")).toBe("superseded");
      expect(MemoryStateSchema.parse("pruned")).toBe("pruned");
      expect(() => MemoryStateSchema.parse("archived")).toThrow();
    });
  });
});

describe("domain/validation MemoryScopeSchema", () => {
  it("accepts single segments and multi-segment paths", () => {
    expect(MemoryScopeSchema.parse("global")).toBe("global");
    expect(MemoryScopeSchema.parse("clients")).toBe("clients");
    expect(MemoryScopeSchema.parse("clients/larkspur")).toBe(
      "clients/larkspur",
    );
    expect(MemoryScopeSchema.parse("clients/larkspur/billing")).toBe(
      "clients/larkspur/billing",
    );
    expect(MemoryScopeSchema.parse("a-b-c/1-2-3/x9")).toBe("a-b-c/1-2-3/x9");
  });

  it("rejects empty strings, leading/trailing slash, double slash", () => {
    expect(() => MemoryScopeSchema.parse("")).toThrow();
    expect(() => MemoryScopeSchema.parse("/leading")).toThrow();
    expect(() => MemoryScopeSchema.parse("trailing/")).toThrow();
    expect(() => MemoryScopeSchema.parse("a//b")).toThrow();
  });

  it("rejects spaces, uppercase, and disallowed characters", () => {
    expect(() => MemoryScopeSchema.parse("has space")).toThrow();
    expect(() => MemoryScopeSchema.parse("Clients")).toThrow();
    expect(() => MemoryScopeSchema.parse("clients/Larkspur")).toThrow();
    expect(() => MemoryScopeSchema.parse("clients/data_knox")).toThrow();
    expect(() => MemoryScopeSchema.parse("clients/data.knox")).toThrow();
  });

  it("rejects scopes longer than 256 characters", () => {
    const long = "x".repeat(257);
    expect(() => MemoryScopeSchema.parse(long)).toThrow();
  });
});

describe("domain/validation QuarterCodeSchema", () => {
  // Matches the goals.quarter CHECK constraint in src/db/schema.ts:
  // ~ '^[0-9]{4}-Q[1-4]$'.
  it("accepts well-formed quarter codes", () => {
    expect(QuarterCodeSchema.parse("2026-Q1")).toBe("2026-Q1");
    expect(QuarterCodeSchema.parse("2026-Q4")).toBe("2026-Q4");
    expect(QuarterCodeSchema.parse("1999-Q2")).toBe("1999-Q2");
  });

  it("rejects malformed quarter codes", () => {
    expect(() => QuarterCodeSchema.parse("2026Q1")).toThrow(); // missing hyphen
    expect(() => QuarterCodeSchema.parse("2026-q1")).toThrow(); // lowercase q
    expect(() => QuarterCodeSchema.parse("2026-Q5")).toThrow();
    expect(() => QuarterCodeSchema.parse("2026-Q0")).toThrow();
    expect(() => QuarterCodeSchema.parse("26-Q1")).toThrow();
    expect(() => QuarterCodeSchema.parse("Y2026Q1")).toThrow(); // old format
    expect(() => QuarterCodeSchema.parse("")).toThrow();
  });
});

describe("domain/validation nonEmptyString", () => {
  it("accepts ordinary non-empty strings", () => {
    const schema = nonEmptyString(50);
    expect(schema.parse("hello")).toBe("hello");
    expect(schema.parse("a")).toBe("a");
  });

  it("rejects empty strings and whitespace-only", () => {
    const schema = nonEmptyString(50);
    expect(() => schema.parse("")).toThrow();
    expect(() => schema.parse("   ")).toThrow();
    expect(() => schema.parse("\t\n")).toThrow();
  });

  it("enforces the max length cap", () => {
    const schema = nonEmptyString(5);
    expect(schema.parse("hello")).toBe("hello");
    expect(() => schema.parse("hello!")).toThrow();
  });
});

describe("domain/validation SettingsSchema and DEFAULT_SETTINGS", () => {
  it("DEFAULT_SETTINGS conforms to SettingsSchema", () => {
    const parsed = SettingsSchema.parse(DEFAULT_SETTINGS);
    expect(parsed).toEqual(DEFAULT_SETTINGS);
  });

  it("DEFAULT_SETTINGS exposes the documented baseline values", () => {
    // Sanity checks against the baseline prioritization constants. If any of
    // these change, the seed data and user-facing defaults must change too.
    expect(DEFAULT_SETTINGS.prioritization.priority_weights.P0).toBe(10);
    expect(DEFAULT_SETTINGS.prioritization.priority_weights.P1).toBe(5);
    expect(DEFAULT_SETTINGS.prioritization.priority_weights.P2).toBe(2);
    expect(DEFAULT_SETTINGS.prioritization.priority_weights.P3).toBe(1);
    expect(DEFAULT_SETTINGS.prioritization.overdue.max).toBe(20);
    expect(DEFAULT_SETTINGS.prioritization.staleness.max_penalty).toBe(3);
    expect(DEFAULT_SETTINGS.prioritization.wip_caps.P0_in_progress_max).toBe(3);
    expect(DEFAULT_SETTINGS.prioritization.risk_windows.commitment_days).toBe(3);
    expect(DEFAULT_SETTINGS.prioritization.risk_windows.goal_days).toBe(14);
    expect(
      DEFAULT_SETTINGS.intake_checklist.dedup.similarity_threshold,
    ).toBeCloseTo(0.85, 5);
  });

  it("rejects non-positive or non-integer risk_windows values", () => {
    const bad = structuredClone(DEFAULT_SETTINGS) as Settings;
    bad.prioritization.risk_windows.commitment_days = 0;
    expect(() => SettingsSchema.parse(bad)).toThrow();

    const bad2 = structuredClone(DEFAULT_SETTINGS) as Settings;
    bad2.prioritization.risk_windows.goal_days = 1.5;
    expect(() => SettingsSchema.parse(bad2)).toThrow();
  });

  it("DEFAULT_SETTINGS is deeply frozen (mutation throws)", () => {
    expect(() => {
      // Cast to any to bypass readonly type guard; we want to prove the
      // runtime freeze, not just the static type guard.
      (DEFAULT_SETTINGS as unknown as { prioritization: { priority_weights: { P0: number } } })
        .prioritization.priority_weights.P0 = 999;
    }).toThrow();
  });

  it("rejects negative priority weights", () => {
    const bad = structuredClone(DEFAULT_SETTINGS) as Settings;
    bad.prioritization.priority_weights.P0 = -1;
    expect(() => SettingsSchema.parse(bad)).toThrow();
  });

  it("rejects non-integer staleness days_per_penalty", () => {
    const bad = structuredClone(DEFAULT_SETTINGS) as Settings;
    bad.prioritization.staleness.days_per_penalty = 1.5;
    expect(() => SettingsSchema.parse(bad)).toThrow();
  });

  it("rejects similarity_threshold outside [0, 1]", () => {
    const bad = structuredClone(DEFAULT_SETTINGS) as Settings;
    bad.intake_checklist.dedup.similarity_threshold = 1.5;
    expect(() => SettingsSchema.parse(bad)).toThrow();

    const bad2 = structuredClone(DEFAULT_SETTINGS) as Settings;
    bad2.intake_checklist.dedup.similarity_threshold = -0.1;
    expect(() => SettingsSchema.parse(bad2)).toThrow();
  });

  it("rejects priority_inference_confidence_min outside [0, 1]", () => {
    const bad = structuredClone(DEFAULT_SETTINGS) as Settings;
    bad.intake_checklist.field_assignment.priority_inference_confidence_min = 2;
    expect(() => SettingsSchema.parse(bad)).toThrow();
  });

  it("rejects missing top-level keys", () => {
    expect(() => SettingsSchema.parse({})).toThrow();
    expect(() =>
      SettingsSchema.parse({ prioritization: DEFAULT_SETTINGS.prioritization }),
    ).toThrow();
  });

  it("rejects empty multi_objective_pattern", () => {
    const bad = structuredClone(DEFAULT_SETTINGS) as Settings;
    bad.intake_checklist.complexity.multi_objective_pattern = "";
    expect(() => SettingsSchema.parse(bad)).toThrow();
  });
});

describe("domain/validation parseSettings + safeParseSettings", () => {
  it("parseSettings returns a fresh, mutable Settings (not frozen)", () => {
    const parsed = parseSettings(DEFAULT_SETTINGS);
    // Should NOT throw — the parsed result is a fresh object.
    parsed.prioritization.priority_weights.P0 = 99;
    expect(parsed.prioritization.priority_weights.P0).toBe(99);
    // DEFAULT_SETTINGS itself unchanged.
    expect(DEFAULT_SETTINGS.prioritization.priority_weights.P0).toBe(10);
  });

  it("parseSettings throws on invalid input", () => {
    expect(() => parseSettings({ foo: "bar" })).toThrow();
    expect(() => parseSettings(null)).toThrow();
    expect(() => parseSettings(undefined)).toThrow();
  });

  it("safeParseSettings returns ok=true on valid input", () => {
    const result = safeParseSettings(DEFAULT_SETTINGS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prioritization.priority_weights.P0).toBe(10);
    }
  });

  it("safeParseSettings returns ok=false with ZodError on invalid input", () => {
    const result = safeParseSettings({ prioritization: "wrong" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

// Local Settings type alias for tests that need a mutable copy.
type Settings = ReturnType<typeof parseSettings>;
