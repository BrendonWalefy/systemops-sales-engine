ALTER TABLE "conversations" ADD COLUMN "needs_attention" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "attention_reason" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "consecutive_unclear_count" integer DEFAULT 0 NOT NULL;