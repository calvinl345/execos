CREATE SEQUENCE "public"."goal_id_sequence" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."task_id_sequence" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "document_tasks" (
	"document_id" text NOT NULL,
	"task_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_tasks_document_id_task_id_pk" PRIMARY KEY("document_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "document_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"category" text NOT NULL,
	"notes" text,
	"storage_path" text NOT NULL,
	"size_bytes" bigint,
	"mime_type" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_category_enum" CHECK ("documents"."category" IN ('client', 'business', 'product', 'house', 'personal'))
);
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goals" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"quarter" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "goals_description_min_length" CHECK (length("goals"."description") >= 10),
	CONSTRAINT "goals_quarter_format" CHECK ("goals"."quarter" ~ '^[0-9]{4}-Q[1-4]$'),
	CONSTRAINT "goals_status_enum" CHECK ("goals"."status" IN ('active', 'achieved', 'dropped'))
);
--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memories" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"content" text NOT NULL,
	"applicability" text NOT NULL,
	"content_embedding" vector(3072) NOT NULL,
	"applicability_embedding" vector(3072) NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"superseded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pruned_at" timestamp with time zone,
	CONSTRAINT "memories_state_enum" CHECK ("memories"."state" IN ('active', 'superseded', 'pruned'))
);
--> statement-breakpoint
ALTER TABLE "memories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"id" text PRIMARY KEY NOT NULL,
	"blocker_task_id" text NOT NULL,
	"blocked_task_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_no_self_block" CHECK ("task_dependencies"."blocker_task_id" <> "task_dependencies"."blocked_task_id")
);
--> statement-breakpoint
ALTER TABLE "task_dependencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"note_type" text DEFAULT 'manual' NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'agent' NOT NULL,
	CONSTRAINT "task_notes_type_enum" CHECK ("task_notes"."note_type" IN ('manual', 'intake_checklist', 'status_change', 'mcp_action', 'system')),
	CONSTRAINT "task_notes_created_by_enum" CHECK ("task_notes"."created_by" IN ('agent', 'system', 'user-direct'))
);
--> statement-breakpoint
ALTER TABLE "task_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'triage' NOT NULL,
	"priority" text,
	"category" text NOT NULL,
	"owner" text DEFAULT 'me',
	"due_date" timestamp with time zone,
	"goal_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"last_status_change_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_unblocked_at" timestamp with time zone,
	"needs_attention" boolean DEFAULT false NOT NULL,
	"needs_attention_set_at" timestamp with time zone,
	"needs_attention_reason" text,
	CONSTRAINT "tasks_description_min_length" CHECK (length("tasks"."description") >= 10),
	CONSTRAINT "tasks_status_enum" CHECK ("tasks"."status" IN ('triage', 'backlog', 'in_progress', 'blocked', 'review', 'done', 'cancelled')),
	CONSTRAINT "tasks_priority_enum" CHECK ("tasks"."priority" IS NULL OR "tasks"."priority" IN ('P0', 'P1', 'P2', 'P3')),
	CONSTRAINT "tasks_category_enum" CHECK ("tasks"."category" IN ('client', 'business', 'product', 'house', 'personal')),
	CONSTRAINT "tasks_needs_attention_reason_length" CHECK ("tasks"."needs_attention_reason" IS NULL OR length("tasks"."needs_attention_reason") <= 200)
);
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text,
	"slack_user_id" text,
	"email" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "triage_items" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"superhuman_message_id" text NOT NULL,
	"disposition" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"superseded_at" timestamp with time zone,
	"superseded_by_action" text,
	"created_task_id" text,
	"created_memory_id" text,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "triage_items_disposition_enum" CHECK ("triage_items"."disposition" IN ('task', 'memory', 'archived', 'skipped')),
	CONSTRAINT "triage_items_state_enum" CHECK ("triage_items"."state" IN ('active', 'superseded')),
	CONSTRAINT "triage_items_superseded_by_action_enum" CHECK ("triage_items"."superseded_by_action" IS NULL OR "triage_items"."superseded_by_action" IN ('user_back'))
);
--> statement-breakpoint
ALTER TABLE "triage_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "triage_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paused_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_processed_message_id" text,
	"total_emails_seen" integer DEFAULT 0 NOT NULL,
	"total_to_task" integer DEFAULT 0 NOT NULL,
	"total_to_memory" integer DEFAULT 0 NOT NULL,
	"total_archived" integer DEFAULT 0 NOT NULL,
	"total_skipped" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "triage_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_tasks" ADD CONSTRAINT "document_tasks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tasks" ADD CONSTRAINT "document_tasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_superseded_by_id_memories_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocker_task_id_tasks_id_fk" FOREIGN KEY ("blocker_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocked_task_id_tasks_id_fk" FOREIGN KEY ("blocked_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_items" ADD CONSTRAINT "triage_items_session_id_triage_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."triage_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_items" ADD CONSTRAINT "triage_items_created_task_id_tasks_id_fk" FOREIGN KEY ("created_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_items" ADD CONSTRAINT "triage_items_created_memory_id_memories_id_fk" FOREIGN KEY ("created_memory_id") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_tasks_doc_idx" ON "document_tasks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "doc_tasks_task_idx" ON "document_tasks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "documents_category_idx" ON "documents" USING btree ("category");--> statement-breakpoint
CREATE INDEX "documents_filename_trgm_idx" ON "documents" USING gin ("filename" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "goals_status_quarter_idx" ON "goals" USING btree ("status","quarter");--> statement-breakpoint
CREATE INDEX "memories_scope_state_idx" ON "memories" USING btree ("scope" text_pattern_ops,"state");--> statement-breakpoint
CREATE UNIQUE INDEX "task_dependencies_unique_edge" ON "task_dependencies" USING btree ("blocker_task_id","blocked_task_id");--> statement-breakpoint
CREATE INDEX "dep_blocker_idx" ON "task_dependencies" USING btree ("blocker_task_id");--> statement-breakpoint
CREATE INDEX "dep_blocked_idx" ON "task_dependencies" USING btree ("blocked_task_id");--> statement-breakpoint
CREATE INDEX "task_notes_task_idx" ON "task_notes" USING btree ("task_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "task_notes_type_created_idx" ON "task_notes" USING btree ("note_type","created_at" DESC);--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_priority_status_idx" ON "tasks" USING btree ("priority","status");--> statement-breakpoint
CREATE INDEX "tasks_goal_idx" ON "tasks" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "tasks_due_date_idx" ON "tasks" USING btree ("due_date") WHERE "tasks"."due_date" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_last_status_change_idx" ON "tasks" USING btree ("last_status_change_at");--> statement-breakpoint
CREATE INDEX "tasks_needs_attention_idx" ON "tasks" USING btree ("needs_attention_set_at" DESC) WHERE "tasks"."needs_attention" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "team_slug_idx" ON "team" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "triage_items_session_state_idx" ON "triage_items" USING btree ("session_id","state","processed_at");--> statement-breakpoint
CREATE VIEW "public"."v_eligible_for_prioritization" AS (select "id", "title", "description", "status", "priority", "category", "owner", "due_date", "goal_id", "created_at", "updated_at", "completed_at", "cancelled_at", "last_status_change_at", "last_unblocked_at", "needs_attention", "needs_attention_set_at", "needs_attention_reason" from "tasks" where "tasks"."status" IN ('triage', 'backlog', 'in_progress')
        OR ("tasks"."status" = 'blocked'
            AND "tasks"."last_unblocked_at" IS NOT NULL
            AND "tasks"."last_unblocked_at" >= now() - interval '24 hours'));--> statement-breakpoint
CREATE VIEW "public"."v_recent_wins" AS (select "id", "title", "description", "status", "priority", "category", "owner", "due_date", "goal_id", "created_at", "updated_at", "completed_at", "cancelled_at", "last_status_change_at", "last_unblocked_at", "needs_attention", "needs_attention_set_at", "needs_attention_reason" from "tasks" where "tasks"."status" = 'done' AND "tasks"."completed_at" >= now() - interval '7 days');--> statement-breakpoint
CREATE POLICY "app_settings_anon_select" ON "app_settings" AS PERMISSIVE FOR SELECT TO "anon" USING (true);--> statement-breakpoint
CREATE POLICY "document_tasks_anon_select" ON "document_tasks" AS PERMISSIVE FOR SELECT TO "anon" USING (true);--> statement-breakpoint
CREATE POLICY "documents_anon_select" ON "documents" AS PERMISSIVE FOR SELECT TO "anon" USING (true);--> statement-breakpoint
CREATE POLICY "goals_anon_select" ON "goals" AS PERMISSIVE FOR SELECT TO "anon" USING (true);--> statement-breakpoint
CREATE POLICY "memories_anon_select" ON "memories" AS PERMISSIVE FOR SELECT TO "anon" USING (true);--> statement-breakpoint
CREATE POLICY "task_dependencies_anon_select" ON "task_dependencies" AS PERMISSIVE FOR SELECT TO "anon" USING (true);--> statement-breakpoint
CREATE POLICY "task_notes_anon_select" ON "task_notes" AS PERMISSIVE FOR SELECT TO "anon" USING (true);--> statement-breakpoint
CREATE POLICY "tasks_anon_select" ON "tasks" AS PERMISSIVE FOR SELECT TO "anon" USING (true);--> statement-breakpoint
CREATE POLICY "team_anon_select" ON "team" AS PERMISSIVE FOR SELECT TO "anon" USING (true);--> statement-breakpoint
CREATE POLICY "triage_items_anon_select" ON "triage_items" AS PERMISSIVE FOR SELECT TO "anon" USING (true);--> statement-breakpoint
CREATE POLICY "triage_sessions_anon_select" ON "triage_sessions" AS PERMISSIVE FOR SELECT TO "anon" USING (true);