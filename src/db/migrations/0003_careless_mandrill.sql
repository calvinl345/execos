DROP VIEW "public"."v_eligible_for_prioritization";--> statement-breakpoint
DROP VIEW "public"."v_recent_wins";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "embedding" vector(3072);--> statement-breakpoint
CREATE VIEW "public"."v_eligible_for_prioritization" AS (select "id", "title", "description", "status", "priority", "category", "owner", "due_date", "follow_up_date", "goal_id", "created_at", "updated_at", "completed_at", "cancelled_at", "last_status_change_at", "last_unblocked_at", "needs_attention", "needs_attention_set_at", "needs_attention_reason", "embedding" from "tasks" where "tasks"."status" IN ('triage', 'backlog', 'in_progress')
        OR ("tasks"."status" = 'blocked'
            AND "tasks"."last_unblocked_at" IS NOT NULL
            AND "tasks"."last_unblocked_at" >= now() - interval '24 hours'));--> statement-breakpoint
CREATE VIEW "public"."v_recent_wins" AS (select "id", "title", "description", "status", "priority", "category", "owner", "due_date", "follow_up_date", "goal_id", "created_at", "updated_at", "completed_at", "cancelled_at", "last_status_change_at", "last_unblocked_at", "needs_attention", "needs_attention_set_at", "needs_attention_reason", "embedding" from "tasks" where "tasks"."status" = 'done' AND "tasks"."completed_at" >= now() - interval '7 days');