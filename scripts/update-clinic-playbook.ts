/**
 * Atualiza configurações operacionais da Ximendes Odontologia.
 * Run: npx tsx scripts/update-clinic-playbook.ts
 * Requires DATABASE_URL in environment (or .env.local).
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { organizations, playbookVersions } from "../src/infrastructure/db/schema";
import { CONCIERGE_MENU_ITEMS } from "../src/domain/entities/clinic";
import { and, eq } from "drizzle-orm";

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

const COMMERCIAL_POLICY = `PREÇO — REGRA GERAL: não informar valores de procedimentos por mensagem. O plano e os valores são apresentados pelo Dr. Gregorie na avaliação.

PREÇO — EXCEÇÃO (LENTES EM RESINA, foco da clínica): pode informar os valores DE PARTIDA, sempre como "a partir de" e sempre seguidos da ressalva de que o valor final depende da avaliação:
- Técnica Simplificada (resina nacional): a partir de R$2.500 — 20 elementos.
- Técnica Estratificada (resina importada): a partir de R$5.000 — 20 elementos.
Ao falar de lentes, SEMPRE: (1) deixar claro que é valor inicial; (2) explicar que cada caso é avaliado individualmente para indicação e valor final; (3) oferecer o agendamento da avaliação. NÃO aplicar essa exceção a nenhum outro procedimento.

AVALIAÇÃO PRESENCIAL: custa R$100 e é descontada integralmente do tratamento caso o paciente avance. Comunicar sempre o abatimento.

PARCELAMENTO: a clínica trabalha com parcelamento em até 12x. Quando o lead perguntar sobre parcelas, deixe explícito que os valores enviados são algumas simulações para facilitar a visualização e que o parcelamento pode ser feito em até 12x. Apresente as simulações de forma natural, sem detalhar taxas e sem tratar os exemplos como condição única.

ENDEREÇO: compartilhar apenas ao confirmar agendamento ou quando o lead perguntar diretamente — "Rua Guararapes, 1894 — Brooklin Novo, São Paulo/SP."

REGRAS ABSOLUTAS:
- Preço só para lentes em resina (regra acima). Para todos os demais: NUNCA citar valor.
- SEMPRE mencionar o abatimento dos R$100 ao falar da avaliação.
- NUNCA pressionar para fechar na primeira mensagem.
- NÃO oferecer agendamento em toda mensagem — apenas com interesse claro.`;

async function main() {
  const now = new Date();

  await db.update(organizations).set({
    businessHours: "Segunda a sexta das 8h às 18h. Sábado das 8h às 13h.",
    greetingMessage: GREETING_MESSAGE,
    menuItems: CONCIERGE_MENU_ITEMS,
    receptionistPhone: null,
    staleConversationHours: 6,
    slotLookaheadDays: 21,
    mediaTakeoverTtlHours: 6,
    updatedAt: now,
  }).where(eq(organizations.id, CLINIC_ID));

  await db.update(playbookVersions).set({
    commercialPolicy: COMMERCIAL_POLICY,
    updatedAt: now,
  }).where(and(eq(playbookVersions.clinicId, CLINIC_ID), eq(playbookVersions.status, "active")));

  console.log("✅ Settings operacionais e política comercial da Ximendes atualizados.");
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
