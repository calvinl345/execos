/**
 * Shared CLI helpers used by both the entry point (`./index.ts`) and
 * the command modules (`./commands/*.ts`). Lives in its own file to
 * avoid a circular import between the entry and the commands it
 * registers.
 */

import type { Command } from "commander";
import {
  defaultContext,
  resolveFormat,
  type FormatterContext,
} from "./output-formatters/index.js";

/**
 * Build a FormatterContext from the program's `--format` global.
 * Subcommand handlers call this once at the start of their action.
 */
export function ctxFromProgram(program: Command): FormatterContext {
  const opts = program.optsWithGlobals();
  const format = resolveFormat(opts.format);
  return defaultContext(format);
}
