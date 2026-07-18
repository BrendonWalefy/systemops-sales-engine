ALTER TABLE "organizations" ADD COLUMN "deposit_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deposit_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deposit_pix_key" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deposit_pix_key_type" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deposit_recipient_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deposit_ttl_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deposit_notes" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deposit_confirmation_notes" text;