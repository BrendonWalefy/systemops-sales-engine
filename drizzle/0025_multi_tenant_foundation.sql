-- ── Multi-tenant: identificação e roteamento por clínica ──

-- enum de papel de membro
DO $$ BEGIN
  CREATE TYPE "member_role" AS ENUM ('owner', 'clinic_admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- colunas em clinics
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "slug" text;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "channel_provider" "whatsapp_provider";
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "zapi_instance_id" text;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "zapi_token" text;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "zapi_client_token" text;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "meta_phone_number_id" text;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "meta_access_token" text;

-- Índices ÚNICOS PARCIAIS: garantem que dois clientes não compartilhem
-- o mesmo canal/slug, mas ignoram nulos (clínicas ainda em env-fallback).
CREATE UNIQUE INDEX IF NOT EXISTS "clinics_slug_uidx"
  ON "clinics" ("slug") WHERE "slug" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "clinics_zapi_instance_uidx"
  ON "clinics" ("zapi_instance_id") WHERE "zapi_instance_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "clinics_meta_phone_uidx"
  ON "clinics" ("meta_phone_number_id") WHERE "meta_phone_number_id" IS NOT NULL;

-- tabela de membros (usuário -> clínica)
CREATE TABLE IF NOT EXISTS "clinic_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL REFERENCES "clinics"("id"),
  "email" text NOT NULL,
  "role" "member_role" NOT NULL DEFAULT 'clinic_admin',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_members_email_clinic_idx"
  ON "clinic_members" ("email", "clinic_id");
CREATE INDEX IF NOT EXISTS "clinic_members_email_idx"
  ON "clinic_members" ("email");

-- Backfill da clínica piloto: dá um slug e vincula o(s) admin(s) atuais.
-- Ajuste 'piloto' se quiser outro slug. ADMIN_EMAIL é setado fora do banco,
-- então o vínculo do admin é feito pelo script de onboarding/seed, não aqui.
UPDATE "clinics" SET "slug" = 'piloto'
  WHERE "slug" IS NULL
    AND "id" = (SELECT "id" FROM "clinics" ORDER BY "created_at" ASC LIMIT 1);
