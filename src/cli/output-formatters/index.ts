/**
 * CLI output formatters.
 *
 * Two output modes:
 *   - text: terse, human-readable; default.
 *   - json: machine-readable; one JSON document per command.
 *
 * Agent skills and the dashboard consume the JSON form. The human form
 * stays small enough to read on a narrow terminal.
 *
 * Pure functions only. Writers receive a `WriteFn` so tests can capture
 * output without stubbing process.stdout.
 */

import type { CliErrorSummary } from "../errors.js";

export type OutputFormat = "text" | "json";

export type WriteFn = (chunk: string) => void;

export interface FormatterContext {
  format: OutputFormat;
  out: WriteFn;
  err: WriteFn;
}

export function defaultContext(format: OutputFormat = "text"): FormatterContext {
  return {
    format,
    out: (chunk) => process.stdout.write(chunk),
    err: (chunk) => process.stderr.write(chunk),
  };
}

export function emit(
  ctx: FormatterContext,
  payload: {
    text: () => string;
    json: () => unknown;
  },
): void {
  if (ctx.format === "json") {
    ctx.out(JSON.stringify(payload.json()) + "\n");
  } else {
    ctx.out(payload.text() + "\n");
  }
}

export function emitError(
  ctx: FormatterContext,
  summary: CliErrorSummary,
): void {
  if (ctx.format === "json") {
    ctx.err(
      JSON.stringify({
        ok: false,
        error: {
          category: summary.category,
          message: summary.message,
          ...(summary.details ? { details: summary.details } : {}),
        },
      }) + "\n",
    );
  } else {
    ctx.err(`error (${summary.category}): ${summary.message}\n`);
    if (summary.details) {
      for (const [k, v] of Object.entries(summary.details)) {
        ctx.err(`  ${k}: ${formatDetailValue(v)}\n`);
      }
    }
  }
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Resolve the active output format from a Commander option value plus
 * the FORMAT_OUTPUT env var fallback. Tested via settings-loader's own
 * tests since that module is the one that injects this into command
 * actions.
 */
export function resolveFormat(
  optionValue: unknown,
  envValue: string | undefined = process.env.EXECOS_FORMAT,
): OutputFormat {
  const candidate =
    (typeof optionValue === "string" && optionValue.length > 0
      ? optionValue
      : envValue) ?? "text";
  if (candidate === "json") return "json";
  if (candidate === "text") return "text";
  // Unknown values fall back to text and the entry point logs a warning.
  return "text";
}
