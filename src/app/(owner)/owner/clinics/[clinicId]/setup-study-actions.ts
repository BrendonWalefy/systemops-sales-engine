"use server";

import { db } from "@/infrastructure/db/client";
import { setupStudies } from "@/infrastructure/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { buildCorpus } from "@/application/setup-study/build-corpus";
import { extractFindings } from "@/application/setup-study/extract-findings";
import type { SetupFinding } from "@/domain/entities/setup-study";

async function assertOwnerSession() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) throw new Error("Não autorizado");
  const session = await verifyToken(token);
  if (!session || session.role !== "owner") {
    throw new Error("Apenas o owner pode gerenciar estudos de setup");
  }
}

/**
 * Gera um novo estudo de setup para a clínica usando o shadow mode corpus.
 * Se já houver um draft, ele é expirado.
 */
export async function generateSetupStudy(clinicId: string) {
  await assertOwnerSession();

  // 1. Expira rascunhos anteriores
  await db
    .update(setupStudies)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(setupStudies.organizationId, clinicId),
        eq(setupStudies.status, "draft")
      )
    );

  // 2. Constrói o corpus anonimizado
  const transcript = await buildCorpus(clinicId);

  // Se não houver conversas suficientes, podemos lançar um erro informativo
  if (transcript.conversationCount === 0) {
    throw new Error("Não há conversas suficientes no período para gerar o estudo.");
  }

  // 3. Extrai findings usando o LLM
  const findings = await extractFindings(transcript);

  // 4. Salva no banco como draft
  await db.insert(setupStudies).values({
    organizationId: clinicId,
    status: "draft",
    findings,
  });

  revalidatePath(`/owner/clinics/${clinicId}`);
}

/**
 * Lê os findings de um estudo em rascunho, garantindo tenant (clinicId) e status.
 * Retorna null se não existir ou não for editável.
 */
async function loadDraftFindings(
  clinicId: string,
  studyId: string,
): Promise<SetupFinding[] | null> {
  const study = await db.query.setupStudies.findFirst({
    where: and(
      eq(setupStudies.id, studyId),
      eq(setupStudies.organizationId, clinicId),
      eq(setupStudies.status, "draft"),
    ),
  });
  if (!study) return null;
  return (study.findings ?? []) as SetupFinding[];
}

/**
 * Curadoria (ADR-002 Fase 1): remove um finding do rascunho antes de enviar
 * para validação. Owner-only; só mexe em estudo "draft" da própria clínica.
 */
export async function deleteSetupFinding(
  clinicId: string,
  studyId: string,
  findingId: string,
) {
  await assertOwnerSession();

  const findings = await loadDraftFindings(clinicId, studyId);
  if (!findings) throw new Error("Estudo não encontrado ou não editável.");

  const next = findings.filter((f) => f.id !== findingId);
  await db
    .update(setupStudies)
    .set({ findings: next, updatedAt: new Date() })
    .where(
      and(
        eq(setupStudies.id, studyId),
        eq(setupStudies.organizationId, clinicId),
        eq(setupStudies.status, "draft"),
      ),
    );

  revalidatePath(`/owner/clinics/${clinicId}`);
}

/**
 * Curadoria (ADR-002 Fase 1): edita o texto do claim de um finding. O owner
 * reescreve o que o LLM afirmou antes de o cliente validar. Owner-only; draft.
 */
export async function updateSetupFindingClaim(
  clinicId: string,
  studyId: string,
  findingId: string,
  claim: string,
) {
  await assertOwnerSession();

  const trimmed = claim.trim().slice(0, 280);
  if (!trimmed) throw new Error("O texto do apontamento não pode ficar vazio.");

  const findings = await loadDraftFindings(clinicId, studyId);
  if (!findings) throw new Error("Estudo não encontrado ou não editável.");

  const next = findings.map((f) =>
    f.id === findingId ? { ...f, claim: trimmed } : f,
  );
  await db
    .update(setupStudies)
    .set({ findings: next, updatedAt: new Date() })
    .where(
      and(
        eq(setupStudies.id, studyId),
        eq(setupStudies.organizationId, clinicId),
        eq(setupStudies.status, "draft"),
      ),
    );

  revalidatePath(`/owner/clinics/${clinicId}`);
}
