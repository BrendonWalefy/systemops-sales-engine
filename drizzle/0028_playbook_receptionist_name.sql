-- P1.5: receptionistName explícito no schema editorial
-- Antes era hardcoded "Marina" na validação e derivado de greetingMessage no runtime.
-- Agora é campo editável direto na versão do playbook.
ALTER TABLE "playbook_versions"
  ADD COLUMN "receptionist_name" TEXT NOT NULL DEFAULT 'Marina';
