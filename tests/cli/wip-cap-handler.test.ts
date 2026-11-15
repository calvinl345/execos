import { describe, expect, it } from "vitest";
import { buildWipCapDescriptor } from "../../src/cli/wip-cap-handler.js";

describe("buildWipCapDescriptor", () => {
  it("surfaces the four AC-073 proactive options plus free-text path", () => {
    const d = buildWipCapDescriptor({
      cap: 3,
      currentCount: 3,
      existingP0: [
        { id: "KS-001", title: "Existing P0 a", status: "in_progress", priority: "P0" },
        { id: "KS-002", title: "Existing P0 b", status: "in_progress", priority: "P0" },
      ],
    });

    expect(d.cap).toBe(3);
    expect(d.currentCount).toBe(3);
    expect(d.freeTextAccepted).toBe(true);

    const keys = d.options.map((o) => o.key).sort();
    expect(keys).toEqual([
      "bump-cap",
      "demote-existing-p0",
      "downgrade-to-p1",
      "hold-in-backlog",
    ]);
  });

  it("does not include any silent-bypass option (AC-073 forbids auto-deciding)", () => {
    const d = buildWipCapDescriptor({ cap: 3, currentCount: 3, existingP0: [] });
    const keys = d.options.map((o) => o.key);
    expect(keys).not.toContain("override");
    expect(keys).not.toContain("complete-existing");
  });

  it("flags demote-existing-p0 and bump-cap as requiring confirmation", () => {
    const d = buildWipCapDescriptor({
      cap: 3,
      currentCount: 3,
      existingP0: [],
    });
    const requireConfirm = d.options
      .filter((o) => o.requiresConfirmation)
      .map((o) => o.key)
      .sort();
    expect(requireConfirm).toEqual(["bump-cap", "demote-existing-p0"]);
  });

  it("includes a concrete command string per option", () => {
    const d = buildWipCapDescriptor({ cap: 3, currentCount: 3, existingP0: [] });
    for (const o of d.options) {
      expect(o.command.length).toBeGreaterThan(0);
    }
  });

  it("includes existing P0 list verbatim for the operator to choose from", () => {
    const existingP0 = [
      { id: "KS-007", title: "Title A", status: "in_progress", priority: "P0" as const },
      { id: "KS-008", title: "Title B", status: "blocked", priority: "P0" as const },
    ];
    const d = buildWipCapDescriptor({ cap: 3, currentCount: 3, existingP0 });
    expect(d.existingP0).toEqual(existingP0);
  });

  it("returns option descriptions as non-empty human-readable strings", () => {
    const d = buildWipCapDescriptor({ cap: 3, currentCount: 3, existingP0: [] });
    for (const o of d.options) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.description.length).toBeGreaterThan(10);
    }
  });

  it("renders the bump-cap command against the typed Settings key (chunk-4.5)", () => {
    const d = buildWipCapDescriptor({ cap: 3, currentCount: 3, existingP0: [] });
    const bump = d.options.find((o) => o.key === "bump-cap");
    expect(bump).toBeDefined();
    // The cap is read from Settings.infrastructure.p0_wip_cap. The
    // bump-cap option's command and description must point operators at
    // that typed key, not the legacy flat key.
    expect(bump?.command).toContain("infrastructure.p0_wip_cap");
    expect(bump?.command).not.toMatch(/key\s*=\s*'p0_wip_cap'/);
    expect(bump?.description).toContain("infrastructure.p0_wip_cap");
    expect(bump?.label).toContain("infrastructure.p0_wip_cap");
  });
});
