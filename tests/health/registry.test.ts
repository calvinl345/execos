import { afterEach, describe, expect, it } from "vitest";
import {
  _getRegisteredProbeForTest,
  _unregisterProbeForTest,
  getRegisteredProbeNames,
  registerProbe,
  type ProbeResult,
} from "../../src/health/index.js";

const TEST_PROBE_NAME = "test_probe";

describe("health probe registry", () => {
  afterEach(() => {
    // Always remove any test_probe a test registered, even on assertion
    // failure, so the registry returns to its baseline shape.
    _unregisterProbeForTest(TEST_PROBE_NAME);
  });

  it("registers the baseline probe slots in sorted order", () => {
    expect(getRegisteredProbeNames()).toEqual(["embed", "mcp", "supabase"]);
  });

  // -----------------------------------------------------------------------
  // Content-stability invariant: register a fake probe and confirm the
  // existing supabase probe is unchanged. The invariant under test is
  // "new probes are added by registering, NOT by editing existing
  // probe bodies."
  //
  // We capture (a) the probe function reference and (b) its source-text
  // snapshot before and after registering test_probe. If a future change
  // accidentally rewires the supabase probe body or the registration
  // pattern, this test fails loudly.
  // -----------------------------------------------------------------------

  it(
    "preserves the supabase probe body when a new probe registers",
    () => {
      const before = _getRegisteredProbeForTest("supabase");
      expect(before, "supabase probe must be registered").toBeDefined();
      const beforeSource = (before as () => Promise<ProbeResult>).toString();

      // Register a fake probe. Per the registry contract this MUST NOT
      // touch any existing probe.
      registerProbe(TEST_PROBE_NAME, async () => ({
        name: TEST_PROBE_NAME,
        status: "ok",
        durationMs: 0,
      }));

      expect(getRegisteredProbeNames()).toEqual([
        "embed",
        "mcp",
        "supabase",
        TEST_PROBE_NAME,
      ]);

      const after = _getRegisteredProbeForTest("supabase");
      expect(after, "supabase probe must still be registered").toBeDefined();
      const afterSource = (after as () => Promise<ProbeResult>).toString();

      // Reference equality: the registered Probe is the same function
      // object before and after.
      expect(after).toBe(before);

      // Source-text equality: the function body is byte-for-byte the
      // same. This catches a subtler regression where someone registers
      // supabase a second time (which would currently throw because of
      // the duplicate guard, but the assertion remains a clear contract).
      expect(afterSource).toBe(beforeSource);
    },
  );

  it("rejects duplicate probe registration", () => {
    registerProbe(TEST_PROBE_NAME, async () => ({
      name: TEST_PROBE_NAME,
      status: "ok",
      durationMs: 0,
    }));
    expect(() =>
      registerProbe(TEST_PROBE_NAME, async () => ({
        name: TEST_PROBE_NAME,
        status: "ok",
        durationMs: 0,
      })),
    ).toThrow(/already registered/);
  });
});
