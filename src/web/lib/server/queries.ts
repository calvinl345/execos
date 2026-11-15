/**
 * Dashboard data queries via the Supabase anon client.
 *
 * All reads here go through the anon-key path (RLS enforces SELECT-only
 * across all 12 tables per AC-031 / AC-058). The service-role client is
 * forbidden in `src/web/` by ESLint.
 */

import { anonClient } from "../../../db/anon-client.js";
import type {
  DashboardData,
  DashboardTask,
  GoalStatus,
  GoalSummary,
  TeamMember,
} from "../types.js";
import { compareDashboardTasks } from "../utils/inbox-partition.js";

const ACTIVE_TASK_STATUSES_FOR_GOAL_COUNTS = [
  "triage",
  "backlog",
  "in_progress",
  "blocked",
  "review",
] as const;

const ACTIVE_TASK_STATUSES = [
  "triage",
  "backlog",
  "in_progress",
  "blocked",
  "review",
] as const;

function buildGoalSummaries(
  goalsRows: {
    id: string;
    title: string;
    description: string;
    quarter: string;
    status: string;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
  }[],
  counts: Map<string, number>,
): { goals: GoalSummary[]; goalQuarters: string[] } {
  const goals: GoalSummary[] = goalsRows.map((g) => ({
    id: g.id,
    title: g.title,
    description: g.description,
    quarter: g.quarter,
    status: g.status as GoalStatus,
    created_at: g.created_at,
    updated_at: g.updated_at,
    closed_at: g.closed_at,
    active_task_count: counts.get(g.id) ?? 0,
  }));

  goals.sort((a, b) => {
    const aActive = a.status === "active";
    const bActive = b.status === "active";
    if (aActive && !bActive) return -1;
    if (bActive && !aActive) return 1;
    if (aActive && bActive) {
      if (a.quarter !== b.quarter) return b.quarter.localeCompare(a.quarter);
      return b.created_at.localeCompare(a.created_at);
    }
    const ac = a.closed_at ?? "";
    const bc = b.closed_at ?? "";
    if (ac !== bc) return bc.localeCompare(ac);
    return b.created_at.localeCompare(a.created_at);
  });

  const goalQuarters = [...new Set(goals.map((g) => g.quarter))].sort((a, b) =>
    b.localeCompare(a),
  );

  return { goals, goalQuarters };
}

export interface LoadDashboardOpts {
  goalIdFromUrl?: string | null;
  includeClosed?: boolean;
  now?: Date;
}

export async function loadDashboardData(opts: LoadDashboardOpts = {}): Promise<DashboardData> {
  const sb = anonClient();
  const now = opts.now ?? new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const wantGoalId =
    opts.goalIdFromUrl && /^G-\d+$/.test(opts.goalIdFromUrl) ? opts.goalIdFromUrl : null;
  let tasksQuery = sb
    .from("tasks")
    .select(
      `id,title,description,status,priority,category,owner,due_date,follow_up_date,
         snoozed_until,handoff_state,handoff_copied_at,handoff_last_copied_at,
         handoff_last_nudge_copied_at,
         goal_id,needs_attention,needs_attention_set_at,
         needs_attention_reason,created_at,updated_at,completed_at,
         hard_deadline,effort,queue_rank,queue_rationale,queue_ranked_at,
         goals(title)`,
    );

  if (!opts.includeClosed) {
    tasksQuery = tasksQuery.in("status", ACTIVE_TASK_STATUSES);
  }

  const [tasksResp, goalsFullResp, tasksGoalRefsResp, goalRespMaybe, teamResp, recentlyDoneResp] =
    await Promise.all([
      tasksQuery,
      sb
        .from("goals")
        .select("id,title,description,quarter,status,created_at,updated_at,closed_at"),
      sb
        .from("tasks")
        .select("id,goal_id")
        .not("goal_id", "is", null)
        .in("status", ACTIVE_TASK_STATUSES_FOR_GOAL_COUNTS),
      wantGoalId
        ? sb.from("goals").select("id,title").eq("id", wantGoalId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      sb
        .from("team")
        .select("slug,display_name")
        .order("display_name", { ascending: true }),
      sb
        .from("tasks")
        .select(
          `id,title,description,status,priority,category,owner,due_date,follow_up_date,
             snoozed_until,handoff_state,handoff_copied_at,handoff_last_copied_at,
             handoff_last_nudge_copied_at,
             goal_id,needs_attention,needs_attention_set_at,
             needs_attention_reason,created_at,updated_at,completed_at,
             hard_deadline,effort,queue_rank,queue_rationale,queue_ranked_at,
             goals(title)`,
        )
        .eq("status", "done")
        .gte("completed_at", sevenDaysAgo),
    ]);

  if (tasksResp.error) throw new Error(`tasks: ${tasksResp.error.message}`);
  if (goalsFullResp.error) throw new Error(`goals_list: ${goalsFullResp.error.message}`);
  if (tasksGoalRefsResp.error)
    throw new Error(`tasks_goal_refs: ${tasksGoalRefsResp.error.message}`);
  const goalResp = goalRespMaybe;
  if (goalResp.error) throw new Error(`goal_lookup: ${goalResp.error.message}`);
  if (teamResp.error) throw new Error(`team: ${teamResp.error.message}`);
  if (recentlyDoneResp.error) throw new Error(`recentlyDone: ${recentlyDoneResp.error.message}`);

  const filteredGoal =
    wantGoalId !== null
      ? {
          id: wantGoalId,
          title: (goalResp.data as { title: string } | null)?.title ?? null,
        }
      : null;

  const team: TeamMember[] = (teamResp.data ?? []).map((r) => ({
    slug: r.slug,
    displayName: r.display_name,
  }));

  const counts = new Map<string, number>();
  for (const t of tasksGoalRefsResp.data ?? []) {
    if (!t.goal_id) continue;
    counts.set(t.goal_id, (counts.get(t.goal_id) ?? 0) + 1);
  }
  const { goals, goalQuarters } = buildGoalSummaries(
    (goalsFullResp.data ?? []) as Parameters<typeof buildGoalSummaries>[0],
    counts,
  );

  const activeTasks: DashboardTask[] = (tasksResp.data ?? []).map((r) => {
    type GoalLike = { title: string } | { title: string }[] | null;
    const goalRel = r.goals as GoalLike;
    let goalTitle: string | null = null;
    if (Array.isArray(goalRel)) goalTitle = goalRel[0]?.title ?? null;
    else if (goalRel) goalTitle = goalRel.title;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority,
      category: r.category,
      owner: r.owner,
      due_date: r.due_date,
      follow_up_date: r.follow_up_date,
      snoozed_until: r.snoozed_until,
      handoff_state: r.handoff_state,
      handoff_copied_at: r.handoff_copied_at,
      handoff_last_copied_at: r.handoff_last_copied_at,
      handoff_last_nudge_copied_at: r.handoff_last_nudge_copied_at,
      goal_id: r.goal_id,
      goal_title: goalTitle,
      needs_attention: r.needs_attention,
      needs_attention_set_at: r.needs_attention_set_at,
      needs_attention_reason: r.needs_attention_reason,
      created_at: r.created_at,
      updated_at: r.updated_at,
      completed_at: r.completed_at,
      hard_deadline: r.hard_deadline,
      effort: r.effort,
      attachment_count: 0,
      queue_rank: r.queue_rank,
      queue_rationale: r.queue_rationale,
      queue_ranked_at: r.queue_ranked_at,
    };
  });

  const recentlyDone: DashboardTask[] = (recentlyDoneResp.data ?? [])
    .map((r) => {
      type GoalLike = { title: string } | { title: string }[] | null;
      const goalRel = r.goals as GoalLike;
      let goalTitle: string | null = null;
      if (Array.isArray(goalRel)) goalTitle = goalRel[0]?.title ?? null;
      else if (goalRel) goalTitle = goalRel.title;
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        status: r.status,
        priority: r.priority,
        category: r.category,
        owner: r.owner,
        due_date: r.due_date,
        follow_up_date: r.follow_up_date,
        snoozed_until: r.snoozed_until,
        handoff_state: r.handoff_state,
        handoff_copied_at: r.handoff_copied_at,
        handoff_last_copied_at: r.handoff_last_copied_at,
        handoff_last_nudge_copied_at: r.handoff_last_nudge_copied_at,
        goal_id: r.goal_id,
        goal_title: goalTitle,
        needs_attention: r.needs_attention,
        needs_attention_set_at: r.needs_attention_set_at,
        needs_attention_reason: r.needs_attention_reason,
        created_at: r.created_at,
        updated_at: r.updated_at,
        completed_at: r.completed_at,
        hard_deadline: r.hard_deadline,
        effort: r.effort,
        attachment_count: 0,
        queue_rank: r.queue_rank,
        queue_rationale: r.queue_rationale,
        queue_ranked_at: r.queue_ranked_at,
      };
    });

  activeTasks.sort((a, b) => compareDashboardTasks(a, b, now));

  return {
    activeTasks,
    recentlyDone,
    team,
    goals,
    goalQuarters,
    filteredGoal,
  };
}
