import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types.js";
import { anonClient } from "../../../db/anon-client.js";
import { createDocumentSignedUrl } from "../../../db/storage-signing-client.js";
import type { TaskCategory } from "$lib/types.js";
import { isWellFormedResourceTaskId } from "./resource-filters.js";

export interface ResourceRow {
  id: string;
  filename: string;
  category: TaskCategory;
  notes: string | null;
  size_bytes: number | null;
  mime_type: string | null;
  uploaded_at: string;
  linked_task_ids: string[];
  signed_url: string | null;
}

const SIGNED_URL_TTL_SECONDS = 300;

type DocumentDbRow = {
  id: string;
  filename: string;
  category: TaskCategory;
  notes: string | null;
  size_bytes: bigint | number | string | null;
  mime_type: string | null;
  uploaded_at: string;
  storage_path: string;
};

type DocumentTaskDbRow = {
  document_id: string;
  task_id: string;
};

function taskIdRank(taskId: string): number {
  const suffix = taskId.match(/-(\d+)$/)?.[1];
  return suffix ? Number(suffix) : Number.POSITIVE_INFINITY;
}

function sortTaskIds(ids: string[]): string[] {
  return ids.sort((a, b) => {
    const delta = taskIdRank(a) - taskIdRank(b);
    return delta === 0 ? a.localeCompare(b) : delta;
  });
}

function coerceSizeBytes(value: bigint | number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const size = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(size) ? size : null;
}

interface ResourcesDashboardData {
  documents: ResourceRow[];
  filteredTask: { id: string; title: string | null } | null;
}

const lastGood = new Map<string, ResourcesDashboardData>();

export const load: PageServerLoad = async ({ url }) => {
  const taskFromUrl = url.searchParams.get("task");
  const wantTaskId =
    taskFromUrl && isWellFormedResourceTaskId(taskFromUrl) ? taskFromUrl : null;
  const key = wantTaskId ?? "";

  try {
    const sb = anonClient();
    const taskLookupPromise = wantTaskId
      ? sb.from("tasks").select("id,title").eq("id", wantTaskId).maybeSingle()
      : Promise.resolve({ data: null, error: null });

    const [docsResp, junctionResp, taskLookupResp] = await Promise.all([
      sb
        .from("documents")
        .select("id,filename,category,notes,size_bytes,mime_type,uploaded_at,storage_path")
        .order("uploaded_at", { ascending: false }),
      sb.from("document_tasks").select("document_id,task_id"),
      taskLookupPromise,
    ]);

    if (docsResp.error) throw error(500, `documents: ${docsResp.error.message}`);
    if (junctionResp.error) throw error(500, `document_tasks: ${junctionResp.error.message}`);
    if (taskLookupResp.error) throw error(500, `task lookup: ${taskLookupResp.error.message}`);

    const linkedByDoc = new Map<string, string[]>();
    for (const row of (junctionResp.data ?? []) as DocumentTaskDbRow[]) {
      const links = linkedByDoc.get(row.document_id) ?? [];
      links.push(row.task_id);
      linkedByDoc.set(row.document_id, links);
    }

    for (const ids of linkedByDoc.values()) {
      sortTaskIds(ids);
    }

    const documents: ResourceRow[] = await Promise.all(
      ((docsResp.data ?? []) as DocumentDbRow[]).map(async (doc) => {
        const signedUrl = await createDocumentSignedUrl(
          doc.storage_path,
          doc.filename,
          SIGNED_URL_TTL_SECONDS,
        );

        return {
          id: doc.id,
          filename: doc.filename,
          category: doc.category,
          notes: doc.notes,
          size_bytes: coerceSizeBytes(doc.size_bytes),
          mime_type: doc.mime_type,
          uploaded_at: doc.uploaded_at,
          linked_task_ids: linkedByDoc.get(doc.id) ?? [],
          signed_url: signedUrl,
        } satisfies ResourceRow;
      }),
    );

    const result = {
      documents,
      filteredTask: wantTaskId
        ? {
            id: wantTaskId,
            title: (taskLookupResp.data as { title?: string } | null)?.title ?? null,
          }
        : null,
    };

    lastGood.set(key, result);
    return { ...result, stale: false };
  } catch (err) {
    const cached = lastGood.get(key);
    if (cached) return { ...cached, stale: true };
    throw err;
  }
};

