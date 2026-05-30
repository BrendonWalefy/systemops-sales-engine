ALTER TABLE "clinics" ADD COLUMN "greeting_message" text;--> statement-breakpoint
ALTER TABLE "treatments" ADD COLUMN "requires_evaluation_first" boolean DEFAULT false NOT NULL;