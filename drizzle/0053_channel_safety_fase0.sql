CREATE TYPE "public"."outbound_message_category" AS ENUM('reply', 'follow_up', 'reminder', 'recovery', 'campaign', 'operational');--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "contact_consent_revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "contact_consent_source" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "outbound_hourly_cap" integer DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "outbound_daily_cap" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "category" "outbound_message_category" DEFAULT 'reply' NOT NULL;