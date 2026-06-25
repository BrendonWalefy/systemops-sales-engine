CREATE TYPE "public"."inbound_event_processing_status" AS ENUM('pending', 'processing', 'processed', 'failed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."job_queue" AS ENUM('message.process', 'message.send', 'followup.dispatch');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'processing', 'done', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."outbound_message_delivery_kind" AS ENUM('text', 'audio', 'image', 'video', 'document');--> statement-breakpoint
CREATE TYPE "public"."outbound_message_status" AS ENUM('pending', 'processing', 'sent', 'failed', 'dead', 'cancelled');--> statement-breakpoint
CREATE TABLE "inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"provider" "whatsapp_provider" NOT NULL,
	"provider_message_id" text NOT NULL,
	"conversation_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"normalized_text" text,
	"media_type" text,
	"dedupe_key" text NOT NULL,
	"processing_status" "inbound_event_processing_status" DEFAULT 'pending' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" "job_queue" NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 10 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"payload" jsonb NOT NULL,
	"delivery_kind" "outbound_message_delivery_kind" NOT NULL,
	"status" "outbound_message_status" DEFAULT 'pending' NOT NULL,
	"provider_message_id" text,
	"dedupe_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_events_provider_message_unique" ON "inbound_events" USING btree ("provider","provider_message_id");--> statement-breakpoint
CREATE INDEX "inbound_events_clinic_received_at_idx" ON "inbound_events" USING btree ("clinic_id","received_at");--> statement-breakpoint
CREATE INDEX "inbound_events_processing_status_received_at_idx" ON "inbound_events" USING btree ("processing_status","received_at");--> statement-breakpoint
CREATE INDEX "inbound_events_dedupe_key_idx" ON "inbound_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "jobs_queue_status_run_at_idx" ON "jobs" USING btree ("queue","status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_status_run_at_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_queue_dedupe_key_idx" ON "jobs" USING btree ("queue","dedupe_key");--> statement-breakpoint
CREATE INDEX "outbound_messages_conversation_created_at_idx" ON "outbound_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "outbound_messages_status_created_at_idx" ON "outbound_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_messages_conversation_dedupe_key_idx" ON "outbound_messages" USING btree ("conversation_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "outbound_messages_provider_message_id_idx" ON "outbound_messages" USING btree ("provider_message_id");