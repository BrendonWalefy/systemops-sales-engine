ALTER TABLE "messages" ADD COLUMN "simulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "shadow_mode_enabled" boolean DEFAULT false NOT NULL;