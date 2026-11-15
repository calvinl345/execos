import { describe, expect, it } from "vitest";
import {
  dedupCheck,
  complexityCheck,
  dependencyCheck,
  categoryInference,
  priorityInference,
  ownerInference,
  downstreamImpact,
  exactDuplicateMatches,
  generateAuditTrail,
  normalizeForExactMatch,
  runIntake,
  type EmbedFn,
  type DedupCandidate,
  type TaskRef,
  type DownstreamRef,
} from "../../src/domain/intake.js";
import { DEFAULT_SETTINGS } from "../../src/domain/validation.js";

const REF = new Date("2026-04-26T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// dedupCheck (D.1)
// ---------------------------------------------------------------------------

describe("domain/intake dedupCheck (D.1)", () => {
  // Stub embedder: maps text -> deterministic 4-d vector.
  // Identical text -> identical vector -> cosine 1.
  // Predictable variants for testing band thresholds.
  const stubEmbed: EmbedFn = async (text: string) => {
    if (text === "draft") return [1, 0, 0, 0];
    if (text === "exact-match") return [1, 0, 0, 0]; // cos=1 with draft
    if (text === "very-close") return [0.99, 0.05, 0, 0]; // cos ~ 0.998
    if (text === "borderline") return [0.85, 0.5, 0, 0]; // cos ~ 0.862
    if (text === "different") return [0, 1, 0, 0]; // cos = 0
    return [0, 0, 1, 0];
  };

  it("returns near_identical when top match is at or above 0.92", async () => {
    const cand: DedupCandidate[] = [
      { id: "KS-001", text: "exact-match", embedding: null },
      { id: "KS-002", text: "different", embedding: null },
    ];
    const r = await dedupCheck("draft", cand, stubEmbed, DEFAULT_SETTINGS);
    expect(r.skipped).toBe(false);
    expect(r.suggestion).toBe("near_identical");
    expect(r.matches[0].id).toBe("KS-001");
    expect(r.matches[0].similarity).toBeCloseTo(1, 8);
    expect(r.matches[0].band).toBe("near_identical");
  });

  it("returns similar in the [threshold, 0.92) band", async () => {
    const cand: DedupCandidate[] = [
      { id: "KS-010", text: "borderline", embedding: null },
      { id: "KS-020", text: "different", embedding: null },
    ];
    const r = await dedupCheck("draft", cand, stubEmbed, DEFAULT_SETTINGS);
    expect(r.skipped).toBe(false);
    expect(r.suggestion).toBe("similar");
    expect(r.matches[0].id).toBe("KS-010");
    expect(r.matches[0].band).toBe("similar");
  });

  it("returns no_match when nothing meets threshold", async () => {
    const cand: DedupCandidate[] = [
      { id: "KS-030", text: "different", embedding: null },
    ];
    const r = await dedupCheck("draft", cand, stubEmbed, DEFAULT_SETTINGS);
    expect(r.skipped).toBe(false);
    expect(r.suggestion).toBe("no_match");
    expect(r.matches[0].band).toBe("no_match");
  });

  it("uses pre-computed embeddings when present", async () => {
    let embedCalls = 0;
    const tracking: EmbedFn = async (t) => {
      embedCalls += 1;
      return stubEmbed(t);
    };
    const cand: DedupCandidate[] = [
      { id: "KS-001", text: "exact-match", embedding: [1, 0, 0, 0] },
    ];
    const r = await dedupCheck("draft", cand, tracking, DEFAULT_SETTINGS);
    expect(r.matches[0].similarity).toBeCloseTo(1, 8);
    // Only the draft is embedded; the candidate uses its pre-baked vector.
    expect(embedCalls).toBe(1);
  });

  it("skips the step when embed throws (graceful degradation per D.0)", async () => {
    const failing: EmbedFn = async () => {
      throw new Error("OpenAI 503");
    };
    const cand: DedupCandidate[] = [
      { id: "KS-001", text: "exact-match", embedding: null },
    ];
    const r = await dedupCheck("draft", cand, failing, DEFAULT_SETTINGS);
    expect(r.skipped).toBe(true);
    expect(r.skipReason).toContain("OpenAI");
    expect(r.matches).toEqual([]);
    expect(r.suggestion).toBe("no_match");
  });

  it("excludes individual candidates whose own embedding fails", async () => {
    let firstCall = true;
    const partial: EmbedFn = async (t) => {
      if (t === "draft") return [1, 0, 0, 0];
      if (firstCall) {
        firstCall = false;
        throw new Error("transient");
      }
      return stubEmbed(t);
    };
    const cand: DedupCandidate[] = [
      { id: "KS-bad", text: "exact-match", embedding: null },
      { id: "KS-good", text: "different", embedding: null },
    ];
    const r = await dedupCheck("draft", cand, partial, DEFAULT_SETTINGS);
    expect(r.skipped).toBe(false);
    // KS-bad excluded; only KS-good in the result.
    expect(r.matches.map((m) => m.id)).toEqual(["KS-good"]);
  });

  it("orders matches by similarity descending", async () => {
    const cand: DedupCandidate[] = [
      { id: "KS-1", text: "different", embedding: null },
      { id: "KS-2", text: "exact-match", embedding: null },
      { id: "KS-3", text: "borderline", embedding: null },
    ];
    const r = await dedupCheck("draft", cand, stubEmbed, DEFAULT_SETTINGS);
    expect(r.matches.map((m) => m.id)).toEqual(["KS-2", "KS-3", "KS-1"]);
  });
});

// ---------------------------------------------------------------------------
// Exact-match dedup helpers (decision 006)
// ---------------------------------------------------------------------------

describe("domain/intake normalizeForExactMatch / exactDuplicateMatches", () => {
  it("normalizes case, trims, and collapses internal whitespace runs only", () => {
    expect(normalizeForExactMatch("  Send  the\tLarkspur\n MSA ")).toBe(
      "send the larkspur msa",
    );
    // No punctuation stripping, no stemming.
    expect(normalizeForExactMatch("Send the MSA!")).toBe("send the msa!");
    expect(normalizeForExactMatch("Sending the MSA")).toBe("sending the msa");
  });

  it("matches per-field: title-vs-title and description-vs-description, never cross-field", () => {
    const candidates = [
      { id: "KS-001", title: "Send the MSA", description: "Totally different body" },
      { id: "KS-002", title: "Other work", description: "Draft the contract terms" },
      { id: "KS-003", title: "Draft the contract terms", description: "Send the MSA" },
    ];
    const matches = exactDuplicateMatches(
      { title: "send THE msa", description: "draft the   contract terms" },
      candidates,
    );
    expect(matches.map((m) => [m.id, m.matchedOn])).toEqual([
      ["KS-001", "title"],
      ["KS-002", "description"],
      // KS-003 only matches cross-field, which never counts.
    ]);
  });

  it("reports matched_on 'both' when title and description both match", () => {
    const matches = exactDuplicateMatches(
      { title: "Send the MSA", description: "Draft the contract terms" },
      [{ id: "KS-001", title: " SEND  the msa", description: "draft the contract terms " }],
    );
    expect(matches).toEqual([
      { id: "KS-001", title: " SEND  the msa", matchedOn: "both" },
    ]);
  });

  it("substantive edits never match", () => {
    const matches = exactDuplicateMatches(
      { title: "Send the MSA to Larkspur", description: "Draft the contract terms" },
      [{ id: "KS-001", title: "Send the MSA", description: "Draft the contract term" }],
    );
    expect(matches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// complexityCheck (D.2)
// ---------------------------------------------------------------------------

describe("domain/intake complexityCheck (D.2)", () => {
  it("counts words and reports under-threshold result", () => {
    const r = complexityCheck("Short task description.", DEFAULT_SETTINGS);
    expect(r.wordCount).toBe(3);
    expect(r.hitsThreshold).toBe(false);
    expect(r.suggestSplit).toBe(false);
  });

  it("flags as multi-objective when default 'and.*and' regex matches", () => {
    const r = complexityCheck(
      "Write the doc and review the PR and also schedule",
      DEFAULT_SETTINGS,
    );
    expect(r.isMultiObjective).toBe(true);
    expect(r.suggestSplit).toBe(true);
  });

  it("hits threshold when word count exceeds the configured value", () => {
    const long = Array(70).fill("foo").join(" ");
    const r = complexityCheck(long, DEFAULT_SETTINGS);
    expect(r.wordCount).toBe(70);
    expect(r.hitsThreshold).toBe(true);
    expect(r.suggestSplit).toBe(true);
  });

  it("does NOT hit threshold for a long single-objective text without 'and...and'", () => {
    const text = "This is a relatively long task description discussing one thing without conjoining objectives.";
    const r = complexityCheck(text, DEFAULT_SETTINGS);
    expect(r.isMultiObjective).toBe(false);
    expect(r.hitsThreshold).toBe(false);
  });

  it("respects custom multi_objective_pattern", () => {
    const custom = structuredClone(DEFAULT_SETTINGS) as typeof DEFAULT_SETTINGS;
    (
      custom.intake_checklist.complexity as { multi_objective_pattern: string }
    ).multi_objective_pattern = "split";
    const r = complexityCheck("please split this work", custom);
    expect(r.isMultiObjective).toBe(true);
  });

  it("counts zero words for empty / whitespace-only input", () => {
    expect(complexityCheck("", DEFAULT_SETTINGS).wordCount).toBe(0);
    expect(complexityCheck("   \t  \n", DEFAULT_SETTINGS).wordCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dependencyCheck (D.3)
// ---------------------------------------------------------------------------

describe("domain/intake dependencyCheck (D.3)", () => {
  it("extracts explicit task IDs", () => {
    const r = dependencyCheck(
      "Continue work on KS-005 then KS-12 follow up.",
      [],
      DEFAULT_SETTINGS,
      REF,
    );
    expect(r.explicitIds.sort()).toEqual(["KS-005", "KS-12"]);
  });

  it("captures dependency phrases as evidence", () => {
    const r = dependencyCheck(
      "Run after KS-001 is done and before KS-002.",
      [],
      DEFAULT_SETTINGS,
      REF,
    );
    expect(r.evidence.length).toBeGreaterThan(0);
    expect(r.evidence[0]).toMatch(/after\s+KS-001\s+is\s+done/i);
  });

  it("suggests likely dependencies from recent completions when titles share tokens", () => {
    const recent: TaskRef[] = [
      {
        id: "KS-100",
        title: "Draft Larkspur quarterly billing report",
        completedAt: new Date(REF.getTime() - 2 * DAY),
      },
      {
        id: "KS-101",
        title: "Order office supplies",
        completedAt: new Date(REF.getTime() - DAY),
      },
    ];
    const r = dependencyCheck(
      "Send Larkspur billing report follow-up note",
      recent,
      DEFAULT_SETTINGS,
      REF,
    );
    expect(r.likelyDependencies.map((t) => t.id)).toEqual(["KS-100"]);
  });

  it("filters likely dependencies by lookback window", () => {
    const ancient: TaskRef[] = [
      {
        id: "KS-200",
        title: "Larkspur billing review",
        completedAt: new Date(REF.getTime() - 30 * DAY),
      },
    ];
    const r = dependencyCheck(
      "Larkspur billing follow-up",
      ancient,
      DEFAULT_SETTINGS,
      REF,
    );
    expect(r.likelyDependencies).toEqual([]);
  });

  it("does NOT duplicate explicit IDs into likely dependencies", () => {
    const recent: TaskRef[] = [
      {
        id: "KS-005",
        title: "Larkspur billing kickoff",
        completedAt: new Date(REF.getTime() - DAY),
      },
    ];
    const r = dependencyCheck(
      "After KS-005 finishes, draft Larkspur billing follow-up",
      recent,
      DEFAULT_SETTINGS,
      REF,
    );
    expect(r.explicitIds).toContain("KS-005");
    expect(r.likelyDependencies.map((t) => t.id)).not.toContain("KS-005");
  });

  it("returns empty results when no signals are present", () => {
    const r = dependencyCheck(
      "Buy groceries this weekend",
      [],
      DEFAULT_SETTINGS,
      REF,
    );
    expect(r.explicitIds).toEqual([]);
    expect(r.likelyDependencies).toEqual([]);
    expect(r.evidence).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// categoryInference (D.4)
// ---------------------------------------------------------------------------

describe("domain/intake categoryInference (D.4)", () => {
  it("returns client for client-related text", () => {
    const r = categoryInference("Send the MSA to the client and update the scope.", DEFAULT_SETTINGS);
    expect(r.category).toBe("client");
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("returns business for internal Northwind ops text", () => {
    const r = categoryInference("Renew the SOP for vendor onboarding at Northwind.", DEFAULT_SETTINGS);
    expect(r.category).toBe("business");
  });

  it("returns product for product text", () => {
    const r = categoryInference("Update the product roadmap before the beta.", DEFAULT_SETTINGS);
    expect(r.category).toBe("product");
  });

  it("returns house for house text", () => {
    const r = categoryInference("Call the landlord about the lease renewal.", DEFAULT_SETTINGS);
    expect(r.category).toBe("house");
  });

  it("returns personal for personal text", () => {
    const r = categoryInference("Schedule dentist appointment and pick up tax forms.", DEFAULT_SETTINGS);
    expect(r.category).toBe("personal");
  });

  it("returns null when no keyword matches", () => {
    const r = categoryInference("Reorganize my desk drawer.", DEFAULT_SETTINGS);
    expect(r.category).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it("picks the dominant category when multiple keywords are present", () => {
    const r = categoryInference(
      "House utility task: client called about home maintenance and lease, but talk client first.",
      DEFAULT_SETTINGS,
    );
    // 'client' x2 + 'lease' + 'house' + 'home' + 'maintenance' + 'utility'
    // client gets 2; house gets 4. House wins.
    expect(r.category).toBe("house");
  });
});

// ---------------------------------------------------------------------------
// priorityInference (D.5)
// ---------------------------------------------------------------------------

describe("domain/intake priorityInference (D.5)", () => {
  it("returns P0 for urgent/critical text above threshold", () => {
    const r = priorityInference(
      "Critical urgent fire to put out emergency",
      DEFAULT_SETTINGS,
    );
    expect(r.priority).toBe("P0");
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.rawPriority).toBe("P0");
  });

  it("returns null when confidence is below the configured minimum", () => {
    // Mix of P0 and P3 keywords -> 50/50 -> below default 0.7.
    const r = priorityInference(
      "Critical thing for someday",
      DEFAULT_SETTINGS,
    );
    expect(r.priority).toBeNull();
    expect(r.rawPriority).not.toBeNull();
    expect(r.rawConfidence).toBeGreaterThan(0);
    expect(r.rawConfidence).toBeLessThan(0.7);
  });

  it("returns null for text with no priority signal", () => {
    const r = priorityInference("Just a normal task", DEFAULT_SETTINGS);
    expect(r.priority).toBeNull();
    expect(r.rawConfidence).toBe(0);
  });

  it("matches multi-word priority phrases (e.g. 'high priority')", () => {
    const r = priorityInference("This is high priority work", DEFAULT_SETTINGS);
    expect(r.priority).toBe("P1");
  });

  it("respects a custom confidence threshold", () => {
    const lax = structuredClone(DEFAULT_SETTINGS) as typeof DEFAULT_SETTINGS;
    (
      lax.intake_checklist.field_assignment as {
        priority_inference_confidence_min: number;
      }
    ).priority_inference_confidence_min = 0.3;
    const r = priorityInference(
      "Critical thing for someday",
      lax,
    );
    // Now the 50/50 split passes the lower threshold.
    expect(r.priority).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ownerInference
// ---------------------------------------------------------------------------

describe("domain/intake ownerInference", () => {
  it("defaults to 'me' when no owner phrase appears", () => {
    const r = ownerInference("Buy groceries");
    expect(r.owner).toBe("me");
    expect(r.shouldDelegate).toBe(false);
  });

  it("detects 'assign to NAME'", () => {
    const r = ownerInference("Assign this to Dana Reyes by Friday");
    expect(r.owner).toBe("Dana Reyes");
    expect(r.shouldDelegate).toBe(true);
    expect(r.evidence).toContain("Dana Reyes");
  });

  it("detects 'delegate to NAME'", () => {
    const r = ownerInference("Delegate to Theo for review");
    expect(r.owner).toBe("Theo");
    expect(r.shouldDelegate).toBe(true);
  });

  it("detects 'NAME owns this'", () => {
    const r = ownerInference("Dana owns this from now on");
    expect(r.owner).toBe("Dana");
    expect(r.shouldDelegate).toBe(true);
  });

  it("normalizes 'me' / 'myself' to non-delegated", () => {
    const r = ownerInference("Assign to me before EOD");
    // The leading "Assign to me" pattern won't match because "me" is lowercase
    // and the regex requires capitalized initial. Defaults to 'me' / no delegate.
    expect(r.owner).toBe("me");
    expect(r.shouldDelegate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// downstreamImpact (D.6)
// ---------------------------------------------------------------------------

describe("domain/intake downstreamImpact (D.6)", () => {
  it("flags P0 as high severity", () => {
    const ds: DownstreamRef[] = [
      { id: "KS-D1", title: "ds1", priority: "P0", dueAt: null },
    ];
    const r = downstreamImpact(ds, REF);
    expect(r[0].severity).toBe("high");
    expect(r[0].reason).toContain("P0");
  });

  it("flags due-within-48h as high severity", () => {
    const ds: DownstreamRef[] = [
      {
        id: "KS-D2",
        title: "ds2",
        priority: "P3",
        dueAt: new Date(REF.getTime() + DAY),
      },
    ];
    const r = downstreamImpact(ds, REF);
    expect(r[0].severity).toBe("high");
    expect(r[0].reason).toContain("48 hours");
  });

  it("flags P1 as medium severity", () => {
    const ds: DownstreamRef[] = [
      { id: "KS-D3", title: "ds3", priority: "P1", dueAt: null },
    ];
    const r = downstreamImpact(ds, REF);
    expect(r[0].severity).toBe("medium");
  });

  it("flags due-within-7d as medium severity", () => {
    const ds: DownstreamRef[] = [
      {
        id: "KS-D4",
        title: "ds4",
        priority: "P3",
        dueAt: new Date(REF.getTime() + 5 * DAY),
      },
    ];
    const r = downstreamImpact(ds, REF);
    expect(r[0].severity).toBe("medium");
  });

  it("flags everything else as low severity", () => {
    const ds: DownstreamRef[] = [
      { id: "KS-D5", title: "ds5", priority: "P3", dueAt: null },
    ];
    const r = downstreamImpact(ds, REF);
    expect(r[0].severity).toBe("low");
  });

  it("orders results high then medium then low", () => {
    const ds: DownstreamRef[] = [
      { id: "L1", title: "low", priority: "P3", dueAt: null },
      { id: "H1", title: "high", priority: "P0", dueAt: null },
      { id: "M1", title: "med", priority: "P1", dueAt: null },
    ];
    const r = downstreamImpact(ds, REF);
    expect(r.map((x) => x.taskId)).toEqual(["H1", "M1", "L1"]);
  });

  it("returns empty array for empty input", () => {
    expect(downstreamImpact([], REF)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// generateAuditTrail (D.7)
// ---------------------------------------------------------------------------

describe("domain/intake generateAuditTrail (D.7)", () => {
  it("serializes all six step results into stable shape", () => {
    const trail = generateAuditTrail({
      dedup: {
        suggestion: "near_identical",
        matches: [{ id: "KS-001", similarity: 0.95, band: "near_identical" }],
        skipped: false,
      },
      complexity: {
        wordCount: 30,
        isMultiObjective: false,
        hitsThreshold: false,
        suggestSplit: false,
      },
      dependency: {
        explicitIds: ["KS-005"],
        likelyDependencies: [],
        evidence: [],
      },
      category: { category: "personal", confidence: 1, reasons: ["keyword \"personal\""] },
      priority: {
        priority: "P1",
        confidence: 1,
        reasons: ["keyword \"asap\""],
        rawPriority: "P1",
        rawConfidence: 1,
      },
      owner: { owner: "me", shouldDelegate: false },
      downstream: [],
      durationMs: 42,
    });

    expect(trail).toEqual({
      step_1_dedup: "merge_candidate:KS-001",
      step_2_complexity: "kept_single",
      step_3_dependency: "explicit:KS-005",
      step_4_field_assignment: "complete",
      step_5_delegation: "not_delegated",
      step_6_downstream: "noted",
      duration_ms: 42,
    });
  });

  it("reports skipped dedup with reason", () => {
    const trail = generateAuditTrail({
      dedup: {
        suggestion: "no_match",
        matches: [],
        skipped: true,
        skipReason: "OpenAI 503",
      },
      complexity: {
        wordCount: 0,
        isMultiObjective: false,
        hitsThreshold: false,
        suggestSplit: false,
      },
      dependency: { explicitIds: [], likelyDependencies: [], evidence: [] },
      category: { category: null, confidence: 0, reasons: [] },
      priority: {
        priority: null,
        confidence: 0,
        reasons: [],
        rawPriority: null,
        rawConfidence: 0,
      },
      owner: { owner: "me", shouldDelegate: false },
      downstream: [],
      durationMs: 1,
    });
    expect(trail.step_1_dedup).toBe("skipped:OpenAI 503");
  });

  it("reports partial field assignment when category or priority are missing", () => {
    const trail = generateAuditTrail({
      dedup: { suggestion: "no_match", matches: [], skipped: false },
      complexity: {
        wordCount: 0,
        isMultiObjective: false,
        hitsThreshold: false,
        suggestSplit: false,
      },
      dependency: { explicitIds: [], likelyDependencies: [], evidence: [] },
      category: { category: null, confidence: 0, reasons: [] },
      priority: {
        priority: "P1",
        confidence: 1,
        reasons: [],
        rawPriority: "P1",
        rawConfidence: 1,
      },
      owner: { owner: "me", shouldDelegate: false },
      downstream: [],
      durationMs: 1,
    });
    expect(trail.step_4_field_assignment).toBe("partial:category");
  });

  it("reports split_suggested when complexity suggests splitting", () => {
    const trail = generateAuditTrail({
      dedup: { suggestion: "no_match", matches: [], skipped: false },
      complexity: {
        wordCount: 100,
        isMultiObjective: true,
        hitsThreshold: true,
        suggestSplit: true,
      },
      dependency: { explicitIds: [], likelyDependencies: [], evidence: [] },
      category: {
        category: "personal",
        confidence: 1,
        reasons: ["keyword \"personal\""],
      },
      priority: {
        priority: "P1",
        confidence: 1,
        reasons: ["keyword \"asap\""],
        rawPriority: "P1",
        rawConfidence: 1,
      },
      owner: { owner: "Dana", shouldDelegate: true },
      downstream: [{ taskId: "KS-9", title: "x", reason: "P0", severity: "high" }],
      durationMs: 1,
    });
    expect(trail.step_2_complexity).toBe("split_suggested");
    expect(trail.step_5_delegation).toBe("drafted:to=Dana");
    expect(trail.step_6_downstream).toBe("affects:1");
  });
});

// ---------------------------------------------------------------------------
// runIntake (orchestrator end-to-end with stubbed embed)
// ---------------------------------------------------------------------------

describe("domain/intake runIntake (orchestrator)", () => {
  const stubEmbed: EmbedFn = async (text: string) => {
    // Return distinguishable vectors keyed off short prefixes.
    return [text.length, text.charCodeAt(0) ?? 0, 0, 0];
  };

  it("composes all six steps and produces an audit trail", async () => {
    const r = await runIntake({
      text: "ASAP urgent: send Larkspur MSA. Due Thursday.",
      candidates: [],
      recentCompletions: [],
      downstream: [],
      embed: stubEmbed,
      settings: DEFAULT_SETTINGS,
      referenceTime: REF,
      defaultTimeZone: "UTC",
    });

    expect(r.dedup.skipped).toBe(false);
    expect(r.dedup.suggestion).toBe("no_match");
    expect(r.complexity.suggestSplit).toBe(false);
    expect(r.dependency.explicitIds).toEqual([]);
    // 'Larkspur' triggers client through 'client'? Actually the
    // word 'client' isn't in the text. 'Larkspur' alone won't match
    // any keyword. 'MSA' is a client keyword though.
    expect(r.category.category).toBe("client");
    // 'ASAP' and 'urgent' both fire (P1 and P0). Distribution is
    // 50/50, below default 0.7 threshold; we only get raw inference.
    // Actually 'urgent' is P0; 'ASAP' is P1. 1+1=2 total, top=1
    // -> rawConfidence 0.5; resolved priority is null.
    expect(r.priority.priority).toBeNull();
    expect(r.priority.rawConfidence).toBeCloseTo(0.5, 5);
    expect(r.owner.shouldDelegate).toBe(false);
    expect(r.downstream).toEqual([]);
    // Thursday at 17:00 UTC (REF is Sunday Apr 26 -> Thursday Apr 30).
    expect(r.dueAt?.toISOString()).toBe("2026-04-30T17:00:00.000Z");
    expect(r.audit.step_4_field_assignment).toBe("partial:priority");
  });

  it("dedup result feeds into the audit trail correctly", async () => {
    const candEmbed: number[] = [
      "send Larkspur MSA".length,
      "send Larkspur MSA".charCodeAt(0),
      0,
      0,
    ];
    const r = await runIntake({
      text: "send Larkspur MSA",
      candidates: [{ id: "KS-001", text: "send Larkspur MSA", embedding: candEmbed }],
      recentCompletions: [],
      downstream: [],
      embed: stubEmbed,
      settings: DEFAULT_SETTINGS,
      referenceTime: REF,
      defaultTimeZone: "UTC",
    });
    expect(r.dedup.suggestion).toBe("near_identical");
    expect(r.audit.step_1_dedup).toBe("merge_candidate:KS-001");
  });

  it("graceful degradation: embed throw produces 'skipped' but still runs other steps", async () => {
    const failing: EmbedFn = async () => {
      throw new Error("OpenAI down");
    };
    const r = await runIntake({
      text: "Schedule dentist appointment for next Monday",
      candidates: [{ id: "KS-001", text: "stuff", embedding: null }],
      recentCompletions: [],
      downstream: [],
      embed: failing,
      settings: DEFAULT_SETTINGS,
      referenceTime: REF,
      defaultTimeZone: "UTC",
    });
    expect(r.dedup.skipped).toBe(true);
    expect(r.audit.step_1_dedup).toContain("skipped");
    // Other steps still produced results.
    expect(r.category.category).toBe("personal");
    expect(r.dueAt).toBeNull(); // No "due X" phrase in this input.
  });

  it("extracts due-date phrase when prefixed with 'due'", async () => {
    const r = await runIntake({
      text: "Tax filing prep due 2026-05-15.",
      candidates: [],
      recentCompletions: [],
      downstream: [],
      embed: stubEmbed,
      settings: DEFAULT_SETTINGS,
      referenceTime: REF,
      defaultTimeZone: "UTC",
    });
    expect(r.dueAt?.toISOString()).toBe("2026-05-15T17:00:00.000Z");
  });

  it("respects an explicit duePhrase override over text extraction", async () => {
    const r = await runIntake({
      text: "Tax filing prep due 2026-05-15.",
      duePhrase: "tomorrow at noon",
      candidates: [],
      recentCompletions: [],
      downstream: [],
      embed: stubEmbed,
      settings: DEFAULT_SETTINGS,
      referenceTime: REF,
      defaultTimeZone: "UTC",
    });
    expect(r.dueAt?.toISOString()).toBe("2026-04-27T12:00:00.000Z");
  });
});
