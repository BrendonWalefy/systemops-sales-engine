/**
 * BW Odontologia — Playbook v4 "Canônico" (Dr. Gregorie — especialista em lentes)
 *
 * Versão profissional com arquitetura limpa: cada tipo de regra tem UM único dono.
 * Elimina todas as redundâncias e conflitos da v3:
 *
 *   PROBLEMA CORRIGIDO 1 — Regras de formato NÃO ficam no notes.
 *     O ResponseComposer.ts já define formato universalmente. Duplicar aqui causava
 *     comportamento imprevisível quando as duas versões discordavam em detalhe.
 *
 *   PROBLEMA CORRIGIDO 2 — Objeções de lentes NÃO ficam inline no notes.
 *     A v3 tinha as mesmas 4 objeções em dois lugares (notes + objections[]).
 *     Agora notes só tem o trigger sequencial; as respostas ficam em objections[].
 *
 *   PROBLEMA CORRIGIDO 3 — Preços ficam SOMENTE em commercialPolicy.
 *     Antes apareciam em notes, differentials e treatments.description.
 *     Se o preço mudar, agora é 1 lugar para alterar.
 *
 *   PROBLEMA CORRIGIDO 4 — "Conduta Geral" verbosa removida do notes.
 *     O modo concierge no ResponseComposer já cuida disso. Ficam apenas
 *     2 linhas de conduta específica da clínica que o Composer não cobre.
 *
 * Arquitetura de responsabilidades:
 *   notes          → triggers comportamentais e sequências (apenas)
 *   commercialPolicy → todos os preços e condições (apenas)
 *   objections[]   → todas as respostas a objeções (sem sobreposição com notes)
 *   differentials[] → diferenciais competitivos (sem preços explícitos)
 *   treatments     → descrições factuais (sem preços)
 *   ResponseComposer → formato, anti-repetição, identidade, regras de mídia
 *
 * Run: npx dotenv -e .env.local -- tsx scripts/seed-bw-playbook-v4-canonical.ts
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
// NOTES — SOMENTE triggers comportamentais e sequências obrigatórias.
//
// O que NÃO está aqui (e por quê):
//  • Regras de formato → ResponseComposer.ts (hardcoded, universal)
//  • Respostas a objeções → objections[] abaixo (sem duplicação)
//  • Preços → commercialPolicy (fonte única de preços)
//  • "Nunca pressione" genérico → conversationExperience=concierge cobre isso
// ─────────────────────────────────────────────────────────────────────────────
const NOTES = `ESPECIALIDADE DO DR. GREGORIE:
O Dr. Gregorie é especialista em lentes de resina composta. Toda conversa sobre lentes tem prioridade máxima e segue a sequência abaixo sem exceção.

TRIGGER DE LENTES — execute SEMPRE que o lead mencionar qualquer referência a lentes ou estética dental: "lentes", "técnica", "simplificada", "estratificada", "lentes de contato dental", "faceta", "faceta de resina", "resina nos dentes", "lente no dente", "lentes de porcelana" ou pedir agendamento relacionado a lentes. NUNCA mostre horários antes de concluir os passos abaixo, mesmo quando a ação for de agendamento.

Passo 1 — apresente cada técnica com o vídeo correspondente vindo ANTES da explicação. Dois blocos em sequência:

Bloco A (Técnica Simplificada): escreva [MEDIA:id] usando o id do vídeo da Simplificada (encontre na biblioteca pelo título — deve conter "simplificada"). Imediatamente após, em prosa corrida: "A Técnica Simplificada usa resina de alta qualidade e entrega um sorriso harmonioso e natural, com investimento mais acessível. É a escolha ideal para quem busca equilíbrio entre resultado e custo."

Bloco B (Técnica Estratificada): escreva [MEDIA:id] usando o id do vídeo da Estratificada (encontre na biblioteca pelo título — deve conter "estratificada"). Imediatamente após, em prosa corrida: "A Técnica Estratificada usa resina premium em múltiplas camadas, reproduzindo a translucidez e o brilho natural dos dentes. É para quem deseja o nível máximo de personalização e refinamento estético."

Passo 2 — faça a pergunta de qualificação: "Qual dessas combina mais com o que você busca — um resultado harmonioso e natural, ou personalização máxima com cada detalhe?"

Quando o lead responder: identifique a técnica ideal para o perfil dele e ofereça: "O Dr. Gregorie avalia pessoalmente o seu sorriso e mostra exatamente como ficaria. Posso verificar um horário para você essa semana?"

CONDUTA ESPECÍFICA DA CLÍNICA:
Só ofereça agendamento quando o lead demonstrar interesse real. Toda jornada começa pela avaliação. O endereço só ao confirmar agendamento ou se o lead perguntar diretamente.`;

// ─────────────────────────────────────────────────────────────────────────────
// COMMERCIAL POLICY — SOMENTE preços e condições comerciais.
//
// Fonte única de verdade para valores. Qualquer ajuste de preço: alterar só aqui.
// ─────────────────────────────────────────────────────────────────────────────
const COMMERCIAL_POLICY = `A avaliação inicial com o Dr. Gregorie custa R$ 100 e esse valor é integralmente abatido do tratamento se o paciente decidir avançar. Sempre mencione esse abatimento ao falar da avaliação.

Para lentes de resina, único procedimento com valor autorizado por mensagem: Técnica Simplificada a partir de R$ 2.500 para vinte elementos, e Técnica Estratificada a partir de R$ 5.000 para vinte elementos. Sempre diga "a partir de" e que o valor exato depende da avaliação presencial.

Parcelamento em até 12 vezes com juros da operadora de cartão. Mencione de forma natural quando o tema parcelas surgir, sem detalhar taxas. Nunca invente valor de parcela — se perguntarem "em 10x quanto fica?", responda que os valores são apresentados na avaliação com o plano personalizado.

Para todos os outros procedimentos: não informe valores por mensagem. Oriente que os valores são definidos na avaliação.`;

// ─────────────────────────────────────────────────────────────────────────────
// PROCEDURE DESCRIPTION — Prosa TTS-friendly. Sem preços (ficam na policy).
// ─────────────────────────────────────────────────────────────────────────────
const PROCEDURE_DESCRIPTION = `A BW Odontologia tem como especialidade principal as lentes de resina composta, nas versões Simplificada e Estratificada, realizadas pelo Dr. Gregorie. Além disso, oferece avaliação odontológica, limpeza dental, clareamento dental e implante dentário. Posso explicar com detalhes qualquer um deles.`;

// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIALS — Diferenciais competitivos. Sem valores explícitos.
// Preços não devem aparecer aqui — conflitaria com commercial_policy.
// ─────────────────────────────────────────────────────────────────────────────
const DIFFERENTIALS = [
  "Especialista em lentes de resina — Técnica Simplificada e Estratificada",
  "Dr. Gregorie avalia pessoalmente o sorriso e mostra o resultado antes de decidir",
  "Avaliação abatida integralmente do tratamento se avançar",
  "Resina preserva o esmalte — procedimento reversível sem desgaste permanente",
  "Parcelamento em até 12 vezes (juros da operadora)",
  "Atendimento consultivo, sem pressão para fechar",
];

// ─────────────────────────────────────────────────────────────────────────────
// OBJECTIONS — 8 entradas. Sem sobreposição com o notes.
//
// Removida da v3: "Quanto custam as lentes? Qual a diferença entre as técnicas?"
// → Essa objeção é coberta pelo trigger do notes (3 passos). Duplicar aqui fazia
//   o LLM receber duas versões da mesma resposta.
//
// Respostas em prosa corrida — o LLM reproduz o estilo do que lê.
// ─────────────────────────────────────────────────────────────────────────────
const OBJECTIONS = [
  {
    objection: "Está muito caro / não tenho esse valor agora",
    response: "O investimento depende do número de elementos e da técnica. Na avaliação o Dr. Gregorie monta um plano personalizado com valores e parcelamento em até 12 vezes. Os R$ 100 da avaliação são abatidos do tratamento se você decidir avançar.",
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
// TREATMENTS — Descrições factuais. Sem preços (ficam em commercial_policy).
// ─────────────────────────────────────────────────────────────────────────────
const TREATMENTS_V4 = [
  {
    name: "Avaliação odontológica",
    duration_minutes: 60,
    description: "Consulta inicial com o Dr. Gregorie para análise do sorriso, diagnóstico e montagem do plano de tratamento personalizado. O valor da avaliação é abatido do tratamento se o paciente decidir avançar.",
    requires_evaluation_first: false,
  },
  {
    name: "Lentes de resina composta",
    duration_minutes: 90,
    description: "Facetas em resina para transformar o sorriso, em duas técnicas. Técnica Simplificada: resina de alta qualidade para um sorriso harmonioso e natural. Técnica Estratificada: resina premium em múltiplas camadas, reproduzindo translucidez e brilho, para o máximo de personalização. A técnica ideal e os valores são definidos na avaliação com o Dr. Gregorie.",
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
  console.log("🚀 BW Odontologia — seed v4 (Canônico / Dr. Gregorie — especialista em lentes)\n");
  console.log("Arquitetura limpa: cada regra tem um único dono.\n");

  // 1. Confirma clínica
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
    console.log(`✅ Arquivadas ${archived.length} versão(ões): ${archived.map(v => v.name).join(", ")}`);
  }

  // 3. Cria nova versão ativa
  const newVersion = await db
    .insert(playbookVersions)
    .values({
      id: randomUUID(),
      clinicId: CLINIC_ID,
      name: "BW Odontologia — Canônico v4 (Dr. Gregorie — especialista em lentes)",
      status: "active",
      specialty: "Odontologia Estética — Lentes de Resina",
      toneOfVoice: "Profissional, caloroso e consultivo. Sem gírias, calmo e nunca insistente. Português brasileiro natural, como uma conversa real.",
      notes: NOTES,
      commercialPolicy: COMMERCIAL_POLICY,
      procedureDescription: PROCEDURE_DESCRIPTION,
      differentials: DIFFERENTIALS,
      objections: OBJECTIONS,
      mediaLibrary: [], // vídeos copiados da versão arquivada abaixo
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: playbookVersions.id, name: playbookVersions.name });

  console.log(`✅ Nova versão criada: "${newVersion[0].name}" (${newVersion[0].id})`);

  // 4. Copia biblioteca de mídia da versão arquivada (vídeos de lentes)
  const previousMedia = await sql`
    SELECT media_library FROM playbook_versions
    WHERE clinic_id = ${CLINIC_ID} AND status = 'historical'
    ORDER BY created_at DESC LIMIT 1
  `;
  if (previousMedia[0]?.media_library && Array.isArray(previousMedia[0].media_library) && previousMedia[0].media_library.length > 0) {
    const mediaItems = previousMedia[0].media_library as Array<{ id: string; title: string }>;
    await db
      .update(playbookVersions)
      .set({ mediaLibrary: previousMedia[0].media_library, updatedAt: new Date() })
      .where(eq(playbookVersions.id, newVersion[0].id));
    console.log(`✅ Biblioteca de mídia copiada: ${mediaItems.map(m => m.title).join(", ")}`);
  } else {
    console.log("⚠️  Sem mídia anterior — faça upload dos vídeos de lentes no editor após rodar este script");
  }

  // 5. Atualiza treatments com descrições limpas (sem preços)
  for (const t of TREATMENTS_V4) {
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
  console.log("v4 canônico completo. Mapa de responsabilidades:");
  console.log("  • notes        — trigger 3 passos + conduta específica (sem formato, sem objeções inline, sem preços)");
  console.log("  • policy       — todos os preços em prosa (fonte única)");
  console.log("  • description  — foco em lentes, 4 procedimentos de suporte (sem preços)");
  console.log("  • differentials — 6 diferenciais sem valores explícitos");
  console.log("  • objections   — 8 objeções sem sobreposição com o notes");
  console.log("  • treatments   — 5 tratamentos com descrições factuais (sem preços)");
  console.log("  • ResponseComposer.ts — formato, anti-repetição, regras de mídia (hardcoded)");
  console.log("\n📋 PROTOCOLO DE TESTE — rode no simulador: /playbook/simulate → Produção → BW Odontologia");
  console.log("  A: 'quero saber sobre lentes'       → técnicas → vídeo → pergunta de qualificação (sem horários)");
  console.log("  B: 'quero agendar lentes'           → 3 passos ANTES dos horários");
  console.log("  C: 'resina é pior que porcelana?'   → objeção em prosa, sem duplicação, sem preços");
  console.log("  D: 'quanto custa a avaliação?'      → R$ 100 + abatimento (só da política, não do notes)");
  console.log("  E: 'quanto custa?'                  → lentes com 'a partir de' + outros = 'na avaliação'");
  console.log("  F: 'vou pensar...'                  → sem pressão, sem repetir oferta de agenda");
  console.log("  G: 2ª mensagem do lead              → sem mencionar clínica de novo, sem repetir info já dada");

  await sql.end();
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
