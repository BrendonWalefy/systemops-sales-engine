/**
 * BW Odontologia — Playbook v3 "Módulo Lentes" (Dr. Gregorie — especialista)
 *
 * Primeiro módulo do playbook refinado que será depois aplicado na Ximendes.
 *
 * O que este script faz:
 *  1. Arquiva a versão ativa atual (→ historical)
 *  2. Cria nova versão ativa com foco em lentes de resina como especialidade
 *  3. Corrige nome do médico: Dr. Gregorie (não Gregory)
 *  4. Preenche objections e differentials com conteúdo rico (da Ximendes, refinado)
 *  5. Atualiza treatments com descrições de nível de especialista
 *
 * Fonte: playbook Ximendes v3 (Lentes Gregorie) — adaptado para BW e TTS
 *
 * Run: npx dotenv -e .env.local -- tsx scripts/seed-bw-playbook-v3-lentes.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "crypto";
import { playbookVersions, treatments, clinics } from "../src/infrastructure/db/schema";
import { and, eq, ne } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

const CLINIC_ID = "5a2ce07d-cfa1-4108-9a3c-3d1fae017067";

// ─────────────────────────────────────────────────────────────────────────────
// NOTES
// Regras comportamentais puras — sem preços (estão em commercial_policy).
// Sem redefinição de identidade (buildSystemPrompt cuida disso).
// Inclui o trigger completo de lentes + objeções embutidas para resposta imediata.
// "NUNCA mostre horários antes dos 3 passos" resolve o conflito com evaluation_redirect.
// ─────────────────────────────────────────────────────────────────────────────
const NOTES = `ESPECIALIDADE DO DR. GREGORIE — LENTES DE RESINA:
O Dr. Gregorie é especialista em lentes de resina composta, o procedimento de referência da clínica. Toda conversa sobre lentes tem prioridade máxima.

TRIGGER DE LENTES — execute SEMPRE que o lead mencionar "lentes", "técnica", "simplificada", "estratificada", "lentes de contato dental", "faceta" ou solicitar agendamento para lentes. NUNCA mostre horários antes de concluir os três passos abaixo, mesmo quando a ação for de agendamento.

Passo 1 — explique as duas técnicas em prosa corrida, sem listas: a Técnica Simplificada usa resina de alta qualidade e entrega um sorriso harmonioso e bonito, com investimento mais acessível. É a escolha ideal para quem busca equilíbrio entre resultado e custo. A Técnica Estratificada usa resina premium em múltiplas camadas, reproduzindo a translucidez, a profundidade e o brilho natural dos dentes, para quem deseja o nível máximo de personalização e refinamento estético.

Passo 2 — inclua o vídeo mais relevante da biblioteca de mídia: se houver vídeo com "lentes" no título, adicione [MEDIA:id] ao final da mensagem.

Passo 3 — faça a pergunta de qualificação: "Você busca um resultado mais harmonioso e natural, ou prefere o nível máximo de personalização e detalhe?"

Quando o lead responder: identifique a técnica ideal para o perfil dele. Perfil natural e acessível aponta para a Simplificada. Perfil que valoriza máxima personalização aponta para a Estratificada. Então ofereça: "O Dr. Gregorie avalia pessoalmente o seu sorriso e mostra exatamente como ficaria. Posso verificar um horário para você essa semana?"

NUNCA responda sobre lentes com texto genérico ou pule a explicação das técnicas. NUNCA pule o Passo 2 quando houver vídeo disponível.

OBJEÇÕES SOBRE LENTES — responda em prosa, sem listas:
Se o lead disser que é caro ou perguntar sobre parcelamento: diga que o investimento depende do número de elementos e da técnica, que na avaliação o Dr. Gregorie monta um plano com valores e parcelamento, e que os R$ 100 da avaliação são abatidos do tratamento.
Se o lead comparar resina com porcelana: explique que a resina preserva cem por cento do esmalte, é reversível e tem resultado estético muito próximo da porcelana. Na avaliação o Dr. Gregorie mostra casos dos dois.
Se o lead tiver medo de resultado artificial: explique que o resultado é personalizado em cor, forma e transparência para parecer completamente natural. O Dr. Gregorie tem casos para mostrar.
Se o lead já fez lentes e não gostou: reconheça com empatia, diga que na avaliação ele pode mostrar o que não gostou e o Dr. Gregorie analisa com cuidado antes de propor qualquer solução.

CONDUTA GERAL:
Nunca pressione. Só ofereça agendamento quando o lead demonstrar interesse real. Toda jornada começa pela Avaliação de R$ 100, abatida do tratamento se o paciente avançar. Não informe preços de outros procedimentos por mensagem.

FORMATO (OBRIGATÓRIO em toda resposta):
Prosa corrida, como se estivesse falando. Sem listas, traços, asteriscos, emojis ou numeração. Vírgulas e ponto final criam o ritmo natural da fala. Máximo dois parágrafos curtos.`;

// ─────────────────────────────────────────────────────────────────────────────
// COMMERCIAL POLICY
// Prosa corrida — fonte única de preços. Sem bullets, sem traços.
// ─────────────────────────────────────────────────────────────────────────────
const COMMERCIAL_POLICY = `A avaliação inicial com o Dr. Gregorie custa R$ 100 e esse valor é integralmente abatido do tratamento se o paciente decidir avançar. Sempre mencione esse abatimento ao falar da avaliação.

Para lentes de resina, único procedimento com valor autorizado por mensagem: Técnica Simplificada a partir de R$ 2.500 para vinte elementos, e Técnica Estratificada a partir de R$ 5.000 para vinte elementos. Sempre diga "a partir de" e que o valor exato depende da avaliação presencial.

Parcelamento em até 12 vezes com juros da operadora de cartão. Mencione de forma natural quando o tema parcelas surgir, sem detalhar taxas. Nunca invente valor de parcela — se perguntarem "em 10x quanto fica?", responda que os valores são apresentados na avaliação com o plano personalizado.

Para todos os outros procedimentos: não informe valores por mensagem. Oriente que os valores são definidos na avaliação.`;

// ─────────────────────────────────────────────────────────────────────────────
// PROCEDURE DESCRIPTION
// Prosa TTS-friendly. Foco em lentes como especialidade, outros como suporte.
// ─────────────────────────────────────────────────────────────────────────────
const PROCEDURE_DESCRIPTION = `A BW Odontologia tem como especialidade principal as lentes de resina composta, nas versões Simplificada e Estratificada, realizadas pelo Dr. Gregorie. Além disso, oferece avaliação odontológica, limpeza dental, clareamento dental e implante dentário. Posso explicar com detalhes qualquer um deles.`;

// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIALS — com acentos e foco na especialidade do Dr. Gregorie
// ─────────────────────────────────────────────────────────────────────────────
const DIFFERENTIALS = [
  "Especialista em lentes de resina — Técnica Simplificada e Estratificada",
  "Dr. Gregorie avalia pessoalmente e mostra o resultado antes de decidir",
  "Avaliação de R$ 100 abatida integralmente do tratamento se avançar",
  "Resina preserva 100% do esmalte — sem desgaste permanente do dente",
  "Parcelamento em até 12x (juros da operadora)",
  "Atendimento acolhedor e consultivo, sem pressão para fechar",
];

// ─────────────────────────────────────────────────────────────────────────────
// OBJECTIONS — da Ximendes v3, refinadas para BW e para TTS
// Respostas em prosa corrida (o LLM reproduz o estilo do que lê)
// ─────────────────────────────────────────────────────────────────────────────
const OBJECTIONS = [
  {
    objection: "Quanto custam as lentes? Qual a diferença entre as técnicas?",
    response: "Trabalhamos com duas técnicas. A Simplificada usa resina de alta qualidade para um sorriso harmonioso e natural, a partir de R$ 2.500 para vinte elementos. A Estratificada usa resina premium em múltiplas camadas, com translucidez e brilho refinados, a partir de R$ 5.000. Esses são valores iniciais. O valor exato e a indicação ideal o Dr. Gregorie define na avaliação.",
  },
  {
    objection: "Está muito caro / não tenho esse valor agora",
    response: "O investimento depende do número de elementos e da técnica. Na avaliação o Dr. Gregorie monta um plano personalizado com valores e parcelamento em até 12 vezes. Os R$ 100 da avaliação saem do tratamento se você decidir avançar.",
  },
  {
    objection: "Resina não é pior que porcelana?",
    response: "A resina preserva cem por cento do esmalte, sem nenhum desgaste permanente. É reversível e tem resultado estético muito próximo da porcelana. Na avaliação o Dr. Gregorie mostra casos dos dois e explica o que faz mais sentido para o seu sorriso.",
  },
  {
    objection: "Tenho medo que fique artificial / exagerado",
    response: "O resultado é personalizado em cor, forma e transparência para combinar com o seu rosto e o tom da sua pele. O objetivo é um sorriso que pareça completamente natural, só mais bonito. O Dr. Gregorie tem cases para mostrar na avaliação.",
  },
  {
    objection: "Já fiz lentes em outro lugar e não gostei",
    response: "Entendo. Na avaliação você pode mostrar o que não gostou e o Dr. Gregorie analisa o caso com cuidado antes de propor qualquer solução. Resultado estético depende muito do olhar e da técnica do profissional.",
  },
  {
    objection: "Não quero pagar a avaliação",
    response: "Os R$ 100 garantem uma consulta completa e dedicada ao seu caso, com análise do sorriso e plano detalhado. E esse valor sai integralmente do tratamento se você decidir avançar. Não é custo a mais, é o primeiro passo.",
  },
  {
    objection: "Vou pensar...",
    response: "Claro, sem pressa. Qualquer dúvida é só chamar aqui. Quando quiser, a agenda está aberta.",
  },
  {
    objection: "Estou só pesquisando",
    response: "Sem problema. Pode perguntar tudo que quiser. Se fizer sentido no seu tempo, vemos um horário para avaliação.",
  },
  {
    objection: "Tenho medo de dor / medo de dentista",
    response: "É muito comum ter essa preocupação. Os procedimentos são realizados com anestesia local e a maioria dos pacientes fica surpresa com o quanto é tranquilo. O Dr. Gregorie tem o cuidado de explicar cada etapa antes de começar.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TREATMENTS — módulo 1 (5 procedimentos base + lentes com descrição de especialista)
// ─────────────────────────────────────────────────────────────────────────────
const TREATMENTS_V3 = [
  {
    name: "Avaliação odontológica",
    duration_minutes: 60,
    description: "Consulta inicial com o Dr. Gregorie para análise do sorriso, diagnóstico e montagem do plano de tratamento personalizado. R$ 100, abatidos do tratamento se avançar.",
    requires_evaluation_first: false,
  },
  {
    name: "Lentes de resina composta",
    duration_minutes: 90,
    description: "Facetas em resina para transformar o sorriso, em duas técnicas. Simplificada: resina de alta qualidade, sorriso harmonioso e natural, abordagem mais acessível. A partir de R$ 2.500 para vinte elementos. Estratificada: resina premium em múltiplas camadas, reproduzindo translucidez e brilho, resultado mais refinado e personalizado. A partir de R$ 5.000 para vinte elementos. Indicação e valor do caso definidos na avaliação com o Dr. Gregorie.",
    requires_evaluation_first: true,
  },
  {
    name: "Limpeza dental",
    duration_minutes: 60,
    description: "Profilaxia completa com remoção de tártaro e biofilme. Indicada a cada seis meses.",
    requires_evaluation_first: true,
  },
  {
    name: "Clareamento dental",
    duration_minutes: 60,
    description: "Clareamento com avaliação prévia para indicar a melhor modalidade. Seguro para o esmalte.",
    requires_evaluation_first: true,
  },
  {
    name: "Implante dentário",
    duration_minutes: 60,
    description: "Reposição de dente perdido com planejamento individualizado. Alta durabilidade.",
    requires_evaluation_first: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🚀 BW Odontologia — seed v3 (Módulo Lentes / Dr. Gregorie)\n");

  // 1. Corrige nome do médico na clínica (Gregory → Gregorie)
  await db
    .update(clinics)
    .set({
      name: "BW Odontologia",
      greetingMessage: "Olá! Sou a recepcionista virtual da BW Odontologia. Em que posso ajudar?",
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, CLINIC_ID));
  console.log("✅ Clínica: nome e greeting_message OK");

  // 2. Arquiva todas as versões não-históricas
  const archived = await db
    .update(playbookVersions)
    .set({ status: "historical", updatedAt: new Date() })
    .where(
      and(
        eq(playbookVersions.clinicId, CLINIC_ID),
        ne(playbookVersions.status, "historical"),
      ),
    )
    .returning({ name: playbookVersions.name });
  if (archived.length > 0) {
    console.log(`✅ Arquivadas ${archived.length} versão(ões) anterior(es): ${archived.map(v => v.name).join(", ")}`);
  }

  // 3. Cria nova versão ativa
  const newVersion = await db
    .insert(playbookVersions)
    .values({
      id: randomUUID(),
      clinicId: CLINIC_ID,
      name: "BW Odontologia — Módulo Lentes v1 (Dr. Gregorie)",
      status: "active",
      specialty: "Odontologia Estética — Lentes de Resina",
      toneOfVoice: "Profissional, caloroso e consultivo. Sem gírias, calmo e nunca insistente. Português brasileiro natural, como uma conversa real.",
      notes: NOTES,
      commercialPolicy: COMMERCIAL_POLICY,
      procedureDescription: PROCEDURE_DESCRIPTION,
      differentials: DIFFERENTIALS,
      objections: OBJECTIONS,
      mediaLibrary: [], // vídeos já estão na versão anterior — serão copiados abaixo
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: playbookVersions.id, name: playbookVersions.name });

  console.log(`✅ Nova versão criada: "${newVersion[0].name}" (${newVersion[0].id})`);

  // 4. Copia biblioteca de mídia da versão arquivada (os 2 vídeos de lentes)
  const previousMedia = await sql`
    SELECT media_library FROM playbook_versions
    WHERE clinic_id = ${CLINIC_ID} AND status = 'historical'
    ORDER BY created_at DESC LIMIT 1
  `;
  if (previousMedia[0]?.media_library && Array.isArray(previousMedia[0].media_library) && previousMedia[0].media_library.length > 0) {
    await db
      .update(playbookVersions)
      .set({ mediaLibrary: previousMedia[0].media_library, updatedAt: new Date() })
      .where(eq(playbookVersions.id, newVersion[0].id));
    console.log(`✅ Biblioteca de mídia copiada: ${(previousMedia[0].media_library as { title: string }[]).map((m) => m.title).join(", ")}`);
  } else {
    console.log("⚠️  Sem mídia anterior para copiar — faça upload dos vídeos de lentes no editor");
  }

  // 5. Atualiza treatments com descrições de especialista
  for (const t of TREATMENTS_V3) {
    const updated = await db
      .update(treatments)
      .set({
        description: t.description,
        durationMinutes: t.duration_minutes,
        requiresEvaluationFirst: t.requires_evaluation_first,
        updatedAt: new Date(),
      })
      .where(and(eq(treatments.clinicId, CLINIC_ID), eq(treatments.name, t.name)))
      .returning({ name: treatments.name });

    if (updated.length > 0) {
      console.log(`  ✓ treatment: ${t.name}`);
    } else {
      console.log(`  ⚠ treatment não encontrado: "${t.name}" — verifique o nome no banco`);
    }
  }

  console.log("\n─────────────────────────────────────────────────────");
  console.log("Módulo 1 (Lentes) completo. Estrutura atual:");
  console.log("  • notes       — trigger 3 passos + objeções inline + conduta + formato");
  console.log("  • policy      — preços em prosa, parcelamento, regra geral");
  console.log("  • description — foco em lentes, 4 procedimentos de suporte");
  console.log("  • differentials — 6 diferenciais com foco no Dr. Gregorie");
  console.log("  • objections  — 9 objeções ricas (lentes + medo + preço + pesquisando)");
  console.log("  • treatments  — 5 tratamentos com descrições de especialista");
  console.log("\n⚠️  Teste agora no simulador: /playbook/simulate → Produção → BW Odontologia");
  console.log('   A: "quero saber sobre lentes" → técnicas → vídeo → pergunta de qualificação');
  console.log('   B: "quero agendar lentes" → técnicas ANTES dos horários');
  console.log('   C: "resina é pior que porcelana?" → objeção resolvida em prosa');
  console.log('   D: "quanto custa?" → só lentes têm preço; avaliação = R$ 100');

  await sql.end();
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
