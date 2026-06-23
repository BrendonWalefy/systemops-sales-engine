/**
 * Seed da clínica fictícia premium "Odonto Marques" — fonte única de verdade,
 * usada tanto pelo CLI (`npm run seed:demo`) quanto pelo botão do painel owner
 * ("Carregar clínica demo").
 *
 * É um TENANT REAL (não há "modo demo" em runtime): o dashboard, o inbox e a
 * agenda são calculados ao vivo, então geramos VOLUME realista para bater os
 * números do kit de marketing — sem nenhum dado real de pessoas.
 *
 * Idempotente: cada execução APAGA e recria os dados da clínica (reset limpo),
 * datando os registros relativos ao momento da execução.
 */
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { hashPassword } from "@/lib/password";
import { syncModulesForPlan } from "@/application/modules/module-gate";
import {
  clinics,
  treatments,
  professionals,
  leads,
  conversations,
  messages,
  appointments,
  calendarBlocks,
  followUps,
  playbookVersions,
  clinicMembers,
  conversationStates,
  clinicMetrics,
  clinicModules,
  agentRecommendations,
  slotReservations,
} from "@/infrastructure/db/schema";

// ── Identidade da demo ──────────────────────────────────────────────────
export const DEMO_CLINIC_NAME = "Odonto Marques";
export const DEMO_CLINIC_SLUG = "odonto-marques";
export const DEMO_ADMIN_EMAIL = "helena@odontomarques.com.br";
export const DEMO_ADMIN_PASSWORD = "OdontoMarques2026!";
const PLAN = "clinica" as const;

export type DemoSeedResult = {
  clinicId: string;
  slug: string;
  adminEmail: string;
  adminPassword: string;
  counts: {
    leads: number;
    conversations: number;
    messages: number;
    agentMessages: number;
    appointments: number;
    followUps: number;
    afterHoursMessages: number;
    hoursSaved: number;
  };
};

const COLORS = {
  verde: "#10B981",
  azul: "#3B82F6",
  roxo: "#8B5CF6",
  dourado: "#D4AF37",
};

const DAY = 86_400_000;

function pick<T>(arr: readonly T[], i: number): T {
  return arr[((i % arr.length) + arr.length) % arr.length];
}

// ── Pools de nomes fictícios premium (sem nomes reais próximos) ──────────
const FIRST_NAMES = [
  "Camila", "Mariana", "Lucas", "Ana Beatriz", "Renata", "Pedro Henrique",
  "Sabrina", "Patrícia", "Felipe", "Juliana", "Larissa", "Thiago",
  "Isabela", "Fernanda", "Gabriela", "Rodrigo", "Bruno", "Carolina",
  "Vanessa", "Daniela", "Marcela", "Leonardo", "Rafael", "Aline",
  "Bruna", "Letícia", "Amanda", "Eduardo", "Vinícius", "Tatiana",
  "Priscila", "Natália", "Rafaela", "Henrique", "Otávio", "Bárbara",
  "Cristina", "Adriana", "Mateus", "Gustavo", "Yasmin", "Helena",
  "Clara", "Sofia", "Beatriz", "Lorena", "Diego", "André",
];
const LAST_NAMES = [
  "Rocha", "Alves", "Ferreira", "Lima", "Melo", "Gomes", "Santos",
  "Costa", "Fonseca", "Barros", "Monteiro", "Barbosa", "Mendes",
  "Cardoso", "Ribeiro", "Carvalho", "Teixeira", "Moreira", "Pinto",
  "Azevedo", "Cavalcanti", "Macedo", "Nogueira", "Tavares", "Brandão",
  "Coelho", "Pacheco", "Andrade", "Vasconcelos", "Siqueira", "Furtado",
  "Bittencourt", "Rezende", "Camargo", "Queiroz", "Sampaio",
];

const CHANNELS = ["whatsapp", "whatsapp", "whatsapp", "instagram", "meta_ads", "referral"] as const;

const LEAD_OPENERS: Record<string, string[]> = {
  "Lentes de porcelana": [
    "Oi! Vocês fazem lentes de porcelana?",
    "Queria saber sobre lentes pra fechar uns espaços nos dentes.",
    "Vi o Instagram de vocês, fiquei interessada nas lentes.",
  ],
  "Clareamento dental": [
    "Boa tarde, quanto custa o clareamento?",
    "Queria clarear os dentes pra um evento, dá tempo?",
    "Vocês fazem clareamento a laser?",
  ],
  "Implante dentário": [
    "Perdi um dente e queria avaliar implante.",
    "Vocês fazem implante? Quanto fica?",
    "Tenho um espaço de um dente que caiu, dá pra implante?",
  ],
  "Alinhadores invisíveis": [
    "Queria alinhar os dentes sem aparelho fixo, vocês têm?",
    "Como funcionam os alinhadores invisíveis?",
    "Meu caso dá pra corrigir com alinhador?",
  ],
  "Avaliação estética": [
    "Queria fazer uma avaliação do meu sorriso.",
    "Gostaria de agendar uma avaliação estética.",
    "Posso marcar uma avaliação pra entender o que dá pra melhorar?",
  ],
  "Harmonização facial": [
    "Vocês fazem harmonização facial?",
    "Queria saber sobre harmonização, preenchimento.",
    "Fazem harmonização orofacial aí?",
  ],
  "Limpeza e profilaxia": [
    "Quero marcar uma limpeza.",
    "Faz quanto tempo que não faço limpeza, dá pra agendar?",
    "Quanto custa a profilaxia?",
  ],
};

const AGENT_LINES = [
  "Olá! Que bom falar com você 😊 Posso te explicar como funciona e já ver horários, tudo bem?",
  "Fazemos sim! O ideal é uma avaliação rápida pra entender seu caso com segurança. Quer ver os horários?",
  "Perfeito. Posso te mostrar algumas opções de horário esta semana?",
  "Ótimo! Vou separar uns horários e já te envio aqui.",
  "Qualquer dúvida sobre o procedimento eu te explico com calma, viu?",
  "Combinado! Deixei pré-reservado e a equipe confirma antes da consulta.",
];

const FOLLOWUP_LINE =
  "Oi! Passando pra saber se ainda faz sentido seguirmos com sua avaliação. Temos novos horários esta semana — quer que eu te envie as opções?";

// ── Plano de valores (centavos) — somam EXATAMENTE os alvos de receita ──
const PRICE_CYCLE: { t: string; v: number }[] = [
  { t: "Implante dentário", v: 290000 },
  { t: "Lentes de porcelana", v: 180000 },
  { t: "Harmonização facial", v: 89000 },
  { t: "Clareamento dental", v: 69000 },
  { t: "Alinhadores invisíveis", v: 35000 },
  { t: "Limpeza e profilaxia", v: 22000 },
  { t: "Avaliação estética", v: 15000 },
];

function buildValuePlan(count: number, targetCents: number): { t: string; v: number }[] {
  const plan: { t: string; v: number }[] = [];
  for (let i = 0; i < count - 1; i++) plan.push({ ...pick(PRICE_CYCLE, i) });
  const partial = plan.reduce((a, b) => a + b.v, 0);
  plan.push({ t: "Implante dentário", v: targetCents - partial });
  return plan;
}

// ── Reset idempotente (respeita FKs) ────────────────────────────────────
async function resetClinic(clinicId: string): Promise<void> {
  const convIdsRows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.clinicId, clinicId));
  const convIds = convIdsRows.map((r) => r.id);

  if (convIds.length > 0) {
    await db.delete(messages).where(inArray(messages.conversationId, convIds));
    await db.delete(conversationStates).where(inArray(conversationStates.conversationId, convIds));
  }
  await db.delete(agentRecommendations).where(eq(agentRecommendations.clinicId, clinicId));
  await db.delete(slotReservations).where(eq(slotReservations.clinicId, clinicId));
  await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
  await db.delete(calendarBlocks).where(eq(calendarBlocks.clinicId, clinicId));
  await db.delete(followUps).where(eq(followUps.clinicId, clinicId));
  await db.delete(conversations).where(eq(conversations.clinicId, clinicId));
  await db.delete(clinicMembers).where(eq(clinicMembers.clinicId, clinicId));
  await db.delete(treatments).where(eq(treatments.clinicId, clinicId));
  await db.delete(professionals).where(eq(professionals.clinicId, clinicId));
  await db.delete(playbookVersions).where(eq(playbookVersions.clinicId, clinicId));
  await db.delete(clinicMetrics).where(eq(clinicMetrics.clinicId, clinicId));
  await db.delete(clinicModules).where(eq(clinicModules.clinicId, clinicId));
  await db.delete(leads).where(eq(leads.clinicId, clinicId));
  await db.delete(clinics).where(eq(clinics.id, clinicId));
}

async function insertChunked<T>(
  table: Parameters<typeof db.insert>[0],
  rows: T[],
  size = 400,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await db.insert(table).values(rows.slice(i, i + size));
  }
}

type LeadRow = typeof leads.$inferInsert;
type ConvRow = typeof conversations.$inferInsert;
type MsgRow = typeof messages.$inferInsert;
type ApptRow = typeof appointments.$inferInsert;
type FollowRow = typeof followUps.$inferInsert;
type StateRow = typeof conversationStates.$inferInsert;

/**
 * Cria/reseta a clínica demo e devolve um resumo do volume gerado.
 * NÃO checa a flag de habilitação — quem chama (server action) decide.
 */
export async function seedDemoClinic(): Promise<DemoSeedResult> {
  const now = new Date();

  /** Data com hora-de-parede no fuso de São Paulo (UTC-3). daysFromNow negativo = futuro. */
  function spAt(daysFromNow: number, spHour: number, spMin = 0): Date {
    const d = new Date(now.getTime() - daysFromNow * DAY);
    d.setUTCHours(spHour + 3, spMin, 0, 0);
    return d;
  }

  function isNight(d: Date): boolean {
    const spHour = (d.getUTCHours() + 24 - 3) % 24;
    return spHour >= 18 || spHour < 8;
  }

  let nameSeed = 0;
  function genName(): string {
    const f = pick(FIRST_NAMES, nameSeed * 13 + 5);
    const l = pick(LAST_NAMES, nameSeed * 7 + 3);
    nameSeed++;
    return `${f} ${l}`;
  }

  let phoneSeed = 0;
  function genPhone(): string {
    const n = 910000000 + phoneSeed * 137;
    phoneSeed++;
    const s = String(n);
    return `+55 11 9${s.slice(1, 5)}-${s.slice(5, 9)}`;
  }

  const leadRows: LeadRow[] = [];
  const convRows: ConvRow[] = [];
  const msgRows: MsgRow[] = [];
  const apptRows: ApptRow[] = [];
  const followRows: FollowRow[] = [];
  const stateRows: StateRow[] = [];

  let agentMsgCount = 0;
  let afterHoursCount = 0;

  function addMsg(
    conversationId: string,
    author: "lead" | "agent" | "clinic_user" | "system",
    body: string,
    sentAt: Date,
    intent?: string,
  ): void {
    msgRows.push({ id: randomUUID(), conversationId, author, body, sentAt, intent: intent ?? null });
    if (author === "agent") agentMsgCount++;
  }

  type MakeLeadOpts = {
    clinicId: string;
    name: string;
    status:
      | "in_conversation"
      | "waiting_response"
      | "appointment_scheduled"
      | "follow_up_due"
      | "won"
      | "lost";
    temperature: "hot" | "warm" | "cold" | null;
    treatmentInterest: string;
    createdAt: Date;
    channel?: (typeof CHANNELS)[number];
    aiPaused?: boolean;
    needsAttention?: boolean;
    attentionReason?: string | null;
    takeoverExpiresAt?: Date | null;
    thread: { author: "lead" | "agent" | "clinic_user"; body: string; at: Date; intent?: string }[];
  };

  function makeLead(opts: MakeLeadOpts): { leadId: string; convId: string } {
    const leadId = randomUUID();
    const convId = randomUUID();
    const channel = opts.channel ?? "whatsapp";

    leadRows.push({
      id: leadId,
      clinicId: opts.clinicId,
      name: opts.name,
      phone: genPhone(),
      channel,
      treatmentInterest: opts.treatmentInterest,
      status: opts.status,
      temperature: opts.temperature,
      createdAt: opts.createdAt,
      updatedAt: opts.createdAt,
    });

    const sorted = [...opts.thread].sort((a, b) => a.at.getTime() - b.at.getTime());
    const lastAt = sorted.length ? sorted[sorted.length - 1].at : opts.createdAt;

    convRows.push({
      id: convId,
      clinicId: opts.clinicId,
      leadId,
      channel,
      category: "sales",
      aiPaused: opts.aiPaused ?? false,
      needsAttention: opts.needsAttention ?? false,
      attentionReason: opts.attentionReason ?? null,
      takeoverExpiresAt: opts.takeoverExpiresAt ?? null,
      lastMessageAt: lastAt,
      createdAt: opts.createdAt,
      updatedAt: lastAt,
    });

    for (const m of sorted) addMsg(convId, m.author, m.body, m.at, m.intent);

    return { leadId, convId };
  }

  // 0) reset
  const existing = await db
    .select({ id: clinics.id })
    .from(clinics)
    .where(eq(clinics.slug, DEMO_CLINIC_SLUG))
    .limit(1)
    .then((r) => r[0] ?? null);
  if (existing) await resetClinic(existing.id);

  const clinicId = randomUUID();

  // 1) clínica
  await db.insert(clinics).values({
    id: clinicId,
    name: DEMO_CLINIC_NAME,
    slug: DEMO_CLINIC_SLUG,
    specialty: "Odontologia estética e reabilitação oral",
    segment: "dental",
    city: "São Paulo, SP",
    address: "Rua dos Jardins, 1200 — Jardim Paulista, São Paulo, SP",
    timezone: "America/Sao_Paulo",
    businessHours: "Seg–sex 08h–19h · Sáb 08h–13h",
    greetingMessage:
      "Olá! Seja bem-vindo à Odonto Marques. Sou a Marina, assistente virtual da clínica. " +
      "Posso te ajudar com informações, avaliação, horários disponíveis e dúvidas sobre tratamentos. Como posso te ajudar hoje?",
    menuItems: [
      { number: 1, label: "Lentes de porcelana", intent: "procedures", enabled: true, treatmentKeyword: "lentes" },
      { number: 2, label: "Agendar avaliação", intent: "book_appointment", enabled: true },
      { number: 3, label: "Clareamento", intent: "procedures", enabled: true, treatmentKeyword: "clareamento" },
      { number: 4, label: "Implantes", intent: "procedures", enabled: true, treatmentKeyword: "implante" },
      { number: 5, label: "Valores", intent: "price_inquiry", enabled: true },
      { number: 6, label: "Endereço e horários", intent: "location", enabled: true },
      { number: 7, label: "Falar com equipe", intent: "needs_human", enabled: true },
    ],
    receptionistPhone: "+55 11 90000-0000",
    calendarMode: "internal",
    autoReplyEnabled: false, // segurança: nunca tenta responder via Z-API
    plan: PLAN,
    operationalStatus: "active",
    monthlyRevenueBrl: 452083, // calibra ROI = 21.700 / 4.520,83 = 4,8x
    isTest: true, // mantém a demo fora dos crons/digest de produção
    createdAt: spAt(120, 9),
    updatedAt: now,
  });

  // 2) profissionais
  const profHelena = randomUUID();
  const profRafael = randomUUID();
  const profCamila = randomUUID();
  const profAndre = randomUUID();
  await db.insert(professionals).values([
    { id: profHelena, clinicId, name: "Dra. Helena Marques", specialty: "Lentes, estética e clareamento", color: COLORS.verde },
    { id: profRafael, clinicId, name: "Dr. Rafael Nogueira", specialty: "Implantes e cirurgia", color: COLORS.azul },
    { id: profCamila, clinicId, name: "Dra. Camila Torres", specialty: "Ortodontia e alinhadores", color: COLORS.roxo },
    { id: profAndre, clinicId, name: "Dr. André Vilela", specialty: "Avaliação geral e harmonização", color: COLORS.dourado },
  ]);
  const profByTreatment: Record<string, string> = {
    "Lentes de porcelana": profHelena,
    "Clareamento dental": profHelena,
    "Avaliação estética": profHelena,
    "Harmonização facial": profAndre,
    "Implante dentário": profRafael,
    "Alinhadores invisíveis": profCamila,
    "Limpeza e profilaxia": profAndre,
    "Avaliação geral": profAndre,
  };

  // 3) membros admin
  await db.insert(clinicMembers).values([
    // Login principal da demo (Dra. Helena → "Olá, Dra. Helena!" no dashboard)
    {
      clinicId,
      email: DEMO_ADMIN_EMAIL,
      role: "clinic_admin",
      professionalId: profHelena,
      passwordHash: await hashPassword(DEMO_ADMIN_PASSWORD),
    },
    // Owner do sistema — acesso direto à visão de clínica sem trocar de conta
    {
      clinicId,
      email: "brendonwalefyom@gmail.com",
      role: "clinic_admin",
      professionalId: null,
      passwordHash: await hashPassword(DEMO_ADMIN_PASSWORD),
    },
  ]);

  // 4) procedimentos
  const treatmentIds: Record<string, string> = {};
  const treatmentDefs: (typeof treatments.$inferInsert)[] = [
    {
      clinicId, name: "Avaliação estética", durationMinutes: 40, priceCents: 15000,
      description: "Consulta inicial para diagnóstico do sorriso e plano de tratamento.",
      isAesthetic: true, commonObjections: ["Tem custo?", "Quanto tempo dura?", "Preciso de exames?"],
    },
    {
      clinicId, name: "Lentes de porcelana", durationMinutes: 60, minPriceCents: 180000,
      description: "A partir de R$ 1.800 por dente, sempre após avaliação. Melhora formato, cor e harmonia do sorriso.",
      isAesthetic: true, requiresEvaluationFirst: true,
      commonObjections: ["Muito caro", "Dói?", "Quanto tempo leva?"],
    },
    {
      clinicId, name: "Clareamento dental", durationMinutes: 50, minPriceCents: 69000,
      description: "A partir de R$ 690. A laser na clínica ou com moldeiras para uso em casa.",
      commonObjections: ["Vai sensibilizar?", "Quanto dura?", "Quanto custa?"],
    },
    {
      clinicId, name: "Implante dentário", durationMinutes: 60, minPriceCents: 290000,
      description: "A partir de R$ 2.900. Implante de titânio para substituir dente ausente, após avaliação e exames.",
      requiresEvaluationFirst: true,
      commonObjections: ["Muito caro", "Dói?", "Quanto tempo leva?"],
    },
    {
      clinicId, name: "Alinhadores invisíveis", durationMinutes: 45, minPriceCents: 35000,
      description: "A partir de R$ 350/mês. Correção ortodôntica com alinhadores transparentes removíveis.",
      commonObjections: ["Quanto custa?", "Quanto tempo demora?", "É melhor que aparelho fixo?"],
    },
    {
      clinicId, name: "Limpeza e profilaxia", durationMinutes: 40, priceCents: 22000,
      description: "Limpeza profissional, remoção de tártaro e polimento.",
      commonObjections: ["Quanto custa?", "Dói?", "Com que frequência?"],
    },
    {
      clinicId, name: "Harmonização facial", durationMinutes: 45, minPriceCents: 89000,
      description: "A partir de R$ 890. Procedimentos estéticos faciais realizados pelo dentista.",
      isAesthetic: true,
      commonObjections: ["É seguro?", "Quanto dura o resultado?", "Quanto custa?"],
    },
  ];
  for (const def of treatmentDefs) {
    const id = randomUUID();
    treatmentIds[def.name] = id;
    await db.insert(treatments).values({ ...def, id });
  }

  // 5) playbook ativo
  await db.insert(playbookVersions).values({
    clinicId,
    name: "Odonto Marques — demo",
    status: "active",
    specialty: "Odontologia estética e reabilitação oral",
    procedureDescription:
      "Clínica de odontologia estética e reabilitação oral. Procedimentos: avaliação estética (R$ 150), " +
      "lentes de porcelana (a partir de R$ 1.800 por dente), clareamento dental (a partir de R$ 690), " +
      "implante dentário (a partir de R$ 2.900), alinhadores invisíveis (a partir de R$ 350/mês), " +
      "limpeza e profilaxia (R$ 220) e harmonização facial (a partir de R$ 890).",
    toneOfVoice: "Consultivo, acolhedor, elegante e objetivo. Trata por você, com cordialidade premium.",
    commercialPolicy:
      "Valores sempre apresentados como 'a partir de', pois dependem de avaliação. Lentes são cobradas por dente. " +
      "Alinhadores têm valor mensal. Parcelamos no cartão. Procedimentos estéticos exigem avaliação prévia. " +
      "A avaliação estética custa R$ 150 e é o ponto de partida para lentes, implantes e harmonização.",
    notes: "Recepcionista virtual: Marina. Sempre oferecer horários reais e confirmar antes da consulta.",
    differentials: [
      "Atendimento humanizado e premium",
      "Planejamento digital do sorriso",
      "Equipe especializada por área",
      "Agenda flexível, inclusive aos sábados",
    ],
    objections: [
      { objection: "Está caro", response: "Entendo! Conseguimos parcelar e o plano é montado conforme sua prioridade na avaliação." },
      { objection: "Vou pensar", response: "Claro! Posso deixar uma avaliação pré-reservada pra você sem compromisso?" },
    ],
  });

  // ── LEADS / CONVERSAS / MENSAGENS / AGENDAMENTOS ───────────────────────
  const activeConvIds: string[] = [];
  const recoveryLeads: { name: string; treatment: string; days: number }[] = [
    { name: "Larissa Fonseca", treatment: "Lentes de porcelana", days: 3 },
    { name: "Thiago Barros", treatment: "Clareamento dental", days: 5 },
    { name: "Patrícia Gomes", treatment: "Implante dentário", days: 7 },
  ];

  let recentBudget = 42; // alvo "leads nos últimos 7 dias"
  function createdAtFor(preferRecent: boolean): Date {
    if (preferRecent && recentBudget > 0) {
      recentBudget--;
      return spAt(Math.floor(Math.random() * 6) + 0.2 * Math.random(), 9 + Math.floor(Math.random() * 8));
    }
    return spAt(8 + Math.floor(Math.random() * 80), 9 + Math.floor(Math.random() * 8));
  }

  // HOT (12)
  const hotCast = [
    { name: "Lucas Ferreira", treatment: "Implante dentário", slots: true },
    { name: "Ana Beatriz Souza", treatment: "Alinhadores invisíveis" },
  ];
  for (let i = 0; i < 12; i++) {
    const cast = hotCast[i];
    const treatment = cast?.treatment ?? pick(["Lentes de porcelana", "Clareamento dental", "Implante dentário", "Harmonização facial"], i);
    const name = cast?.name ?? genName();
    const created = createdAtFor(true);
    const opener = pick(LEAD_OPENERS[treatment] ?? LEAD_OPENERS["Avaliação estética"], i);
    const thread = [
      { author: "lead" as const, body: opener, at: spAt(2, 10, i), intent: "price_inquiry" },
      { author: "agent" as const, body: pick(AGENT_LINES, i + 1), at: spAt(2, 10, i + 1), intent: "price_inquiry" },
      { author: "lead" as const, body: "Pode me mostrar os horários?", at: spAt(1, 11, i), intent: "scheduling" },
      { author: "agent" as const, body: "Claro! Tenho terça 10h30, quarta 15h ou sexta 11h. Qual prefere?", at: spAt(0, 9, i), intent: "scheduling" },
    ];
    const { convId } = makeLead({
      clinicId, name, status: "in_conversation", temperature: "hot",
      treatmentInterest: treatment, createdAt: created, channel: pick(CHANNELS, i), thread,
    });
    activeConvIds.push(convId);
    if (cast?.slots) {
      stateRows.push({
        id: randomUUID(), conversationId: convId, state: "slots_offered",
        payload: { offered: ["ter 10:30", "qua 15:00", "sex 11:00"] },
        createdAt: spAt(0, 9, i), expiresAt: spAt(-1, 9),
      });
    }
  }

  // WARM (21)
  const warmCast = [
    { name: "Renata Lima", treatment: "Lentes de porcelana" },
    { name: "Sabrina Melo", treatment: "Avaliação estética" },
    { name: "Juliana Costa", treatment: "Clareamento dental" },
  ];
  for (let i = 0; i < 21; i++) {
    const cast = warmCast[i];
    const treatment = cast?.treatment ?? pick(["Lentes de porcelana", "Clareamento dental", "Alinhadores invisíveis", "Avaliação estética", "Harmonização facial"], i);
    const name = cast?.name ?? genName();
    const created = createdAtFor(true);
    const thread = [
      { author: "lead" as const, body: pick(LEAD_OPENERS[treatment] ?? LEAD_OPENERS["Avaliação estética"], i), at: spAt(4, 14, i), intent: "price_inquiry" },
      { author: "agent" as const, body: pick(AGENT_LINES, i), at: spAt(4, 14, i + 1), intent: "price_inquiry" },
      { author: "lead" as const, body: "Vou ver minha agenda e retorno, obrigada!", at: spAt(3, 15, i), intent: "unclear" },
      { author: "agent" as const, body: "Combinado! Fico à disposição quando quiser ver os horários 😊", at: spAt(1, 10, i), intent: "small_talk" },
    ];
    const { convId } = makeLead({
      clinicId, name, status: i % 3 === 0 ? "waiting_response" : "in_conversation",
      temperature: "warm", treatmentInterest: treatment, createdAt: created, channel: pick(CHANNELS, i + 2), thread,
    });
    activeConvIds.push(convId);
  }

  // COLD (8)
  const coldCast = [{ name: "Pedro Henrique Dias", treatment: "Alinhadores invisíveis" }];
  for (let i = 0; i < 8; i++) {
    const cast = coldCast[i];
    const treatment = cast?.treatment ?? pick(["Clareamento dental", "Limpeza e profilaxia", "Avaliação estética"], i);
    const name = cast?.name ?? genName();
    const created = createdAtFor(false);
    const thread = [
      { author: "lead" as const, body: pick(LEAD_OPENERS[treatment] ?? LEAD_OPENERS["Avaliação estética"], i), at: spAt(20 + i, 16, i), intent: "price_inquiry" },
      { author: "agent" as const, body: "Posso te explicar e já ver horários, tudo bem? 😊", at: spAt(20 + i, 16, i + 1), intent: "price_inquiry" },
      { author: "agent" as const, body: "Se quiser, deixo uma avaliação pré-reservada pra você esta semana.", at: spAt(9, 11, i), intent: "scheduling" },
    ];
    const { convId } = makeLead({
      clinicId, name, status: "in_conversation", temperature: "cold",
      treatmentInterest: treatment, createdAt: created, channel: pick(CHANNELS, i + 4), thread,
    });
    activeConvIds.push(convId);
  }

  // ATENÇÃO (4) — needsAttention
  const attentionCast = [{ name: "Felipe Santos", treatment: "Avaliação estética", reason: "Lead pediu para falar com a equipe" }];
  for (let i = 0; i < 4; i++) {
    const cast = attentionCast[i];
    const name = cast?.name ?? genName();
    const treatment = cast?.treatment ?? pick(["Implante dentário", "Harmonização facial"], i);
    const reason = cast?.reason ?? pick(["Negociação fora da política", "Lead relatou dor", "Pediu atendimento humano"], i);
    makeLead({
      clinicId, name, status: "in_conversation", temperature: null,
      treatmentInterest: treatment, createdAt: createdAtFor(false),
      needsAttention: true, attentionReason: reason, channel: "whatsapp",
      thread: [
        { author: "lead", body: "Preciso falar com alguém da equipe, é uma situação específica.", at: spAt(0, 13, i), intent: "needs_human" },
        { author: "agent", body: "Claro! Já estou chamando a equipe pra te atender com atenção. Um instante 🙏", at: spAt(0, 13, i + 2), intent: "needs_human" },
      ],
    });
  }

  // PAUSADOS (3) — aiPaused, takeover no futuro
  for (let i = 0; i < 3; i++) {
    makeLead({
      clinicId, name: genName(), status: "in_conversation", temperature: null,
      treatmentInterest: pick(["Lentes de porcelana", "Implante dentário", "Clareamento dental"], i),
      createdAt: createdAtFor(false), aiPaused: true, takeoverExpiresAt: spAt(-1, 18), channel: "whatsapp",
      thread: [
        { author: "lead", body: "Queria entender melhor o parcelamento.", at: spAt(0, 11, i), intent: "price_inquiry" },
        { author: "clinic_user", body: "Oi! Aqui é a recepção da Odonto Marques, vou te explicar certinho 😊", at: spAt(0, 12, i), intent: "small_talk" },
      ],
    });
  }

  // RECUPERAÇÃO (9) — follow_up_due, última msg da IA
  for (let i = 0; i < 9; i++) {
    const r = recoveryLeads[i];
    const name = r?.name ?? genName();
    const treatment = r?.treatment ?? pick(["Lentes de porcelana", "Clareamento dental", "Implante dentário", "Avaliação estética"], i);
    const days = r?.days ?? 3 + (i % 7);
    const { leadId } = makeLead({
      clinicId, name, status: "follow_up_due", temperature: null,
      treatmentInterest: treatment, createdAt: spAt(days + 6, 10, i), channel: pick(CHANNELS, i),
      thread: [
        { author: "lead", body: pick(LEAD_OPENERS[treatment] ?? LEAD_OPENERS["Avaliação estética"], i), at: spAt(days + 6, 10, i), intent: "price_inquiry" },
        { author: "agent", body: "Posso te mostrar horários esta semana?", at: spAt(days + 5, 11, i), intent: "scheduling" },
        { author: "agent", body: FOLLOWUP_LINE, at: spAt(days, 9, i), intent: "follow_up" },
      ],
    });
    followRows.push({
      id: randomUUID(), clinicId, leadId, dueAt: spAt(-1, 9, i), status: "pending",
      reason: "reengajamento",
      suggestedMessage: `Olá, ${name.split(" ")[0]}! Passando para saber se ainda faz sentido te ajudarmos com sua ${treatment.toLowerCase()}. Temos novos horários esta semana. Quer que eu te envie as opções?`,
    });
  }

  // AGENDADOS (63) — receita potencial = R$ 68.400
  const valuePlan = buildValuePlan(63, 6_840_000);
  const scheduledCast = [
    "Camila Rocha", "Mariana Alves", "Rafael Mendes", "Bruna Castro",
    "Larissa Monteiro", "Aline Barbosa",
  ];
  const todayHours = [8, 9, 10, 11, 14, 16];
  for (let i = 0; i < 63; i++) {
    const plan = valuePlan[i];
    const treatment = plan.t;
    const name = scheduledCast[i] ?? genName();
    const created = createdAtFor(i < 9);
    const apptCreated = spAt(Math.floor(Math.random() * 6), 10, i);
    let startsAt: Date;
    if (i < 6) startsAt = spAt(0, todayHours[i]);
    else startsAt = spAt(-(1 + Math.floor(Math.random() * 13)), 9 + (i % 9));
    const endsAt = new Date(startsAt.getTime() + 50 * 60_000);

    const { leadId } = makeLead({
      clinicId, name, status: "appointment_scheduled", temperature: null,
      treatmentInterest: treatment, createdAt: created, channel: pick(CHANNELS, i),
      thread: [
        { author: "lead", body: pick(LEAD_OPENERS[treatment] ?? LEAD_OPENERS["Avaliação estética"], i), at: new Date(apptCreated.getTime() - 2 * 3600_000), intent: "price_inquiry" },
        { author: "agent", body: "Perfeito! Vou te mostrar os horários disponíveis 😊", at: new Date(apptCreated.getTime() - 1 * 3600_000), intent: "scheduling" },
        { author: "lead", body: "Esse horário fica ótimo!", at: new Date(apptCreated.getTime() - 30 * 60_000), intent: "scheduling" },
        { author: "agent", body: "Agendamento confirmado ✅ Te espero na Odonto Marques!", at: apptCreated, intent: "confirmation" },
      ],
    });
    apptRows.push({
      id: randomUUID(), clinicId, leadId,
      professionalId: profByTreatment[treatment] ?? profHelena,
      treatmentId: treatmentIds[treatment] ?? null,
      startsAt, endsAt,
      status: i % 4 === 0 ? "confirmed" : "scheduled",
      source: "app", valueCents: plan.v,
      createdAt: apptCreated, updatedAt: apptCreated,
    });
  }

  // GANHOS com consulta REALIZADA (14) — receita confirmada R$ 21.700
  const confirmedPlan = buildValuePlan(14, 2_170_000);
  for (let i = 0; i < 14; i++) {
    const plan = confirmedPlan[i];
    const treatment = plan.t;
    const name = genName();
    const created = spAt(10 + i, 10, i);
    const apptCreated = spAt(Math.floor(Math.random() * 6), 10, i + 20);
    const startsAt = spAt(2 + (i % 4), 10 + (i % 6));
    const { leadId } = makeLead({
      clinicId, name, status: "won", temperature: null,
      treatmentInterest: treatment, createdAt: created, channel: pick(CHANNELS, i),
      thread: [
        { author: "lead", body: pick(LEAD_OPENERS[treatment] ?? LEAD_OPENERS["Avaliação estética"], i), at: created, intent: "price_inquiry" },
        { author: "agent", body: "Que ótimo! Já deixei tudo certo pra sua consulta 💚", at: spAt(8 + i, 11, i), intent: "confirmation" },
      ],
    });
    apptRows.push({
      id: randomUUID(), clinicId, leadId,
      professionalId: profByTreatment[treatment] ?? profHelena,
      treatmentId: treatmentIds[treatment] ?? null,
      startsAt, endsAt: new Date(startsAt.getTime() + 50 * 60_000),
      status: "completed", source: "app", valueCents: plan.v,
      createdAt: apptCreated, updatedAt: apptCreated,
    });
  }

  // HISTÓRICO restante para fechar 184 (20 ganhos + 30 perdidos)
  for (let i = 0; i < 20; i++) {
    makeLead({
      clinicId, name: genName(), status: "won", temperature: null,
      treatmentInterest: pick(["Clareamento dental", "Limpeza e profilaxia", "Avaliação estética"], i),
      createdAt: spAt(15 + i, 10, i), channel: pick(CHANNELS, i),
      thread: [
        { author: "lead", body: "Obrigada pelo atendimento!", at: spAt(15 + i, 10, i), intent: "small_talk" },
        { author: "agent", body: "Nós que agradecemos 💚 Até a próxima!", at: spAt(15 + i, 11, i), intent: "small_talk" },
      ],
    });
  }
  for (let i = 0; i < 30; i++) {
    makeLead({
      clinicId, name: genName(), status: "lost", temperature: null,
      treatmentInterest: pick(["Implante dentário", "Lentes de porcelana", "Harmonização facial", "Alinhadores invisíveis"], i),
      createdAt: spAt(20 + i, 10, i), channel: pick(CHANNELS, i),
      thread: [
        { author: "lead", body: pick(LEAD_OPENERS[pick(["Implante dentário", "Lentes de porcelana"], i)], i), at: spAt(20 + i, 10, i), intent: "price_inquiry" },
        { author: "agent", body: "Sem problemas! Fico à disposição se mudar de ideia 😊", at: spAt(19 + i, 11, i), intent: "small_talk" },
      ],
    });
  }

  // Mensagens fora do horário (58) — leads, à noite, nos últimos 7 dias
  const nightTexts = [
    "Oi! Vi vocês agora à noite, ainda dá pra agendar?",
    "Boa noite! Quanto fica o clareamento?",
    "Tô pesquisando aqui fora do horário, vocês respondem amanhã?",
    "Queria muito fazer as lentes, qual o valor?",
    "Vocês atendem sábado?",
  ];
  for (let i = 0; i < 58; i++) {
    const convId = pick(activeConvIds, i * 3 + 1);
    const d = spAt(1 + (i % 6), pick([19, 20, 21, 22, 23, 6, 7], i), (i * 7) % 60);
    addMsg(convId, "lead", pick(nightTexts, i), d, "price_inquiry");
    if (isNight(d)) afterHoursCount++;
  }

  // Mensagem FINAL da IA em cada conversa ativa (garante lastMsg = agent)
  for (let i = 0; i < activeConvIds.length; i++) {
    addMsg(activeConvIds[i], "agent", pick(AGENT_LINES, i), spAt(0, 8, i % 50), "scheduling");
  }

  // Top-up de mensagens da IA até ~1.260 (Tempo economizado = 42h)
  const TARGET_AGENT = 1260;
  let topup = 0;
  const fallbackConvIds = convRows.map((c) => c.id ?? "").filter(Boolean);
  while (agentMsgCount < TARGET_AGENT) {
    const convId = pick(activeConvIds.length ? activeConvIds : fallbackConvIds, topup);
    addMsg(convId, "agent", pick(AGENT_LINES, topup), spAt(2 + (topup % 25), 13, topup % 60), "small_talk");
    topup++;
  }

  // Bloqueios de agenda (almoço)
  const blockRows: (typeof calendarBlocks.$inferInsert)[] = [];
  for (const profId of [profHelena, profRafael, profCamila, profAndre]) {
    blockRows.push({
      id: randomUUID(), clinicId, professionalId: profId,
      startsAt: spAt(0, 12), endsAt: spAt(0, 13), reason: "Almoço",
    });
  }

  // Persistência
  await insertChunked(leads, leadRows);
  await insertChunked(conversations, convRows);
  await insertChunked(messages, msgRows);
  await insertChunked(appointments, apptRows);
  await insertChunked(followUps, followRows);
  if (stateRows.length) await insertChunked(conversationStates, stateRows);
  if (blockRows.length) await insertChunked(calendarBlocks, blockRows);

  await syncModulesForPlan(clinicId, PLAN, "seed-demo");

  return {
    clinicId,
    slug: DEMO_CLINIC_SLUG,
    adminEmail: DEMO_ADMIN_EMAIL,
    adminPassword: DEMO_ADMIN_PASSWORD,
    counts: {
      leads: leadRows.length,
      conversations: convRows.length,
      messages: msgRows.length,
      agentMessages: agentMsgCount,
      appointments: apptRows.length,
      followUps: followRows.length,
      afterHoursMessages: afterHoursCount,
      hoursSaved: Math.round((agentMsgCount * 2) / 60),
    },
  };
}
