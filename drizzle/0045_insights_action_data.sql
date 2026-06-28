ALTER TABLE "clinic_operational_insights"
  ADD COLUMN IF NOT EXISTS "action_data" jsonb,
  ADD COLUMN IF NOT EXISTS "conv_ids" jsonb;
