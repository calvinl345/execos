import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, db } from "../../../../src/db/index.js";
import { embed } from "../../../../src/embeddings/index.js";
import { resetDbData } from "../../../db/db-test-utils.js";
import { resetSettingsCache } from "../../../../src/cli/settings-loader.js";
import {
  parseLastJsonStdoutValidated,
  runCli,
} from "../../../cli/test-utils.js";
import { Schemas as MemorySchemas } from "../../../../src/cli/commands/memory.js";
import {
  EXIT_INPUT_VALIDATION,
  EXIT_OK,
} from "../../../../src/cli/errors.js";

describe("execos memory CLI", () => {
  beforeEach(async () => {
    resetSettingsCache();
    await resetDbData();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("saves, recalls, lists, audits, updates, forgets, and exposes Notion retry seam", async () => {
    const saved = await runCli(
      [
        "memory",
        "save",
        "--scope",
        "clients/larkspur/billing",
        "--content",
        "Larkspur prefers invoices grouped by project.",
        "--applicability",
        "When preparing Larkspur billing updates.",
      ],
      { format: "json" },
    );
    expect(saved.exitCode).toBe(EXIT_OK);
    const parsedSave = parseLastJsonStdoutValidated(
      saved,
      MemorySchemas.save.output,
    );

    const recall = await runCli(
      [
        "memory",
        "recall",
        "--scope",
        "clients/larkspur",
        "--query",
        "How should Larkspur invoices be grouped?",
      ],
      { format: "json" },
    );
    const parsedRecall = parseLastJsonStdoutValidated(
      recall,
      MemorySchemas.recall.output,
    );
    expect(parsedRecall.memories[0].id).toBe(parsedSave.memory.id);

    const listed = await runCli(["memory", "list", "--scope", "clients"], {
      format: "json",
    });
    expect(parseLastJsonStdoutValidated(listed, MemorySchemas.list.output).count).toBe(1);

    const audited = await runCli(
      ["memory", "audit", "--scope", "clients/larkspur"],
      { format: "json" },
    );
    expect(parseLastJsonStdoutValidated(audited, MemorySchemas.audit.output).count).toBe(1);

    const updated = await runCli(
      [
        "memory",
        "update",
        parsedSave.memory.id,
        "--content",
        "Larkspur wants invoices grouped by project and sent monthly.",
      ],
      { format: "json" },
    );
    const parsedUpdate = parseLastJsonStdoutValidated(
      updated,
      MemorySchemas.update.output,
    );
    expect(parsedUpdate.supersededMemoryId).toBe(parsedSave.memory.id);

    const forget = await runCli(
      ["memory", "forget", parsedUpdate.memoryId, "--yes"],
      { format: "json" },
    );
    expect(parseLastJsonStdoutValidated(forget, MemorySchemas.forget.output).state).toBe("pruned");

    const sync = await runCli(
      ["memory", "sync-to-notion", parsedSave.memory.id],
      { format: "json" },
    );
    expect(parseLastJsonStdoutValidated(sync, MemorySchemas.syncToNotion.output).synced).toBe(false);
  });

  it("accepts memory content from stdin", async () => {
    const saved = await runCli(
      [
        "memory",
        "save",
        "--scope",
        "policies/stdin-capture",
        "--content",
        "-",
        "--applicability",
        "When validating stdin-backed memory capture.",
      ],
      {
        format: "json",
        stdin: "  Store this multiline memory.\n\nKeep internal spacing.\n",
      },
    );

    expect(saved.exitCode).toBe(EXIT_OK);
    const parsedSave = parseLastJsonStdoutValidated(
      saved,
      MemorySchemas.save.output,
    );
    expect(parsedSave.memory.content).toBe(
      "  Store this multiline memory.\n\nKeep internal spacing.",
    );
  });

  it("requires explicit duplicate action and supports decision auto-capture", async () => {
    const first = await runCli(
      [
        "memory",
        "save",
        "--scope",
        "decisions/general",
        "--content",
        "Going with OpenAI over Voyage for memory embeddings.",
        "--applicability",
        "When evaluating embedding provider history.",
        "--auto-decision",
      ],
      { format: "json" },
    );
    expect(first.exitCode).toBe(EXIT_OK);
    const parsedFirst = parseLastJsonStdoutValidated(
      first,
      MemorySchemas.save.output,
    );
    expect(parsedFirst.decisionCapture?.matchedPattern).toBe("going_with_over");

    const duplicate = await runCli(
      [
        "memory",
        "save",
        "--scope",
        "decisions/general",
        "--content",
        "Going with OpenAI over Voyage for memory embeddings.",
        "--applicability",
        "When evaluating embedding provider history.",
      ],
      { format: "json" },
    );
    expect(duplicate.exitCode).toBe(EXIT_INPUT_VALIDATION);
    expect(duplicate.err).toMatch(/Possible duplicate memory/);

    const replace = await runCli(
      [
        "memory",
        "save",
        "--scope",
        "decisions/general",
        "--content",
        "Going with OpenAI over Voyage for memory embeddings.",
        "--applicability",
        "When evaluating embedding provider history.",
        "--on-duplicate",
        "replace",
      ],
      { format: "json" },
    );
    expect(replace.exitCode).toBe(EXIT_OK);

    const rows = await db.execute<{ state: string } & Record<string, unknown>>(
      sql`SELECT state FROM memories ORDER BY created_at ASC`,
    );
    expect((rows as unknown as Array<{ state: string }>).map((r) => r.state)).toEqual([
      "superseded",
      "active",
    ]);
  });

  it("dedups against exact-scope memories before global row caps", async () => {
    await saveScopedMemory("clients/larkspur/billing", "Larkspur prefers billing updates grouped by project.");
    await insertNewerOutOfScopeMemories(501);

    const duplicate = await runCli(
      [
        "memory",
        "save",
        "--scope",
        "clients/larkspur/billing",
        "--content",
        "Larkspur prefers billing updates grouped by project.",
        "--applicability",
        "When preparing Larkspur billing updates.",
      ],
      { format: "json" },
    );

    expect(duplicate.exitCode).toBe(EXIT_INPUT_VALIDATION);
    expect(duplicate.err).toMatch(/Possible duplicate memory/);
  });

  it("stores merged content with an embedding derived from the persisted merged text", async () => {
    const originalContent = "Larkspur prefers billing updates grouped by project.";
    const newContent = "Larkspur prefers billing updates grouped by project.";
    const first = await saveScopedMemory("clients/larkspur/billing", originalContent);

    const merge = await runCli(
      [
        "memory",
        "save",
        "--scope",
        "clients/larkspur/billing",
        "--content",
        newContent,
        "--applicability",
        "When preparing Larkspur billing updates.",
        "--on-duplicate",
        "merge",
      ],
      { format: "json" },
    );
    expect(merge.exitCode).toBe(EXIT_OK);
    const parsedMerge = parseLastJsonStdoutValidated(merge, MemorySchemas.save.output);
    const expectedContent = `${originalContent}\n\n${newContent}`;
    expect(parsedMerge.memory.content).toBe(expectedContent);

    const rows = await db.execute<{
      id: string;
      content: string;
      contentEmbedding: string;
      state: string;
      supersededById: string | null;
    } & Record<string, unknown>>(sql`
      SELECT
        id,
        content,
        content_embedding::text AS "contentEmbedding",
        state,
        superseded_by_id AS "supersededById"
      FROM memories
      ORDER BY created_at ASC
    `);
    const [original, merged] = rows as unknown as Array<{
      id: string;
      content: string;
      contentEmbedding: string;
      state: string;
      supersededById: string | null;
    }>;
    expect(original.id).toBe(first.memory.id);
    expect(original.state).toBe("superseded");
    expect(original.supersededById).toBe(parsedMerge.memory.id);
    expect(merged.content).toBe(expectedContent);
    expect(parseVector(merged.contentEmbedding)).toEqual(await embed(expectedContent));
  });

  it("recalls scoped memories before applying top-K despite newer out-of-scope rows", async () => {
    const saved = await saveScopedMemory("clients/larkspur/billing", "Larkspur wants invoices grouped by project.");
    await insertNewerOutOfScopeMemories(501);

    const recall = await runCli(
      [
        "memory",
        "recall",
        "--scope",
        "clients/larkspur",
        "--query",
        "How should Larkspur invoices be grouped?",
        "--limit",
        "1",
      ],
      { format: "json" },
    );
    const parsedRecall = parseLastJsonStdoutValidated(recall, MemorySchemas.recall.output);
    expect(parsedRecall.memories.map((memory) => memory.id)).toEqual([saved.memory.id]);
  });

  it("lists and audits scoped memories before applying command caps", async () => {
    const saved = await saveScopedMemory("clients/larkspur/billing", "Larkspur wants invoices grouped by project.");
    await insertNewerOutOfScopeMemories(501);

    const listed = await runCli(
      ["memory", "list", "--scope", "clients/larkspur", "--limit", "1"],
      { format: "json" },
    );
    const parsedList = parseLastJsonStdoutValidated(listed, MemorySchemas.list.output);
    expect(parsedList.memories.map((memory) => memory.id)).toEqual([saved.memory.id]);

    const audited = await runCli(
      ["memory", "audit", "--scope", "clients/larkspur"],
      { format: "json" },
    );
    const parsedAudit = parseLastJsonStdoutValidated(audited, MemorySchemas.audit.output);
    expect(parsedAudit.memories.map((memory) => memory.id)).toContain(saved.memory.id);
  });

  it("treats underscores as literal scope characters when listing and auditing", async () => {
    const exact = await saveScopedMemory("clients/acme_co/billing", "Acme Co billing memory.");
    const sibling = await saveScopedMemory("clients/acmexco/billing", "Acme Xco billing memory.");

    const listed = await runCli(
      ["memory", "list", "--scope", "clients/acme_co"],
      { format: "json" },
    );
    const parsedList = parseLastJsonStdoutValidated(listed, MemorySchemas.list.output);
    expect(parsedList.memories.map((memory) => memory.id)).toEqual([exact.memory.id]);

    const audited = await runCli(
      ["memory", "audit", "--scope", "clients/acme_co"],
      { format: "json" },
    );
    const parsedAudit = parseLastJsonStdoutValidated(audited, MemorySchemas.audit.output);
    expect(parsedAudit.memories.map((memory) => memory.id)).toEqual([exact.memory.id]);
    expect(parsedAudit.memories.map((memory) => memory.id)).not.toContain(sibling.memory.id);
  });
});

async function saveScopedMemory(scope: string, content: string) {
  const saved = await runCli(
    [
      "memory",
      "save",
      "--scope",
      scope,
      "--content",
      content,
      "--applicability",
      "When preparing Larkspur billing updates.",
    ],
    { format: "json" },
  );
  expect(saved.exitCode).toBe(EXIT_OK);
  return parseLastJsonStdoutValidated(saved, MemorySchemas.save.output);
}

async function insertNewerOutOfScopeMemories(count: number): Promise<void> {
  const vector = vectorLiteral(await embed("out-of-scope filler memory"));
  await db.execute(sql`
    INSERT INTO memories (
      id,
      scope,
      content,
      applicability,
      content_embedding,
      applicability_embedding,
      created_at,
      updated_at
    )
    SELECT
      'M-out-' || n::text,
      'other/project-' || n::text,
      'Out-of-scope memory ' || n::text,
      'When testing global cap behavior',
      ${vector}::vector,
      ${vector}::vector,
      now() + (n * interval '1 second'),
      now() + (n * interval '1 second')
    FROM generate_series(0, ${count - 1}) AS n
  `);
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

function parseVector(value: string): number[] {
  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((part) => Number(part));
}
