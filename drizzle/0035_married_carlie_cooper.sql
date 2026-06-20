CREATE TYPE "public"."conversation_category" AS ENUM('sales', 'operational', 'vendor', 'spam', 'archived');--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "category" "conversation_category" DEFAULT 'sales' NOT NULL;--> statement-breakpoint
CREATE INDEX "conversations_clinic_category_idx" ON "conversations" USING btree ("clinic_id","category");