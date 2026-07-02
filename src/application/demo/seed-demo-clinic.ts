/**
 * Seed da clínica fictícia premium "Odonto Marques" — fonte única de verdade,
 * usada tanto pelo CLI (`npm run seed:demo`) quanto pelo botão do painel owner
 * ("Carregar clínica demo").
 *
 * É um TENANT REAL (não há "modo demo" em runtime): o dashboard, o inbox e a
 * agenda são calculados ao vivo. As conversas visíveis são geradas pela IA REAL
 * (ResponseComposer, mesmo motor da produção) a partir de roteiros curados — ver
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
  plan.push({ t: "Implante dentário", v: Math.max(15000, targetCents - partial) });
  return plan;
}

const TREATMENT_VALUE_CENTS: Record<string, number> = {
  "Implante dentário": 290000,
  "Lentes de porcelana": 180000,
  "Harmonização facial": 89000,
  "Clareamento dental": 69000,
  "Alinhadores invisíveis": 35000,
  "Limpeza e profilaxia": 22000,
  "Avaliação estética": 15000,
};

// Fechos curtos e COERENTES para o volume histórico (nunca frases soltas/aleatórias).
const WON_CLOSERS: [string, string][] = [
  ["Fiz o tratamento com vocês e amei o resultado, muito obrigada! 💚", "Nós que agradecemos! Ficamos muito felizes 💚"],
  ["Ficou perfeito, super recomendo!", "Que alegria ler isso! Obrigada pela confiança 😊"],
  ["Melhor decisão, adorei o atendimento de vocês.", "Obrigada! Estamos sempre por aqui quando precisar 💚"],
];
const LOST_CLOSERS: [string, string][] = [
  ["Por ora vou deixar pra mais pra frente, obrigada.", "Sem problema! Fico à disposição quando quiser 😊"],
  ["Vou pensar com calma e retorno depois.", "Claro! Qualquer dúvida, é só me chamar por aqui 💚"],
];
const HISTORY_TREATMENTS = [
  "Clareamento dental", "Limpeza e profilaxia", "Avaliação estética",
  "Lentes de porcelana", "Implante dentário", "Harmonização facial",
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

  // Reusa a biblioteca de mídia da Ximendes (vídeos de procedimento reais) na demo.
  // Se a Ximendes não existir (ex.: banco local), segue sem mídia — degrada limpo.
  type MediaItem = { id: string; title: string; url: string; type: "video" | "image" };
  const ximendesMedia = await db
    .select({ media: playbookVersions.mediaLibrary })
    .from(playbookVersions)
    .innerJoin(organizations, eq(playbookVersions.clinicId, organizations.id))
    .where(and(eq(organizations.slug, "ximendes"), eq(playbookVersions.status, "active")))
    .limit(1)
    .then((r) => r[0] ?? null);
  const demoMediaLibrary: MediaItem[] = (ximendesMedia?.media as MediaItem[] | null) ?? [];
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
    mediaLibrary: demoMediaLibrary, // vídeos de procedimento reusados da Ximendes
  });

  // ── CONVERSAS REAIS geradas pela IA a partir dos roteiros curados ──────────
  // Cada conversa é coerente e na voz da Marina (ResponseComposer real). Substitui
  // as threads fabricadas + o padding aleatório antigos. Ver src/application/demo/.
  const demoCtx: DemoClinicContext = {
    clinicName: DEMO_CLINIC_NAME,
    specialty: "Odontologia estética e reabilitação oral",
    toneOfVoice: "Consultivo, acolhedor, elegante e objetivo. Trata por você, com cordialidade premium.",
    playbook:
      "Procedimentos e valores: avaliação estética R$150; lentes de porcelana a partir de R$1.800 por dente; " +
      "clareamento a partir de R$690; implante a partir de R$2.900; alinhadores a partir de R$350/mês; " +
      "limpeza R$220; harmonização facial a partir de R$890. Valores sempre 'a partir de', após avaliação. " +
      "Objeção de preço: parcelamos no cartão e o plano é montado na avaliação. Recepcionista: Marina.",
    commercialPolicy:
      "Valores sempre 'a partir de', pois dependem de avaliação. Lentes por dente. Parcelamos no cartão. " +
      "Procedimentos estéticos exigem avaliação prévia (R$150).",
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
    const created = spAt(10 + i, 10, i % 55);
    const closer = pick(WON_CLOSERS, i);
    const { leadId } = makeLead({
      clinicId, name: genName(), status: "won", temperature: null,
      treatmentInterest: treatment, createdAt: created, channel: pick(CHANNELS, i),
      thread: [
        { author: "lead", body: closer[0], at: created, intent: "small_talk" },
        { author: "agent", body: closer[1], at: new Date(created.getTime() + 60_000), intent: "small_talk" },
      ],
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
    const closer = pick(LOST_CLOSERS, i);
    makeLead({
      clinicId, name: genName(), status: "lost", temperature: null,
      treatmentInterest: treatment, createdAt: created, channel: pick(CHANNELS, i),
      thread: [
        { author: "lead", body: closer[0], at: created, intent: "small_talk" },
        { author: "agent", body: closer[1], at: new Date(created.getTime() + 60_000), intent: "small_talk" },
      ],
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
