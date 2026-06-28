CREATE TABLE IF NOT EXISTS "treatment_gap_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"lead_name" text,
	"mentioned_text" text NOT NULL,
	"message_snippet" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "treatment_gap_reports" ADD CONSTRAINT "treatment_gap_reports_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "treatment_gap_reports" ADD CONSTRAINT "treatment_gap_reports_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "treatment_gap_reports_clinic_created_idx" ON "treatment_gap_reports" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "treatment_gap_reports_conv_idx" ON "treatment_gap_reports" USING btree ("conversation_id");
