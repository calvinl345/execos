import { describe, expect, it } from "vitest";
import { requireFollowUpForDelegatedOwner } from "../../src/domain/follow-ups.js";

describe("requireFollowUpForDelegatedOwner", () => {
  it("allows own owner with null follow-up date", () => {
    expect(requireFollowUpForDelegatedOwner("me", null)).toEqual({ ok: true });
    expect(requireFollowUpForDelegatedOwner(null, null)).toEqual({ ok: true });
    expect(requireFollowUpForDelegatedOwner(undefined, null)).toEqual({ ok: true });
    expect(requireFollowUpForDelegatedOwner("", null)).toEqual({ ok: true });
    expect(requireFollowUpForDelegatedOwner("  me  ", null)).toEqual({ ok: true });
    expect(requireFollowUpForDelegatedOwner("ME", null)).toEqual({ ok: true });
  });

  it("fails delegated owner with null or undefined follow-up date", () => {
    expect(requireFollowUpForDelegatedOwner("elena", null)).toEqual({
      ok: false,
      reason: "A delegated task must have a follow-up date",
    });
    expect(requireFollowUpForDelegatedOwner("elena", undefined)).toEqual({
      ok: false,
      reason: "A delegated task must have a follow-up date",
    });
  });

  it("allows delegated owner with valid follow-up date", () => {
    expect(requireFollowUpForDelegatedOwner("elena", new Date())).toEqual({ ok: true });
  });
});
