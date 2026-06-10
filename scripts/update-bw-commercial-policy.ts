import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { playbookVersions } from "../src/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sql);
const BW_ID = "5a2ce07d-cfa1-4108-9a3c-3d1fae017067";

// Política comercial atualizada com as opções reais de parcelamento (4x, 5x, 10x, 12x).
// Os preços R$2.500 e R$5.000 são extraídos pelo buildInstallmentTable para gerar
// a tabela de parcelas automaticamente.
const COMMERCIAL_POLICY = `A avaliação inicial com o Dr. Gregorie custa R$ 100 e esse valor é integralmente abatido do tratamento quando o paciente decide avançar. \
Para lentes de resina, os valores de referência são: Técnica Simplificada a partir de R$ 2.500 para vinte elementos, e Técnica Estratificada a partir de R$ 5.000 para vinte elementos. \
Sempre diga "a partir de" e esclareça que o valor exato depende da avaliação presencial. \
O parcelamento é disponível em 4, 5, 10 ou 12 vezes com as taxas da operadora de cartão já incluídas nos valores informados. \
Para os demais procedimentos, não informe estimativas de valor por mensagem — oriente que os valores são apresentados na avaliação com o plano personalizado.`;

async function main() {
  const [row] = await db
    .select({ id: playbookVersions.id, name: playbookVersions.name })
    .from(playbookVersions)
    .where(and(eq(playbookVersions.clinicId, BW_ID), eq(playbookVersions.status, "active")));

  if (!row) { console.error("❌ Nenhuma versão ativa"); process.exit(1); }

  await db
    .update(playbookVersions)
    .set({ commercialPolicy: COMMERCIAL_POLICY, updatedAt: new Date() })
    .where(eq(playbookVersions.id, row.id));

  console.log(`✅ commercial_policy atualizado — "${row.name}"`);
  console.log("\nOpções de parcelamento agora explícitas: 4x | 5x | 10x | 12x");
  console.log("A IA vai calcular e exibir:");
  console.log("  R$2.500 → 4x R$672 | 5x R$541 | 10x R$281 | 12x R$237");
  console.log("  R$5.000 → 4x R$1.344 | 5x R$1.081 | 10x R$562 | 12x R$474");

  await sql.end();
}
main().catch((err) => { console.error("❌", err); process.exit(1); });
