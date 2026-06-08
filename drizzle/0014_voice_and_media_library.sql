ALTER TABLE "clinics" ADD COLUMN "voice_response_enabled" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD COLUMN "media_library" jsonb NOT NULL DEFAULT '[]'::jsonb;
