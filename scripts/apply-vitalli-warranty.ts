/**
 * Move a política de garantia da Vitalli do texto livre da objeção para o campo
 * estruturado (`playbook_versions.warranty_policy`).
 *
 * Fonte: a objeção cadastrada desde 07/07/2026, e as respostas que o operador deu
 * à mão em produção — "ela tem uma garantia de 2 anos caso essa lente descole por
 * inteira" (Paulinho, 08/07) e "Cobre o descolamento por completo da lente"
 * (Guilherme, 07/07).
 *
 * RODAR SÓ DEPOIS DO DEPLOY: a coluna nasce na migração 0081. O script confere e
 * aborta se ela ainda não existir.
 *
 * A objeção NÃO é removida de propósito: ela segue como fallback e continua sendo
 * o texto que a IA usa para as outras partes da mesma pergunta ("quanto tempo dura?
 * […] como é a manutenção?"). O campo estruturado só tem precedência na parte da
 * garantia.
 *
 *   npx dotenv -e .env.local -- tsx scripts/apply-vitalli-warranty.ts
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../src/infrastructure/db/client";
import { organizations, playbookVersions } from "../src/infrastructure/db/schema";

const WARRANTY = {
  offersWarranty: true,
  tiers: [
    { periodMonths: 24, covers: "a lente descolar por completo" },
    { periodMonths: 1, covers: "pigmentação ou quebra por descuido" },
  ],
  conditions: "é só trazer a lente descolada",
};

async function run() {
  const columnExists = await db.execute(sql`
    select 1 from information_schema.columns
    where table_name = 'playbook_versions' and column_name = 'warranty_policy'
  `);
  if (columnExists.rows.length === 0) {
    throw new Error("Coluna warranty_policy ainda não existe — rode a migração 0081 antes.");
  }

  const [clinic] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.slug, "clinica-vitalli"))
    .limit(1);
  if (!clinic) throw new Error("Clínica Vitalli não encontrada");

  const [active] = await db
    .select()
    .from(playbookVersions)
    .where(and(eq(playbookVersions.clinicId, clinic.id), eq(playbookVersions.status, "active")))
    .orderBy(desc(playbookVersions.createdAt))
    .limit(1);
  if (!active) throw new Error("Nenhuma versão de playbook ativa para a Vitalli");

  console.log(`${clinic.name} — playbook ativo ${active.id}`);
  console.log(`  antes:  ${JSON.stringify(active.warrantyPolicy)}`);

  await db
    .update(playbookVersions)
    .set({ warrantyPolicy: WARRANTY, updatedAt: new Date() })
    .where(eq(playbookVersions.id, active.id));

  const [after] = await db
    .select({ warrantyPolicy: playbookVersions.warrantyPolicy, objections: playbookVersions.objections })
    .from(playbookVersions)
    .where(eq(playbookVersions.id, active.id));

  console.log(`  depois: ${JSON.stringify(after.warrantyPolicy)}`);
  console.log(`  objeções preservadas: ${(after.objections ?? []).length}`);
  process.exit(0);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
