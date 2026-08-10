import { and, eq, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinicReadVersions } from "@/infrastructure/db/schema";

export type ClinicReadResource = "inbox";

/**
 * Marca que o `resource` de uma clínica mudou, para invalidar o read model
 * materializado que a Task 6 vai consumir no lugar das quatro agregações do
 * poll da inbox.
 *
 * Upsert de statement único: neon-http não tem transação interativa, então
 * ler-e-escrever perderia bumps concorrentes (dois writes na mesma janela
 * fariam um sobrescrever o outro). O incremento é calculado pelo Postgres
 * (`version + 1` na cláusula SET), nunca em JavaScript.
 */
export async function bumpClinicReadVersion(
  clinicId: string,
  resource: ClinicReadResource,
): Promise<void> {
  await db
    .insert(clinicReadVersions)
    .values({ clinicId, resource, version: 1 })
    .onConflictDoUpdate({
      target: [clinicReadVersions.clinicId, clinicReadVersions.resource],
      set: {
        version: sql`${clinicReadVersions.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Lê a versão atual de um recurso da clínica. É um sinal de invalidação puro
 * — nunca carrega conteúdo de conversa, nome, telefone ou dado clínico.
 * "0" quando a clínica ainda não teve nenhum bump para este recurso.
 */
export async function readClinicVersion(
  clinicId: string,
  resource: ClinicReadResource,
): Promise<string> {
  const [row] = await db
    .select({ version: clinicReadVersions.version })
    .from(clinicReadVersions)
    .where(and(eq(clinicReadVersions.clinicId, clinicId), eq(clinicReadVersions.resource, resource)))
    .limit(1);

  return String(row?.version ?? 0);
}

/**
 * Dispara o bump do recurso "inbox" em fire-and-forget: o chamador nunca
 * espera por isto e uma falha aqui nunca pode derrubar a escrita real (a
 * mensagem, o lead, o agendamento). Um bump perdido só degrada para o teto
 * de 60s da escada de polling — não perde dado.
 *
 * Helper único para os ~9 call sites de escrita (Task 6) em vez de repetir o
 * `void ... .catch()` em cada arquivo.
 */
export function bumpInboxVersion(clinicId: string): void {
  void bumpClinicReadVersion(clinicId, "inbox").catch(() => {
    // Invalidação é best-effort; a escada de polling cobre uma falha.
  });
}
