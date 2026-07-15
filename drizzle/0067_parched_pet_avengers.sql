CREATE TYPE "public"."conversation_review_status" AS ENUM('draft', 'sent', 'answered', 'expired');--> statement-breakpoint
CREATE TABLE "conversation_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "conversation_review_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"excerpts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overall_comment" text,
	"access_token_hash" text,
	"sent_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_reviews" ADD CONSTRAINT "conversation_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_reviews_org_status_idx" ON "conversation_reviews" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "conversation_reviews_org_created_at_idx" ON "conversation_reviews" USING btree ("organization_id","created_at");