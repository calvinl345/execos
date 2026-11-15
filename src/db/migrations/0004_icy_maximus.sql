DROP VIEW "public"."v_eligible_for_prioritization";--> statement-breakpoint
DROP VIEW "public"."v_recent_wins";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "hard_deadline" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "effort" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_effort_enum" CHECK ("tasks"."effort" IS NULL OR "tasks"."effort" IN ('S', 'M', 'L', 'XL'));--> statement-breakpoint
CREATE VIEW "public"."v_eligible_for_prioritization" AS (select "id", "title", "description", "status", "priority", "category", "owner", "due_date", "follow_up_date", "goal_id", "created_at", "updated_at", "completed_at", "cancelled_at", "last_status_change_at", "last_unblocked_at", "needs_attention", "needs_attention_set_at", "needs_attention_reason", "embedding", "hard_deadline", "effort" from "tasks" where "tasks"."status" IN ('triage', 'backlog', 'in_progress')
        OR ("tasks"."status" = 'blocked'
            AND "tasks"."last_unblocked_at" IS NOT NULL
            AND "tasks"."last_unblocked_at" >= now() - interval '24 hours'));--> statement-breakpoint
CREATE VIEW "public"."v_recent_wins" AS (select "id", "title", "description", "status", "priority", "category", "owner", "due_date", "follow_up_date", "goal_id", "created_at", "updated_at", "completed_at", "cancelled_at", "last_status_change_at", "last_unblocked_at", "needs_attention", "needs_attention_set_at", "needs_attention_reason", "embedding", "hard_deadline", "effort" from "tasks" where "tasks"."status" = 'done' AND "tasks"."completed_at" >= now() - interval '7 days');