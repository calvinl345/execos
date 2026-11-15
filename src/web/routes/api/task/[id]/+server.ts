import type { RequestHandler } from "./$types.js";
import { error, json } from "@sveltejs/kit";
import { anonClient } from "../../../../../db/anon-client.js";
import { createDocumentSignedUrl } from "../../../../../db/storage-signing-client.js";
import type {
  AttachmentRef,
  DashboardTask,
  DependencyRef,
  TaskActivity,
  TaskDetailPayload,
  TaskNote,
} from "$lib/types.js";
import {
  handleTaskActionPost,
  TaskActionRequestError,
} from "$lib/server/task-action-post.js";
import { isWellFormedTaskId } from "$lib/utils/task-id.js";

type GoalLike = { title: string } | { title: string }[] | null;

function mapTaskRow(r: Record<string, unknown>): DashboardTask {
  const goalRel = r.goals as GoalLike;
  let goalTitle: string | null = null;
  if (Array.isArray(goalRel)) goalTitle = goalRel[0]?.title ?? null;
  else if (goalRel) goalTitle = goalRel.title;

  return {
    id: r.id as string,
    title: r.title as string,
    description: (r.description as string) ?? "",
    status: r.status as DashboardTask["status"],
    priority: (r.priority as DashboardTask["priority"]) ?? null,
    category: r.category as DashboardTask["category"],
    owner: (r.owner as string | null) ?? null,
    due_date: (r.due_date as string | null) ?? null,
    follow_up_date: (r.follow_up_date as string | null) ?? null,
    snoozed_until: (r.snoozed_until as string | null) ?? null,
    handoff_state: (r.handoff_state as DashboardTask["handoff_state"]) ?? "not_applicable",
    handoff_copied_at: (r.handoff_copied_at as string | null) ?? null,
    handoff_last_copied_at: (r.handoff_last_copied_at as string | null) ?? null,
    handoff_last_nudge_copied_at: (r.handoff_last_nudge_copied_at as string | null) ?? null,
    goal_id: (r.goal_id as string | null) ?? null,
    goal_title: goalTitle,
    needs_attention: r.needs_attention as boolean,
    needs_attention_set_at: (r.needs_attention_set_at as string | null) ?? null,
    needs_attention_reason: (r.needs_attention_reason as string | null) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    completed_at: (r.completed_at as string | null) ?? null,
    hard_deadline: (r.hard_deadline as boolean) ?? false,
    effort: (r.effort as DashboardTask["effort"]) ?? null,
    attachment_count: 0,
    queue_rank: (r.queue_rank as number | null) ?? null,
    queue_rationale: (r.queue_rationale as string | null) ?? null,
    queue_ranked_at: (r.queue_ranked_at as string | null) ?? null,
  };
}

function dedupeDeps(rows: DependencyRef[]): DependencyRef[] {
  const seen = new Set<string>();
  const out: DependencyRef[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/** PostgREST may return an embedded row as an object or a single-element array. */
function embedOne<T extends Record<string, unknown>>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] as T | undefined) ?? null : x;
}

function mapDepRow(raw: {
  id: string;
  title: string;
  status: DependencyRef["status"];
  priority: DependencyRef["priority"];
  owner: DependencyRef["owner"];
}): DependencyRef {
  return {
    id: raw.id,
    title: raw.title,
    status: raw.status,
    priority: raw.priority ?? null,
    owner: raw.owner ?? null,
  };
}

export const GET: RequestHandler = async ({ params }) => {
  const id = params.id;
  if (!id || !isWellFormedTaskId(id)) throw error(400, "bad task id");

  const sb = anonClient();

  const [taskResp, notesResp, activitiesResp, depsInResp, depsOutResp, attResp] = await Promise.all([
    sb
      .from("tasks")
      .select(
        `id,title,description,status,priority,category,owner,
        due_date,follow_up_date,snoozed_until,handoff_state,handoff_copied_at,
        handoff_last_copied_at,handoff_last_nudge_copied_at,
        goal_id,needs_attention,needs_attention_set_at,
        needs_attention_reason,created_at,updated_at,completed_at,
        hard_deadline,effort,queue_rank,queue_rationale,queue_ranked_at,
        goals!tasks_goal_id_goals_id_fk(title)`,
      )
      .eq("id", id)
      .maybeSingle(),
    sb
      .from("task_notes")
      .select("id,task_id,note_type,content,created_at,created_by")
      .eq("task_id", id)
      .eq("note_type", "manual")
      .order("created_at", { ascending: true }),
    sb
      .from("task_activities")
      .select("id,task_id,event_type,summary,actor_type,actor_label,source,occurred_at,payload,schema_version")
      .eq("task_id", id)
      .order("occurred_at", { ascending: false }),
    sb
      .from("task_dependencies")
      .select(
        "blocker:tasks!task_dependencies_blocker_task_id_tasks_id_fk(id,title,status,priority,owner)",
      )
      .eq("blocked_task_id", id),
    sb
      .from("task_dependencies")
      .select(
        "blocked:tasks!task_dependencies_blocked_task_id_tasks_id_fk(id,title,status,priority,owner)",
      )
      .eq("blocker_task_id", id),
    sb
      .from("document_tasks")
      .select(
        "documents!document_tasks_document_id_documents_id_fk(id,filename,category,size_bytes,mime_type,uploaded_at,storage_path)",
      )
      .eq("task_id", id),
  ]);

  if (taskResp.error) throw error(500, `task: ${taskResp.error.message}`);
  if (!taskResp.data) throw error(404, "task not found");
  if (notesResp.error) throw error(500, `notes: ${notesResp.error.message}`);
  if (activitiesResp.error) throw error(500, `activities: ${activitiesResp.error.message}`);
  if (depsInResp.error) throw error(500, `deps_in: ${depsInResp.error.message}`);
  if (depsOutResp.error) throw error(500, `deps_out: ${depsOutResp.error.message}`);
  if (attResp.error) throw error(500, `attachments: ${attResp.error.message}`);

  const notes: TaskNote[] = (notesResp.data ?? []) as TaskNote[];
  const activities: TaskActivity[] = (activitiesResp.data ?? []).map((row) => ({
    id: String(row.id),
    task_id: String(row.task_id),
    event_type: row.event_type as TaskActivity["event_type"],
    summary: String(row.summary),
    actor_type: row.actor_type as TaskActivity["actor_type"],
    actor_label: String(row.actor_label),
    source: row.source as TaskActivity["source"],
    occurred_at: String(row.occurred_at),
    payload:
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
    schema_version: Number(row.schema_version),
  }));

  const dependenciesIn = dedupeDeps(
    (depsInResp.data ?? [])
      .map((row) => embedOne(row.blocker as Record<string, unknown> | Record<string, unknown>[] | null))
      .filter((r): r is Record<string, unknown> => r != null)
      .map((r) =>
        mapDepRow({
          id: String(r.id),
          title: String(r.title),
          status: r.status as DependencyRef["status"],
          priority: (r.priority as DependencyRef["priority"]) ?? null,
          owner: (r.owner as string | null) ?? null,
        }),
      ),
  );
  const dependenciesOut = dedupeDeps(
    (depsOutResp.data ?? [])
      .map((row) => embedOne(row.blocked as Record<string, unknown> | Record<string, unknown>[] | null))
      .filter((r): r is Record<string, unknown> => r != null)
      .map((r) =>
        mapDepRow({
          id: String(r.id),
          title: String(r.title),
          status: r.status as DependencyRef["status"],
          priority: (r.priority as DependencyRef["priority"]) ?? null,
          owner: (r.owner as string | null) ?? null,
        }),
      ),
  );

  type DocRow = {
    id: string;
    filename: string;
    category: AttachmentRef["category"];
    size_bytes: bigint | number | string | null;
    mime_type: string | null;
    uploaded_at: string;
    storage_path: string;
  };

  const attachments: AttachmentRef[] = await Promise.all(
    (attResp.data ?? []).map(async (r) => {
      const d = embedOne(
        r.documents as DocRow | DocRow[] | null | undefined,
      );
      if (!d) return null;
      const signed = await createDocumentSignedUrl(d.storage_path, d.filename, 300);
      const sz = d.size_bytes;
      const sizeNum =
        sz === null || sz === undefined ? null : typeof sz === "bigint" ? Number(sz) : Number(sz);
      return {
        id: d.id,
        filename: d.filename,
        category: d.category,
        size_bytes: Number.isFinite(sizeNum) ? sizeNum : null,
        mime_type: d.mime_type,
        uploaded_at: d.uploaded_at,
        signed_url: signed,
      } satisfies AttachmentRef;
    }),
  ).then((rows) => rows.filter(Boolean) as AttachmentRef[]);

  const taskBase = mapTaskRow(taskResp.data as Record<string, unknown>);
  const task: DashboardTask = { ...taskBase, attachment_count: attachments.length };

  const payload: TaskDetailPayload = {
    task,
    notes,
    activities,
    dependenciesIn,
    dependenciesOut,
    attachments,
  };
  return json(payload);
};

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const result = await handleTaskActionPost({
      taskId: params.id,
      readJson: () => request.json(),
    });
    return json(result.body, { status: result.status });
  } catch (err: unknown) {
    if (err instanceof TaskActionRequestError) {
      throw error(err.status, err.message);
    }
    throw err;
  }
};
