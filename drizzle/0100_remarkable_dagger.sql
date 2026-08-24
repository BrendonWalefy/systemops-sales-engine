CREATE TYPE "public"."outbound_authorization_kind" AS ENUM('live_stream_reply', 'follow_up', 'reminder', 'campaign', 'human_manual', 'operational', 'system', 'recovery', 'legacy');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_stream_alias_kind" AS ENUM('phone', 'whatsapp_lid', 'provider_thread');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_stream_retirement_reason" AS ENUM('alias_convergence', 'conversation_convergence', 'manual');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_stream_state" AS ENUM('provisional', 'active', 'retired');--> statement-breakpoint
ALTER TYPE "public"."inbound_event_processing_status" ADD VALUE 'identity_conflict';--> statement-breakpoint
ALTER TYPE "public"."inbound_event_processing_status" ADD VALUE 'history_only';--> statement-breakpoint
CREATE TABLE "conversation_authority" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"activated_at" timestamp with time zone,
	"activated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_authority_version_check" CHECK ("conversation_authority"."version" in (0, 1, 2, 3))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_stream_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "whatsapp_stream_alias_kind" NOT NULL,
	"provider_scope" text NOT NULL,
	"normalized_value" text NOT NULL,
	"stream_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "whatsapp_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid,
	"state" "whatsapp_stream_state" DEFAULT 'provisional' NOT NULL,
	"current_generation" bigint DEFAULT 0 NOT NULL,
	"latest_inbound_event_id" uuid,
	"quiet_until" timestamp with time zone,
	"conversation_stream_order" bigint,
	"bound_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"retirement_reason" "whatsapp_stream_retirement_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_streams_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "whatsapp_streams_current_generation_check" CHECK ("whatsapp_streams"."current_generation" between 0 and 9007199254740991),
	CONSTRAINT "whatsapp_streams_conversation_binding_check" CHECK ((
        ("whatsapp_streams"."conversation_id" is null and "whatsapp_streams"."conversation_stream_order" is null and "whatsapp_streams"."bound_at" is null)
        or
        ("whatsapp_streams"."conversation_id" is not null and "whatsapp_streams"."conversation_stream_order" is not null and "whatsapp_streams"."bound_at" is not null)
      )),
	CONSTRAINT "whatsapp_streams_conversation_order_check" CHECK ("whatsapp_streams"."conversation_stream_order" is null or "whatsapp_streams"."conversation_stream_order" between 1 and 9007199254740991),
	CONSTRAINT "whatsapp_streams_retirement_check" CHECK ((
        ("whatsapp_streams"."state" = 'retired' and "whatsapp_streams"."retired_at" is not null and "whatsapp_streams"."retirement_reason" is not null)
        or
        ("whatsapp_streams"."state" <> 'retired' and "whatsapp_streams"."retired_at" is null and "whatsapp_streams"."retirement_reason" is null)
      ))
);
--> statement-breakpoint
ALTER TABLE "inbound_events" ADD COLUMN "stream_id" uuid;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD COLUMN "stream_generation" bigint;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD COLUMN "registered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD COLUMN "claim_token" text;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD COLUMN "claim_token_digest" text;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD COLUMN "claim_job_id" uuid;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "inbound_event_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "inbound_event_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "stream_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "stream_generation" bigint;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "authorization_kind" "outbound_authorization_kind";--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "authorization_stream_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "authorization_generation" bigint;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "authorization_inbound_event_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "authorization_claim_job_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "authorization_claim_token_digest" text;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "authorization_version" integer;--> statement-breakpoint
ALTER TABLE "conversation_authority" ADD CONSTRAINT "conversation_authority_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_stream_aliases" ADD CONSTRAINT "whatsapp_stream_aliases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_stream_aliases" ADD CONSTRAINT "whatsapp_stream_aliases_stream_org_fk" FOREIGN KEY ("stream_id","organization_id") REFERENCES "public"."whatsapp_streams"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_streams" ADD CONSTRAINT "whatsapp_streams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_streams" ADD CONSTRAINT "whatsapp_streams_latest_inbound_event_id_inbound_events_id_fk" FOREIGN KEY ("latest_inbound_event_id") REFERENCES "public"."inbound_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_stream_aliases_active_identity_unique" ON "whatsapp_stream_aliases" USING btree ("organization_id","kind","provider_scope","normalized_value") WHERE "whatsapp_stream_aliases"."retired_at" is null;--> statement-breakpoint
CREATE INDEX "whatsapp_stream_aliases_stream_retired_idx" ON "whatsapp_stream_aliases" USING btree ("stream_id","retired_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_streams_active_conversation_unique" ON "whatsapp_streams" USING btree ("conversation_id") WHERE "whatsapp_streams"."state" = 'active' and "whatsapp_streams"."conversation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_streams_conversation_order_unique" ON "whatsapp_streams" USING btree ("conversation_id","conversation_stream_order") WHERE "whatsapp_streams"."conversation_id" is not null and "whatsapp_streams"."conversation_stream_order" is not null;--> statement-breakpoint
CREATE INDEX "whatsapp_streams_org_state_updated_idx" ON "whatsapp_streams" USING btree ("organization_id","state","updated_at");--> statement-breakpoint
CREATE INDEX "whatsapp_streams_conversation_history_idx" ON "whatsapp_streams" USING btree ("conversation_id","conversation_stream_order","id");--> statement-breakpoint
CREATE INDEX "whatsapp_streams_org_quiet_generation_idx" ON "whatsapp_streams" USING btree ("organization_id","quiet_until","current_generation");--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_claim_job_id_jobs_id_fk" FOREIGN KEY ("claim_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_stream_org_fk" FOREIGN KEY ("stream_id","organization_id") REFERENCES "public"."whatsapp_streams"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_inbound_event_id_inbound_events_id_fk" FOREIGN KEY ("inbound_event_id") REFERENCES "public"."inbound_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_authorization_claim_job_id_jobs_id_fk" FOREIGN KEY ("authorization_claim_job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_authorization_stream_org_fk" FOREIGN KEY ("authorization_stream_id","organization_id") REFERENCES "public"."whatsapp_streams"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_events_org_provider_message_unique" ON "inbound_events" USING btree ("organization_id","provider","provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_events_stream_generation_unique" ON "inbound_events" USING btree ("stream_id","stream_generation") WHERE "inbound_events"."stream_id" is not null and "inbound_events"."stream_generation" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_events_authority_tuple_unique" ON "inbound_events" USING btree ("id","stream_id","stream_generation");--> statement-breakpoint
CREATE INDEX "inbound_events_stream_generation_id_idx" ON "inbound_events" USING btree ("stream_id","stream_generation","id");--> statement-breakpoint
CREATE INDEX "inbound_events_claim_job_idx" ON "inbound_events" USING btree ("claim_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_inbound_event_unique" ON "jobs" USING btree ("inbound_event_id");--> statement-breakpoint
CREATE INDEX "jobs_queue_status_run_at_inbound_idx" ON "jobs" USING btree ("queue","status","run_at","inbound_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_inbound_event_unique" ON "messages" USING btree ("inbound_event_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_stream_generation_idx" ON "messages" USING btree ("conversation_id","stream_id","stream_generation","inbound_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_messages_live_stream_authority_unique" ON "outbound_messages" USING btree ("authorization_stream_id","authorization_generation","authorization_inbound_event_id");--> statement-breakpoint
CREATE INDEX "outbound_messages_authority_status_idx" ON "outbound_messages" USING btree ("organization_id","authorization_kind","status","created_at");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_stream_tuple_check" CHECK ((
        ("inbound_events"."stream_id" is null and "inbound_events"."stream_generation" is null)
        or
        ("inbound_events"."stream_id" is not null and "inbound_events"."stream_generation" is not null)
      ));--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_stream_generation_check" CHECK ("inbound_events"."stream_generation" is null or "inbound_events"."stream_generation" between 1 and 9007199254740991);--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_claim_token_check" CHECK ((
        ("inbound_events"."claim_token" is null and "inbound_events"."claim_token_digest" is null and "inbound_events"."claimed_at" is null)
        or
        ("inbound_events"."claim_token" is not null and "inbound_events"."claim_token_digest" is not null and "inbound_events"."claimed_at" is not null)
      ));--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_claim_token_format_check" CHECK ((
        ("inbound_events"."claim_token" is null or "inbound_events"."claim_token" ~ '^[A-Za-z0-9_-]{43}$')
        and
        ("inbound_events"."claim_token_digest" is null or "inbound_events"."claim_token_digest" ~ '^[A-Za-z0-9_-]{43}$')
      ));--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_claim_job_check" CHECK ("inbound_events"."claim_job_id" is null or "inbound_events"."claim_token" is not null);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_stream_generation_check" CHECK ("messages"."stream_generation" is null or "messages"."stream_generation" between 1 and 9007199254740991);--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_authorization_generation_check" CHECK ("outbound_messages"."authorization_generation" is null or "outbound_messages"."authorization_generation" between 1 and 9007199254740991);--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_authorization_digest_check" CHECK ("outbound_messages"."authorization_claim_token_digest" is null or "outbound_messages"."authorization_claim_token_digest" ~ '^[A-Za-z0-9_-]{43}$');