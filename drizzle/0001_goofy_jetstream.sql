ALTER TYPE "public"."whatsapp_provider" ADD VALUE 'z_api';--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "auto_reply_enabled" boolean DEFAULT false NOT NULL;