ALTER TABLE treatments
  ADD COLUMN IF NOT EXISTS pipeline_steps jsonb;
