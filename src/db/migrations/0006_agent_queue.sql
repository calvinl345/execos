DROP VIEW "public"."v_eligible_for_prioritization";--> statement-breakpoint
DROP VIEW "public"."v_recent_wins";--> statement-breakpoint
ALTER TABLE "task_activities" DROP CONSTRAINT "task_activities_event_type_enum";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "queue_rank" smallint;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "queue_rationale" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "queue_ranked_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_queue_rank_unique" ON "tasks" USING btree ("queue_rank") WHERE queue_rank IS NOT NULL;--> statement-breakpoint
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_event_type_enum" CHECK ("task_activities"."event_type" IN ('task_created', 'task_fields_updated', 'task_status_changed', 'task_goal_linked', 'task_goal_unlinked', 'task_dependency_added', 'task_dependency_removed', 'task_attention_flagged', 'task_attention_cleared', 'task_delegation_updated', 'task_followed_up', 'task_deferred', 'task_resource_attached', 'task_mcp_action_recorded', 'task_queue_changed'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_queue_rank_range" CHECK ("tasks"."queue_rank" IS NULL OR ("tasks"."queue_rank" >= 1 AND "tasks"."queue_rank" <= 5));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_queue_rationale_length" CHECK ("tasks"."queue_rationale" IS NULL OR length("tasks"."queue_rationale") <= 200);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_queue_consistency" CHECK ("tasks"."queue_rank" IS NULL OR ("tasks"."queue_rationale" IS NOT NULL AND "tasks"."queue_ranked_at" IS NOT NULL));--> statement-breakpoint
CREATE VIEW "public"."v_eligible_for_prioritization" AS (select "id", "title", "description", "status", "priority", "category", "owner", "due_date", "follow_up_date", "goal_id", "created_at", "updated_at", "completed_at", "cancelled_at", "last_status_change_at", "last_unblocked_at", "needs_attention", "needs_attention_set_at", "needs_attention_reason", "embedding", "hard_deadline", "effort", "queue_rank", "queue_rationale", "queue_ranked_at" from "tasks" where "tasks"."status" IN ('triage', 'backlog', 'in_progress')
        OR ("tasks"."status" = 'blocked'
            AND "tasks"."last_unblocked_at" IS NOT NULL
            AND "tasks"."last_unblocked_at" >= now() - interval '24 hours'));--> statement-breakpoint
CREATE VIEW "public"."v_recent_wins" AS (select "id", "title", "description", "status", "priority", "category", "owner", "due_date", "follow_up_date", "goal_id", "created_at", "updated_at", "completed_at", "cancelled_at", "last_status_change_at", "last_unblocked_at", "needs_attention", "needs_attention_set_at", "needs_attention_reason", "embedding", "hard_deadline", "effort", "queue_rank", "queue_rationale", "queue_ranked_at" from "tasks" where "tasks"."status" = 'done' AND "tasks"."completed_at" >= now() - interval '7 days');