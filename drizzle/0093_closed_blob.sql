CREATE TABLE "job_dead_letter_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_email" text NOT NULL,
	"reason" text NOT NULL,
	"allowed_late_delivery" boolean DEFAULT false NOT NULL,
	"job_attempts" integer NOT NULL,
	"job_last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "dead_letter_disposition" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "dead_letter_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "dead_letter_resolved_by" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "dead_letter_resolution_reason" text;--> statement-breakpoint
ALTER TABLE "job_dead_letter_actions" ADD CONSTRAINT "job_dead_letter_actions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_dead_letter_actions_job_created_at_idx" ON "job_dead_letter_actions" USING btree ("job_id","created_at");