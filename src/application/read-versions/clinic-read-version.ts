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
