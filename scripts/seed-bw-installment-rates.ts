import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { clinics } from "../src/infrastructure/db/schema";
import { eq } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

const BW_ID     = "5a2ce07d-cfa1-4108-9a3c-3d1fae017067";
const XIMENDES_ID = "c9137774-e783-4461-ac2b-e2f01be739a6";

async function main() {
  // Lê os rates da Ximendes (fonte de verdade do financeiro)
  const [ximendes] = await db.select({ rates: clinics.installmentRates }).from(clinics).where(eq(clinics.id, XIMENDES_ID));
  if (!ximendes?.rates) { console.error("❌ Ximendes sem installment_rates"); process.exit(1); }

  const rates = ximendes.rates as { n: number; rate: number; active: boolean }[];
  const ativos = rates.filter(r => r.active);
  console.log("Rates ativos na Ximendes:", ativos.map(r => `${r.n}x (${r.rate}%)`).join(", "));

  await db.update(clinics).set({ installmentRates: rates, updatedAt: new Date() }).where(eq(clinics.id, BW_ID));
  console.log("✅ installment_rates aplicados na BW Odontologia");

  // Simula a tabela que o Orchestrator vai gerar para R$2.500 e R$5.000
  const { buildInstallmentTable } = await import("../src/core/pipeline/ConversationOrchestrator");
  const policy = `Técnica Simplificada a partir de R$ 2.500. Técnica Estratificada a partir de R$ 5.000.`;
  const table = buildInstallmentTable(policy, rates);
  console.log("\n📊 Tabela que a IA vai receber nas consultas de preço:");
  console.log(table);

  await sql.end();
}
main().catch((err) => { console.error("❌", err); process.exit(1); });
