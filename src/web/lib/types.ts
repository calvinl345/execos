/**
 * Type shapes consumed by the dashboard UI.
 *
 * These mirror the relevant subset of the Drizzle row types in
 * src/db/schema.ts but are redeclared here to keep the SvelteKit subtree
 * decoupled from the service-role DB module (per ESLint barrier in
 * `.eslintrc.json` — anything under `src/web/` is forbidden from
 * importing the service-role client).
 */

export type TaskStatus =
  | "triage"
  | "backlog"
  | "in_progress"
  | "blocked"
  | "review"
  | "done"
  | "cancelled";

export type TaskPriority = "P0" | "P1" | "P2" | "P3";

export type TaskCategory =
  | "client"
  | "business"
  | "product"
  | "house"
  | "personal";

export type GoalStatus = "active" | "achieved" | "dropped";

export type TaskEffort = "S" | "M" | "L" | "XL";

export type TaskHandoffState = "not_applicable" | "pending" | "copied";

/** Goals board tab row from load (formerly `/goals`). */
export interface GoalSummary {
  id: string;
  title: string;
  description: string;
  quarter: string;
  status: GoalStatus;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  active_task_count: number;
}

export interface DashboardTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  category: TaskCategory;
  owner: string | null;
  due_date: string | null;
  follow_up_date: string | null;
  snoozed_until: string | null;
  handoff_state: TaskHandoffState;
  handoff_copied_at: string | null;
  handoff_last_copied_at: string | null;
  handoff_last_nudge_copied_at: string | null;
  goal_id: string | null;
  goal_title: string | null;
  needs_attention: boolean;
  needs_attention_set_at: string | null;
  needs_attention_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  attachment_count: number;
  hard_deadline: boolean;
  effort: TaskEffort | null;
  queue_rank: number | null;
  queue_rationale: string | null;
  queue_ranked_at: string | null;
}

export interface DashboardData {
  activeTasks: DashboardTask[];
  recentlyDone: DashboardTask[];
  team: TeamMember[];
  /** All goals + per-goal active-task counts for the Goals board tab */
  goals: GoalSummary[];
  /** Distinct quarters from `goals`, descending sort */
  goalQuarters: string[];
  /** Present when `?goal=G-NNN` is well-formed; title may be null if the row is missing. */
  filteredGoal: { id: string; title: string | null } | null;
}

export type TaskNoteType =
  | "manual"
  | "intake_checklist"
  | "status_change"
  | "mcp_action"
  | "system";

export interface TaskNote {
  id: string;
  task_id: string;
  note_type: TaskNoteType;
  content: string;
  created_at: string;
  created_by: "agent" | "system" | "user-direct";
}

export type TaskActivityEventType =
  | "task_created"
  | "task_fields_updated"
  | "task_status_changed"
  | "task_goal_linked"
  | "task_goal_unlinked"
  | "task_dependency_added"
  | "task_dependency_removed"
  | "task_attention_flagged"
  | "task_attention_cleared"
  | "task_delegation_updated"
  | "task_resource_attached"
  | "task_mcp_action_recorded"
  | "task_queue_changed"
  | "task_followed_up"
  | "task_deferred";

export interface TaskActivity {
  id: string;
  task_id: string;
  event_type: TaskActivityEventType;
  summary: string;
  actor_type: "agent" | "system" | "user";
  actor_label: string;
  source: "cli" | "dashboard" | "mcp" | "system";
  occurred_at: string;
  payload: Record<string, unknown>;
  schema_version: number;
}

export interface DependencyRef {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  owner: string | null;
}

export interface AttachmentRef {
  id: string;
  filename: string;
  category: TaskCategory;
  size_bytes: number | null;
  mime_type: string | null;
  uploaded_at: string;
  signed_url: string | null;
}

export interface TaskDetailPayload {
  task: DashboardTask;
  notes: TaskNote[];
  activities: TaskActivity[];
  dependenciesIn: DependencyRef[];
  dependenciesOut: DependencyRef[];
  attachments: AttachmentRef[];
}

export interface TeamMember { slug: string; displayName: string }
export interface InboxSections { followUps: DashboardTask[]; tasks: DashboardTask[] }
export type InboxActionPayload =
  | { action: "delegate"; owner: string; followUpDate?: string; dueDate?: string; notes?: string }
  | { action: "delegation-message"; kind: "handoff" | "nudge"; followUpDate?: string | null }
  | { action: "follow-up"; update: string; nextFollowUpDate: string; dueDate?: string; status?: string }
  | { action: "defer"; until: string }
  | { action: "clear-snooze" }
  | { action: "update-fields"; dueDate?: string | null }
  | { action: "complete" }
  | { action: "reopen" }
  | { action: "undelegate" };

export type EnvKind = "production" | "development" | "production-sandbox" | "development-sandbox";

export interface EnvInfo {
  kind: EnvKind;
  envFile: string;
  activeProfile: string;
  supabaseProjectName: string | null;
  sandboxSource: string | null;
  clonedAt: string | null;
}
