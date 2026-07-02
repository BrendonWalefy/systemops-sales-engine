/**
 * Seed da clínica fictícia premium "Odonto Marques" — fonte única de verdade,
 * usada tanto pelo CLI (`npm run seed:demo`) quanto pelo botão do painel owner
 * ("Carregar clínica demo").
 *
 * É um TENANT REAL (não há "modo demo" em runtime): o dashboard, o inbox e a
 * agenda são calculados ao vivo. As conversas visíveis usam roteiros curados,
 * com fallback pelo ResponseComposer quando o turno não traz resposta fixa — ver
 * `generate-demo-conversation.ts` e `demo-conversation-scripts.ts`. Isso substitui
 * as threads fabricadas antigas (frases genéricas soltas + padding aleatório) por
 * conteúdo coerente que serve para demo E para marketing.
 *
 * Requer OPENAI_API_KEY para gerar as respostas autênticas. Sem chave (ou com
 * `DISABLE_REAL_OPENAI=true`), cai em respostas-modelo coerentes (não trava).
 *
 * Idempotente: cada execução APAGA e recria os dados da clínica (reset limpo),
 * datando os registros relativos ao momento da execução.
 */
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { hashPassword } from "@/lib/password";
import { syncModulesForPlan } from "@/application/modules/module-gate";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { generateDemoThread, type DemoClinicContext } from "@/application/demo/generate-demo-conversation";
import { DEMO_CONVERSATIONS } from "@/application/demo/demo-conversation-scripts";
import {
  organizations,
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
const PLAN = "avancado" as const;

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

// ── Plano de valores (centavos) — para o volume histórico de ganhos ──────
const PRICE_CYCLE: { t: string; v: number }[] = [
  { t: "Lentes de resina", v: 95000 },
  { t: "Implante dentário", v: 290000 },
  { t: "Lentes de porcelana", v: 180000 },
  { t: "Prótese dentária", v: 240000 },
  { t: "Remoção de dentes", v: 65000 },
  { t: "Botox", v: 89000 },
  { t: "Clareamento dental", v: 69000 },
  { t: "Alinhadores invisíveis", v: 35000 },
  { t: "Limpeza e profilaxia", v: 22000 },
  { t: "Avaliação estética", v: 15000 },
];

function buildValuePlan(count: number, targetCents: number): { t: string; v: number }[] {
  const plan: { t: string; v: number }[] = [];
  for (let i = 0; i < count - 1; i++) plan.push({ ...pick(PRICE_CYCLE, i) });
  const partial = plan.reduce((a, b) => a + b.v, 0);
  plan.push({ t: "Implante dentário", v: Math.max(15000, targetCents - partial) });
  return plan;
}

const TREATMENT_VALUE_CENTS: Record<string, number> = {
  "Lentes de resina": 95000,
  "Implante dentário": 290000,
  "Lentes de porcelana": 180000,
  "Prótese dentária": 240000,
  "Remoção de dentes": 65000,
  "Botox": 89000,
  "Harmonização facial": 89000,
  "Clareamento dental": 69000,
  "Alinhadores invisíveis": 35000,
  "Limpeza e profilaxia": 22000,
  "Avaliação estética": 15000,
};

// Volume histórico é NUMÉRICO (lead + agendamento, sem conversa) — o inbox só mostra
// as conversas ricas. Estes tratamentos calibram a receita/contagem do dashboard.
const HISTORY_TREATMENTS = [
  "Clareamento dental", "Limpeza e profilaxia", "Avaliação estética",
  "Lentes de porcelana", "Lentes de resina", "Prótese dentária",
  "Remoção de dentes", "Botox", "Implante dentário",
];

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
  await db.delete(organizations).where(eq(organizations.id, clinicId));
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
    extra?: {
      deliveryFormat?: "text" | "audio" | null;
      mediaUrl?: string | null;
      mediaType?: "image" | "video" | "audio" | "document" | null;
    },
  ): void {
    msgRows.push({
      id: randomUUID(),
      conversationId,
      author,
      body,
      sentAt,
      intent: intent ?? null,
      deliveryFormat: extra?.deliveryFormat ?? null,
      mediaUrl: extra?.mediaUrl ?? null,
      mediaType: extra?.mediaType ?? null,
    });
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
    thread: {
      author: "lead" | "agent" | "clinic_user";
      body: string;
      at: Date;
      intent?: string;
      deliveryFormat?: "text" | "audio" | null;
      mediaUrl?: string | null;
      mediaType?: "image" | "video" | "audio" | "document" | null;
    }[];
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

    for (const m of sorted) {
      addMsg(convId, m.author, m.body, m.at, m.intent, {
        deliveryFormat: m.deliveryFormat,
        mediaUrl: m.mediaUrl,
        mediaType: m.mediaType,
      });
    }

    return { leadId, convId };
  }

  // Reusa da Ximendes: (a) vídeos de procedimento e (b) o voiceId da voz B-WAVE.
  // Reusar o voiceId NÃO interfere na Ximendes — é só um identificador de voz.
  // Se a Ximendes não existir (ex.: banco local), segue sem mídia/voz — degrada limpo.
  type MediaItem = { id: string; title: string; url: string; type: "video" | "image" };
  const ximendes = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, "ximendes"))
    .limit(1)
    .then((r) => r[0] ?? null);
  let demoMediaLibrary: MediaItem[] = [];
  let ximendesVoiceId = "";
  if (ximendes) {
    const pv = await db
      .select({ media: playbookVersions.mediaLibrary })
      .from(playbookVersions)
      .where(and(eq(playbookVersions.clinicId, ximendes.id), eq(playbookVersions.status, "active")))
      .limit(1)
      .then((r) => r[0] ?? null);
    demoMediaLibrary = (pv?.media as MediaItem[] | null) ?? [];
    const vm = await db
      .select({ config: clinicModules.config })
      .from(clinicModules)
      .where(and(eq(clinicModules.clinicId, ximendes.id), eq(clinicModules.moduleKey, "voice_elevenlabs")))
      .limit(1)
      .then((r) => r[0] ?? null);
    ximendesVoiceId = ((vm?.config as { voiceId?: string } | null)?.voiceId ?? "").trim();
  }
  const demoVideo = demoMediaLibrary.find((m) => m.type === "video") ?? null;
  const demoImage = demoMediaLibrary.find((m) => m.type === "image") ?? demoVideo;

  // 0) reset
  const existing = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, DEMO_CLINIC_SLUG))
    .limit(1)
    .then((r) => r[0] ?? null);
  if (existing) await resetClinic(existing.id);

  const clinicId = randomUUID();

  // 1) clínica
  await db.insert(organizations).values({
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
      { number: 1, label: "Lentes", intent: "procedures", enabled: true, treatmentKeyword: "lentes" },
      { number: 2, label: "Agendar avaliação", intent: "book_appointment", enabled: true },
      { number: 3, label: "Prótese dentária", intent: "procedures", enabled: true, treatmentKeyword: "prótese" },
      { number: 4, label: "Remoção de dentes", intent: "procedures", enabled: true, treatmentKeyword: "remoção" },
      { number: 5, label: "Botox", intent: "procedures", enabled: true, treatmentKeyword: "botox" },
      { number: 6, label: "Valores", intent: "price_inquiry", enabled: true },
      { number: 7, label: "Endereço e horários", intent: "location", enabled: true },
      { number: 8, label: "Falar com equipe", intent: "needs_human", enabled: true },
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
    { id: profRafael, clinicId, name: "Dr. Rafael Nogueira", specialty: "Prótese, implantes e cirurgia", color: COLORS.azul },
    { id: profCamila, clinicId, name: "Dra. Camila Torres", specialty: "Ortodontia e alinhadores", color: COLORS.roxo },
    { id: profAndre, clinicId, name: "Dr. André Vilela", specialty: "Avaliação geral e botox", color: COLORS.dourado },
  ]);
  const profByTreatment: Record<string, string> = {
    "Lentes de resina": profHelena,
    "Lentes de porcelana": profHelena,
    "Clareamento dental": profHelena,
    "Avaliação estética": profHelena,
    "Harmonização facial": profAndre,
    "Botox": profAndre,
    "Implante dentário": profRafael,
    "Prótese dentária": profRafael,
    "Remoção de dentes": profRafael,
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
      role: "org_admin",
      professionalId: profHelena,
      passwordHash: await hashPassword(DEMO_ADMIN_PASSWORD),
    },
    // Owner do sistema — acesso direto à visão de clínica sem trocar de conta
    {
      clinicId,
      email: "brendonwalefyom@gmail.com",
      role: "org_admin",
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
      clinicId, name: "Lentes de resina", durationMinutes: 60, minPriceCents: 95000,
      description: "A partir de R$ 950 por dente, após avaliação. Melhora formato, cor e harmonia com planejamento conservador.",
      isAesthetic: true, requiresEvaluationFirst: true,
      commonObjections: ["Fica artificial?", "Mancha?", "Quanto tempo dura?"],
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
      clinicId, name: "Prótese dentária", durationMinutes: 60, minPriceCents: 240000,
      description: "A partir de R$ 2.400. Reabilitação com prótese fixa, removível ou sobre implantes, conforme avaliação.",
      requiresEvaluationFirst: true,
      commonObjections: ["Fica firme?", "Parece natural?", "Precisa de implante?"],
    },
    {
      clinicId, name: "Remoção de dentes", durationMinutes: 50, minPriceCents: 65000,
      description: "A partir de R$ 650. Avaliação cirúrgica para sisos, dentes quebrados ou extrações indicadas por planejamento.",
      requiresEvaluationFirst: true,
      commonObjections: ["Dói?", "Preciso repousar?", "Tira no mesmo dia?"],
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
    {
      clinicId, name: "Botox", durationMinutes: 45, minPriceCents: 89000,
      description: "A partir de R$ 890. Avaliação para toxina botulínica estética ou apoio em tensão muscular/bruxismo.",
      isAesthetic: true, requiresEvaluationFirst: true,
      commonObjections: ["Fica congelado?", "Quanto dura?", "É seguro?"],
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
      "lentes de resina (a partir de R$ 950 por dente), lentes de porcelana (a partir de R$ 1.800 por dente), " +
      "prótese dentária (a partir de R$ 2.400), remoção de dentes (a partir de R$ 650), " +
      "botox (a partir de R$ 890), clareamento dental (a partir de R$ 690), implante dentário (a partir de R$ 2.900), " +
      "alinhadores invisíveis (a partir de R$ 350/mês), limpeza e profilaxia (R$ 220) e harmonização facial (a partir de R$ 890).",
    toneOfVoice: "Consultivo, acolhedor, elegante e objetivo. Trata por você, com cordialidade premium.",
    commercialPolicy:
      "Valores sempre apresentados como 'a partir de', pois dependem de avaliação. Lentes são cobradas por dente. " +
      "Prótese, remoção de dentes e botox dependem de avaliação. Alinhadores têm valor mensal. Parcelamos no cartão. " +
      "Procedimentos estéticos e cirúrgicos exigem avaliação prévia. A avaliação estética/cirúrgica custa R$ 150 e é o ponto de partida.",
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
    mediaLibrary: demoMediaLibrary, // vídeos de procedimento reusados da Ximendes
  });

  // ── CONVERSAS CURADAS a partir dos roteiros completos ──────────────────────
  // Cada conversa é coerente e na voz da Marina. Turnos sem resposta fixa ainda
  // passam pelo ResponseComposer, mas os casos principais são fechados no roteiro.
  const demoCtx: DemoClinicContext = {
    clinicName: DEMO_CLINIC_NAME,
    specialty: "Odontologia estética e reabilitação oral",
    toneOfVoice: "Consultivo, acolhedor, elegante e objetivo. Trata por você, com cordialidade premium.",
    playbook:
      "Procedimentos e valores: avaliação R$150; lentes de resina a partir de R$950 por dente; " +
      "lentes de porcelana a partir de R$1.800 por dente; prótese dentária a partir de R$2.400; " +
      "remoção de dentes a partir de R$650; botox a partir de R$890; clareamento a partir de R$690; " +
      "implante a partir de R$2.900; alinhadores a partir de R$350/mês; limpeza R$220. " +
      "Valores sempre 'a partir de', após avaliação. " +
      "Objeção de preço: parcelamos no cartão e o plano é montado na avaliação. Recepcionista: Marina.",
    commercialPolicy:
      "Valores sempre 'a partir de', pois dependem de avaliação. Lentes por dente. " +
      "Prótese, remoção de dentes e botox dependem de avaliação. Parcelamos no cartão. " +
      "Avaliação prévia R$150.",
    receptionistName: "Marina",
    timezone: new ClinicTimezone("America/Sao_Paulo"),
  };

  let convIdx = 0;
  for (const conv of DEMO_CONVERSATIONS) {
    const generated = await generateDemoThread(demoCtx, conv.turns);
    const startHour = conv.afterHours ? pick([20, 21, 22], convIdx) : 9 + (convIdx % 8);
    const created = spAt(conv.daysAgo, startHour, (convIdx * 7) % 50);
    // timestamps crescentes (agente responde ~1-2 min depois do lead)
    const thread: MakeLeadOpts["thread"] = [];
    let step = 0;
    for (const m of generated) {
      const mediaItem = m.media === "image" ? demoImage : m.media === "video" ? demoVideo : null;
      thread.push({
        author: m.author,
        body: m.body,
        at: new Date(created.getTime() + step * 90_000),
        intent: m.intent,
        deliveryFormat: m.author === "agent" && m.voice ? "audio" : undefined,
      });
      step++;
      // Mídia (vídeo/imagem) vai como mensagem PRÓPRIA logo depois do texto.
      if (m.author === "agent" && mediaItem) {
        thread.push({
          author: "agent",
          body: mediaItem.title ?? "",
          at: new Date(created.getTime() + step * 90_000),
          intent: "media_sent",
          mediaUrl: mediaItem.url,
          mediaType: mediaItem.type,
        });
        step++;
      }
    }
    const { leadId } = makeLead({
      clinicId,
      name: conv.leadName,
      status: conv.status,
      temperature: conv.temperature,
      treatmentInterest: conv.treatment,
      createdAt: created,
      channel: conv.channel,
      needsAttention: conv.needsAttention,
      attentionReason: conv.attentionReason ?? null,
      aiPaused: conv.aiPaused,
      thread,
    });
    if (conv.afterHours) afterHoursCount += thread.length;

    if (conv.booked) {
      const isWon = conv.status === "won";
      const startsAt = isWon
        ? spAt(2 + (convIdx % 5), 10 + (convIdx % 6))
        : spAt(-(1 + (convIdx % 12)), 9 + (convIdx % 9));
      apptRows.push({
        id: randomUUID(),
        clinicId,
        leadId,
        professionalId: profByTreatment[conv.treatment] ?? profHelena,
        treatmentId: treatmentIds[conv.treatment] ?? null,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 50 * 60_000),
        status: isWon ? "completed" : convIdx % 4 === 0 ? "confirmed" : "scheduled",
        source: "app",
        valueCents: TREATMENT_VALUE_CENTS[conv.treatment] ?? 15000,
        createdAt: created,
        updatedAt: created,
      });
    }

    if (conv.status === "follow_up_due") {
      followRows.push({
        id: randomUUID(),
        clinicId,
        leadId,
        dueAt: spAt(-1, 9, convIdx),
        status: "pending",
        reason: "reengajamento",
        suggestedMessage: `Olá, ${conv.leadName.split(" ")[0]}! Passando para saber se ainda faz sentido seguirmos com sua ${conv.treatment.toLowerCase()}. Temos novos horários esta semana. Quer que eu te envie as opções?`,
      });
    }
    convIdx++;
  }

  // ── Volume histórico (numérico) — cada lead com UMA troca curta e COERENTE,
  // só para o dashboard ter volume real. Sem frases soltas/aleatórias.
  const HISTORY_WON = 40;
  const wonValuePlan = buildValuePlan(HISTORY_WON, 4_800_000);
  for (let i = 0; i < HISTORY_WON; i++) {
    const treatment = wonValuePlan[i].t;
    const created = spAt(12 + i, 10, i % 55);
    const leadId = randomUUID();
    leadRows.push({
      id: leadId, clinicId, name: genName(), phone: genPhone(), channel: pick(CHANNELS, i),
      treatmentInterest: treatment, status: "won", temperature: null,
      createdAt: created, updatedAt: created,
    });
    const startsAt = spAt(2 + (i % 6), 10 + (i % 6));
    apptRows.push({
      id: randomUUID(), clinicId, leadId,
      professionalId: profByTreatment[treatment] ?? profHelena,
      treatmentId: treatmentIds[treatment] ?? null,
      startsAt, endsAt: new Date(startsAt.getTime() + 50 * 60_000),
      status: "completed", source: "app", valueCents: wonValuePlan[i].v,
      createdAt: created, updatedAt: created,
    });
  }

  const HISTORY_LOST = 45;
  for (let i = 0; i < HISTORY_LOST; i++) {
    const treatment = pick(HISTORY_TREATMENTS, i + 3);
    const created = spAt(18 + i, 10, i % 50);
    leadRows.push({
      id: randomUUID(), clinicId, name: genName(), phone: genPhone(), channel: pick(CHANNELS, i),
      treatmentInterest: treatment, status: "lost", temperature: null,
      createdAt: created, updatedAt: created,
    });
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

  // Reusa a voz B-WAVE da Ximendes na clínica demo (só o voiceId — não afeta a Ximendes).
  // Assim, no simulador ao vivo / WhatsApp, a Marina já fala em B-WAVE sem config manual.
  if (ximendesVoiceId) {
    await db
      .update(clinicModules)
      .set({
        config: { voiceId: ximendesVoiceId, stability: 0.58, similarityBoost: 0.82, speed: 0.96, mode: "impact" },
      })
      .where(and(eq(clinicModules.clinicId, clinicId), eq(clinicModules.moduleKey, "voice_elevenlabs")));
  }

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
