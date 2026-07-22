CREATE TYPE "public"."reactivation_campaign_status" AS ENUM('draft', 'reviewing', 'approved', 'running', 'paused', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reactivation_message_mode" AS ENUM('ai_per_lead', 'template');--> statement-breakpoint
CREATE TYPE "public"."reactivation_target_status" AS ENUM('pending', 'approved', 'rejected', 'queued', 'sent', 'skipped', 'failed', 'replied', 'converted');--> statement-breakpoint
ALTER TYPE "public"."ai_operation" ADD VALUE 'reactivation_draft';--> statement-breakpoint
CREATE TABLE "reactivation_campaign_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" "reactivation_target_status" DEFAULT 'pending' NOT NULL,
	"draft_message" text,
	"edited_message" text,
	"rejection_reason" text,
	"skip_reason" text,
	"outbound_message_id" uuid,
	"queued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"converted_appointment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactivation_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"segment" jsonb NOT NULL,
	"price_campaign_id" uuid,
	"deadline_at" timestamp with time zone,
	"status" "reactivation_campaign_status" DEFAULT 'draft' NOT NULL,
	"message_mode" "reactivation_message_mode" DEFAULT 'ai_per_lead' NOT NULL,
	"template_text" text,
	"daily_send_cap" integer DEFAULT 30 NOT NULL,
	"test_lead_id" uuid,
	"created_by_email" text,
	"approved_by_email" text,
	"approved_at" timestamp with time zone,
	"last_dispatch_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reactivation_campaign_targets" ADD CONSTRAINT "reactivation_campaign_targets_campaign_id_reactivation_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."reactivation_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactivation_campaign_targets" ADD CONSTRAINT "reactivation_campaign_targets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactivation_campaign_targets" ADD CONSTRAINT "reactivation_campaign_targets_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactivation_campaign_targets" ADD CONSTRAINT "reactivation_campaign_targets_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactivation_campaigns" ADD CONSTRAINT "reactivation_campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactivation_campaigns" ADD CONSTRAINT "reactivation_campaigns_price_campaign_id_price_campaigns_id_fk" FOREIGN KEY ("price_campaign_id") REFERENCES "public"."price_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactivation_campaigns" ADD CONSTRAINT "reactivation_campaigns_test_lead_id_leads_id_fk" FOREIGN KEY ("test_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reactivation_targets_campaign_lead_idx" ON "reactivation_campaign_targets" USING btree ("campaign_id","lead_id");--> statement-breakpoint
CREATE INDEX "reactivation_targets_campaign_status_idx" ON "reactivation_campaign_targets" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "reactivation_targets_org_lead_idx" ON "reactivation_campaign_targets" USING btree ("organization_id","lead_id");--> statement-breakpoint
CREATE INDEX "reactivation_campaigns_org_status_idx" ON "reactivation_campaigns" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "reactivation_campaigns_org_created_at_idx" ON "reactivation_campaigns" USING btree ("organization_id","created_at");