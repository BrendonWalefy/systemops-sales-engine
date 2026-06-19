-- Remove colunas legacy de voz e experiência da tabela clinics.
-- Dados já migrados para clinic_modules na migration 0029.
ALTER TABLE "clinics" DROP COLUMN IF EXISTS "voice_response_enabled";
ALTER TABLE "clinics" DROP COLUMN IF EXISTS "tts_voice";
ALTER TABLE "clinics" DROP COLUMN IF EXISTS "tts_config";
ALTER TABLE "clinics" DROP COLUMN IF EXISTS "conversation_experience";
