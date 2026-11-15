CREATE TABLE "gate_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gate" text NOT NULL,
	"operation" text NOT NULL,
	"outcome" text NOT NULL,
	"task_id" text,
	"surface" text NOT NULL,
	"justification" text,
	"input_fingerprint" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "gate_events_gate_enum" CHECK ("gate_events"."gate" IN ('dedup', 'owner_not_self', 'owner_follow_up', 'owner_resolution', 'wip_cap', 'status_transition', 'terminal_confirmation', 'dependency_cycle')),
	CONSTRAINT "gate_events_outcome_enum" CHECK ("gate_events"."outcome" IN ('blocked', 'overridden', 'warned', 'skipped')),
	CONSTRAINT "gate_events_surface_enum" CHECK ("gate_events"."surface" IN ('cli', 'web'))
);
--> statement-breakpoint
ALTER TABLE "gate_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "gate_events_occurred_idx" ON "gate_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "gate_events_task_idx" ON "gate_events" USING btree ("task_id") WHERE "gate_events"."task_id" IS NOT NULL;--> statement-breakpoint
CREATE POLICY "gate_events_anon_select" ON "gate_events" AS PERMISSIVE FOR SELECT TO "anon" USING (true);