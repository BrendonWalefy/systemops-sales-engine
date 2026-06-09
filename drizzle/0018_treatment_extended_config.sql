ALTER TABLE treatments
  ADD COLUMN IF NOT EXISTS trigger_template text,
  ADD COLUMN IF NOT EXISTS keyword_match_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_aesthetic boolean NOT NULL DEFAULT false;
