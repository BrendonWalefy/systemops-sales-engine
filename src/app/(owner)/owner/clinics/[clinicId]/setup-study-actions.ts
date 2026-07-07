"use server";

import { db } from "@/infrastructure/db/client";
import { setupStudies, treatments } from "@/infrastructure/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { buildCorpus } from "@/application/setup-study/build-corpus";
import { extractFindings } from "@/application/setup-study/extract-findings";
import { generateAccessToken } from "@/application/setup-study/access-token";
import {
  resolveFindingApplication,
  executeApplyPlan,
  hasAppliableFindings,
} from "@/application/setup-study/apply-finding";
import type { SetupFinding } from "@/domain/entities/setup-study";

/** Validade do link público de validação (ADR-002 Fase 2). */
const VALIDATION_LINK_TTL_DAYS = 7;

/** Base pública do app — o link é montado pelo owner e enviado ao cliente. */
function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.systemops.com.br";
}

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
export async function generateSetupStudy(clinicId: string): Promise<{ error?: string }> {
  try {
    await assertOwnerSession();

    // 1. Constrói o corpus anonimizado
    const transcript = await buildCorpus(clinicId);

    // Se não houver conversas suficientes, podemos lançar um erro informativo
    if (transcript.conversationCount === 0) {
      return { error: "Não há conversas suficientes no período para gerar o estudo." };
    }

    // 2. Catálogo da clínica — permite ao LLM propor targets treatment:<uuid> reais
    const clinicTreatments = await db
      .select({ id: treatments.id, name: treatments.name, priceCents: treatments.priceCents })
      .from(treatments)
      .where(eq(treatments.clinicId, clinicId));

    // 3. Extrai findings usando o LLM (lança erro se a resposta for inválida)
    const findings = await extractFindings(transcript, { treatments: clinicTreatments });

    // 4. Só depois da extração dar certo: expira o rascunho anterior e salva o novo.
    //    Na ordem inversa, uma falha do LLM destruía o draft existente.
    await db
      .update(setupStudies)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(setupStudies.organizationId, clinicId),
          eq(setupStudies.status, "draft")
        )
      );

    await db.insert(setupStudies).values({
      organizationId: clinicId,
      status: "draft",
      findings,
    });

    revalidatePath(`/owner/clinics/${clinicId}`);
    return {};
  } catch (err: unknown) {
    return { error: (err as Error).message || "Erro interno ao gerar o estudo." };
  }
}

/**
 * ADR-002 Fase 2: aprova o rascunho e o envia para validação do cliente.
 *
 * Gera um token de acesso (32 bytes), grava **apenas o hash** no estudo, muda
 * o status para "sent" e define validade de 7 dias. Retorna o token/URL crus
 * **uma única vez** (padrão API key) — o owner copia o link e envia ao
 * responsável da clínica por WhatsApp. Owner-only; só age em estudo "draft" da
 * própria clínica com ao menos um finding.
 */
export async function sendSetupStudyForValidation(
  clinicId: string,
  studyId: string,
): Promise<{ token: string; url: string; expiresAt: string }> {
  await assertOwnerSession();

  const findings = await loadDraftFindings(clinicId, studyId);
  if (!findings) throw new Error("Estudo não encontrado ou não editável.");
  if (findings.length === 0) {
    throw new Error("Adicione ou mantenha ao menos um apontamento antes de enviar.");
  }

  const { token, hash } = generateAccessToken();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + VALIDATION_LINK_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  // Escopo por clinicId da rota + status draft: não sobrescreve um estudo já
  // enviado nem de outra clínica.
  const updated = await db
    .update(setupStudies)
    .set({
      status: "sent",
      accessTokenHash: hash,
      sentAt: now,
      expiresAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(setupStudies.id, studyId),
        eq(setupStudies.organizationId, clinicId),
        eq(setupStudies.status, "draft"),
      ),
    )
    .returning({ id: setupStudies.id });

  if (updated.length === 0) {
    throw new Error("Estudo não encontrado ou já enviado.");
  }

  revalidatePath(`/owner/clinics/${clinicId}`);

  return {
    token,
    url: `${appBaseUrl()}/validacao/${token}`,
    expiresAt: expiresAt.toISOString(),
  };
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

/**
 * Lê os findings de um estudo respondido/em aplicação (Fase 3), garantindo
 * tenant. Retorna null se não existir ou não estiver aplicável.
 */
async function loadAnsweredStudy(
  clinicId: string,
  studyId: string,
): Promise<{ id: string; findings: SetupFinding[] } | null> {
  const study = await db.query.setupStudies.findFirst({
    where: and(
      eq(setupStudies.id, studyId),
      eq(setupStudies.organizationId, clinicId),
      inArray(setupStudies.status, ["answered", "applied"]),
    ),
  });
  if (!study) return null;
  return { id: study.id, findings: (study.findings ?? []) as SetupFinding[] };
}

/**
 * ADR-002 Fase 3: aplica um único finding validado à config da clínica.
 *
 * Resolve o plano determinístico (`resolveFindingApplication`, respeitando a
 * allowlist), executa a escrita **escopada pelo clinicId da rota** e grava a
 * trilha de auditoria (`applied`) no próprio jsonb. Quando não resta mais nada
 * aplicável, o estudo vira "applied" (terminal). Owner-only.
 */
export async function applySetupFinding(
  clinicId: string,
  studyId: string,
  findingId: string,
) {
  await assertOwnerSession();

  const study = await loadAnsweredStudy(clinicId, studyId);
  if (!study) throw new Error("Estudo não encontrado ou não aplicável.");

  const finding = study.findings.find((f) => f.id === findingId);
  if (!finding) throw new Error("Apontamento não encontrado.");
  if (finding.applied) throw new Error("Este apontamento já foi aplicado.");
  if (!finding.answer) throw new Error("Apontamento ainda não respondido pelo cliente.");

  const plan = resolveFindingApplication(finding);
  const summary = await executeApplyPlan(clinicId, plan);
  if (summary === null) {
    throw new Error("Nada a aplicar automaticamente neste apontamento (informativo).");
  }

  // Grava a trilha de auditoria no finding.
  const appliedAt = new Date().toISOString();
  const nextFindings = study.findings.map((f) =>
    f.id === findingId ? { ...f, applied: { at: appliedAt, summary } } : f,
  );

  // Se não resta mais nenhum finding aplicável, fecha o estudo como "applied".
  const stillAppliable = hasAppliableFindings(nextFindings);

  await db
    .update(setupStudies)
    .set({
      findings: nextFindings,
      ...(stillAppliable ? {} : { status: "applied" as const }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(setupStudies.id, studyId),
        eq(setupStudies.organizationId, clinicId),
        inArray(setupStudies.status, ["answered", "applied"]),
      ),
    );

  revalidatePath(`/owner/clinics/${clinicId}`);
}

/**
 * ADR-002 Fase 3: encerra manualmente o estudo (answered → applied) sem mais
 * escritas — usado quando só restam findings informativos ou o owner decide
 * parar. Owner-only.
 */
export async function finalizeSetupStudy(clinicId: string, studyId: string) {
  await assertOwnerSession();

  const updated = await db
    .update(setupStudies)
    .set({ status: "applied", updatedAt: new Date() })
    .where(
      and(
        eq(setupStudies.id, studyId),
        eq(setupStudies.organizationId, clinicId),
        eq(setupStudies.status, "answered"),
      ),
    )
    .returning({ id: setupStudies.id });

  if (updated.length === 0) throw new Error("Estudo não encontrado ou já encerrado.");

  revalidatePath(`/owner/clinics/${clinicId}`);
}
