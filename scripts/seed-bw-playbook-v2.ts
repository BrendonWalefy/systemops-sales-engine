/**
 * BW Odontologia — seed de configuração v2.
 *
 * O que este script corrige em relação à v1:
 *
 * 1. NOTAS (notes): removida duplicação de preços e de identidade.
 *    As notes agora contêm APENAS regras comportamentais e de formato.
 *    Preços ficam exclusivamente em commercial_policy.
 *    "NUNCA mostre horários antes dos 3 passos" é explícito para resolver
 *    o conflito com o evaluation_redirect do Orchestrator.
 *
 * 2. POLÍTICA COMERCIAL (commercial_policy): reescrita em prosa corrida,
 *    sem bullets nem traços — o LLM lê formato de lista e tende a reproduzi-lo
 *    na resposta, causando leitura ruim no TTS.
 *
 * 3. PROCEDIMENTOS (procedure_description): prosa TTS-friendly, sem emojis.
 *
 * 4. TRATAMENTOS: acentos corretos nos nomes para boa pronúncia no TTS.
 *
 * 5. CLÍNICA: nome capitalizado corretamente + greeting_message com acentos.
 *
 * Run: npx dotenv -e .env.local -- tsx scripts/seed-bw-playbook-v2.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { playbookVersions, treatments, clinics } from "../src/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

const CLINIC_ID = "5a2ce07d-cfa1-4108-9a3c-3d1fae017067";

// ── Notes ─────────────────────────────────────────────────────────────────────
// Regras comportamentais puras. SEM preços (estão em commercial_policy).
// SEM redefinição de identidade (o ResponseComposer já define via buildSystemPrompt).
// "NUNCA mostre horários antes dos 3 passos" resolve o conflito com evaluation_redirect.

const NOTES = `REGRA PRIORITÁRIA — LENTES DE RESINA:
Quando o lead mencionar "lentes", "técnica", "simplificada", "estratificada", "lentes de contato dental" ou solicitar agendamento para lentes, execute esta sequência IMEDIATAMENTE — inclusive quando a ação for de agendamento ou avaliação. NUNCA mostre horários antes de concluir os três passos abaixo.

Passo 1 — explique as duas técnicas em prosa corrida, sem listas: a Técnica Simplificada usa resina de alta qualidade e entrega um sorriso harmonioso e bonito, com investimento mais acessível. A Técnica Estratificada usa resina premium em múltiplas camadas, reproduzindo a translucidez e o brilho natural dos dentes para quem busca o nível máximo de personalização.

Passo 2 — se houver vídeo na biblioteca de mídia com "lentes" no título, inclua o mais relevante usando [MEDIA:id] ao final da mensagem.

Passo 3 — termine com esta pergunta de qualificação: "Você busca um resultado mais harmonioso e natural, ou prefere o nível máximo de personalização e detalhe?"

Quando o lead responder: indique a técnica ideal para o perfil dele e ofereça: "O Dr. Gregory avalia pessoalmente o seu sorriso e mostra exatamente como ficaria. Posso verificar um horário para você essa semana?"

NUNCA responda sobre lentes com texto genérico ou direto para agendamento. NUNCA pule o Passo 2 quando houver vídeo disponível.

CONDUTA GERAL:
Acolha com calma e sem pressa. Nunca pressione o lead. Só ofereça agendamento quando houver interesse claro. Toda jornada começa pela Avaliação de R$ 100, abatida do tratamento se o paciente avançar. Não informe preços de outros procedimentos por mensagem.

FORMATO (OBRIGATÓRIO em toda resposta):
Escreva em prosa corrida, como se estivesse falando. Sem listas, traços, asteriscos, emojis ou numeração. Use vírgulas e ponto final para criar ritmo natural na fala. Máximo dois parágrafos curtos.`;

// ── Commercial Policy ─────────────────────────────────────────────────────────
// Prosa corrida — sem bullets nem traços. O LLM lê formato de lista e tende
// a reproduzi-lo na resposta, o que quebra a naturalidade no TTS.

const COMMERCIAL_POLICY = `A avaliação inicial com o Dr. Gregory custa R$ 100 e esse valor é integralmente abatido do tratamento se o paciente decidir avançar. Para lentes de resina, os valores de referência são: Técnica Simplificada a partir de R$ 2.500 para vinte elementos, e Técnica Estratificada a partir de R$ 5.000 para vinte elementos. Sempre diga "a partir de" e esclareça que o valor exato depende da avaliação presencial. Para todos os outros procedimentos, não informe estimativas de valor por mensagem — oriente que os valores são apresentados na avaliação. Quando o lead pedir agendamento, consulte a agenda interna e ofereça horários reais disponíveis.`;

// ── Procedure Description ─────────────────────────────────────────────────────
// Prosa curta, TTS-friendly. Sem emojis, sem bullets.

const PROCEDURE_DESCRIPTION = `A BW Odontologia oferece avaliação inicial com o Dr. Gregory, limpeza dental, clareamento dental, implante dentário e lentes de contato dental em resina composta. As lentes são o procedimento foco da clínica, disponíveis nas versões Simplificada e Estratificada. Posso explicar melhor qualquer um deles.`;

// ── Treatments corrigidos ─────────────────────────────────────────────────────
// Acentos corretos garantem boa pronúncia no TTS e correspondência precisa
// no IntentClassifier quando o lead digita o nome do tratamento.

const TREATMENTS_V2 = [
  {
    name: "Avaliação odontológica",
    duration_minutes: 60,
    description: "Consulta inicial com o Dr. Gregory para entender o caso, orientar os próximos passos e montar o plano de tratamento.",
    requires_evaluation_first: false,
  },
  {
    name: "Limpeza dental",
    duration_minutes: 60,
    description: "Profilaxia completa para remover tártaro e biofilme.",
    requires_evaluation_first: true,
  },
  {
    name: "Clareamento dental",
    duration_minutes: 60,
    description: "Clareamento com avaliação prévia para indicar a melhor modalidade.",
    requires_evaluation_first: true,
  },
  {
    name: "Implante dentário",
    duration_minutes: 60,
    description: "Reposição de dente perdido com planejamento individualizado.",
    requires_evaluation_first: true,
  },
  {
    name: "Lentes de resina composta",
    duration_minutes: 90,
    description: "Facetas em resina para transformar o sorriso. Disponíveis na Técnica Simplificada e na Técnica Estratificada, com indicação definida na avaliação.",
    requires_evaluation_first: true,
  },
];

async function main() {
  console.log("🚀 BW Odontologia — seed v2\n");

  // 1. Atualiza nome e greeting_message da clínica
  await db
    .update(clinics)
    .set({
      name: "BW Odontologia",
      greetingMessage: "Olá! Sou a recepcionista virtual da BW Odontologia. Em que posso ajudar?",
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, CLINIC_ID));
  console.log("✅ Clínica: nome e greeting_message atualizados com acentos corretos");

  // 2. Atualiza treatments com acentos e descrições melhoradas
  for (const t of TREATMENTS_V2) {
    await db
      .update(treatments)
      .set({
        description: t.description,
        requiresEvaluationFirst: t.requires_evaluation_first,
        updatedAt: new Date(),
      })
      .where(and(eq(treatments.clinicId, CLINIC_ID), eq(treatments.name, t.name)));

    // Se não encontrou pelo nome novo, tenta pelo nome antigo sem acento
    const oldName = t.name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[áéíóúãõâêîôûàèìòù]/gi, (c) => c.normalize("NFD").replace(/[̀-ͯ]/g, ""));
    if (oldName !== t.name) {
      await db
        .update(treatments)
        .set({
          name: t.name,
          description: t.description,
          requiresEvaluationFirst: t.requires_evaluation_first,
          updatedAt: new Date(),
        })
        .where(and(eq(treatments.clinicId, CLINIC_ID), eq(treatments.name, oldName)));
    }
  }
  console.log("✅ Treatments: nomes com acentos e descrições atualizadas");

  // 3. Atualiza notes, commercial_policy e procedure_description do playbook ativo
  const result = await db
    .update(playbookVersions)
    .set({
      notes: NOTES,
      commercialPolicy: COMMERCIAL_POLICY,
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
    console.error("❌ Nenhuma versão ativa encontrada para a BW Odontologia.");
    await sql.end();
    process.exit(1);
  }

  const [updated] = result;
  console.log(`✅ Playbook "${updated.name}" (${updated.id}) atualizado\n`);

  console.log("O que mudou:");
  console.log("  notes            — sem preços duplicados, sem redefinição de identidade;");
  console.log('                     "NUNCA mostre horários antes dos 3 passos" explícito');
  console.log("  commercial_policy — prosa corrida, sem bullets (melhor para TTS)");
  console.log("  procedure_description — prosa TTS-friendly\n");

  console.log("⚠️  Próximos passos:");
  console.log("  1. Teste no simulador: /playbook/simulate → modo Produção → BW Odontologia");
  console.log('     Cenário A: "quero saber sobre lentes" → deve explicar técnicas, depois qualificar');
  console.log('     Cenário B: "quero agendar lentes" → deve explicar técnicas ANTES dos horários');
  console.log('     Cenário C: "quanto custa a avaliação?" → deve dar R$ 100 em prosa natural');
  console.log("  2. Faça upload dos vídeos na Biblioteca de Mídia (títulos com 'lentes')");

  await sql.end();
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
