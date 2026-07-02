/**
 * Confere se a rota de exclusão permanente
 * (src/app/api/owner/clinics/[clinicId]/purge/route.ts) cobre TODAS as tabelas
 * que hoje têm uma FK (direta ou indireta) até `organizations`.
 *
 * Existe porque a rota fazia deletes manuais tabela-por-tabela e um schema
 * novo (ex.: `messages`, sem coluna organization_id, só alcança organizations
 * via conversations) ficou de fora silenciosamente — só quebrou em produção
 * na hora de apagar uma clínica com dado de verdade.
 *
 * Rode depois de qualquer migration que adicione uma coluna com
 * `.references(() => organizations.id)` ou que referencie uma tabela que já
 * chega em organizations (ex.: nova tabela referenciando conversations/leads).
 *
 * Uso:
 *   npx dotenv -e .env.local -- npx tsx scripts/check-purge-coverage.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const PURGE_ROUTE_PATH = "src/app/api/owner/clinics/[clinicId]/purge/route.ts";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });

type FkRow = {
  child_table: string;
  parent_table: string;
  delete_rule: string;
};

async function getForeignKeys(): Promise<FkRow[]> {
  return client<FkRow[]>`
    SELECT
      tc.table_name AS child_table,
      ccu.table_name AS parent_table,
      rc.delete_rule AS delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';
  `;
}

// snake_case (nome da tabela no banco) -> nome do export em schema.ts, como
// usado na rota de purge. Mantido aqui só para o diff ficar legível — a
// comparação real é feita pelo texto do arquivo, não por este mapa.
function tableNameVariants(snakeCase: string): string[] {
  const camel = snakeCase.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return [snakeCase, camel];
}

async function main() {
  const fks = await getForeignKeys();

  // BFS a partir de organizations, seguindo apenas FKs sem cascade (cascade é
  // automático, não precisa de delete explícito na rota).
  const parentToChildren = new Map<string, string[]>();
  for (const fk of fks) {
    if (fk.delete_rule === "CASCADE") continue;
    const list = parentToChildren.get(fk.parent_table) ?? [];
    list.push(fk.child_table);
    parentToChildren.set(fk.parent_table, list);
  }

  const reachable = new Set<string>();
  const queue = ["organizations"];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const child of parentToChildren.get(parent) ?? []) {
      if (child === "organizations" || reachable.has(child)) continue;
      reachable.add(child);
      queue.push(child);
    }
  }

  const routeSource = readFileSync(PURGE_ROUTE_PATH, "utf-8");

  const missing: string[] = [];
  for (const table of reachable) {
    const variants = tableNameVariants(table);
    const covered = variants.some((v) => routeSource.includes(v));
    if (!covered) missing.push(table);
  }

  await client.end();

  if (missing.length > 0) {
    console.error(
      `❌ ${missing.length} tabela(s) alcançam "organizations" via FK sem cascade e NÃO aparecem em ${PURGE_ROUTE_PATH}:\n` +
      missing.map((t) => `   - ${t}`).join("\n") +
      `\n\nAdicione o delete explícito na ordem correta (filhos antes de pais) antes de confiar na exclusão permanente.`,
    );
    process.exit(1);
  }

  console.log(`✅ Todas as ${reachable.size} tabelas alcançáveis a partir de "organizations" (sem cascade) estão cobertas em ${PURGE_ROUTE_PATH}.`);
}

main();
