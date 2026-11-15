import { Command } from "commander";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, memories } from "../../db/index.js";
import { embed } from "../../embeddings/index.js";
import {
  allowedDedupActions,
  findMemoryDedupMatches,
  type MemoryDedupAction,
} from "../../domain/memory-dedup.js";
import { retrieveMemories } from "../../domain/memory-retrieval.js";
import { detectDecisionCapture } from "../../domain/decisions-heuristic.js";
import { MemoryStateSchema, nonEmptyString } from "../../domain/validation.js";
import {
  EXIT_GENERIC,
  EXIT_INPUT_VALIDATION,
  EXIT_OK,
  InputValidationError,
} from "../errors.js";
import { ctxFromProgram } from "../index-shared.js";
import { emit } from "../output-formatters/index.js";
import { loadSettings } from "../settings-loader.js";
import { TextInputResolver } from "../text-input.js";
import {
  MemorySyncSchemas,
  registerMemorySyncCommand,
} from "./memory-sync.js";

type MemoryState = "active" | "superseded" | "pruned";

interface MemoryRow {
  id: string;
  scope: string;
  content: string;
  applicability: string;
  contentEmbedding: number[];
  applicabilityEmbedding: number[];
  state: MemoryState;
  supersededById: string | null;
  createdAt: Date;
  updatedAt: Date;
  prunedAt: Date | null;
}

interface SaveOpts {
  scope?: string;
  content?: string;
  applicability?: string;
  onDuplicate?: string;
  autoDecision?: boolean;
}

interface RecallOpts {
  scope?: string;
  query: string;
  limit?: string;
}

interface ListOpts {
  scope?: string;
  state?: string;
  limit?: string;
}

interface ForgetOpts {
  yes?: boolean;
}

interface UpdateOpts {
  content: string;
  applicability?: string;
}

export function registerMemoryCommand(program: Command): void {
  const memory = program
    .command("memory")
    .description("Manage scoped memories");

  memory
    .command("save")
    .description("Save a scoped memory")
    .option("--scope <scope>", "Scope path, e.g. clients/larkspur/billing")
    .option("--content <text>", "Memory content. Use - to read from stdin")
    .option("--applicability <text>", "When this memory applies. Use - to read from stdin")
    .option(
      "--on-duplicate <action>",
      "Duplicate action: merge, replace, or keep-both",
    )
    .option(
      "--auto-decision",
      "Detect decision language and save under decisions/general when matched",
      false,
    )
    .action(async (opts: SaveOpts) => {
      await runSave(program, opts);
    });

  memory
    .command("recall")
    .description("Recall relevant memories")
    .option("--scope <scope>", "Optional scope-prefix filter")
    .requiredOption("--query <text>", "Query text")
    .option("--limit <n>", "Maximum rows (default 5)", "5")
    .action(async (opts: RecallOpts) => {
      await runRecall(program, opts);
    });

  memory
    .command("list")
    .description("List memories")
    .option("--scope <scope>", "Scope-prefix filter")
    .option("--state <state>", "active, superseded, or pruned", "active")
    .option("--limit <n>", "Maximum rows (default 50)", "50")
    .action(async (opts: ListOpts) => {
      await runList(program, opts);
    });

  memory
    .command("forget")
    .description("Soft-delete a memory")
    .argument("<id>", "Memory id")
    .option("-y, --yes", "Confirm the soft-delete", false)
    .action(async (id: string, opts: ForgetOpts) => {
      await runForget(program, id, opts);
    });

  memory
    .command("audit")
    .description("Audit memories under a scope prefix")
    .requiredOption("--scope <scope>", "Scope-prefix filter")
    .action(async (opts: { scope: string }) => {
      await runAudit(program, opts.scope);
    });

  memory
    .command("update")
    .description("Create a replacement memory and supersede the old row")
    .argument("<id>", "Memory id")
    .requiredOption("--content <text>", "Replacement content. Use - to read from stdin")
    .option("--applicability <text>", "Replacement applicability. Use - to read from stdin")
    .action(async (id: string, opts: UpdateOpts) => {
      await runUpdate(program, id, opts);
    });

  registerMemorySyncCommand(memory);
}

async function runSave(program: Command, opts: SaveOpts): Promise<void> {
  const ctx = ctxFromProgram(program);
  const settingsResult = await loadSettings();
  const textInputs = new TextInputResolver();
  const rawContent = await textInputs.resolve({
    inline: opts.content,
    inlineName: "--content",
  });
  const rawApplicability = await textInputs.resolve({
    inline: opts.applicability,
    inlineName: "--applicability",
  });
  const decision = opts.autoDecision && rawContent
    ? detectDecisionCapture(rawContent)
    : null;
  const scope = parseScope(decision?.shouldCapture ? decision.scope : opts.scope);
  const content = parseContent(decision?.shouldCapture ? decision.content : rawContent);
  const applicability = parseContent(
    decision?.shouldCapture ? decision.applicability : rawApplicability,
    "applicability",
  );
  const duplicateAction = parseDuplicateAction(opts.onDuplicate);

  let contentEmbedding = await embed(content);
  const applicabilityEmbedding = await embed(applicability);
  const existing = await selectMemories({ state: "active", exactScope: scope });
  const matches = findMemoryDedupMatches({
    scope,
    contentEmbedding,
    candidates: existing.map((memory) => ({
      id: memory.id,
      scope: memory.scope,
      content: memory.content,
      contentEmbedding: memory.contentEmbedding,
    })),
    settings: settingsResult.settings,
  });
  const topMatch = matches[0];

  if (topMatch && !duplicateAction) {
    const actions = allowedDedupActions(topMatch).join(", ");
    throw new InputValidationError(
      `Possible duplicate memory ${topMatch.id} (${topMatch.similarity.toFixed(3)}). Re-run with --on-duplicate ${actions}.`,
    );
  }
  if (topMatch && duplicateAction && !allowedDedupActions(topMatch).includes(duplicateAction)) {
    throw new InputValidationError(
      `Duplicate action '${duplicateAction}' is not allowed at similarity ${topMatch.similarity.toFixed(3)}.`,
    );
  }

  const persistedContent = duplicateAction === "merge" && topMatch
    ? `${topMatch.content}\n\n${content}`
    : content;
  if (persistedContent !== content) {
    contentEmbedding = await embed(persistedContent);
  }

  const id = await db.transaction(async (tx) => {
    const memoryId = `M-${nanoid(10)}`;
    await tx.insert(memories).values({
      id: memoryId,
      scope,
      content: persistedContent,
      applicability,
      contentEmbedding,
      applicabilityEmbedding,
    });
    if (topMatch && duplicateAction !== "keep-both") {
      await tx
        .update(memories)
        .set({
          state: "superseded",
          supersededById: memoryId,
        })
        .where(eq(memories.id, topMatch.id));
    }
    return memoryId;
  });

  emit(ctx, {
    text: () => `saved memory ${id} (${scope})`,
    json: () => ({
      ok: true,
      memory: { id, scope, content: persistedContent, applicability, state: "active" },
      dedup: topMatch
        ? {
            matchedId: topMatch.id,
            similarity: topMatch.similarity,
            action: duplicateAction,
          }
        : null,
      decisionCapture: decision?.shouldCapture
        ? { matchedPattern: decision.matchedPattern, scope: decision.scope }
        : null,
    }),
  });
}

async function runRecall(program: Command, opts: RecallOpts): Promise<void> {
  const ctx = ctxFromProgram(program);
  const scope = opts.scope ? parseScope(opts.scope) : null;
  const query = parseContent(opts.query, "query");
  const limit = parseLimit(opts.limit, 5);
  const queryEmbedding = await embed(query);
  const active = await selectMemories({
    state: "active",
    scopePrefix: scope ?? undefined,
  });
  const results = retrieveMemories({
    queryContentEmbedding: queryEmbedding,
    queryApplicabilityEmbedding: queryEmbedding,
    memories: active,
    scopePrefix: scope ?? undefined,
    k: limit,
  });

  emit(ctx, {
    text: () =>
      results.length === 0
        ? "no memories found"
        : results
            .map((memory) => `${memory.id} ${memory.score.toFixed(3)} ${memory.scope}: ${memory.content}`)
            .join("\n"),
    json: () => ({
      ok: true,
      count: results.length,
      memories: results.map(serializeMemoryWithScore),
    }),
  });
}

async function runList(program: Command, opts: ListOpts): Promise<void> {
  const ctx = ctxFromProgram(program);
  const state = parseMemoryState(opts.state ?? "active");
  const scope = opts.scope ? parseScope(opts.scope) : null;
  const limit = parseLimit(opts.limit, 50);
  const rows = await selectMemories({
    state,
    scopePrefix: scope ?? undefined,
    limit,
  });

  emit(ctx, {
    text: () =>
      rows.length === 0
        ? "no memories found"
        : rows.map((memory) => `${memory.id} ${memory.scope}: ${memory.content}`).join("\n"),
    json: () => ({
      ok: true,
      count: rows.length,
      memories: rows.map(serializeMemory),
    }),
  });
}

async function runForget(
  program: Command,
  id: string,
  opts: ForgetOpts,
): Promise<void> {
  if (!opts.yes) {
    throw new InputValidationError(
      "Forgetting a memory is a terminal soft-delete. Re-run with --yes to confirm.",
    );
  }
  const ctx = ctxFromProgram(program);
  const now = new Date();
  const updated = await db
    .update(memories)
    .set({ state: "pruned", prunedAt: now })
    .where(eq(memories.id, id))
    .returning();
  if (updated.length === 0) throw new InputValidationError(`Memory '${id}' not found.`);

  emit(ctx, {
    text: () => `forgot memory ${id}`,
    json: () => ({ ok: true, memoryId: id, state: "pruned" }),
  });
}

async function runAudit(program: Command, scopeRaw: string): Promise<void> {
  const ctx = ctxFromProgram(program);
  const scope = parseScope(scopeRaw);
  const rows = await selectMemories({ scopePrefix: scope, limit: 200 });

  emit(ctx, {
    text: () =>
      rows.length === 0
        ? "no memories found"
        : rows
            .map((memory) => `${memory.id} ${memory.state} ${memory.scope}: ${memory.content}`)
            .join("\n"),
    json: () => ({
      ok: true,
      count: rows.length,
      memories: rows.map(serializeMemory),
    }),
  });
}

async function runUpdate(
  program: Command,
  id: string,
  opts: UpdateOpts,
): Promise<void> {
  const ctx = ctxFromProgram(program);
  const original = await selectMemoryById(id);
  if (!original) throw new InputValidationError(`Memory '${id}' not found.`);
  const textInputs = new TextInputResolver();
  const rawContent = await textInputs.resolve({
    inline: opts.content,
    inlineName: "--content",
  });
  const rawApplicability = await textInputs.resolve({
    inline: opts.applicability,
    inlineName: "--applicability",
  });
  const content = parseContent(rawContent);
  const applicability = parseContent(
    rawApplicability ?? original.applicability,
    "applicability",
  );
  const contentEmbedding = await embed(content);
  const applicabilityEmbedding = await embed(applicability);
  const replacementId = await db.transaction(async (tx) => {
    const nextId = `M-${nanoid(10)}`;
    await tx.insert(memories).values({
      id: nextId,
      scope: original.scope,
      content,
      applicability,
      contentEmbedding,
      applicabilityEmbedding,
    });
    await tx
      .update(memories)
      .set({ state: "superseded", supersededById: nextId })
      .where(eq(memories.id, id));
    return nextId;
  });

  emit(ctx, {
    text: () => `updated memory ${id}; replacement ${replacementId}`,
    json: () => ({
      ok: true,
      memoryId: replacementId,
      supersededMemoryId: id,
      state: "active",
    }),
  });
}

async function selectMemories(args: {
  state?: MemoryState;
  exactScope?: string;
  scopePrefix?: string;
  limit?: number;
} = {}): Promise<MemoryRow[]> {
  const conditions: SQL[] = [];
  if (args.state) conditions.push(eq(memories.state, args.state));
  if (args.exactScope) conditions.push(eq(memories.scope, args.exactScope));
  if (args.scopePrefix) conditions.push(scopePrefixCondition(args.scopePrefix));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const query = db
    .select()
    .from(memories)
    .where(where)
    .orderBy(desc(memories.createdAt));
  const rows = args.limit === undefined ? await query : await query.limit(args.limit);
  return rows as MemoryRow[];
}

function scopePrefixCondition(scope: string): SQL {
  const childPrefix = `${scope}/`;
  return sql`(${memories.scope} = ${scope} OR left(${memories.scope}, ${childPrefix.length}) = ${childPrefix})`;
}

async function selectMemoryById(id: string): Promise<MemoryRow | null> {
  const rows = await db
    .select()
    .from(memories)
    .where(and(eq(memories.id, id)))
    .limit(1);
  return (rows[0] as MemoryRow | undefined) ?? null;
}

function serializeMemory(memory: MemoryRow) {
  return {
    id: memory.id,
    scope: memory.scope,
    content: memory.content,
    applicability: memory.applicability,
    state: memory.state,
    supersededById: memory.supersededById,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
    prunedAt: memory.prunedAt ? memory.prunedAt.toISOString() : null,
  };
}

function serializeMemoryWithScore(memory: MemoryRow & { score: number }) {
  return {
    ...serializeMemory(memory),
    score: memory.score,
  };
}

function parseScope(value: string | undefined): string {
  const parsed = ScopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new InputValidationError("Memory scope must be a slash-delimited path.");
  }
  return parsed.data;
}

function parseContent(value: string | undefined, label = "content"): string {
  const parsed = nonEmptyString(10000).safeParse(value);
  if (!parsed.success) {
    throw new InputValidationError(`Memory ${label} must be non-empty.`);
  }
  return parsed.data;
}

function parseDuplicateAction(value: string | undefined): MemoryDedupAction | null {
  if (!value) return null;
  const parsed = DuplicateActionSchema.safeParse(value);
  if (!parsed.success) {
    throw new InputValidationError("--on-duplicate must be merge, replace, or keep-both.");
  }
  return parsed.data;
}

function parseMemoryState(value: string): MemoryState {
  const parsed = MemoryStateSchema.safeParse(value);
  if (!parsed.success) {
    throw new InputValidationError("--state must be active, superseded, or pruned.");
  }
  return parsed.data;
}

function parseLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 200) {
    throw new InputValidationError("--limit must be an integer between 1 and 200.");
  }
  return n;
}

const ScopeSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\/[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/);

const DuplicateActionSchema = z.enum(["merge", "replace", "keep-both"]);

const isoDateString = z.string().refine(
  (s) => !Number.isNaN(Date.parse(s)),
  { message: "expected ISO-8601 date string" },
);

const MemoryOutputSchema = z.object({
  id: z.string(),
  scope: ScopeSchema,
  content: z.string(),
  applicability: z.string(),
  state: MemoryStateSchema,
  supersededById: z.string().nullable(),
  createdAt: isoDateString,
  updatedAt: isoDateString,
  prunedAt: isoDateString.nullable(),
});

const MemoryCommonExitCodes = [
  EXIT_OK,
  EXIT_GENERIC,
  EXIT_INPUT_VALIDATION,
] as const;

const MemoryCommonErrorCategories = [
  "input_validation",
  "unhandled",
] as const;

export const Schemas = {
  save: {
    input: z.object({
      scope: ScopeSchema.optional(),
      content: z.string().optional(),
      applicability: z.string().optional(),
      onDuplicate: DuplicateActionSchema.optional(),
      autoDecision: z.boolean().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      memory: z.object({
        id: z.string(),
        scope: ScopeSchema,
        content: z.string(),
        applicability: z.string(),
        state: z.literal("active"),
      }),
      dedup: z
        .object({
          matchedId: z.string(),
          similarity: z.number(),
          action: DuplicateActionSchema.nullable(),
        })
        .nullable(),
      decisionCapture: z
        .object({
          matchedPattern: z.string().nullable(),
          scope: ScopeSchema,
        })
        .nullable(),
    }),
    exitCodes: MemoryCommonExitCodes,
    errorCategories: MemoryCommonErrorCategories,
  },
  recall: {
    input: z.object({
      scope: ScopeSchema.optional(),
      query: nonEmptyString(10000),
      limit: z.string().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      count: z.number().int().nonnegative(),
      memories: z.array(MemoryOutputSchema.extend({ score: z.number() })),
    }),
    exitCodes: MemoryCommonExitCodes,
    errorCategories: MemoryCommonErrorCategories,
  },
  list: {
    input: z.object({
      scope: ScopeSchema.optional(),
      state: MemoryStateSchema.optional(),
      limit: z.string().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      count: z.number().int().nonnegative(),
      memories: z.array(MemoryOutputSchema),
    }),
    exitCodes: MemoryCommonExitCodes,
    errorCategories: MemoryCommonErrorCategories,
  },
  forget: {
    input: z.object({
      id: z.string().min(1),
      yes: z.boolean().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      memoryId: z.string(),
      state: z.literal("pruned"),
    }),
    exitCodes: MemoryCommonExitCodes,
    errorCategories: MemoryCommonErrorCategories,
  },
  audit: {
    input: z.object({
      scope: ScopeSchema,
    }),
    output: z.object({
      ok: z.literal(true),
      count: z.number().int().nonnegative(),
      memories: z.array(MemoryOutputSchema),
    }),
    exitCodes: MemoryCommonExitCodes,
    errorCategories: MemoryCommonErrorCategories,
  },
  update: {
    input: z.object({
      id: z.string().min(1),
      content: nonEmptyString(10000),
      applicability: z.string().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      memoryId: z.string(),
      supersededMemoryId: z.string(),
      state: z.literal("active"),
    }),
    exitCodes: MemoryCommonExitCodes,
    errorCategories: MemoryCommonErrorCategories,
  },
  syncToNotion: MemorySyncSchemas.syncToNotion,
} as const;

export type MemoryCommandName = keyof typeof Schemas;
