ALTER TYPE "public"."whatsapp_provider" ADD VALUE 'waha';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "waha_base_url" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "waha_api_key" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "waha_session" text;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_waha_session_unique" ON "organizations" USING btree ("waha_session") WHERE "organizations"."waha_session" is not null and btrim("organizations"."waha_session") <> '';