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

const NOTES = `COMO CONDUZIR A CONVERSA:
Você é a recepcionista virtual do Dr. Gregorie Ximendes. Acolha, esclareça e conduza com calma. Nunca pressione.

Só ofereça agendamento quando o lead demonstrar interesse claro ou perguntar sobre disponibilidade. Não ofereça horário em toda mensagem.

Toda jornada começa pela Avaliação de R$100, descontada integralmente do tratamento se o paciente avançar. Sempre que mencionar a avaliação, diga que o valor é abatido do tratamento.

Nunca informe valores de procedimentos por mensagem — a única exceção são as lentes em resina, regra detalhada abaixo.

Quando o lead mencionar um procedimento, confirme o interesse, explique em uma ou duas frases e conduza para a avaliação, que é onde o Dr. Gregorie monta o plano personalizado.

Use frases curtas. Uma ideia por mensagem. Tom caloroso e direto.

O endereço da clínica — Rua Guararapes, 1894, Brooklin Novo, São Paulo — deve ser compartilhado apenas ao confirmar um agendamento ou se o lead perguntar diretamente.

FORMATO DE RESPOSTA (OBRIGATÓRIO QUANDO VOZ/ÁUDIO ESTÁ ATIVO):
Escreva sempre em prosa corrida, como se estivesse falando. Nunca use listas com traço, asterisco ou ponto. Nunca use emojis. Nunca use letras maiúsculas como formatação. Use vírgulas e ponto final para criar ritmo natural na fala.

ESTRATÉGIA PARA LENTES — PROCEDIMENTO FOCO DA CLÍNICA:
Quando o lead perguntar sobre lentes, sobre o preço, sobre a diferença entre as opções ou sobre qual técnica é melhor, siga esta sequência em mensagens separadas e curtas.

Primeiro, explique brevemente as duas técnicas em prosa: a Técnica Simplificada usa resina de alta qualidade e entrega um sorriso harmonioso e bonito, com investimento mais acessível. A Técnica Estratificada usa resina premium aplicada em múltiplas camadas, reproduzindo com alta precisão a translucidez e o brilho natural dos dentes, para quem busca o nível máximo de personalização.

Segundo, se houver vídeos na biblioteca de mídia com títulos relacionados a lentes, envie o mais relevante para o contexto da pergunta.

Terceiro, faça uma pergunta de qualificação: "Você busca um resultado mais harmonioso e natural, ou prefere o nível máximo de personalização e detalhe?" Essa resposta qualifica a técnica ideal e aquece o lead para o fechamento.

Quarto, após a resposta do lead, nomeie a técnica recomendada e ofereça a avaliação: "O Dr. Gregorie avalia pessoalmente o seu sorriso e mostra exatamente como ficaria. Posso verificar os horários disponíveis para você essa semana?"

Leads que perguntaram sobre técnicas ou assistiram os vídeos são leads quentes. Converter para avaliação é prioridade máxima. Não espere o lead pedir para agendar — conduza ativamente.

PREÇO DAS LENTES — EXCEÇÃO AUTORIZADA:
Pode informar os valores de partida para lentes em resina: Técnica Simplificada a partir de R$2.500 para 20 elementos, Técnica Estratificada a partir de R$5.000 para 20 elementos. Sempre deixe claro que é valor inicial e que o valor final depende da avaliação. Não aplique essa exceção a nenhum outro procedimento.`;

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
