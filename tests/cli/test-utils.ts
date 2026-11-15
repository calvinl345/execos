/**
 * Test helper for exercising the `execos` CLI from inside Vitest.
 *
 * `runCli(args)` builds a fresh Commander program and runs parseAsync
 * against the given argv tail (the leading `node` and script paths are
 * synthesized). stdout/stderr writes go into in-memory buffers so the
 * test can assert on the exact bytes produced.
 *
 * Errors thrown by command actions are caught, classified through the
 * production `classifyError`, and returned as `{ exitCode, err }` so
 * tests can assert the same exit-code surface a real shell would see.
 */

import { Command } from "commander";
import { buildProgram } from "../../src/cli/index.js";
import { classifyError, EXIT_OK } from "../../src/cli/errors.js";
import {
  emit,
  emitError,
  type FormatterContext,
} from "../../src/cli/output-formatters/index.js";
import { setTextInputRuntimeForTests } from "../../src/cli/text-input.js";

export interface CliResult {
  exitCode: number;
  out: string;
  err: string;
  stdoutLines: string[];
  stderrLines: string[];
}

export async function runCli(
  argv: string[],
  options: {
    format?: "text" | "json";
    stdin?: string;
    stdinIsTty?: boolean;
  } = {},
): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];

  // We patch process.stdout/stderr write while the action runs because
  // the production code calls `defaultContext()` deep inside command
  // actions; intercepting at the streams keeps the production code
  // path identical to the real CLI.
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: string | Uint8Array): boolean => {
    out.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: string | Uint8Array): boolean => {
    err.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  };

  let exitCode = EXIT_OK;
  let program: Command | undefined;
  let restoreTextInput: (() => void) | undefined;
  try {
    if (options.stdin !== undefined || options.stdinIsTty !== undefined) {
      restoreTextInput = setTextInputRuntimeForTests({
        readStdinText: async () => options.stdin ?? "",
        stdinIsTty: () => options.stdinIsTty ?? false,
      });
    }
    program = buildProgram();
    const argvFull = ["node", "execos"];
    if (options.format) argvFull.push("--format", options.format);
    argvFull.push(...argv);
    await program.parseAsync(argvFull);
  } catch (caught) {
    const summary = classifyError(caught);
    exitCode = summary.exitCode;
    const ctx = ctxFromCapture(out, err, options.format ?? "text");
    emitError(ctx, summary);
  } finally {
    restoreTextInput?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = origStdout;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = origStderr;
  }

  return {
    exitCode,
    out: out.join(""),
    err: err.join(""),
    stdoutLines: out.join("").split(/\r?\n/).filter((l) => l.length > 0),
    stderrLines: err.join("").split(/\r?\n/).filter((l) => l.length > 0),
  };
}

function ctxFromCapture(
  out: string[],
  err: string[],
  format: "text" | "json",
): FormatterContext {
  return {
    format,
    out: (chunk) => out.push(chunk),
    err: (chunk) => err.push(chunk),
  };
}

export function parseLastJsonStdout(result: CliResult): unknown {
  // CLI commands write a single JSON document terminated by newline.
  // Some CI flows insert warnings on stderr, so we always parse stdout.
  const trimmed = result.out.trim();
  if (trimmed.length === 0) return null;
  // If multiple JSON docs are present, parse the last one.
  const lines = trimmed.split(/\r?\n/).filter((l) => l.startsWith("{"));
  if (lines.length === 0) return null;
  return JSON.parse(lines[lines.length - 1]);
}

/**
 * Like `parseLastJsonStdout`, but runs the captured JSON through the
 * supplied Zod schema (typically `Schemas[command].output` from one of
 * the command files). If the production code drifts from the schema's
 * documented shape, the test fails at THIS line with a precise Zod
 * error path rather than later when an assertion picks at a missing
 * field. This is the contract guard from the schemas-contract test
 * pattern, applied to live CLI invocations.
 */
export function parseLastJsonStdoutValidated<T>(
  result: CliResult,
  schema: { parse(value: unknown): T },
): T {
  const raw = parseLastJsonStdout(result);
  return schema.parse(raw);
}

// Re-export so test files can also call emit/emitError if needed.
export { emit };
