/**
 * Atualiza configurações operacionais da Ximendes Odontologia.
 * Run: npx tsx scripts/update-clinic-playbook.ts
 * Requires DATABASE_URL in environment (or .env.local).
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { clinics } from "../src/infrastructure/db/schema";
import { CONCIERGE_MENU_ITEMS } from "../src/domain/entities/clinic";
import { eq } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("DATABASE_URL not set"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

const CLINIC_ID = "c9137774-e783-4461-ac2b-e2f01be739a6";

// ─── Saudação fixa ────────────────────────────────────────────────────────────
// Exibida na primeira mensagem — sem LLM. Prefixo de período (Bom dia/Boa tarde/Boa noite)
// é gerado em runtime pelo Orchestrator com base no horário local da clínica.
const GREETING_MESSAGE = `Seja bem-vindo à Ximendes Odontologia.
Sou a Marina, assistente do Dr. Gregorie. Para te direcionar melhor, escolha uma opção:`;

async function main() {
  await db.update(clinics).set({
    businessHours: "Segunda a sexta das 8h às 18h. Sábado das 8h às 13h.",
    conversationExperience: "concierge",
    greetingMessage: GREETING_MESSAGE,
    menuItems: CONCIERGE_MENU_ITEMS,
    updatedAt: new Date(),
  }).where(eq(clinics.id, CLINIC_ID));

  console.log("✅ Settings operacionais da Ximendes atualizados (greetingMessage, businessHours).");
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
