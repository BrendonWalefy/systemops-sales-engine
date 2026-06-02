-- Coluna para orientação livre, agora ancorada na versão ativa do playbook
-- (deixa de morar em clinics.playbook).
ALTER TABLE "playbook_versions" ADD COLUMN IF NOT EXISTS "notes" text;

-- Backfill: garante que toda clínica com conteúdo editorial em `clinics`
-- tenha uma versão ATIVA em playbook_versions, para a produção (que passa a
-- ler da versão ativa) ter algo no dia 1. Só cria se a clínica ainda não
-- tiver nenhuma versão ativa.
INSERT INTO "playbook_versions"
  ("clinic_id", "name", "status", "specialty", "procedure_description",
   "tone_of_voice", "commercial_policy", "notes", "differentials", "objections")
SELECT
  c."id",
  'Migrado de clinics',
  'active',
  c."specialty",
  '',
  COALESCE(c."tone_of_voice", 'acolhedor'),
  c."commercial_policy",
  c."playbook",
  '[]'::jsonb,
  '[]'::jsonb
FROM "clinics" c
WHERE NOT EXISTS (
  SELECT 1 FROM "playbook_versions" pv
  WHERE pv."clinic_id" = c."id" AND pv."status" = 'active'
);

-- NOTA: as colunas editoriais de clinics (playbook, commercial_policy,
-- tone_of_voice) NÃO são removidas aqui de propósito — a remoção é um passo
-- separado, depois de confirmar em produção que nada mais as lê.
