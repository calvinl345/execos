/**
 * `execos health` — base health command.
 *
 * Calls the existing health probe registry. Per AC-044 staging:
 *   - supabase probe: real
 *   - embed probe:    OpenAI key and dimension verification
 *   - mcp probe:      not_configured shape (activates with the MCP
 *                     server configuration)
 *
 * This command does NOT edit any existing probe. New probes register
 * themselves via `registerProbe` from `src/health/index.ts`.
 */

import { Command } from "commander";
import { z } from "zod";
import { runHealthCheck, type ProbeResult } from "../../health/index.js";
import { ctxFromProgram } from "../index-shared.js";
import { emit } from "../output-formatters/index.js";
import {
  EXIT_OK,
  EXIT_GENERIC,
  EXIT_HEALTH_FAIL,
  HealthCheckFailedError,
} from "../errors.js";

export function registerHealthCommand(program: Command): void {
  program
    .command("health")
    .description("Run the local health probes")
    .option(
      "--strict",
      "Exit non-zero if any probe is not_configured (default: only fail on hard fails)",
      false,
    )
    .action(async (opts: { strict?: boolean }) => {
      await runHealth(program, opts);
    });
}

async function runHealth(
  program: Command,
  opts: { strict?: boolean },
): Promise<void> {
  const ctx = ctxFromProgram(program);
  const overall = await runHealthCheck();

  emit(ctx, {
    text: () => renderHealthText(overall.status, overall.probes, overall.ranAt),
    json: () => ({
      ok: overall.status !== "fail",
      status: overall.status,
      ranAt: overall.ranAt,
      probes: overall.probes,
    }),
  });

  if (overall.status === "fail") {
    throw new HealthCheckFailedError(
      `Health check failed: ${overall.probes
        .filter((p) => p.status === "fail")
        .map((p) => p.name)
        .join(", ")}`,
    );
  }
  // --strict matches the option text verbatim: exit non-zero if ANY
  // probe is not_configured, regardless of overall status. This catches
  // the case where Supabase is OK but MCP is still staged and
  // strict-mode operators want to fail loudly.
  if (opts.strict) {
    const unconfigured = overall.probes.filter(
      (p) => p.status === "not_configured",
    );
    if (unconfigured.length > 0) {
      throw new HealthCheckFailedError(
        `Health check has unconfigured probes (--strict mode): ${unconfigured
          .map((p) => p.name)
          .join(", ")}`,
      );
    }
  }
}

function renderHealthText(
  status: string,
  probes: ProbeResult[],
  ranAt: string,
): string {
  const lines: string[] = [];
  lines.push(`overall: ${status}   ran at: ${ranAt}`);
  lines.push("");
  for (const p of probes) {
    lines.push(
      `  ${p.name.padEnd(10)} ${p.status.padEnd(15)} ${p.durationMs}ms`,
    );
    if (p.reason) lines.push(`    reason: ${p.reason}`);
    if (p.error) lines.push(`    error:  ${p.error}`);
    if (p.details) {
      for (const [k, v] of Object.entries(p.details)) {
        lines.push(`    ${k}: ${formatDetail(v)}`);
      }
    }
  }
  return lines.join("\n");
}

function formatDetail(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Typed CLI command Schemas.
//
// This file exports a `Schemas` object describing the `health`
// subcommand's input shape, success-output shape, reserved exit codes,
// and error categories. See `task.ts` for the pattern definition.
// ---------------------------------------------------------------------------

const isoDateString = z.string().refine(
  (s) => !Number.isNaN(Date.parse(s)),
  { message: "expected ISO-8601 date string" },
);

const ProbeStatusSchema = z.enum(["ok", "fail", "not_configured"]);

const ProbeResultSchema = z.object({
  name: z.string(),
  status: ProbeStatusSchema,
  durationMs: z.number().nonnegative(),
  reason: z.string().optional(),
  error: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const Schemas = {
  health: {
    input: z.object({
      strict: z.boolean().optional(),
    }),
    output: z.object({
      ok: z.boolean(),
      status: ProbeStatusSchema,
      ranAt: isoDateString,
      probes: z.array(ProbeResultSchema),
    }),
    exitCodes: [
      EXIT_OK,
      EXIT_GENERIC,
      EXIT_HEALTH_FAIL,
    ] as readonly number[],
    errorCategories: [
      "health_fail",
      "unhandled",
    ] as readonly string[],
  },
} as const;

export type HealthCommandName = keyof typeof Schemas;
