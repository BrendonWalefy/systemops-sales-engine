"use server";

/**
 * Server actions da página pública de validação (ADR-002 Fase 2).
 *
 * SEGURANÇA / MULTI-TENANT:
 * - O estudo é resolvido **exclusivamente** pelo hash sha256 do token. Nem
 *   `clinicId` nem `studyId` trafegam na URL ou no payload — o cliente só
 *   conhece o token cru.
 * - Rate limit dispensado na v1: o token tem 256 bits de entropia, tornando
 *   brute-force inviável (decisão registrada no ADR-002, apêndice G).
 * - Só age em estudo com status "sent" e dentro da validade. Estudo em draft,
 *   expirado ou já respondido não é mutável por aqui.
 */

import { db } from "@/infrastructure/db/client";
import { setupStudies } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import {
  hashAccessToken,
  resolveStudyState,
} from "@/application/setup-study/access-token";
import { allFindingsAnswered } from "@/application/setup-study/apply-finding";
import type {
  SetupFinding,
  SetupFindingAnswer,
} from "@/domain/entities/setup-study";

/** Erro de negócio genérico da página pública (sem vazar detalhes de tenant). */
class ValidationError extends Error {}

/** Resolve o estudo "sent" e navegável a partir do token cru. */
async function loadOpenStudyByToken(token: string): Promise<{
  id: string;
  findings: SetupFinding[];
}> {
  const hash = hashAccessToken(token);
  const study = await db.query.setupStudies.findFirst({
    where: eq(setupStudies.accessTokenHash, hash),
  });

  const state = resolveStudyState(study, new Date());
  if (state !== "valid" || !study) {
    throw new ValidationError(
      state === "expired"
        ? "Este link expirou."
        : state === "answered"
          ? "Esta validação já foi concluída."
          : "Link inválido.",
    );
  }

  return { id: study.id, findings: (study.findings ?? []) as SetupFinding[] };
}

/**
 * Salva a resposta de um único finding (POST parcial, idempotente). O cliente
 * confirma ("confirmed") ou reescreve o apontamento ("corrected" + texto).
 */
export async function answerFinding(
  token: string,
  findingId: string,
  input: { status: "confirmed" | "corrected"; correction?: string },
): Promise<void> {
  if (input.status !== "confirmed" && input.status !== "corrected") {
    throw new ValidationError("Resposta inválida.");
  }
  const correction =
    input.status === "corrected" ? (input.correction ?? "").trim().slice(0, 1000) : undefined;
  if (input.status === "corrected" && !correction) {
    throw new ValidationError("Escreva a correção antes de salvar.");
  }

  const study = await loadOpenStudyByToken(token);

  const target = study.findings.find((f) => f.id === findingId);
  if (!target) throw new ValidationError("Apontamento não encontrado.");

  const answer: SetupFindingAnswer = {
    status: input.status,
    ...(correction ? { correction } : {}),
    answeredAt: new Date().toISOString(),
  };

  const nextFindings = study.findings.map((f) =>
    f.id === findingId ? { ...f, answer } : f,
  );

  // Guarda defensiva de status no WHERE (além da checagem na leitura): evita
  // gravar num estudo que saiu de "sent" entre a leitura e a escrita (TOCTOU).
  await db
    .update(setupStudies)
    .set({ findings: nextFindings, updatedAt: new Date() })
    .where(and(eq(setupStudies.id, study.id), eq(setupStudies.status, "sent")));
}

/**
 * Conclui a validação: exige que todos os findings tenham resposta e move o
 * estudo para "answered", carimbando `answered_at`. Idempotente do ponto de
 * vista do cliente (se já foi concluído, a página mostra o estado "concluído").
 */
export async function concludeValidation(token: string): Promise<void> {
  const study = await loadOpenStudyByToken(token);

  if (!allFindingsAnswered(study.findings)) {
    throw new ValidationError(
      "Responda todos os apontamentos antes de concluir.",
    );
  }

  await db
    .update(setupStudies)
    .set({ status: "answered", answeredAt: new Date(), updatedAt: new Date() })
    .where(and(eq(setupStudies.id, study.id), eq(setupStudies.status, "sent")));
}
