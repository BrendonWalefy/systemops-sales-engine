CREATE TYPE "public"."ai_contract_rejection_access_action" AS ENUM('raw_output_revealed');--> statement-breakpoint
CREATE TYPE "public"."ai_contract_rejection_capture_status" AS ENUM('stored', 'oversized', 'no_raw_output', 'encryption_unavailable', 'expired');--> statement-breakpoint
CREATE TYPE "public"."ai_contract_rejection_stage" AS ENUM('understanding_structural', 'understanding_semantic', 'response_verbalization');--> statement-breakpoint
CREATE TABLE "ai_contract_rejection_access_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rejection_id" uuid NOT NULL,
	"owner_subject" text NOT NULL,
	"action" "ai_contract_rejection_access_action" NOT NULL,
	"accessed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_contract_rejection_access_audits_retention_check" CHECK ("ai_contract_rejection_access_audits"."accessed_at" <= "ai_contract_rejection_access_audits"."expires_at")
);
--> statement-breakpoint
CREATE TABLE "ai_contract_rejections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"inbound_event_id" uuid NOT NULL,
	"turn_id" text NOT NULL,
	"stage" "ai_contract_rejection_stage" NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"contract_version" text NOT NULL,
	"attempt" integer NOT NULL,
	"issues" jsonb NOT NULL,
	"output_sha256" text NOT NULL,
	"output_bytes" integer NOT NULL,
	"capture_status" "ai_contract_rejection_capture_status" NOT NULL,
	"encrypted_output" text,
	"raw_expires_at" timestamp with time zone NOT NULL,
	"metadata_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_contract_rejections_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "ai_contract_rejections_attempt_check" CHECK ("ai_contract_rejections"."attempt" >= 1),
	CONSTRAINT "ai_contract_rejections_issues_check" CHECK (jsonb_typeof("ai_contract_rejections"."issues") = 'array' and jsonb_array_length("ai_contract_rejections"."issues") > 0),
	CONSTRAINT "ai_contract_rejections_output_sha256_check" CHECK ("ai_contract_rejections"."output_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "ai_contract_rejections_output_bytes_check" CHECK ("ai_contract_rejections"."output_bytes" >= 0),
	CONSTRAINT "ai_contract_rejections_turn_inbound_check" CHECK ("ai_contract_rejections"."turn_id" = "ai_contract_rejections"."inbound_event_id"::text),
	CONSTRAINT "ai_contract_rejections_retention_check" CHECK ("ai_contract_rejections"."created_at" <= "ai_contract_rejections"."raw_expires_at" and "ai_contract_rejections"."raw_expires_at" <= "ai_contract_rejections"."metadata_expires_at"),
	CONSTRAINT "ai_contract_rejections_ciphertext_status_check" CHECK ((
        ("ai_contract_rejections"."capture_status" = 'stored' and "ai_contract_rejections"."encrypted_output" is not null)
        or
        ("ai_contract_rejections"."capture_status" <> 'stored' and "ai_contract_rejections"."encrypted_output" is null)
      ))
);
--> statement-breakpoint
ALTER TABLE "ai_contract_rejection_access_audits" ADD CONSTRAINT "ai_contract_rejection_access_audits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_contract_rejection_access_audits" ADD CONSTRAINT "ai_contract_rejection_access_audits_rejection_org_fk" FOREIGN KEY ("rejection_id","organization_id") REFERENCES "public"."ai_contract_rejections"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_contract_rejections" ADD CONSTRAINT "ai_contract_rejections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_contract_rejections" ADD CONSTRAINT "ai_contract_rejections_conversation_org_fk" FOREIGN KEY ("conversation_id","organization_id") REFERENCES "public"."conversations"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_contract_rejections" ADD CONSTRAINT "ai_contract_rejections_inbound_event_org_fk" FOREIGN KEY ("inbound_event_id","organization_id") REFERENCES "public"."inbound_events"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_contract_rejection_access_audits_rejection_accessed_idx" ON "ai_contract_rejection_access_audits" USING btree ("organization_id","rejection_id","accessed_at");--> statement-breakpoint
CREATE INDEX "ai_contract_rejection_access_audits_expires_at_idx" ON "ai_contract_rejection_access_audits" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_contract_rejections_dedupe_unique" ON "ai_contract_rejections" USING btree ("organization_id","turn_id","stage","output_sha256");--> statement-breakpoint
CREATE INDEX "ai_contract_rejections_org_created_at_idx" ON "ai_contract_rejections" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_contract_rejections_org_turn_created_at_idx" ON "ai_contract_rejections" USING btree ("organization_id","turn_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_contract_rejections_raw_expiry_idx" ON "ai_contract_rejections" USING btree ("raw_expires_at") WHERE "ai_contract_rejections"."encrypted_output" is not null;--> statement-breakpoint
CREATE INDEX "ai_contract_rejections_metadata_expiry_idx" ON "ai_contract_rejections" USING btree ("metadata_expires_at");