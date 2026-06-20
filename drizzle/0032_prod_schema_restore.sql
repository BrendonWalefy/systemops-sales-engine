-- Emergency production schema restore.
-- Restores objects expected by main that are missing in production.

ALTER TYPE "member_role" ADD VALUE IF NOT EXISTS 'receptionist';
ALTER TYPE "member_role" ADD VALUE IF NOT EXISTS 'professional';

ALTER TABLE "clinic_members"
  ADD COLUMN IF NOT EXISTS "professional_id" UUID REFERENCES "professionals"("id");

ALTER TABLE "treatments"
  ADD COLUMN IF NOT EXISTS "price_cents" INTEGER,
  ADD COLUMN IF NOT EXISTS "min_price_cents" INTEGER,
  ADD COLUMN IF NOT EXISTS "max_price_cents" INTEGER;

ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "treatment_id" UUID REFERENCES "treatments"("id"),
  ADD COLUMN IF NOT EXISTS "value_cents" INTEGER;

ALTER TABLE "clinics"
  ADD COLUMN IF NOT EXISTS "service_noun" TEXT NOT NULL DEFAULT 'tratamento',
  ADD COLUMN IF NOT EXISTS "segment" TEXT NOT NULL DEFAULT 'dental';

CREATE TABLE IF NOT EXISTS "clinic_modules" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "clinic_id" UUID NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "module_key" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "config" JSONB,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updated_by" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "clinic_modules_clinic_module_key_idx"
  ON "clinic_modules" ("clinic_id", "module_key");

CREATE INDEX IF NOT EXISTS "idx_clinic_modules_clinic"
  ON "clinic_modules" ("clinic_id");

INSERT INTO "clinic_modules" ("clinic_id", "module_key", "is_active", "updated_by")
SELECT c."id", m."module_key", true, 'migration_0032'
FROM "clinics" c
CROSS JOIN (VALUES
  ('video_library'),
  ('ai_co_writer'),
  ('revenue_pipeline'),
  ('team_roles')
) AS m("module_key")
WHERE c."plan" IN ('clinica', 'rede')
ON CONFLICT DO NOTHING;
