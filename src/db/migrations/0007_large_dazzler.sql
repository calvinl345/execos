DROP VIEW "public"."v_eligible_for_prioritization";--> statement-breakpoint
DROP VIEW "public"."v_recent_wins";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "handoff_state" text DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "handoff_copied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "handoff_last_copied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "handoff_last_nudge_copied_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "tasks_snoozed_until_idx" ON "tasks" USING btree ("snoozed_until") WHERE "tasks"."snoozed_until" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_handoff_state_enum" CHECK ("tasks"."handoff_state" IN ('not_applicable', 'pending', 'copied'));--> statement-breakpoint
CREATE VIEW "public"."v_eligible_for_prioritization" AS (select "id", "title", "description", "status", "priority", "category", "owner", "due_date", "follow_up_date", "snoozed_until", "handoff_state", "handoff_copied_at", "handoff_last_copied_at", "handoff_last_nudge_copied_at", "goal_id", "created_at", "updated_at", "completed_at", "cancelled_at", "last_status_change_at", "last_unblocked_at", "needs_attention", "needs_attention_set_at", "needs_attention_reason", "embedding", "hard_deadline", "effort", "queue_rank", "queue_rationale", "queue_ranked_at" from "tasks" where "tasks"."status" IN ('triage', 'backlog', 'in_progress')
        OR ("tasks"."status" = 'blocked'
            AND "tasks"."last_unblocked_at" IS NOT NULL
            AND "tasks"."last_unblocked_at" >= now() - interval '24 hours'));--> statement-breakpoint
CREATE VIEW "public"."v_recent_wins" AS (select "id", "title", "description", "status", "priority", "category", "owner", "due_date", "follow_up_date", "snoozed_until", "handoff_state", "handoff_copied_at", "handoff_last_copied_at", "handoff_last_nudge_copied_at", "goal_id", "created_at", "updated_at", "completed_at", "cancelled_at", "last_status_change_at", "last_unblocked_at", "needs_attention", "needs_attention_set_at", "needs_attention_reason", "embedding", "hard_deadline", "effort", "queue_rank", "queue_rationale", "queue_ranked_at" from "tasks" where "tasks"."status" = 'done' AND "tasks"."completed_at" >= now() - interval '7 days');