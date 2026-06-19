-- Sistema de módulos plug-and-play: substitui booleans soltos em clinics
-- por uma tabela normalizada com controle de plano e config por módulo.
CREATE TABLE "clinic_modules" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "clinic_id"  UUID NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "module_key" TEXT NOT NULL,
  "is_active"  BOOLEAN NOT NULL DEFAULT true,
  "config"     JSONB,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updated_by" TEXT,
  UNIQUE ("clinic_id", "module_key")
);

CREATE INDEX "idx_clinic_modules_clinic" ON "clinic_modules" ("clinic_id") WHERE "is_active" = true;

-- Migrar voice_tts para clínicas com voiceResponseEnabled = true
INSERT INTO "clinic_modules" ("clinic_id", "module_key", "is_active", "config", "updated_by")
SELECT
  "id",
  'voice_tts',
  true,
  jsonb_build_object(
    'provider', COALESCE(("tts_config"->>'provider'), 'nova'),
    'voice',    COALESCE("tts_voice", 'nova'),
    'speed',    COALESCE(("tts_config"->>'speed')::numeric, 1.0)
  ),
  'migration_0029'
FROM "clinics"
WHERE "voice_response_enabled" = true;

-- Migrar menu_mode para clínicas com conversation_experience = 'menu_first' ou null
INSERT INTO "clinic_modules" ("clinic_id", "module_key", "is_active", "updated_by")
SELECT "id", 'menu_mode', true, 'migration_0029'
FROM "clinics"
WHERE "conversation_experience" = 'menu_first' OR "conversation_experience" IS NULL;

-- Migrar concierge_mode para clínicas com conversation_experience = 'concierge'
INSERT INTO "clinic_modules" ("clinic_id", "module_key", "is_active", "updated_by")
SELECT "id", 'concierge_mode', true, 'migration_0029'
FROM "clinics"
WHERE "conversation_experience" = 'concierge';

-- Ativar módulos base para clínicas nos planos clinica/rede
INSERT INTO "clinic_modules" ("clinic_id", "module_key", "is_active", "updated_by")
SELECT c."id", m."module_key", true, 'migration_0029'
FROM "clinics" c
CROSS JOIN (VALUES
  ('video_library'), ('ai_co_writer'), ('revenue_pipeline'), ('team_roles')
) AS m("module_key")
WHERE c."plan" IN ('clinica', 'rede')
ON CONFLICT ("clinic_id", "module_key") DO NOTHING;

-- voice_elevenlabs apenas para plano rede
INSERT INTO "clinic_modules" ("clinic_id", "module_key", "is_active", "updated_by")
SELECT c."id", 'voice_elevenlabs', true, 'migration_0029'
FROM "clinics" c
WHERE c."plan" = 'rede'
ON CONFLICT ("clinic_id", "module_key") DO NOTHING;
