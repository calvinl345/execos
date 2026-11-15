import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "../../../../src/db/index.js";
import { runCli, parseLastJsonStdoutValidated } from "../../../cli/test-utils.js";
import { EXIT_HEALTH_FAIL, EXIT_OK } from "../../../../src/cli/errors.js";
import { Schemas as HealthSchemas } from "../../../../src/cli/commands/health.js";

describe("execos health CLI", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("returns a structured probe report in JSON mode", async () => {
    const result = await runCli(["health"], { format: "json" });
    expect(result.exitCode).toBe(EXIT_OK);
    // Validates the captured JSON against the exported output schema
    // before asserting fields. Catches contract drift between the
    // production emitter and the documented Schemas shape.
    const parsed = parseLastJsonStdoutValidated(
      result,
      HealthSchemas.health.output,
    );
    expect(parsed.ok).toBe(true);
    const names = parsed.probes.map((p) => p.name).sort();
    expect(names).toEqual(["embed", "mcp", "supabase"]);
    // Embed/MCP probes report not_configured until their respective
    // integrations are wired in.
    const embed = parsed.probes.find((p) => p.name === "embed");
    const mcp = parsed.probes.find((p) => p.name === "mcp");
    expect(embed?.status).toBe("not_configured");
    expect(mcp?.status).toBe("not_configured");
  });

  it("--strict exits non-zero when ANY probe is not_configured (embed + mcp staged)", async () => {
    // Default state: supabase=ok, embed=not_configured,
    // mcp=not_configured. Overall is "ok" because at least one probe
    // is OK and none failed, but --strict must still fire because
    // individual probes are unconfigured per the option text.
    const result = await runCli(["health", "--strict"], { format: "json" });
    expect(result.exitCode).toBe(EXIT_HEALTH_FAIL);
    expect(result.err).toMatch(/embed/);
    expect(result.err).toMatch(/mcp/);
  });
});
