ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "ai_resumed_at" timestamp with time zone;
