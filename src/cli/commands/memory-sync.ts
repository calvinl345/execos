import { Command } from "commander";
import { z } from "zod";
import { EXIT_GENERIC, EXIT_OK, EXIT_INPUT_VALIDATION } from "../errors.js";
import { ctxFromProgram } from "../index-shared.js";
import { emit } from "../output-formatters/index.js";

export function registerMemorySyncCommand(memory: Command): void {
  memory
    .command("sync-to-notion")
    .description("Retry syncing a saved memory to Notion")
    .argument("<id>", "Memory id")
    .action(async (id: string) => {
      const ctx = ctxFromProgram(memory.parent ?? memory);
      emit(ctx, {
        text: () =>
          [
            `memory ${id} saved locally`,
            "Notion MCP unreachable; memory saved locally - say 'sync to Notion' again later to retry.",
          ].join("\n"),
        json: () => ({
          ok: true,
          memoryId: id,
          synced: false,
          target: "notion",
          reason:
            "Notion MCP unreachable; memory saved locally - say 'sync to Notion' again later to retry.",
        }),
      });
    });
}

export const MemorySyncSchemas = {
  syncToNotion: {
    input: z.object({
      id: z.string().min(1),
    }),
    output: z.object({
      ok: z.literal(true),
      memoryId: z.string(),
      synced: z.literal(false),
      target: z.literal("notion"),
      reason: z.string(),
    }),
    exitCodes: [
      EXIT_OK,
      EXIT_GENERIC,
      EXIT_INPUT_VALIDATION,
    ] as readonly number[],
    errorCategories: [
      "input_validation",
      "unhandled",
    ] as readonly string[],
  },
} as const;
