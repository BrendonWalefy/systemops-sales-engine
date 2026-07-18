CREATE TYPE "public"."human_review_decision" AS ENUM('approved_direct_booking', 'needs_evaluation', 'manual_reply', 'not_eligible');--> statement-breakpoint
CREATE TYPE "public"."human_review_decision_source" AS ENUM('whatsapp', 'panel');--> statement-breakpoint
CREATE TYPE "public"."human_review_status" AS ENUM('pending', 'decided', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "human_review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"source_message_id" uuid,
	"treatment_id" uuid,
	"target_treatment_id" uuid,
	"review_code" integer NOT NULL,
	"status" "human_review_status" DEFAULT 'pending' NOT NULL,
	"decision" "human_review_decision",
	"decision_source" "human_review_decision_source",
	"reviewer_phone" text,
	"review_notes" text,
	"source_media_type" text,
	"source_media_url" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "human_review_requests" ADD CONSTRAINT "human_review_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_review_requests" ADD CONSTRAINT "human_review_requests_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_review_requests" ADD CONSTRAINT "human_review_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_review_requests" ADD CONSTRAINT "human_review_requests_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_review_requests" ADD CONSTRAINT "human_review_requests_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_review_requests" ADD CONSTRAINT "human_review_requests_target_treatment_id_treatments_id_fk" FOREIGN KEY ("target_treatment_id") REFERENCES "public"."treatments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "human_review_requests_org_status_idx" ON "human_review_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "human_review_requests_conversation_idx" ON "human_review_requests" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "human_review_requests_pending_code_idx" ON "human_review_requests" USING btree ("organization_id","review_code") WHERE "human_review_requests"."status" = 'pending';