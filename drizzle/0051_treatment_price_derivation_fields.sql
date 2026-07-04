ALTER TABLE "treatments" ADD COLUMN "price_quotable_in_chat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "treatments" ADD COLUMN "price_kind" text DEFAULT 'from' NOT NULL;--> statement-breakpoint
ALTER TABLE "treatments" ADD COLUMN "price_unit" text;--> statement-breakpoint
ALTER TABLE "treatments" ADD COLUMN "price_deductible" boolean DEFAULT false NOT NULL;