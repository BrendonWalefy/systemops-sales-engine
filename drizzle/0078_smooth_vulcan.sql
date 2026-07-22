CREATE TYPE "public"."lead_outcome_reason" AS ENUM('price', 'schedule', 'location', 'fear', 'third_party_decision', 'competitor', 'treatment_mismatch', 'no_response', 'already_treated', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_outcome_source" AS ENUM('llm', 'human', 'system');--> statement-breakpoint
ALTER TYPE "public"."ai_operation" ADD VALUE 'lead_outcome_classification';--> statement-breakpoint
CREATE TABLE "lead_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"conversation_id" uuid,
	"reason" "lead_outcome_reason" NOT NULL,
	"evidence_excerpt" text,
	"evidence_message_id" uuid,
	"confidence" integer DEFAULT 0 NOT NULL,
	"source" "lead_outcome_source" DEFAULT 'llm' NOT NULL,
	"model" text,
	"last_seen_message_id" uuid,
	"classified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_outcomes" ADD CONSTRAINT "lead_outcomes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_outcomes" ADD CONSTRAINT "lead_outcomes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_outcomes" ADD CONSTRAINT "lead_outcomes_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_outcomes_org_lead_idx" ON "lead_outcomes" USING btree ("organization_id","lead_id");--> statement-breakpoint
CREATE INDEX "lead_outcomes_org_reason_idx" ON "lead_outcomes" USING btree ("organization_id","reason");