ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS rate_limit_per_hour integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS unclear_threshold integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS stale_conversation_hours integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS slot_offer_ttl_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS max_slots_to_offer integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS slot_lookahead_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS media_takeover_ttl_hours integer,
  ADD COLUMN IF NOT EXISTS rapid_throttle_ms integer NOT NULL DEFAULT 4000;
