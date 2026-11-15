/**
 * Database schema - Drizzle definition for all 12 tables, 2 views,
 * 2 sequences, and per-table RLS policies.
 *
 * Authoritative source: Appendix G (schema dictionary). Implementation
 * pattern: Drizzle-native primitives + TypeScript-layer enforcement
 * (see ADR-006). No hand-written SQL migrations. No PL/pgSQL triggers.
 *
 * What lives here:
 *   - tables, columns, FKs, indexes (incl. text_pattern_ops, gin_trgm_ops)
 *   - CHECK constraints (description length, quarter regex, status enums,
 *     priority enums, category enums, no-self-block, needs_attention_reason length)
 *   - RLS enabled on every table with a per-table SELECT-only policy for anon
 *   - sequences for task and goal id generation
 *   - the two derived views (v_recent_wins, v_eligible_for_prioritization)
 *   - $onUpdate runtime hooks for updated_at columns
 *
 * What lives in src/db/helpers/ (TypeScript layer, per ADR-006):
 *   - composeTaskId() / composeGoalId() (read prefix from app_settings,
 *     pull next sequence value, return composed id)
 *   - updateTaskStatus() (atomic UPDATE + status_change audit-note INSERT
 *     in db.transaction(...); enforces transition matrix; bumps timestamps)
 *   - enforcePZeroWipCap() (SELECT ... FOR UPDATE inside transaction)
 *   - flagAttention() / unflagAttention() (manage needs_attention bool +
 *     side-effect fields atomically)
 *   - assertNoCycle() (recursive CTE check before task_dependencies INSERT)
 *
 * What lives in tests/ (per ADR-006 deviations):
 *   - task_notes APPEND-ONLY scan test: greps every TypeScript source
 *     file for any update/delete taskNotes pattern and fails if found.
 *
 * Postgres extensions (vector, pg_trgm) are enabled out-of-band via the
 * Supabase dashboard at provisioning time. scripts/check-postgres.cjs
 * verifies their presence at install/health-check time.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgRole,
  pgSequence,
  pgTable,
  pgView,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Custom column type - pgvector(N).
//
// Drizzle has no first-class pgvector type. We define a simple custom type
// that emits `vector(<dim>)` in DDL and accepts/returns number[] in TS.
// Embedding dimension is read from env at build time; default 3072 (OpenAI
// text-embedding-3-large per Appendix E.1).
// ---------------------------------------------------------------------------

const EMBEDDING_DIMENSION = Number(process.env.EMBEDDING_DIMENSION ?? 3072);

const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? EMBEDDING_DIMENSION})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    // pgvector returns "[1.2,3.4,5.6]" - strip brackets and split.
    return value.slice(1, -1).split(",").map(Number);
  },
});

// ---------------------------------------------------------------------------
// Type unions for $type<>() narrowing. Enum values match Appendix A.
// CHECK constraints below enforce these at the DB layer.
// ---------------------------------------------------------------------------

export type TaskStatus =
  | "triage"
  | "backlog"
  | "in_progress"
  | "blocked"
  | "review"
  | "done"
  | "cancelled";

export type TaskPriority = "P0" | "P1" | "P2" | "P3";

export type TaskEffort = "S" | "M" | "L" | "XL";

export type TaskHandoffState = "not_applicable" | "pending" | "copied";

export type TaskCategory =
  | "client"
  | "business"
  | "product"
  | "house"
  | "personal";

export type GoalStatus = "active" | "achieved" | "dropped";

export type MemoryState = "active" | "superseded" | "pruned";

export type TaskNoteType =
  | "manual"
  | "intake_checklist"
  | "status_change"
  | "mcp_action"
  | "system";

export type TaskNoteCreatedBy = "agent" | "system" | "user-direct";

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
  | "task_followed_up"
  | "task_deferred"
  | "task_resource_attached"
  | "task_mcp_action_recorded"
  | "task_queue_changed";

export type TaskActivityActorType = "agent" | "system" | "user";

export type TaskActivitySource = "cli" | "dashboard" | "mcp" | "system";

export type GateEventGate =
  | "dedup"
  | "owner_not_self"
  | "owner_follow_up"
  | "owner_resolution"
  | "wip_cap"
  | "status_transition"
  | "terminal_confirmation"
  | "dependency_cycle";

export type GateEventOutcome = "blocked" | "overridden" | "warned" | "skipped";

export type GateEventSurface = "cli" | "web";

export type TriageDisposition = "task" | "memory" | "archived" | "skipped";

export type TriageItemState = "active" | "superseded";

export type TriageSupersededByAction = "user_back";

// ---------------------------------------------------------------------------
// Roles and sequences (G.12).
//
// The `anon` role is created by Supabase at project provisioning; we mark it
// existing so Drizzle does not try to CREATE ROLE. The two id sequences feed
// composeTaskId() / composeGoalId() helpers in src/db/helpers/.
// ---------------------------------------------------------------------------

export const anonRole = pgRole("anon").existing();

export const taskIdSequence = pgSequence("task_id_sequence", {
  startWith: 1,
  increment: 1,
  cache: 1,
});

export const goalIdSequence = pgSequence("goal_id_sequence", {
  startWith: 1,
  increment: 1,
  cache: 1,
});

// ---------------------------------------------------------------------------
// G.2 goals (declared first so tasks.goal_id can reference it without a
// forward callback ambiguity)
// ---------------------------------------------------------------------------

export const goals = pgTable(
  "goals",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    quarter: text("quarter").notNull(),
    status: text("status").$type<GoalStatus>().notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("goals_status_quarter_idx").on(t.status, t.quarter),
    check("goals_description_min_length", sql`length(${t.description}) >= 10`),
    check(
      "goals_quarter_format",
      sql`${t.quarter} ~ '^[0-9]{4}-Q[1-4]$'`,
    ),
    check(
      "goals_status_enum",
      sql`${t.status} IN ('active', 'achieved', 'dropped')`,
    ),
    pgPolicy("goals_anon_select", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// G.1 tasks
// ---------------------------------------------------------------------------

export const tasks = pgTable(
  "tasks",
  {
    // PK is composed by composeTaskId() helper before INSERT; format `{prefix}-NNN`
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: text("status").$type<TaskStatus>().notNull().default("triage"),
    priority: text("priority").$type<TaskPriority>(),
    category: text("category").$type<TaskCategory>().notNull(),
    owner: text("owner").default("me"),
    dueDate: timestamp("due_date", { withTimezone: true, mode: "date" }),
    followUpDate: timestamp("follow_up_date", {
      withTimezone: true,
      mode: "date",
    }),
    snoozedUntil: timestamp("snoozed_until", {
      withTimezone: true,
      mode: "date",
    }),
    handoffState: text("handoff_state")
      .$type<TaskHandoffState>()
      .notNull()
      .default("not_applicable"),
    handoffCopiedAt: timestamp("handoff_copied_at", {
      withTimezone: true,
      mode: "date",
    }),
    handoffLastCopiedAt: timestamp("handoff_last_copied_at", {
      withTimezone: true,
      mode: "date",
    }),
    handoffLastNudgeCopiedAt: timestamp("handoff_last_nudge_copied_at", {
      withTimezone: true,
      mode: "date",
    }),
    goalId: text("goal_id").references(() => goals.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    lastStatusChangeAt: timestamp("last_status_change_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    lastUnblockedAt: timestamp("last_unblocked_at", {
      withTimezone: true,
      mode: "date",
    }),
    // V1.4 Needs Attention agent-curated fields (per AC-076)
    needsAttention: boolean("needs_attention").notNull().default(false),
    needsAttentionSetAt: timestamp("needs_attention_set_at", {
      withTimezone: true,
      mode: "date",
    }),
    needsAttentionReason: text("needs_attention_reason"),
    // change-008 duplicate gate (A9): nullable embedding of title+description.
    // No default, no index (pgvector scan is fine at current row counts).
    embedding: vector("embedding", { dimensions: 3072 }),
    // change-009: commitment flag (external party holds Jordan accountable on
    // the due date) and t-shirt effort estimate. Effort never affects ranking.
    hardDeadline: boolean("hard_deadline").notNull().default(false),
    effort: text("effort").$type<TaskEffort>(),
    // change-009: queue columns
    queueRank: smallint("queue_rank"),
    queueRationale: text("queue_rationale"),
    queueRankedAt: timestamp("queue_ranked_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (t) => [
    index("tasks_status_idx").on(t.status),
    index("tasks_priority_status_idx").on(t.priority, t.status),
    index("tasks_goal_idx").on(t.goalId),
    index("tasks_due_date_idx")
      .on(t.dueDate)
      .where(sql`${t.dueDate} IS NOT NULL`),
    index("tasks_follow_up_date_idx")
      .on(t.followUpDate)
      .where(sql`${t.followUpDate} IS NOT NULL`),
    index("tasks_snoozed_until_idx")
      .on(t.snoozedUntil)
      .where(sql`${t.snoozedUntil} IS NOT NULL`),
    index("tasks_last_status_change_idx").on(t.lastStatusChangeAt),
    index("tasks_needs_attention_idx")
      .on(sql`${t.needsAttentionSetAt} DESC`)
      .where(sql`${t.needsAttention} = true`),
    check(
      "tasks_description_min_length",
      sql`length(${t.description}) >= 10`,
    ),
    check(
      "tasks_status_enum",
      sql`${t.status} IN ('triage', 'backlog', 'in_progress', 'blocked', 'review', 'done', 'cancelled')`,
    ),
    check(
      "tasks_priority_enum",
      sql`${t.priority} IS NULL OR ${t.priority} IN ('P0', 'P1', 'P2', 'P3')`,
    ),
    check(
      "tasks_category_enum",
      sql`${t.category} IN ('client', 'business', 'product', 'house', 'personal')`,
    ),
    check(
      "tasks_needs_attention_reason_length",
      sql`${t.needsAttentionReason} IS NULL OR length(${t.needsAttentionReason}) <= 200`,
    ),
    check(
      "tasks_effort_enum",
      sql`${t.effort} IS NULL OR ${t.effort} IN ('S', 'M', 'L', 'XL')`,
    ),
    check(
      "tasks_handoff_state_enum",
      sql`${t.handoffState} IN ('not_applicable', 'pending', 'copied')`,
    ),
    check(
      "tasks_queue_rank_range",
      sql`${t.queueRank} IS NULL OR (${t.queueRank} >= 1 AND ${t.queueRank} <= 5)`,
    ),
    check(
      "tasks_queue_rationale_length",
      sql`${t.queueRationale} IS NULL OR length(${t.queueRationale}) <= 200`,
    ),
    check(
      "tasks_queue_consistency",
      sql`${t.queueRank} IS NULL OR (${t.queueRationale} IS NOT NULL AND ${t.queueRankedAt} IS NOT NULL)`,
    ),
    uniqueIndex("tasks_queue_rank_unique")
      .on(t.queueRank)
      .where(sql`queue_rank IS NOT NULL`),
    pgPolicy("tasks_anon_select", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// G.3 task_notes (APPEND-ONLY enforced at application layer per ADR-006)
// ---------------------------------------------------------------------------

export const taskNotes = pgTable(
  "task_notes",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    noteType: text("note_type")
      .$type<TaskNoteType>()
      .notNull()
      .default("manual"),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by")
      .$type<TaskNoteCreatedBy>()
      .notNull()
      .default("agent"),
  },
  (t) => [
    index("task_notes_task_idx").on(t.taskId, sql`${t.createdAt} DESC`),
    index("task_notes_type_created_idx").on(
      t.noteType,
      sql`${t.createdAt} DESC`,
    ),
    check(
      "task_notes_type_enum",
      sql`${t.noteType} IN ('manual', 'intake_checklist', 'status_change', 'mcp_action', 'system')`,
    ),
    check(
      "task_notes_created_by_enum",
      sql`${t.createdBy} IN ('agent', 'system', 'user-direct')`,
    ),
    pgPolicy("task_notes_anon_select", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// G.3.1 task_activities (authoritative forward-only task activity feed)
// ---------------------------------------------------------------------------

export const taskActivities = pgTable(
  "task_activities",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    eventType: text("event_type").$type<TaskActivityEventType>().notNull(),
    summary: text("summary").notNull(),
    actorType: text("actor_type")
      .$type<TaskActivityActorType>()
      .notNull()
      .default("agent"),
    actorLabel: text("actor_label").notNull().default("ExecOS agent"),
    source: text("source").$type<TaskActivitySource>().notNull().default("cli"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    schemaVersion: integer("schema_version").notNull().default(1),
  },
  (t) => [
    index("task_activities_task_occurred_idx").on(
      t.taskId,
      sql`${t.occurredAt} DESC`,
    ),
    index("task_activities_type_occurred_idx").on(
      t.eventType,
      sql`${t.occurredAt} DESC`,
    ),
    check(
      "task_activities_event_type_enum",
      sql`${t.eventType} IN ('task_created', 'task_fields_updated', 'task_status_changed', 'task_goal_linked', 'task_goal_unlinked', 'task_dependency_added', 'task_dependency_removed', 'task_attention_flagged', 'task_attention_cleared', 'task_delegation_updated', 'task_followed_up', 'task_deferred', 'task_resource_attached', 'task_mcp_action_recorded', 'task_queue_changed')`,
    ),
    check(
      "task_activities_actor_type_enum",
      sql`${t.actorType} IN ('agent', 'system', 'user')`,
    ),
    check(
      "task_activities_source_enum",
      sql`${t.source} IN ('cli', 'dashboard', 'mcp', 'system')`,
    ),
    check(
      "task_activities_schema_version_positive",
      sql`${t.schemaVersion} >= 1`,
    ),
    pgPolicy("task_activities_anon_select", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// G.3.2 gate_events (gate-decision telemetry; APPEND-ONLY at the application
// layer — all writes route through appendGateEvent() in
// src/db/helpers/gate-events.ts; the scan in
// tests/db/append-only-scan.test.ts enforces this mechanically).
//
// One row per gate DECISION (blocked / overridden / warned / skipped); a
// clean gate pass writes nothing. task_id is deliberately NOT a foreign key:
// telemetry outlives everything, including blocked creates that never
// produced a task row (task_id null). Correlation between a blocked create
// and its later override happens server-side via input_fingerprint (sha256
// of the normalized title + "\n" + description, using the dedup gate's
// normalizeForExactMatch exactly — see dedupInputFingerprint in
// src/domain/intake.ts).
// ---------------------------------------------------------------------------

export const gateEvents = pgTable(
  "gate_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    gate: text("gate").$type<GateEventGate>().notNull(),
    /** The taskops operation name (create, update, delegate, ...). */
    operation: text("operation").notNull(),
    outcome: text("outcome").$type<GateEventOutcome>().notNull(),
    /** Null when a blocked create produced no task row. No FK on purpose. */
    taskId: text("task_id"),
    surface: text("surface").$type<GateEventSurface>().notNull(),
    /** Required by appendGateEvent() when outcome is 'overridden'. */
    justification: text("justification"),
    /** Dedup-gate events only; null for every other gate. */
    inputFingerprint: text("input_fingerprint"),
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    index("gate_events_occurred_idx").on(t.occurredAt),
    index("gate_events_task_idx")
      .on(t.taskId)
      .where(sql`${t.taskId} IS NOT NULL`),
    check(
      "gate_events_gate_enum",
      sql`${t.gate} IN ('dedup', 'owner_not_self', 'owner_follow_up', 'owner_resolution', 'wip_cap', 'status_transition', 'terminal_confirmation', 'dependency_cycle')`,
    ),
    check(
      "gate_events_outcome_enum",
      sql`${t.outcome} IN ('blocked', 'overridden', 'warned', 'skipped')`,
    ),
    check(
      "gate_events_surface_enum",
      sql`${t.surface} IN ('cli', 'web')`,
    ),
    pgPolicy("gate_events_anon_select", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// G.4 task_dependencies
// ---------------------------------------------------------------------------

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: text("id").primaryKey(),
    blockerTaskId: text("blocker_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    blockedTaskId: text("blocked_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("task_dependencies_unique_edge").on(
      t.blockerTaskId,
      t.blockedTaskId,
    ),
    index("dep_blocker_idx").on(t.blockerTaskId),
    index("dep_blocked_idx").on(t.blockedTaskId),
    check(
      "task_dependencies_no_self_block",
      sql`${t.blockerTaskId} <> ${t.blockedTaskId}`,
    ),
    pgPolicy("task_dependencies_anon_select", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// G.5 team
// ---------------------------------------------------------------------------

export const team = pgTable(
  "team",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role"),
    slackUserId: text("slack_user_id"),
    email: text("email"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("team_slug_idx").on(t.slug),
    pgPolicy("team_anon_select", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// G.6 documents (pg_trgm GIN index on filename for filter-by-name search)
// ---------------------------------------------------------------------------

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    filename: text("filename").notNull(),
    category: text("category").$type<TaskCategory>().notNull(),
    notes: text("notes"),
    storagePath: text("storage_path").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }),
    mimeType: text("mime_type"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("documents_category_idx").on(t.category),
    index("documents_filename_trgm_idx").using(
      "gin",
      t.filename.op("gin_trgm_ops"),
    ),
    check(
      "documents_category_enum",
      sql`${t.category} IN ('client', 'business', 'product', 'house', 'personal')`,
    ),
    pgPolicy("documents_anon_select", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// G.7 document_tasks (M:N junction)
// ---------------------------------------------------------------------------

export const documentTasks = pgTable(
  "document_tasks",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    linkedAt: timestamp("linked_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.taskId] }),
    index("doc_tasks_doc_idx").on(t.documentId),
    index("doc_tasks_task_idx").on(t.taskId),
    pgPolicy("document_tasks_anon_select", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// G.8 memories (self-ref FK on superseded_by_id; text_pattern_ops on scope)
// ---------------------------------------------------------------------------

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    content: text("content").notNull(),
    applicability: text("applicability").notNull(),
    contentEmbedding: vector("content_embedding", {
      dimensions: EMBEDDING_DIMENSION,
    }).notNull(),
    applicabilityEmbedding: vector("applicability_embedding", {
      dimensions: EMBEDDING_DIMENSION,
    }).notNull(),
    state: text("state").$type<MemoryState>().notNull().default("active"),
    supersededById: text("superseded_by_id").references(
      (): AnyPgColumn => memories.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    prunedAt: timestamp("pruned_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("memories_scope_state_idx").on(
      t.scope.op("text_pattern_ops"),
      t.state,
    ),
    check(
      "memories_state_enum",
      sql`${t.state} IN ('active', 'superseded', 'pruned')`,
    ),
    pgPolicy("memories_anon_select", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// G.9 triage_sessions
// ---------------------------------------------------------------------------

export const triageSessions = pgTable(
  "triage_sessions",
  {
    id: text("id").primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    pausedAt: timestamp("paused_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    lastProcessedMessageId: text("last_processed_message_id"),
    totalEmailsSeen: integer("total_emails_seen").notNull().default(0),
    totalToTask: integer("total_to_task").notNull().default(0),
    totalToMemory: integer("total_to_memory").notNull().default(0),
    totalArchived: integer("total_archived").notNull().default(0),
    totalSkipped: integer("total_skipped").notNull().default(0),
  },
  () => [
    pgPolicy("triage_sessions_anon_select", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// G.10 triage_items (V1.3.1 state/reason/superseded fields)
// ---------------------------------------------------------------------------

export const triageItems = pgTable(
  "triage_items",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => triageSessions.id, { onDelete: "cascade" }),
    superhumanMessageId: text("superhuman_message_id").notNull(),
    disposition: text("disposition").$type<TriageDisposition>().notNull(),
    state: text("state").$type<TriageItemState>().notNull().default("active"),
    reason: text("reason"),
    supersededAt: timestamp("superseded_at", { withTimezone: true, mode: "date" }),
    supersededByAction: text("superseded_by_action").$type<TriageSupersededByAction>(),
    createdTaskId: text("created_task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    createdMemoryId: text("created_memory_id").references(() => memories.id, {
      onDelete: "set null",
    }),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("triage_items_session_state_idx").on(
      t.sessionId,
      t.state,
      t.processedAt,
    ),
    check(
      "triage_items_disposition_enum",
      sql`${t.disposition} IN ('task', 'memory', 'archived', 'skipped')`,
    ),
    check(
      "triage_items_state_enum",
      sql`${t.state} IN ('active', 'superseded')`,
    ),
    check(
      "triage_items_superseded_by_action_enum",
      sql`${t.supersededByAction} IS NULL OR ${t.supersededByAction} IN ('user_back')`,
    ),
    pgPolicy("triage_items_anon_select", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// G.11 app_settings (runtime-configurable invariants used by TS-layer logic)
// ---------------------------------------------------------------------------

export const appSettings = pgTable(
  "app_settings",
  {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    description: text("description"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  () => [
    pgPolicy("app_settings_anon_select", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// G.13 Derived views
//
// v_recent_wins:               status = 'done' AND completed_at >= now() - 7d,
//                              ordered by completed_at DESC.
// v_eligible_for_prioritization: per Appendix C.1 - status IN
//                              ('triage', 'backlog', 'in_progress')
//                              OR (status = 'blocked'
//                                  AND last_unblocked_at >= now() - 24h).
//
// Both views are read-only by construction; consumers are CLI prioritization
// and dashboard queries (Chunks 3, 9, 10).
// ---------------------------------------------------------------------------

export const vRecentWins = pgView("v_recent_wins").as((qb) =>
  qb
    .select()
    .from(tasks)
    .where(
      sql`${tasks.status} = 'done' AND ${tasks.completedAt} >= now() - interval '7 days'`,
    ),
);

export const vEligibleForPrioritization = pgView(
  "v_eligible_for_prioritization",
).as((qb) =>
  qb
    .select()
    .from(tasks)
    .where(
      sql`${tasks.status} IN ('triage', 'backlog', 'in_progress')
        OR (${tasks.status} = 'blocked'
            AND ${tasks.lastUnblockedAt} IS NOT NULL
            AND ${tasks.lastUnblockedAt} >= now() - interval '24 hours')`,
    ),
);

// ---------------------------------------------------------------------------
// All tables - exported for migration helpers + tests.
// ---------------------------------------------------------------------------

export const ALL_TABLES = {
  tasks,
  goals,
  taskNotes,
  taskActivities,
  gateEvents,
  taskDependencies,
  team,
  documents,
  documentTasks,
  memories,
  triageSessions,
  triageItems,
  appSettings,
} as const;
