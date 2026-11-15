CREATE TABLE "task_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"event_type" text NOT NULL,
	"summary" text NOT NULL,
	"actor_type" text DEFAULT 'agent' NOT NULL,
	"actor_label" text DEFAULT 'ExecOS agent' NOT NULL,
	"source" text DEFAULT 'cli' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "task_activities_event_type_enum" CHECK ("task_activities"."event_type" IN ('task_created', 'task_fields_updated', 'task_status_changed', 'task_goal_linked', 'task_goal_unlinked', 'task_dependency_added', 'task_dependency_removed', 'task_attention_flagged', 'task_attention_cleared', 'task_delegation_updated', 'task_resource_attached', 'task_mcp_action_recorded')),
	CONSTRAINT "task_activities_actor_type_enum" CHECK ("task_activities"."actor_type" IN ('agent', 'system', 'user')),
	CONSTRAINT "task_activities_source_enum" CHECK ("task_activities"."source" IN ('cli', 'dashboard', 'mcp', 'system')),
	CONSTRAINT "task_activities_schema_version_positive" CHECK ("task_activities"."schema_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "task_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_activities_task_occurred_idx" ON "task_activities" USING btree ("task_id","occurred_at" DESC);--> statement-breakpoint
CREATE INDEX "task_activities_type_occurred_idx" ON "task_activities" USING btree ("event_type","occurred_at" DESC);--> statement-breakpoint
GRANT SELECT ON TABLE "task_activities" TO "anon";--> statement-breakpoint
CREATE POLICY "task_activities_anon_select" ON "task_activities" AS PERMISSIVE FOR SELECT TO "anon" USING (true);
