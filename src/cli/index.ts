#!/usr/bin/env node
/**
 * `execos` CLI entry point.
 *
 * Mounts every command family on a single Commander root program and
 * runs them under a unified error classifier so every failure exits
 * with a stable code. The CLI process resolves Settings once at
 * startup (settings-loader memoizes per process) and passes the
 * resolved object explicitly into domain calls.
 *
 * Output mode is `text` by default and `json` when `--format json` is
 * passed at the root level. The flag is global so subcommands inherit
 * it without each having to declare its own option.
 */

import { Command } from "commander";
import { closeDb } from "../db/index.js";
import {
  classifyError,
  EXIT_OK,
} from "./errors.js";
import { emitError } from "./output-formatters/index.js";
import { ctxFromProgram } from "./index-shared.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerGoalCommand } from "./commands/goal.js";
import { registerHealthCommand } from "./commands/health.js";
import { registerReviewCommand } from "./commands/review.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { registerDashboardCommand } from "./commands/dashboard.js";
import { registerResourceCommand } from "./commands/resource.js";
import { registerTaskopsCommand } from "./commands/taskops.js";
import { verifyDimensionAtBoot } from "../embeddings/index.js";

export interface BuildProgramOptions {
  /** When true, do NOT register the task or health commands; used by
   * tests that mount their own minimal subcommand set. */
  bare?: boolean;
}

export function buildProgram(options: BuildProgramOptions = {}): Command {
  const program = new Command();
  program
    .name("execos")
    .description("ExecOS - an AI chief of staff for founders")
    .version("0.1.0")
    .option(
      "-f, --format <format>",
      "Output format: text (human) or json (machine)",
      "text",
    )
    .enablePositionalOptions(true);

  if (!options.bare) {
    registerTaskCommand(program);
    registerGoalCommand(program);
    registerHealthCommand(program);
    registerReviewCommand(program);
    registerMemoryCommand(program);
    registerDashboardCommand(program);
    registerResourceCommand(program);
    registerTaskopsCommand(program);
  }

  return program;
}

function shouldSkipBootDimensionCheck(argv: string[]): boolean {
  const args = argv.slice(2);
  return args.includes("dashboard") || args.includes("--help") || args.includes("-h");
}

export async function main(argv: string[]): Promise<number> {
  const program = buildProgram();
  // Commander throws on unknown commands; catch via the unified
  // classifier below.
  try {
    if (!shouldSkipBootDimensionCheck(argv)) {
      await verifyDimensionAtBoot();
    }
    await program.parseAsync(argv);
    return EXIT_OK;
  } catch (err) {
    const summary = classifyError(err);
    const ctx = ctxFromProgram(program);
    emitError(ctx, summary);
    return summary.exitCode;
  } finally {
    // Close the postgres-js pool so the process exits cleanly. Tests
    // that spawn the CLI need this to avoid hanging.
    try {
      await closeDb();
    } catch {
      // ignore
    }
  }
}

// Run only when invoked directly (not when imported by tests).
const isDirect =
  typeof process.argv[1] === "string" &&
  /[/\\](cli[/\\]index\.(ts|js)|execos)$/.test(process.argv[1]);

if (isDirect) {
  main(process.argv).then((code) => {
    // Only overwrite on failure: a resolved 0 must not clobber a nonzero
    // process.exitCode already set by a command action (e.g. dashboard
    // status/start/stop report failures via process.exitCode, not throws).
    if (code !== 0) {
      process.exitCode = code;
    }
  });
}
