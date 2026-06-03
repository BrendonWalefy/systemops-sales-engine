DO $$ BEGIN
  CREATE TYPE "public"."ai_operation" AS ENUM('sales_conversation_analysis', 'conversation_summary', 'follow_up_suggestion', 'manual_analysis');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."ai_provider" AS ENUM('openai');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."appointment_source" AS ENUM('app', 'gcal_import');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."appointment_status" AS ENUM('scheduled', 'confirmed', 'cancelled', 'completed', 'no_show');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."channel" AS ENUM('whatsapp', 'instagram', 'landing_form', 'google_ads', 'meta_ads', 'phone', 'referral', 'manual');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."clinic_plan" AS ENUM('essencial', 'clinica', 'rede', 'custom');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."follow_up_status" AS ENUM('pending', 'done', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."lead_status" AS ENUM('new', 'waiting_response', 'in_conversation', 'follow_up_due', 'appointment_scheduled', 'lost', 'won');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."lead_temperature" AS ENUM('cold', 'warm', 'hot');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."member_role" AS ENUM('owner', 'clinic_admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."message_author" AS ENUM('lead', 'clinic_user', 'agent', 'system');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."playbook_version_status" AS ENUM('active', 'draft', 'historical');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."whatsapp_category" AS ENUM('service', 'utility', 'marketing', 'authentication', 'unknown');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."whatsapp_provider" AS ENUM('meta_cloud_api', 'z_api');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"lead_temperature" "lead_temperature" NOT NULL,
	"stage" text NOT NULL,
	"main_objection" text,
	"suggested_reply" text NOT NULL,
	"next_action" text NOT NULL,
	"follow_up" text,
	"handoff_required" boolean NOT NULL,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence_score" integer NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"human_decision" text,
	"final_reply" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"model" text NOT NULL,
	"operation" "ai_operation" NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"estimated_cost_usd_micros" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"professional_id" uuid,
	"room_id" uuid,
	"calendar_event_id" text,
	"calendar_event_url" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
	"source" "appointment_source" DEFAULT 'app' NOT NULL,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clinic_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" DEFAULT 'clinic_admin' NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clinic_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clinics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"specialty" text DEFAULT 'odontology' NOT NULL,
	"city" text,
	"address" text,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"greeting_message" text,
	"menu_items" jsonb,
	"business_hours" text,
	"google_calendar_id" text,
	"auto_reply_enabled" boolean DEFAULT false NOT NULL,
	"takeover_ttl_hours" integer DEFAULT 4 NOT NULL,
	"post_appointment_buffer_minutes" integer DEFAULT 60 NOT NULL,
	"default_appointment_duration_minutes" integer DEFAULT 60 NOT NULL,
	"plan" "clinic_plan" DEFAULT 'essencial' NOT NULL,
	"monthly_revenue_brl" integer DEFAULT 89700 NOT NULL,
	"billing_started_at" timestamp with time zone,
	"is_test" boolean DEFAULT false NOT NULL,
	"receptionist_phone" text,
	"calendar_channel_id" text,
	"calendar_sync_token" text,
	"channel_provider" "whatsapp_provider",
	"zapi_instance_id" text,
	"zapi_token" text,
	"zapi_client_token" text,
	"meta_phone_number_id" text,
	"meta_access_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"state" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"external_thread_id" text,
	"summary" text,
	"ai_paused" boolean DEFAULT false NOT NULL,
	"takeover_expires_at" timestamp with time zone,
	"needs_attention" boolean DEFAULT false NOT NULL,
	"attention_reason" text,
	"consecutive_unclear_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "follow_up_status" DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"suggested_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text,
	"phone" text,
	"email" text,
	"channel" "channel" NOT NULL,
	"campaign_id" text,
	"treatment_interest" text,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"temperature" "lead_temperature",
	"assigned_to_user_id" uuid,
	"next_action_at" timestamp with time zone,
	"lost_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author" "message_author" NOT NULL,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"external_id" text,
	"intent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "playbook_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "playbook_version_status" DEFAULT 'draft' NOT NULL,
	"specialty" text,
	"procedure_description" text,
	"tone_of_voice" text DEFAULT 'acolhedor' NOT NULL,
	"differentials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commercial_policy" text,
	"notes" text,
	"objections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "professionals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"specialty" text,
	"color" text DEFAULT '#10B981' NOT NULL,
	"work_schedule" jsonb,
	"google_calendar_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"user_email" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "slot_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"calendar_event_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "treatments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"description" text,
	"common_objections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_evaluation_first" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_message_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"provider" "whatsapp_provider" NOT NULL,
	"provider_message_id" text,
	"direction" "message_direction" NOT NULL,
	"category" "whatsapp_category" NOT NULL,
	"estimated_cost_usd_micros" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_recommendations" ADD CONSTRAINT "agent_recommendations_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_recommendations" ADD CONSTRAINT "agent_recommendations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_recommendations" ADD CONSTRAINT "agent_recommendations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_usage_costs" ADD CONSTRAINT "ai_usage_costs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "clinic_members" ADD CONSTRAINT "clinic_members_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "clinic_metrics" ADD CONSTRAINT "clinic_metrics_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "professionals" ADD CONSTRAINT "professionals_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "rooms" ADD CONSTRAINT "rooms_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "slot_reservations" ADD CONSTRAINT "slot_reservations_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "slot_reservations" ADD CONSTRAINT "slot_reservations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "treatments" ADD CONSTRAINT "treatments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "whatsapp_message_costs" ADD CONSTRAINT "whatsapp_message_costs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_recommendations_lead_created_at_idx" ON "agent_recommendations" USING btree ("lead_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_costs_clinic_created_at_idx" ON "ai_usage_costs" USING btree ("clinic_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_clinic_starts_at_idx" ON "appointments" USING btree ("clinic_id","starts_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_clinic_professional_idx" ON "appointments" USING btree ("clinic_id","professional_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_members_email_clinic_idx" ON "clinic_members" USING btree ("email","clinic_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clinic_members_email_idx" ON "clinic_members" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_states_conversation_created_at_idx" ON "conversation_states" USING btree ("conversation_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_lead_idx" ON "conversations" USING btree ("lead_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_external_thread_idx" ON "conversations" USING btree ("external_thread_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follow_ups_clinic_due_at_idx" ON "follow_ups" USING btree ("clinic_id","due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_clinic_status_idx" ON "leads" USING btree ("clinic_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_clinic_phone_idx" ON "leads" USING btree ("clinic_id","phone");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_conversation_sent_at_idx" ON "messages" USING btree ("conversation_id","sent_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_external_id_idx" ON "messages" USING btree ("external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playbook_versions_clinic_status_idx" ON "playbook_versions" USING btree ("clinic_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "professionals_clinic_idx" ON "professionals" USING btree ("clinic_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_clinic_idx" ON "push_subscriptions" USING btree ("clinic_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rooms_clinic_idx" ON "rooms" USING btree ("clinic_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slot_reservations_clinic_starts_at_idx" ON "slot_reservations" USING btree ("clinic_id","starts_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slot_reservations_clinic_lead_idx" ON "slot_reservations" USING btree ("clinic_id","lead_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "slot_reservations_clinic_starts_at_unique" ON "slot_reservations" USING btree ("clinic_id","starts_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "treatments_clinic_name_idx" ON "treatments" USING btree ("clinic_id","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_message_costs_clinic_created_at_idx" ON "whatsapp_message_costs" USING btree ("clinic_id","created_at");
