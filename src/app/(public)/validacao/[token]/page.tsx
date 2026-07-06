/**
 * Página pública de validação do estudo de setup (ADR-002 Fase 2).
 *
 * Sem login, sem cookie, sem `clinicId` na URL: o estudo é resolvido apenas
 * pelo hash sha256 do token. O responsável da clínica abre o link pelo celular,
 * confirma ou corrige cada apontamento e conclui. As evidências já vêm
 * anonimizadas da Fase 1 — nenhum dado de paciente chega aqui.
 */

import { db } from "@/infrastructure/db/client";
import { setupStudies } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import {
  hashAccessToken,
  resolveStudyState,
} from "@/application/setup-study/access-token";
import type { SetupFinding } from "@/domain/entities/setup-study";
import { ValidationForm } from "./validacao-ui";
import { StateScreen } from "./state-screen";

export const dynamic = "force-dynamic";

export default async function ValidacaoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const study = await db.query.setupStudies.findFirst({
    where: eq(setupStudies.accessTokenHash, hashAccessToken(token)),
  });

  const state = resolveStudyState(study, new Date());

  if (state === "expired") {
    return (
      <StateScreen
        emoji="⌛"
        title="Este link expirou"
        message="O prazo para validar este estudo terminou. Fale com a equipe da SystemOps para gerar um novo link."
      />
    );
  }
  if (state === "answered") {
    return (
      <StateScreen
        emoji="✅"
        title="Validação concluída"
        message="Obrigado! Suas respostas já foram enviadas. Não é preciso fazer mais nada — a equipe vai revisar e aplicar os ajustes."
      />
    );
  }
  if (state !== "valid" || !study) {
    return (
      <StateScreen
        emoji="🔗"
        title="Link inválido"
        message="Não encontramos este estudo. Confira se copiou o link completo ou peça um novo à equipe da SystemOps."
      />
    );
  }

  const findings = (study.findings ?? []) as SetupFinding[];

  return <ValidationForm token={token} findings={findings} />;
}
