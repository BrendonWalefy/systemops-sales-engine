CREATE TYPE "public"."setup_study_status" AS ENUM('draft', 'sent', 'answered', 'applied', 'expired');--> statement-breakpoint
CREATE TABLE "setup_studies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "setup_study_status" DEFAULT 'draft' NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"access_token_hash" text,
	"sent_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "setup_studies" ADD CONSTRAINT "setup_studies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "setup_studies_org_status_idx" ON "setup_studies" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "setup_studies_org_created_at_idx" ON "setup_studies" USING btree ("organization_id","created_at");