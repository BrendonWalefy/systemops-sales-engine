ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "voice_response_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "tts_voice" text DEFAULT 'nova' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "media_url" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "media_type" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "delivery_format" text;--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD COLUMN IF NOT EXISTS "media_library" jsonb DEFAULT '[]'::jsonb NOT NULL;
