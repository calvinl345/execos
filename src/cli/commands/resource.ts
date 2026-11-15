/**
 * `execos resource` command family.
 *
 * The dashboard reads document metadata through the anon path; this command
 * is the service-role write path that uploads the object, inserts metadata,
 * links optional tasks, and leaves task audit notes for attached resources.
 */

import { basename, extname, resolve as resolvePath } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Command } from "commander";
import { inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, documents, documentTasks, tasks } from "../../db/index.js";
import { appendTaskNote, recordTaskResourceAttached } from "../../db/helpers/index.js";
import type { TaskCategory } from "../../db/schema.js";
import { TaskCategorySchema, nonEmptyString } from "../../domain/validation.js";
import {
  EXIT_GENERIC,
  EXIT_INPUT_VALIDATION,
  EXIT_OK,
  EXIT_STORAGE,
  ResourceStorageError,
} from "../errors.js";
import { InputValidationError } from "../errors.js";
import { ctxFromProgram } from "../index-shared.js";
import { emit } from "../output-formatters/index.js";
import { TextInputResolver } from "../text-input.js";

const DOCUMENTS_BUCKET = "documents";
const TASK_ID_RE = /^[A-Z]{1,5}-\d+$/;

export interface ResourceAddOptions {
  category: string;
  task?: string[];
  notes?: string;
}

export interface ResourceAddResult {
  documentId: string;
  filename: string;
  category: TaskCategory;
  storagePath: string;
  sizeBytes: number;
  mimeType: string | null;
  linkedTaskIds: string[];
  bucketCreated: boolean;
}

export function registerResourceCommand(program: Command): void {
  const resource = program
    .command("resource")
    .description("Manage uploaded documents and resources");

  resource
    .command("add")
    .description("Upload a document to Supabase Storage and file it in Resources")
    .argument("<path>", "Local file path to upload")
    .requiredOption(
      "-c, --category <category>",
      "Resource category (client|business|product|house|personal)",
    )
    .option("--task <id>", "Task id to link (repeatable)", collectOption, [] as string[])
    .option("--notes <text>", "Optional notes for the document. Use - to read from stdin")
    .action(async (path: string, opts: ResourceAddOptions) => {
      await runAdd(program, path, opts);
    });
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function runAdd(
  program: Command,
  inputPath: string,
  opts: ResourceAddOptions,
): Promise<void> {
  const ctx = ctxFromProgram(program);
  const result = await addResource(inputPath, opts);
  emit(ctx, {
    text: () => renderAddText(result),
    json: () => ({
      ok: true,
      document: {
        id: result.documentId,
        filename: result.filename,
        category: result.category,
        storagePath: result.storagePath,
        sizeBytes: result.sizeBytes,
        mimeType: result.mimeType,
        linkedTaskIds: result.linkedTaskIds,
      },
      storage: {
        bucket: DOCUMENTS_BUCKET,
        bucketCreated: result.bucketCreated,
      },
    }),
  });
}

export async function addResource(
  inputPath: string,
  opts: ResourceAddOptions,
): Promise<ResourceAddResult> {
  const category = parseCategory(opts.category);
  const linkedTaskIds = parseTaskIds(opts.task ?? []);
  const textInputs = new TextInputResolver();
  const rawNotes = await textInputs.resolve({
    inline: opts.notes,
    inlineName: "--notes",
  });
  const filePath = resolvePath(inputPath);
  const fileInfo = await readUploadFile(filePath);
  const documentId = `DOC-${nanoid(10)}`;
  const storagePath = composeStoragePath(category, documentId, fileInfo.filename, new Date());
  const storage = serviceClient();

  if (linkedTaskIds.length > 0) await assertTasksExist(linkedTaskIds);

  const { bucketCreated } = await ensureDocumentsBucket(storage);
  await uploadDocumentObject(storage, storagePath, fileInfo.body, fileInfo.mimeType);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(documents).values({
        id: documentId,
        filename: fileInfo.filename,
        category,
        notes: rawNotes?.trim() ? rawNotes.trim() : null,
        storagePath,
        sizeBytes: BigInt(fileInfo.sizeBytes),
        mimeType: fileInfo.mimeType,
      });

      if (linkedTaskIds.length > 0) {
        await tx.insert(documentTasks).values(
          linkedTaskIds.map((taskId) => ({
            documentId,
            taskId,
          })),
        );

        for (const taskId of linkedTaskIds) {
          await appendTaskNote(tx, {
            taskId,
            noteType: "system",
            createdBy: "agent",
            content: JSON.stringify({
              action: "document_attached",
              document_id: documentId,
              filename: fileInfo.filename,
              storage_path: storagePath,
            }),
          });
          await recordTaskResourceAttached(tx, {
            taskId,
            documentId,
            filename: fileInfo.filename,
            storagePath,
            by: "agent",
          });
        }
      }
    });
  } catch (err) {
    await storage.storage.from(DOCUMENTS_BUCKET).remove([storagePath]).catch(() => undefined);
    throw err;
  }

  return {
    documentId,
    filename: fileInfo.filename,
    category,
    storagePath,
    sizeBytes: fileInfo.sizeBytes,
    mimeType: fileInfo.mimeType,
    linkedTaskIds,
    bucketCreated,
  };
}

function parseCategory(raw: string): TaskCategory {
  const parsed = TaskCategorySchema.safeParse(raw);
  if (!parsed.success) {
    throw new InputValidationError(
      `Invalid category '${raw}'. Expected one of client, business, product, house, personal.`,
    );
  }
  return parsed.data;
}

function parseTaskIds(rawIds: string[]): string[] {
  const unique = [...new Set(rawIds.map((id) => id.trim()).filter(Boolean))];
  for (const id of unique) {
    if (!TASK_ID_RE.test(id)) {
      throw new InputValidationError(`Invalid task id '${id}'. Expected format like KS-143.`);
    }
  }
  return unique;
}

async function assertTasksExist(taskIds: string[]): Promise<void> {
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(inArray(tasks.id, taskIds));
  const found = new Set(rows.map((row) => row.id));
  const missing = taskIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new InputValidationError(`Task not found: ${missing.join(", ")}`, {
      taskIds: missing,
    });
  }
}

async function readUploadFile(filePath: string): Promise<{
  body: Buffer;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
}> {
  let s;
  try {
    s = await stat(filePath);
  } catch {
    throw new InputValidationError(`File not found: ${filePath}`);
  }
  if (!s.isFile()) {
    throw new InputValidationError(`Path is not a file: ${filePath}`);
  }
  if (s.size === 0) {
    throw new InputValidationError(`File is empty: ${filePath}`);
  }
  return {
    body: await readFile(filePath),
    filename: basename(filePath),
    mimeType: inferMimeType(filePath),
    sizeBytes: s.size,
  };
}

function serviceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new ResourceStorageError("SUPABASE_URL is not set in env");
  if (!key) throw new ResourceStorageError("SUPABASE_SERVICE_ROLE_KEY is not set in env");
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function ensureDocumentsBucket(client: SupabaseClient): Promise<{ bucketCreated: boolean }> {
  const { data, error } = await client.storage.listBuckets();
  if (error) throw new ResourceStorageError(`Could not list storage buckets: ${error.message}`);
  if ((data ?? []).some((bucket) => bucket.name === DOCUMENTS_BUCKET)) {
    return { bucketCreated: false };
  }

  const created = await client.storage.createBucket(DOCUMENTS_BUCKET, {
    public: false,
  });
  if (created.error) {
    throw new ResourceStorageError(`Could not create '${DOCUMENTS_BUCKET}' bucket: ${created.error.message}`);
  }
  return { bucketCreated: true };
}

async function uploadDocumentObject(
  client: SupabaseClient,
  storagePath: string,
  body: Buffer,
  mimeType: string | null,
): Promise<void> {
  const { error } = await client.storage.from(DOCUMENTS_BUCKET).upload(storagePath, body, {
    contentType: mimeType ?? "application/octet-stream",
    upsert: false,
  });
  if (error) {
    throw new ResourceStorageError(`Could not upload document object: ${error.message}`, {
      bucket: DOCUMENTS_BUCKET,
      storagePath,
    });
  }
}

function renderAddText(result: ResourceAddResult): string {
  const lines = [
    `uploaded ${result.filename}`,
    `document: ${result.documentId}`,
    `category: ${result.category}`,
    `storage: ${DOCUMENTS_BUCKET}/${result.storagePath}`,
  ];
  if (result.linkedTaskIds.length > 0) {
    lines.push(`linked tasks: ${result.linkedTaskIds.join(", ")}`);
  }
  if (result.bucketCreated) {
    lines.push("created storage bucket: documents");
  }
  return lines.join("\n");
}

export function sanitizeStorageFilename(filename: string): string {
  const ext = extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;
  const safeStem = stem
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const safeExt = ext.replace(/[^A-Za-z0-9.]/g, "").slice(0, 16);
  return `${safeStem || "document"}${safeExt || ""}`;
}

export function composeStoragePath(
  category: TaskCategory,
  documentId: string,
  filename: string,
  now: Date,
): string {
  const day = now.toISOString().slice(0, 10);
  return `${category}/${day}/${documentId}-${sanitizeStorageFilename(filename)}`;
}

export function inferMimeType(filePath: string): string | null {
  switch (extname(filePath).toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".txt":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return null;
  }
}

export const Schemas = {
  add: {
    input: z.object({
      path: nonEmptyString(4096),
      category: TaskCategorySchema,
      task: z.array(z.string().regex(TASK_ID_RE)).optional(),
      notes: z.string().optional(),
    }),
    output: z.object({
      ok: z.literal(true),
      document: z.object({
        id: z.string(),
        filename: z.string(),
        category: TaskCategorySchema,
        storagePath: z.string(),
        sizeBytes: z.number().int().positive(),
        mimeType: z.string().nullable(),
        linkedTaskIds: z.array(z.string().regex(TASK_ID_RE)),
      }),
      storage: z.object({
        bucket: z.literal(DOCUMENTS_BUCKET),
        bucketCreated: z.boolean(),
      }),
    }),
    exitCodes: [
      EXIT_OK,
      EXIT_GENERIC,
      EXIT_INPUT_VALIDATION,
      EXIT_STORAGE,
    ] as readonly number[],
    errorCategories: [
      "input_validation",
      "resource_storage",
      "unhandled",
    ] as readonly string[],
  },
} as const;

export type ResourceCommandName = keyof typeof Schemas;
