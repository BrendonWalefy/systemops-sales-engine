CREATE TYPE "public"."conversation_engine" AS ENUM('v1', 'v1_with_v2_shadow', 'v2_internal');--> statement-breakpoint
CREATE TABLE "conversation_v2_comparisons" (
	"turn_ref" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"record" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "conversation_engine" "conversation_engine" DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_v2_comparisons" ADD CONSTRAINT "conversation_v2_comparisons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_v2_comparisons_org_occurred_at_idx" ON "conversation_v2_comparisons" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "conversation_v2_comparisons_expires_at_idx" ON "conversation_v2_comparisons" USING btree ("expires_at");