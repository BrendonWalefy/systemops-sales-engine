/**
 * Cria a versão inicial do playbook da Ximendes no sistema de versões.
 * Ativa a versão e atualiza os campos da clínica para o pipeline de IA.
 *
 * Run: npx tsx scripts/seed-ximendes-playbook-version.ts
 * Requires: DATABASE_URL in environment (or .env.local)
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { clinics, playbookVersions } from "../src/infrastructure/db/schema";
import { eq, and, ne } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

const CLINIC_ID = "c9137774-e783-4461-ac2b-e2f01be739a6";

// ─── Configurações da versão ──────────────────────────────────────────────────

const VERSION_NAME = "Ximendes — Padrão";

const SPECIALTY = "Odontologia Estética e Reabilitação Oral";

const PROCEDURE_DESCRIPTION = `A Ximendes Odontologia oferece tratamentos completos de estética e saúde bucal:

LIMPEZA DENTAL
Profilaxia completa com remoção de tártaro e biofilme. Indicada a cada 6 meses para prevenção e saúde gengival.

CLAREAMENTO DENTAL
A laser (resultados visíveis na mesma sessão) ou caseiro com moldeiras personalizadas (7 a 14 dias). Clareia até 8 tons. Seguro para o esmalte com o protocolo utilizado pela clínica.

RESTAURAÇÕES
Resina composta para dentes trincados, lascados ou com cárie. Resultado estético e natural, feito em sessão única. Combina com a cor natural do dente.

EXODONTIA
Extração simples ou cirúrgica, incluindo dentes do siso inclusos. Realizada com anestesia local. Pós-operatório controlado com medicação orientada pelo Dr. Gregory.

IMPLANTES DENTÁRIOS
Titânio biocompatível com osseointegração. Substitui raiz e coroa, funcionando como um dente natural. Alta durabilidade — com cuidados adequados, pode durar a vida toda.

TRATAMENTO DE CANAL (Endodontia)
Preserva o dente natural eliminando a infecção da polpa. Indolor com anestesia local. O dente continua funcional por muitos anos após o tratamento.

PRÓTESE DENTÁRIA
Fixa (sobre implantes), removível total ou parcial, ou protocolo All-on-4 para reabilitação completa. Confeccionada no laboratório próprio com entrega em 48h.

LENTES DE RESINA COMPOSTA
Facetas ultra-finas aplicadas diretamente sobre o esmalte sem desgaste. Procedimento reversível, feito em sessão única de 2 a 4 horas. Transforma o sorriso preservando 100% do dente natural.

LENTES DE PORCELANA (Facetas)
Alta durabilidade e estética superior. Exige leve desgaste do esmalte. Resultado definitivo e permanente, com aparência extremamente natural.

GENGIVOPLASTIA
Remodelamento do contorno gengival para equilibrar o sorriso gengival. Realizada a laser ou com bisturi, com recuperação rápida.

BOTOX ODONTOLÓGICO
Aplicado para tratamento de bruxismo, disfunção temporomandibular (DTM) e harmonização do sorriso gengival. Complementa tratamentos estéticos.

HARMONIZAÇÃO OROFACIAL
Combina estética facial e oral: preenchimento labial, bichectomia, bioestimuladores de colágeno e toxina botulínica. Realizado com protocolo seguro e resultado natural.`;

const TONE_OF_VOICE = "tecnico";

const DIFFERENTIALS = [
  "Escaneamento Digital 3D — sem moldagens tradicionais",
  "Laboratório próprio com entrega de próteses em 48h",
  "Dente original preservado sempre que possível",
  "Atendimento exclusivo com Dr. Gregory Ximendes",
  "Ambiente climatizado, TV e Wi-Fi durante o procedimento",
  "Parcelamento em até 12x (juros da operadora)",
  "Avaliação de R$100 abatida integralmente do tratamento",
];

const COMMERCIAL_POLICY = `Nunca informar valores de procedimentos por mensagem.

AVALIAÇÃO PRESENCIAL:
A avaliação custa R$100. Se o paciente decidir avançar com qualquer procedimento, esse valor é integralmente descontado do tratamento. Comunique sempre o abatimento — o lead conhece o trabalho com calma e o investimento já conta para o tratamento.

PARCELAMENTO:
Os procedimentos podem ser parcelados em até 12 vezes. As parcelas têm acréscimo dos juros da operadora de cartão. Mencione isso de forma natural quando o tema "valor" surgir, sem entrar em detalhes técnicos das taxas.

ENDEREÇO:
Compartilhe apenas ao confirmar agendamento ou quando o lead perguntar diretamente.
"Rua Guararapes, 1894 — Brooklin Novo, São Paulo/SP."

REGRAS ABSOLUTAS:
- NUNCA cite valor de procedimentos por mensagem
- SEMPRE mencione o abatimento dos R$100 ao falar da avaliação
- NUNCA pressione para fechar na primeira mensagem
- NÃO ofereça agendamento em toda mensagem — apenas quando o lead demonstrar interesse claro`;

const OBJECTIONS = [
  {
    objection: "Está muito caro / não tenho esse valor agora",
    response: "O investimento varia de acordo com o caso e a quantidade de dentes. Na avaliação o Dr. Gregory apresenta um plano personalizado com os valores e condições de parcelamento — em até 12x. E os R$100 da avaliação são descontados do tratamento se você decidir avançar.",
  },
  {
    objection: "Vou pensar...",
    response: "Claro, sem nenhuma pressa. Qualquer dúvida que surgir pode me chamar aqui. Quando quiser, a agenda está aberta.",
  },
  {
    objection: "Tenho medo de dor / medo de dentista",
    response: "É muito comum ter essa preocupação. Todos os procedimentos da clínica são realizados com anestesia local — a maioria dos pacientes fica surpreso com o quanto é tranquilo. O Dr. Gregory tem o cuidado de explicar cada etapa antes de começar.",
  },
  {
    objection: "Não quero pagar a avaliação",
    response: "Os R$100 garantem uma consulta completa e dedicada ao seu caso — raio-x, análise do sorriso e plano de tratamento detalhado. E esse valor sai integralmente do seu tratamento caso decida avançar. Não é um custo a mais, é o primeiro passo do investimento.",
  },
  {
    objection: "Porcelana não é mais durável que resina?",
    response: "É verdade que a porcelana tem durabilidade maior. Mas ela exige desgaste permanente e irreversível do esmalte — o dente não volta ao estado original. A resina preserva 100% do dente, é reversível e tem resultado estético muito bom. Na avaliação o Dr. Gregory mostra casos dos dois e explica qual faz mais sentido para o seu sorriso.",
  },
  {
    objection: "Implante é doloroso? Tenho medo da cirurgia",
    response: "O procedimento é realizado com anestesia local. Durante a cirurgia você não sente dor. No pós-operatório pode haver um desconforto parecido com uma extração simples, controlado com a medicação prescrita pelo Dr. Gregory.",
  },
  {
    objection: "Canal não mata o dente?",
    response: "Não. O canal remove apenas a polpa infectada — a estrutura do dente fica completamente preservada. O dente continua vivo, ancorado no osso e funcional. É a melhor alternativa antes de considerar a extração.",
  },
  {
    objection: "Clareamento danifica o esmalte?",
    response: "O protocolo que utilizamos é seguro e aprovado. Pode causar sensibilidade temporária durante o tratamento, mas não prejudica o esmalte. Na avaliação verificamos se o seu caso é indicado e qual modalidade — laser ou caseiro — traz o melhor resultado.",
  },
  {
    objection: "Tenho medo que fique artificial / exagerado",
    response: "O resultado é personalizado junto com você — cor, forma e transparência escolhidas para combinar com o seu rosto e o tom da sua pele. O Dr. Gregory tem cases para mostrar na avaliação. O objetivo é um sorriso que pareça natural, só mais bonito.",
  },
  {
    objection: "Já fiz em outro lugar e não gostei do resultado",
    response: "Resultado estético depende muito do olhar e da técnica do profissional. Na avaliação você pode ver os casos da clínica e conversar abertamente sobre o que não gostou no tratamento anterior — o Dr. Gregory vai analisar e propor o que faz sentido para o seu caso.",
  },
  {
    objection: "Preciso mesmo de implante? Não dá para fazer uma ponte?",
    response: "A ponte é uma alternativa, mas exige desgaste dos dentes vizinhos saudáveis para servir de apoio. O implante preserva os dentes ao redor e tem durabilidade muito maior. Na avaliação o Dr. Gregory explica as opções e o que é mais indicado para o seu caso.",
  },
  {
    objection: "Harmonização facial é feita mesmo no dentista?",
    response: "Sim. Dentistas são os profissionais mais habilitados para harmonização orofacial — conhecem profundamente a anatomia da face e da região oral. O Dr. Gregory realiza o procedimento com protocolo seguro e resultado natural, sempre com foco no equilíbrio entre sorriso e face.",
  },
];

// ─── Compilação para os campos da clínica ────────────────────────────────────

function buildClinicPlaybook(): string {
  const parts: string[] = [];

  parts.push(`ESPECIALIDADE: ${SPECIALTY}`);
  parts.push(`\nSERVIÇOS OFERECIDOS:\n${PROCEDURE_DESCRIPTION}`);
  parts.push(
    `\nDIFERENCIAIS DA CLÍNICA:\n${DIFFERENTIALS.map((d) => `• ${d}`).join("\n")}`,
  );

  const objText = OBJECTIONS.map(
    (o) => `Objeção: ${o.objection}\nResposta: ${o.response}`,
  ).join("\n\n");
  parts.push(`\nOBJEÇÕES E RESPOSTAS:\n${objText}`);

  return parts.join("\n");
}

const COMPILED_TONE =
  "Profissional, cordial e objetivo. Sem informalidades ou gírias. Nunca pressionar o lead para agendar. Responder de forma direta e clara. Oferecer agendamento apenas quando o lead demonstrar interesse claro ou perguntar sobre disponibilidade.";

// ─── Script principal ─────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Iniciando seed do playbook da Ximendes...\n");

  // 1. Arquivar versões ativas anteriores
  const archived = await db
    .update(playbookVersions)
    .set({ status: "historical", updatedAt: new Date() })
    .where(
      and(
        eq(playbookVersions.clinicId, CLINIC_ID),
        ne(playbookVersions.status, "draft"),
      ),
    )
    .returning({ id: playbookVersions.id });

  if (archived.length > 0) {
    console.log(`📦 ${archived.length} versão(ões) anterior(es) arquivada(s).`);
  }

  // 2. Inserir nova versão como ativa
  const [version] = await db
    .insert(playbookVersions)
    .values({
      clinicId: CLINIC_ID,
      name: VERSION_NAME,
      status: "active",
      specialty: SPECIALTY,
      procedureDescription: PROCEDURE_DESCRIPTION,
      toneOfVoice: TONE_OF_VOICE,
      differentials: DIFFERENTIALS,
      commercialPolicy: COMMERCIAL_POLICY,
      objections: OBJECTIONS,
    })
    .returning({ id: playbookVersions.id });

  console.log(`✅ Versão criada: "${VERSION_NAME}" (id: ${version.id})`);

  // 3. Atualizar campos da clínica para o pipeline de IA
  await db
    .update(clinics)
    .set({
      specialty: "Odontologia Estética e Reabilitação Oral",
      toneOfVoice: COMPILED_TONE,
      commercialPolicy: COMMERCIAL_POLICY,
      playbook: buildClinicPlaybook(),
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, CLINIC_ID));

  console.log("✅ Campos da clínica atualizados (specialty, toneOfVoice, commercialPolicy, playbook)");
  console.log("\n📋 Resumo:");
  console.log(`   • Especialidade: ${SPECIALTY}`);
  console.log(`   • Procedimentos: 12`);
  console.log(`   • Diferenciais: ${DIFFERENTIALS.length}`);
  console.log(`   • Objeções mapeadas: ${OBJECTIONS.length}`);
  console.log(`   • Status: ATIVO — IA já usando esta versão\n`);

  await sql.end();
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
