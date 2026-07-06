"use server";

import { db } from "@/infrastructure/db/client";
import { setupStudies } from "@/infrastructure/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { buildCorpus } from "@/application/setup-study/build-corpus";
import { extractFindings } from "@/application/setup-study/extract-findings";

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
    findings: findings as unknown, // jsonb casting
  });

  revalidatePath(`/owner/clinics/${clinicId}`);
}
