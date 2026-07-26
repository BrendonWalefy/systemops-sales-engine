import { sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { playbookVersions } from "@/infrastructure/db/schema";

type NewActivePlaybook = Omit<
  typeof playbookVersions.$inferInsert,
  "status" | "updatedAt"
>;

/**
 * Ativa uma versão existente sem expor um intervalo sem playbook ativo.
 *
 * É uma única instrução SQL: o alvo é bloqueado, as outras versões ativas são
 * arquivadas e só então o alvo é ativado. Se o alvo não existir ou não pertencer
 * à clínica, nenhuma versão é arquivada. O índice parcial único no schema é a
 * última barreira contra duas ativações concorrentes.
 */
export async function activateExistingPlaybookVersion(input: {
  clinicId: string;
  versionId: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const result = await db.execute(sql`
    with target as (
      select id
      from playbook_versions
      where id = ${input.versionId}
        and organization_id = ${input.clinicId}
      for update
    ), archived as (
      update playbook_versions
      set status = 'historical', updated_at = ${now}
      where organization_id = ${input.clinicId}
        and status = 'active'
        and id not in (select id from target)
        and exists (select 1 from target)
    )
    update playbook_versions as version
    set status = 'active', updated_at = ${now}
    from target
    where version.id = target.id
    returning version.id
  `);

  if (result.rows.length !== 1) {
    throw new Error("Playbook não encontrado para ativação nesta clínica.");
  }
}

/**
 * Publica uma nova versão pelo Advisor. `db.batch` é uma transação do driver
 * Neon HTTP: falha do insert (inclusive conflito concorrente no índice único)
 * desfaz o arquivamento anterior.
 */
export async function publishNewActivePlaybook(
  version: NewActivePlaybook,
  now = new Date(),
): Promise<void> {
  await db.batch([
    db.execute(sql`
      update playbook_versions
      set status = 'historical', updated_at = ${now}
      where organization_id = ${version.clinicId}
        and status = 'active'
    `),
    db.insert(playbookVersions).values({
      ...version,
      status: "active",
      updatedAt: now,
    }),
  ]);
}
