/**
 * Ximendes Odontologia — Playbook v5 "Canônico" (Dr. Gregorie Ximendes — especialista em lentes)
 *
 * Versão profissional com arquitetura limpa: cada tipo de regra tem UM único dono.
 * Adaptada para a Ximendes com 13 tratamentos e objeções específicas do
 * portfólio completo da clínica.
 *
 * Conflitos corrigidos vs versões anteriores:
 *
 *   v3 PROBLEMA — commercialPolicy usava bullets (•) e traços (-).
 *     O LLM reproduz o estilo tipográfico que lê. Bullets na policy geravam bullets
 *     nas respostas ao lead — inaceitável para TTS.
 *
 *   v4 PROBLEMA — notes tinha preços ("R$2.500 nacional / R$5.000 importada"),
 *     seção FORMATO e conduta verbosa. Tudo removido desta versão.
 *
 *   v3/v4 PROBLEMA — objection "Quanto custam as lentes? / Qual a diferença?"
 *     duplicava o trigger do notes. Removida das objections (notes cobre).
 *
 *   v3 PROBLEMA — treatment "Lentes de resina composta" tinha preços na descrição.
 *     Removidos. Preços ficam SOMENTE em commercialPolicy.
 *
 *   v3 PROBLEMA — treatment "Avaliação" tinha "R$100, abatido" na descrição.
 *     Removido. Preços ficam SOMENTE em commercialPolicy.
 *
 *   v3 PROBLEMA — differentials tinham "Avaliação de R$100 abatida integralmente".
 *     Substituído por "Avaliação abatida do tratamento" (sem valor explícito).
 *
 *   v3 PROBLEMA — commercialPolicy tinha seção "REGRAS ABSOLUTAS" com regras
 *     que o ResponseComposer já aplica universalmente. Removidas.
 *
 * Arquitetura de responsabilidades:
 *   notes            → triggers comportamentais e sequências (apenas)
 *   commercialPolicy → todos os preços e condições em prosa (apenas)
 *   objections[]     → respostas a objeções (sem sobreposição com notes)
 *   differentials[]  → diferenciais competitivos (sem preços explícitos)
 *   treatments       → descrições factuais (sem preços)
 *   ResponseComposer → formato, anti-repetição, identidade, regras de mídia
 *
 * Run: npx dotenv -e .env.local -- tsx scripts/seed-ximendes-playbook-v5-canonical.ts
 */

import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "crypto";
import { playbookVersions, treatments, clinics } from "../src/infrastructure/db/schema";
import { CONCIERGE_MENU_ITEMS } from "../src/domain/entities/clinic";
import { and, eq, ne } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

const CLINIC_ID = "c9137774-e783-4461-ac2b-e2f01be739a6";

// ─────────────────────────────────────────────────────────────────────────────
// NOTES — SOMENTE triggers comportamentais e sequências obrigatórias.
//
// O que NÃO está aqui (e por quê):
//  • Regras de formato → ResponseComposer.ts (hardcoded, universal)
//  • Respostas a objeções → objections[] abaixo (sem duplicação)
//  • Preços → commercialPolicy (fonte única de preços)
//  • "Nunca pressione" genérico → conversationExperience=concierge cobre isso
//  • "REGRAS ABSOLUTAS" → ResponseComposer.ts (hardcoded, universal)
// ─────────────────────────────────────────────────────────────────────────────
const NOTES = `ESPECIALIDADE DO DR. GREGORIE:
O Dr. Gregorie Ximendes é especialista em lentes de resina composta. Toda conversa sobre lentes tem prioridade máxima e segue a sequência abaixo sem exceção.

TRIGGER DE LENTES — execute SEMPRE que o lead mencionar qualquer referência a lentes ou estética dental: "lentes", "técnica", "simplificada", "estratificada", "lentes de contato dental", "faceta", "faceta de resina", "resina nos dentes", "lente no dente", "lentes de porcelana" ou pedir agendamento relacionado a lentes. NUNCA mostre horários antes de concluir os passos abaixo, mesmo quando a ação for de agendamento.

Passo 1 — apresente cada técnica em dois blocos separados. Em cada bloco: primeiro a explicação em prosa, depois o vídeo correspondente (tag [MEDIA:id] na linha seguinte à explicação).

Bloco A — Técnica Simplificada: escreva em prosa corrida "A Técnica Simplificada usa resina de alta qualidade e entrega um sorriso harmonioso e natural, com investimento mais acessível. É a escolha ideal para quem busca equilíbrio entre resultado e custo." Na linha seguinte, escreva [MEDIA:id] usando o id do vídeo da Simplificada (busque na biblioteca pelo título — deve conter "simplificada").

Bloco B — Técnica Estratificada: escreva em prosa corrida "A Técnica Estratificada usa resina premium em múltiplas camadas, reproduzindo a translucidez e o brilho natural dos dentes. É para quem deseja o nível máximo de personalização e refinamento estético." Na linha seguinte, escreva [MEDIA:id] usando o id do vídeo da Estratificada (busque na biblioteca pelo título — deve conter "estratificada").

Passo 2 — após os dois blocos, pergunte: "Ficou com mais alguma dúvida sobre as técnicas?" Se o lead tiver dúvidas, responda de forma consultiva antes de seguir. Não compacte explicação técnica, convite de foto e agenda no mesmo turno. Se não houver dúvidas, você pode conduzir para a avaliação e só então oferecer horários disponíveis com o Dr. Gregorie.

CONDUTA ESPECÍFICA DA CLÍNICA:
Só ofereça agendamento quando o lead demonstrar interesse real. Toda jornada começa pela avaliação. O endereço (Rua Guararapes, 1894, Brooklin Novo, São Paulo) só ao confirmar agendamento ou se o lead perguntar diretamente.`;

// ─────────────────────────────────────────────────────────────────────────────
// COMMERCIAL POLICY — SOMENTE preços e condições comerciais em prosa.
//
// Fonte única de verdade para valores. Qualquer ajuste de preço: alterar só aqui.
// Sem bullets, traços ou cabeçalhos com maiúsculas — o LLM copia o estilo tipográfico.
// ─────────────────────────────────────────────────────────────────────────────
const COMMERCIAL_POLICY = `A avaliação inicial com o Dr. Gregorie custa R$ 100 e esse valor é integralmente abatido do tratamento se o paciente decidir avançar. Sempre mencione esse abatimento ao falar da avaliação.

Para lentes de resina, único procedimento com valor autorizado por mensagem: Técnica Simplificada a partir de R$ 2.500 para vinte elementos, e Técnica Estratificada a partir de R$ 5.000 para vinte elementos. Sempre diga "a partir de" e que o valor exato depende da avaliação presencial. Responda primeiro a dúvida principal do lead e só conduza para a avaliação quando houver interesse real ou quando ele pedir disponibilidade.

Parcelamento em até 12 vezes. Quando o sistema fornecer simulações de parcelas, apresente-as como exemplos de referência e deixe explícito que a clínica pode parcelar em até 12 vezes. Use uma formulação natural, como "Aqui estão algumas simulações de valores", sem mencionar taxa adicional nem tratar os exemplos como condição única.

Para todos os outros procedimentos: não informe valores por mensagem. Oriente que os valores são definidos na avaliação.`;

// ─────────────────────────────────────────────────────────────────────────────
// PROCEDURE DESCRIPTION — Prosa TTS-friendly. Sem preços, sem bullets.
// ─────────────────────────────────────────────────────────────────────────────
const PROCEDURE_DESCRIPTION = `A Ximendes Odontologia tem como especialidade principal as lentes de resina composta, nas versões Simplificada e Estratificada, realizadas pelo Dr. Gregorie. Além disso, oferece avaliação odontológica, limpeza dental, clareamento dental, restauração em resina, exodontia incluindo siso, implante dentário, tratamento de canal, prótese dentária, lentes de porcelana, gengivoplastia, botox odontológico e harmonização orofacial. Posso explicar com detalhes qualquer um deles.`;

// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIALS — Diferenciais competitivos. Sem preços explícitos.
// ─────────────────────────────────────────────────────────────────────────────
const DIFFERENTIALS = [
  "Especialista em lentes de resina — Técnica Simplificada e Estratificada",
  "Dr. Gregorie avalia pessoalmente o sorriso e mostra o resultado antes de decidir",
  "Avaliação abatida integralmente do tratamento se avançar",
  "Escaneamento Digital 3D — sem moldagens tradicionais",
  "Laboratório próprio com entrega de próteses em 48h",
  "Resina preserva o esmalte — procedimento reversível sem desgaste permanente",
  "Parcelamento em até 12 vezes (juros da operadora)",
];

// ─────────────────────────────────────────────────────────────────────────────
// OBJECTIONS — 11 entradas. Sem sobreposição com o notes.
//
// Removida da v3: "Quanto custam as lentes? / Qual a diferença entre as lentes?"
// → Essa objeção é coberta pelo trigger do notes (3 passos). Duplicar aqui fazia
//   o LLM receber duas versões da mesma resposta.
//
// Respostas em prosa corrida, TTS-friendly — sem \n\n, sem bullets.
// ─────────────────────────────────────────────────────────────────────────────
const OBJECTIONS = [
  {
    objection: "Está muito caro / não tenho esse valor agora",
    response: "O investimento depende do seu caso e da quantidade de dentes. Na avaliação o Dr. Gregorie monta um plano personalizado com valores e parcelamento em até 12 vezes. Os R$ 100 da avaliação são abatidos do tratamento se você decidir avançar.",
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
    objection: "Já fiz lentes em outro lugar e não gostei do resultado",
    response: "Entendo. Na avaliação você pode mostrar o que não gostou e o Dr. Gregorie analisa o caso com cuidado antes de propor qualquer solução. Resultado estético depende muito do olhar e da técnica do profissional.",
  },
  {
    objection: "Não quero pagar a avaliação",
    response: "Os R$ 100 garantem uma consulta completa e dedicada ao seu caso, com raio-x, análise do sorriso e plano detalhado. E esse valor sai integralmente do tratamento se você decidir avançar. Não é custo a mais, é o primeiro passo.",
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
    response: "É muito comum ter essa preocupação. Todos os procedimentos são realizados com anestesia local e a maioria dos pacientes fica surpresa com o quanto é tranquilo. O Dr. Gregorie tem o cuidado de explicar cada etapa antes de começar.",
  },
  {
    objection: "Implante é doloroso? Tenho medo da cirurgia",
    response: "O procedimento é realizado com anestesia local. Durante a cirurgia você não sente dor. No pós-operatório pode haver um desconforto parecido com uma extração simples, controlado com a medicação prescrita pelo Dr. Gregorie.",
  },
  {
    objection: "Canal não mata o dente?",
    response: "Não. O canal remove apenas a polpa infectada. A estrutura do dente fica completamente preservada e ele continua funcional. É a melhor alternativa antes de considerar a extração.",
  },
  {
    objection: "Preciso mesmo de implante? Não dá para fazer uma ponte?",
    response: "A ponte é uma alternativa, mas exige desgaste dos dentes vizinhos saudáveis para servir de apoio. O implante preserva os dentes ao redor e tem durabilidade muito maior. Na avaliação o Dr. Gregorie explica as opções e o que é mais indicado para o seu caso.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TREATMENTS — 13 tratamentos. Descrições factuais sem preços.
// Preços ficam SOMENTE em commercialPolicy.
// ─────────────────────────────────────────────────────────────────────────────
type TreatmentSeed = {
  name: string;
  durationMinutes: number;
  requiresEvaluationFirst: boolean;
  description: string;
};

const TREATMENTS: TreatmentSeed[] = [
  {
    name: "Avaliação",
    durationMinutes: 40,
    requiresEvaluationFirst: false,
    description: "Consulta inicial com o Dr. Gregorie: raio-x, análise do sorriso e montagem do plano de tratamento personalizado. O valor da avaliação é abatido do tratamento se o paciente decidir avançar.",
  },
  {
    name: "Limpeza dental",
    durationMinutes: 40,
    requiresEvaluationFirst: false,
    description: "Profilaxia completa com remoção de tártaro e biofilme. Indicada a cada seis meses.",
  },
  {
    name: "Clareamento dental",
    durationMinutes: 60,
    requiresEvaluationFirst: true,
    description: "A laser (resultado na mesma sessão) ou caseiro com moldeiras. Clareia até oito tons, seguro para o esmalte.",
  },
  {
    name: "Restauração em resina",
    durationMinutes: 60,
    requiresEvaluationFirst: true,
    description: "Resina composta para dentes trincados, lascados ou com cárie. Estético e natural, geralmente em sessão única.",
  },
  {
    name: "Exodontia (extração)",
    durationMinutes: 45,
    requiresEvaluationFirst: true,
    description: "Extração simples ou cirúrgica, incluindo siso incluso. Realizada com anestesia local. Pós-operatório orientado pelo Dr. Gregorie.",
  },
  {
    name: "Implante dentário",
    durationMinutes: 60,
    requiresEvaluationFirst: true,
    description: "Titânio biocompatível com osseointegração. Substitui raiz e coroa como um dente natural. Alta durabilidade.",
  },
  {
    name: "Tratamento de canal",
    durationMinutes: 60,
    requiresEvaluationFirst: true,
    description: "Preserva o dente natural eliminando a infecção da polpa. Indolor com anestesia local.",
  },
  {
    name: "Prótese dentária",
    durationMinutes: 60,
    requiresEvaluationFirst: true,
    description: "Fixa, removível ou protocolo All-on-4. Laboratório próprio com entrega em 48 horas.",
  },
  {
    name: "Lentes de resina composta",
    durationMinutes: 90,
    requiresEvaluationFirst: true,
    description: "Facetas em resina para transformar o sorriso, em duas técnicas. Técnica Simplificada: resina de alta qualidade para um sorriso harmonioso e natural. Técnica Estratificada: resina premium em múltiplas camadas, reproduzindo translucidez e brilho, para o máximo de personalização. A técnica ideal e os valores são definidos na avaliação com o Dr. Gregorie.",
  },
  {
    name: "Lentes de porcelana (facetas)",
    durationMinutes: 90,
    requiresEvaluationFirst: true,
    description: "Alta durabilidade e estética superior. Exige leve desgaste do esmalte para fixação. Resultado definitivo.",
  },
  {
    name: "Gengivoplastia",
    durationMinutes: 45,
    requiresEvaluationFirst: true,
    description: "Remodelamento do contorno gengival para equilibrar o sorriso. Pode ser feita a laser ou bisturi, com recuperação rápida.",
  },
  {
    name: "Botox odontológico",
    durationMinutes: 30,
    requiresEvaluationFirst: true,
    description: "Para bruxismo, DTM e harmonização do sorriso gengival. Complementa tratamentos estéticos.",
  },
  {
    name: "Harmonização orofacial",
    durationMinutes: 60,
    requiresEvaluationFirst: true,
    description: "Preenchimento labial, bichectomia, bioestimuladores e toxina botulínica. Protocolo seguro, resultado natural.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🚀 Ximendes Odontologia — seed v5 (Canônico / Dr. Gregorie — especialista em lentes)\n");
  console.log("Arquitetura limpa: cada regra tem um único dono.\n");

  // 1. Confirma clínica com modo concierge e greeting message
  await db
    .update(clinics)
    .set({
      specialty: "Odontologia Estética e Reabilitação Oral",
      greetingMessage: "Olá! Sou a recepcionista virtual da Ximendes Odontologia. Como posso ajudar?",
      menuItems: CONCIERGE_MENU_ITEMS,
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, CLINIC_ID));
  console.log("✅ Clínica: specialty, greetingMessage e conversationExperience=concierge OK");

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
      name: "Ximendes Odontologia — Canônico v5 (Dr. Gregorie — especialista em lentes)",
      status: "active",
      specialty: "Odontologia Estética e Reabilitação Oral",
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

  // 5. Substitui todos os treatments pelos 13 canônicos
  const deleted = await db
    .delete(treatments)
    .where(eq(treatments.clinicId, CLINIC_ID))
    .returning({ id: treatments.id });
  console.log(`✅ ${deleted.length} treatment(s) anterior(es) removido(s)`);

  const now = new Date();
  const treatmentRows = TREATMENTS.map((t) => ({
    id: randomUUID(),
    clinicId: CLINIC_ID,
    name: t.name,
    durationMinutes: t.durationMinutes,
    requiresEvaluationFirst: t.requiresEvaluationFirst,
    description: t.description,
    commonObjections: [] as string[],
    createdAt: now,
    updatedAt: now,
  }));

  await db.insert(treatments).values(treatmentRows);
  console.log(`✅ ${treatmentRows.length} treatments inseridos`);

  console.log("\n─────────────────────────────────────────────────────");
  console.log("v5 canônico completo. Mapa de responsabilidades:");
  console.log("  • notes        — trigger 3 passos + conduta específica (sem formato, sem objeções inline, sem preços)");
  console.log("  • policy       — todos os preços em prosa (fonte única, sem bullets)");
  console.log("  • description  — 13 tratamentos em prosa TTS-friendly (sem preços)");
  console.log("  • differentials — 7 diferenciais sem valores explícitos");
  console.log("  • objections   — 11 objeções sem sobreposição com o notes");
  console.log("  • treatments   — 13 tratamentos com descrições factuais (sem preços)");
  console.log("  • ResponseComposer.ts — formato, anti-repetição, regras de mídia (hardcoded)");
  console.log("\n📋 PROTOCOLO DE TESTE — rode no simulador: /playbook/simulate → Produção → Ximendes Odontologia");
  console.log("  A: 'quero saber sobre lentes'       → técnicas → vídeo → pergunta de qualificação (sem horários)");
  console.log("  B: 'quero agendar lentes'           → 3 passos ANTES dos horários");
  console.log("  C: 'resina é pior que porcelana?'   → objeção em prosa, sem preços, sem duplicação");
  console.log("  D: 'quanto custa a avaliação?'      → R$ 100 + abatimento (da política, não do notes)");
  console.log("  E: 'quanto custa o implante?'       → valores definidos na avaliação (sem inventar)");
  console.log("  F: 'vou pensar...'                  → sem pressão, sem repetir oferta de agenda");
  console.log("  G: 'canal não mata o dente?'        → objeção canal em prosa");
  console.log("  H: 2ª mensagem do lead              → sem mencionar clínica de novo, sem repetir info já dada");

  await sql.end();
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
