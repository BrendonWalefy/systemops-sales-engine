ALTER TABLE "clinics" ADD COLUMN "voice_response_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "tts_voice" text DEFAULT 'nova' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media_url" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media_type" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "delivery_format" text;--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD COLUMN "media_library" jsonb DEFAULT '[]'::jsonb NOT NULL;