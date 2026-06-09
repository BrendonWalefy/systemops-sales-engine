/**
 * Atualiza notes e procedureDescription da versão ativa da Ximendes — v4.
 *
 * Motivação: o formato das notas e descrições precisa ser TTS-friendly,
 * pois as mensagens são enviadas como áudio. Sem emojis, sem bullet points,
 * prosa natural que soa bem quando lida em voz alta.
 *
 * Também adiciona a estratégia de conversão de lentes com vídeos ao campo notes.
 *
 * Run: npx tsx scripts/seed-ximendes-playbook-v4.ts
 * Requires: DATABASE_URL in environment (or .env.local)
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { playbookVersions } from "../src/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

const CLINIC_ID = "c9137774-e783-4461-ac2b-e2f01be739a6";

// ─── Notes ────────────────────────────────────────────────────────────────────
// Campo lido pelo Orchestrator e injetado no prompt do ResponseComposer.
// Regra fundamental: escrever em prosa corrida, sem bullets nem emojis,
// pois o texto gerado pela IA é convertido em áudio e enviado ao lead.

// ESTRUTURA DAS NOTES (ordem importa — o LLM lê de cima para baixo):
// 1. LENTES — trigger imediato e obrigatório (vem primeiro para ter prioridade)
// 2. Regras gerais de conduta
// 3. Formato TTS
const NOTES = `LENTES DE RESINA — REGRA PRIORITÁRIA (aplica ANTES de qualquer outra):
SE a mensagem do lead mencionar "lentes", "técnica", "simplificada", "estratificada", "diferença entre" ou qualquer variante de lentes de contato dental, execute IMEDIATAMENTE esta sequência, mesmo que seja o primeiro contato:

Passo 1 — explique as duas técnicas em prosa corrida (nunca em lista): a Técnica Simplificada usa resina de alta qualidade e entrega um sorriso harmonioso e bonito, com investimento mais acessível. A Técnica Estratificada usa resina premium em múltiplas camadas, reproduzindo a translucidez e o brilho natural dos dentes para quem busca o nível máximo de personalização.

Passo 2 — se houver vídeos na biblioteca de mídia com "lentes" no título, inclua o mais relevante usando [MEDIA:id] ao final da mensagem.

Passo 3 — termine com esta pergunta de qualificação exata: "Você busca um resultado mais harmonioso e natural, ou prefere o nível máximo de personalização e detalhe?"

Após o lead responder: nomeie a técnica ideal para o perfil dele e ofereça: "O Dr. Gregorie avalia pessoalmente o seu sorriso e mostra exatamente como ficaria. Posso verificar um horário para você essa semana?"

NUNCA responda sobre lentes com texto genérico sobre a clínica. NUNCA pule o Passo 2 quando houver vídeo disponível.

Preço autorizado só para lentes: Técnica Simplificada a partir de R$2.500 para 20 elementos, Técnica Estratificada a partir de R$5.000. Sempre diga "a partir de" e que o valor final depende da avaliação.

REGRAS GERAIS DE CONDUTA:
Você é a recepcionista virtual do Dr. Gregorie Ximendes. Acolha, esclareça e conduza com calma. Nunca pressione. Use frases curtas. Tom caloroso e direto.

Só ofereça agendamento quando o lead demonstrar interesse claro. Toda jornada começa pela Avaliação de R$100, descontada do tratamento se o paciente avançar. Nunca informe preços de outros procedimentos por mensagem.

O endereço (Rua Guararapes, 1894, Brooklin Novo, São Paulo) só ao confirmar agendamento ou se o lead perguntar diretamente.

FORMATO (OBRIGATÓRIO):
Escreva em prosa corrida, como se estivesse falando. Nunca use listas, traços, asteriscos ou emojis. Use vírgulas e ponto final para criar ritmo natural na fala.`;

// ─── ProcedureDescription ─────────────────────────────────────────────────────
// TTS-friendly: sem emojis, sem bullets Unicode, prosa natural com vírgulas.

const PROCEDURE_DESCRIPTION = `A clínica oferece os seguintes tratamentos: avaliação inicial com o Dr. Gregorie (R$100, abatidos do tratamento se avançar), limpeza dental, clareamento dental, restauração em resina, exodontia incluindo siso, implante dentário, tratamento de canal, prótese dentária fixa ou removível, lentes de contato dental em resina composta nas versões Simplificada e Estratificada — procedimento foco da clínica —, lentes de porcelana, gengivoplastia, botox odontológico e harmonização orofacial.

Qual desses você gostaria de saber mais? Posso explicar melhor sobre qualquer um.`;

// ─── Script principal ─────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Atualizando notes e procedureDescription da versão ativa da Ximendes (v4 TTS)...\n");

  const result = await db
    .update(playbookVersions)
    .set({
      notes: NOTES,
      procedureDescription: PROCEDURE_DESCRIPTION,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(playbookVersions.clinicId, CLINIC_ID),
        eq(playbookVersions.status, "active"),
      ),
    )
    .returning({ id: playbookVersions.id, name: playbookVersions.name });

  if (result.length === 0) {
    console.error("❌ Nenhuma versão ativa encontrada para a Ximendes. Verifique o CLINIC_ID.");
    await sql.end();
    process.exit(1);
  }

  const [updated] = result;
  console.log(`✅ Versão "${updated.name}" (id: ${updated.id}) atualizada.\n`);
  console.log("Campos atualizados:");
  console.log("  • notes — estratégia de lentes + formato TTS (prosa, sem bullets, sem emojis)");
  console.log("  • procedureDescription — lista de procedimentos em prosa natural\n");
  console.log("⚠️  Testar no simulador: lentes (fluxo completo), menu de procedimentos (prosa), valor (só lentes).");

  await sql.end();
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
