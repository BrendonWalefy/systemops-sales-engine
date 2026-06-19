-- Revenue Pipeline + Access Control
-- Adiciona: roles granulares, professionalId em membros, preços em tratamentos,
-- treatmentId/valueCents em agendamentos, serviceNoun/segment em clínicas.

-- 1. Novos roles de membro
ALTER TYPE "member_role" ADD VALUE IF NOT EXISTS 'receptionist';
ALTER TYPE "member_role" ADD VALUE IF NOT EXISTS 'professional';

-- 2. Link do membro ao profissional
ALTER TABLE "clinic_members"
  ADD COLUMN IF NOT EXISTS "professional_id" UUID REFERENCES "professionals"("id");

-- 3. Preço nos tratamentos
ALTER TABLE "treatments"
  ADD COLUMN IF NOT EXISTS "price_cents" INTEGER,
  ADD COLUMN IF NOT EXISTS "min_price_cents" INTEGER,
  ADD COLUMN IF NOT EXISTS "max_price_cents" INTEGER;

-- 4. Tratamento e valor no agendamento
ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "treatment_id" UUID REFERENCES "treatments"("id"),
  ADD COLUMN IF NOT EXISTS "value_cents" INTEGER;

-- 5. Terminologia e segmento por clínica (multi-segmento)
ALTER TABLE "clinics"
  ADD COLUMN IF NOT EXISTS "service_noun" TEXT NOT NULL DEFAULT 'tratamento',
  ADD COLUMN IF NOT EXISTS "segment" TEXT NOT NULL DEFAULT 'dental';
