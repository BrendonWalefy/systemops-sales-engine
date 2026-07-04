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
import { DEMO_MEDIA_MANIFEST } from "@/application/demo/demo-media-manifest";
import { createTtsProvider } from "@/infrastructure/adapters/ai/tts/tts-gateway-factory";
import { VercelBlobStorageGateway } from "@/infrastructure/adapters/storage/vercel-blob-storage-gateway";
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

const DEMO_AVATAR_BASE_PATH = "/demo/lead-avatars";
const DEMO_STAFF_AVATAR_BASE_PATH = "/demo/staff-avatars";
const DEMO_STAFF_AVATAR_URLS = {
  helena: `${DEMO_STAFF_AVATAR_BASE_PATH}/helena-marques.png`,
  rafael: `${DEMO_STAFF_AVATAR_BASE_PATH}/rafael-nogueira.png`,
  camila: `${DEMO_STAFF_AVATAR_BASE_PATH}/camila-torres.png`,
  andre: `${DEMO_STAFF_AVATAR_BASE_PATH}/andre-vilela.png`,
} as const;
const DEMO_LEAD_AVATAR_BY_KEY: Record<string, string> = {
  "lentes-resina-noiva": `${DEMO_AVATAR_BASE_PATH}/camila-rocha.png`,
  "lentes-porcelana-executiva": `${DEMO_AVATAR_BASE_PATH}/isabela-ramos.png`,
  "protese-protocolo-indicacao": `${DEMO_AVATAR_BASE_PATH}/sonia-martins.png`,
  "remocao-siso-won": `${DEMO_AVATAR_BASE_PATH}/mariana-alves.png`,
  "implante-follow-up-resgate": `${DEMO_AVATAR_BASE_PATH}/ricardo-menezes.png`,
  "botox-evento-natural": `${DEMO_AVATAR_BASE_PATH}/renata-lima.png`,
  "handoff-caso-complexo": `${DEMO_AVATAR_BASE_PATH}/antonio-ferraz.png`,
  "alinhadores-fora-horario": `${DEMO_AVATAR_BASE_PATH}/thiago-sampaio.png`,
  "clareamento-remarcacao": `${DEMO_AVATAR_BASE_PATH}/juliana-castro.png`,
  "porcelana-plano-fechado": `${DEMO_AVATAR_BASE_PATH}/larissa-monteiro.png`,
};
const DEMO_FEMALE_AVATAR_POOL = [
  `${DEMO_AVATAR_BASE_PATH}/camila-rocha.png`,
  `${DEMO_AVATAR_BASE_PATH}/isabela-ramos.png`,
  `${DEMO_AVATAR_BASE_PATH}/sonia-martins.png`,
  `${DEMO_AVATAR_BASE_PATH}/mariana-alves.png`,
  `${DEMO_AVATAR_BASE_PATH}/renata-lima.png`,
  `${DEMO_AVATAR_BASE_PATH}/juliana-castro.png`,
  `${DEMO_AVATAR_BASE_PATH}/larissa-monteiro.png`,
] as const;
const DEMO_MALE_AVATAR_POOL = [
  `${DEMO_AVATAR_BASE_PATH}/ricardo-menezes.png`,
  `${DEMO_AVATAR_BASE_PATH}/antonio-ferraz.png`,
  `${DEMO_AVATAR_BASE_PATH}/thiago-sampaio.png`,
] as const;
const DEMO_MALE_FIRST_NAMES = new Set([
  "andre", "antonio", "bruno", "diego", "eduardo", "felipe", "gustavo",
  "henrique", "leonardo", "lucas", "mateus", "otavio", "pedro", "rafael",
  "ricardo", "rodrigo", "thiago", "vinicius",
]);

function stableAvatarIndex(seed: string, poolSize: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash) % poolSize;
}

function normalizedFirstName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)[0]
    .toLowerCase();
}

function demoLeadAvatarUrl(name: string, conversationKey?: string): string {
  if (conversationKey && DEMO_LEAD_AVATAR_BY_KEY[conversationKey]) {
    return DEMO_LEAD_AVATAR_BY_KEY[conversationKey];
  }
  const pool = DEMO_MALE_FIRST_NAMES.has(normalizedFirstName(name))
    ? DEMO_MALE_AVATAR_POOL
    : DEMO_FEMALE_AVATAR_POOL;
  return pool[stableAvatarIndex(name, pool.length)];
}

function assertDemoMediaLibraryReady(mediaLibrary: { title: string; type: "video" | "image" }[]): void {
  const normalizedTitles = mediaLibrary.map((item) => normalizeMediaTitle(item.title));
  const has = (needle: string, type: "video" | "image") =>
    mediaLibrary.some((item, index) => item.type === type && normalizedTitles[index].includes(needle));

  const missing = [
    has("implante", "video") ? null : "video: implante",
    has("lentes", "video") ? null : "video: lentes",
    has("porcelana", "video") ? null : "video: porcelana",
    has("sorriso", "image") ? null : "image: sorriso",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`[seed-demo] Biblioteca de mídia incompleta para a demo: faltando ${missing.join(", ")}`);
  }
}

function normalizeMediaTitle(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

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
    profilePicUrl?: string | null;
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
      profilePicUrl: opts.profilePicUrl ?? demoLeadAvatarUrl(opts.name),
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

  // Mídia: prioriza a biblioteca PRÓPRIA da demo (manifest gerado por
  // scripts/upload-demo-media.ts). Fallback: reusa os vídeos da Ximendes.
  // O voiceId B-WAVE ainda vem da Ximendes — é só um identificador de voz.
  // Se nada existir (ex.: banco local), segue sem mídia/voz — degrada limpo.
  type MediaItem = { id: string; title: string; url: string; type: "video" | "image" };
  const ximendes = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, "ximendes"))
    .limit(1)
    .then((r) => r[0] ?? null);
  let ximendesMedia: MediaItem[] = [];
  let ximendesVoiceId = "";
  if (ximendes) {
    const pv = await db
      .select({ media: playbookVersions.mediaLibrary })
      .from(playbookVersions)
      .where(and(eq(playbookVersions.clinicId, ximendes.id), eq(playbookVersions.status, "active")))
      .limit(1)
      .then((r) => r[0] ?? null);
    ximendesMedia = (pv?.media as MediaItem[] | null) ?? [];
    const vm = await db
      .select({ config: clinicModules.config })
      .from(clinicModules)
      .where(and(eq(clinicModules.clinicId, ximendes.id), eq(clinicModules.moduleKey, "voice_elevenlabs")))
      .limit(1)
      .then((r) => r[0] ?? null);
    ximendesVoiceId = ((vm?.config as { voiceId?: string } | null)?.voiceId ?? "").trim();
  }
  const demoMediaLibrary: MediaItem[] = DEMO_MEDIA_MANIFEST.length > 0 ? DEMO_MEDIA_MANIFEST : ximendesMedia;
  assertDemoMediaLibraryReady(demoMediaLibrary);

  function findMedia(type: "video" | "image", query?: string): MediaItem | null {
    const ofType = demoMediaLibrary.filter((m) => m.type === type);
    const pool = ofType.length > 0 ? ofType : demoMediaLibrary;
    if (query) {
      const hit = pool.find((m) => normalizeMediaTitle(m.title ?? "").includes(normalizeMediaTitle(query)));
      if (hit) return hit;
    }
    return pool[0] ?? null;
  }

  // Áudios B-WAVE REAIS para os turnos `voice`: sintetiza via ElevenLabs e sobe
  // para o prefixo permanente demo-media/ (o cron de limpeza só apaga tts/).
  // Sem chave/voz configurada, degrada para texto normal.
  const canSynthesizeVoice = Boolean(
    process.env.ELEVENLABS_API_KEY && process.env.BLOB_READ_WRITE_TOKEN && ximendesVoiceId,
  );
  async function synthesizeVoiceNote(text: string): Promise<string | null> {
    if (!canSynthesizeVoice) return null;
    try {
      const { gateway, format, contentType, speed } = createTtsProvider({
        provider: "elevenlabs",
        speed: 0.96,
        elevenLabsVoiceId: ximendesVoiceId,
        elevenLabsStability: 0.58,
        elevenLabsSimilarityBoost: 0.82,
      });
      const audio = await gateway.synthesize(text, { format, speed });
      return await new VercelBlobStorageGateway().upload(
        `demo-media/voz-marina-${randomUUID()}.${format}`,
        audio,
        { contentType },
      );
    } catch (err) {
      console.error("[seed-demo] TTS falhou — mensagem segue como texto:", err);
      return null;
    }
  }

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
      displayName: "Dra. Helena",
      professionalId: profHelena,
      avatarUrl: DEMO_STAFF_AVATAR_URLS.helena,
      passwordHash: await hashPassword(DEMO_ADMIN_PASSWORD),
    },
    {
      clinicId,
      email: "rafael@odontomarques.com.br",
      role: "professional",
      displayName: "Dr. Rafael",
      professionalId: profRafael,
      avatarUrl: DEMO_STAFF_AVATAR_URLS.rafael,
    },
    {
      clinicId,
      email: "camila@odontomarques.com.br",
      role: "professional",
      displayName: "Dra. Camila",
      professionalId: profCamila,
      avatarUrl: DEMO_STAFF_AVATAR_URLS.camila,
    },
    {
      clinicId,
      email: "andre@odontomarques.com.br",
      role: "professional",
      displayName: "Dr. André",
      professionalId: profAndre,
      avatarUrl: DEMO_STAFF_AVATAR_URLS.andre,
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
      isAesthetic: true,
    },
    {
      clinicId, name: "Lentes de resina", durationMinutes: 60, minPriceCents: 95000,
      description: "A partir de R$ 950 por dente, após avaliação. Melhora formato, cor e harmonia com planejamento conservador.",
      isAesthetic: true, requiresEvaluationFirst: true,
    },
    {
      clinicId, name: "Lentes de porcelana", durationMinutes: 60, minPriceCents: 180000,
      description: "A partir de R$ 1.800 por dente, sempre após avaliação. Melhora formato, cor e harmonia do sorriso.",
      isAesthetic: true, requiresEvaluationFirst: true,
    },
    {
      clinicId, name: "Clareamento dental", durationMinutes: 50, minPriceCents: 69000,
      description: "A partir de R$ 690. A laser na clínica ou com moldeiras para uso em casa.",
    },
    {
      clinicId, name: "Implante dentário", durationMinutes: 60, minPriceCents: 290000,
      description: "A partir de R$ 2.900. Implante de titânio para substituir dente ausente, após avaliação e exames.",
      requiresEvaluationFirst: true,
    },
    {
      clinicId, name: "Prótese dentária", durationMinutes: 60, minPriceCents: 240000,
      description: "A partir de R$ 2.400. Reabilitação com prótese fixa, removível ou sobre implantes, conforme avaliação.",
      requiresEvaluationFirst: true,
    },
    {
      clinicId, name: "Remoção de dentes", durationMinutes: 50, minPriceCents: 65000,
      description: "A partir de R$ 650. Avaliação cirúrgica para sisos, dentes quebrados ou extrações indicadas por planejamento.",
      requiresEvaluationFirst: true,
    },
    {
      clinicId, name: "Alinhadores invisíveis", durationMinutes: 45, minPriceCents: 35000,
      description: "A partir de R$ 350/mês. Correção ortodôntica com alinhadores transparentes removíveis.",
    },
    {
      clinicId, name: "Limpeza e profilaxia", durationMinutes: 40, priceCents: 22000,
      description: "Limpeza profissional, remoção de tártaro e polimento.",
    },
    {
      clinicId, name: "Harmonização facial", durationMinutes: 45, minPriceCents: 89000,
      description: "A partir de R$ 890. Procedimentos estéticos faciais realizados pelo dentista.",
      isAesthetic: true,
    },
    {
      clinicId, name: "Botox", durationMinutes: 45, minPriceCents: 89000,
      description: "A partir de R$ 890. Avaliação para toxina botulínica estética ou apoio em tensão muscular/bruxismo.",
      isAesthetic: true, requiresEvaluationFirst: true,
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
    // timestamps crescentes (agente responde ~1-2 min depois do lead);
    // gapMinutes desloca o relógio (follow-up dias depois, pós-procedimento etc.)
    const thread: MakeLeadOpts["thread"] = [];
    let cursor = created.getTime();
    for (const m of generated) {
      if (m.gapMinutes) cursor += m.gapMinutes * 60_000;
      const mediaItem = m.media ? findMedia(m.media, m.mediaQuery) : null;
      const isVoice = m.author === "agent" && m.voice === true;
      const voiceUrl = isVoice ? await synthesizeVoiceNote(m.body) : null;
      thread.push({
        author: m.author,
        body: m.body,
        at: new Date(cursor),
        intent: m.intent,
        deliveryFormat: voiceUrl ? "audio" : undefined,
        mediaUrl: voiceUrl,
        mediaType: voiceUrl ? "audio" : undefined,
      });
      cursor += 90_000;
      // Mídia (vídeo/imagem) vai como mensagem PRÓPRIA logo depois do texto.
      if (m.author === "agent" && mediaItem) {
        thread.push({
          author: "agent",
          body: mediaItem.title ?? "",
          at: new Date(cursor),
          intent: "media_sent",
          mediaUrl: mediaItem.url,
          mediaType: mediaItem.type,
        });
        cursor += 90_000;
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
      profilePicUrl: demoLeadAvatarUrl(conv.leadName, conv.key),
      needsAttention: conv.needsAttention,
      attentionReason: conv.attentionReason ?? null,
      aiPaused: conv.aiPaused,
      thread,
    });
    if (conv.afterHours) afterHoursCount += thread.length;

    if (conv.booked) {
      const apptStatus = conv.appointment?.status ?? (convIdx % 4 === 0 ? "confirmed" : "scheduled");
      const isCompleted = apptStatus === "completed";
      // Futuro espalhado na semana entre os profissionais; concluídos ficam no passado recente.
      const startsAt = isCompleted
        ? spAt(2 + (convIdx % 5), 10 + (convIdx % 6))
        : spAt(-(1 + (convIdx % 6)), 9 + (convIdx % 9));
      apptRows.push({
        id: randomUUID(),
        clinicId,
        leadId,
        professionalId: profByTreatment[conv.treatment] ?? profHelena,
        treatmentId: treatmentIds[conv.treatment] ?? null,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 50 * 60_000),
        status: apptStatus,
        source: "app",
        valueCents: conv.appointment?.valueCents ?? TREATMENT_VALUE_CENTS[conv.treatment] ?? 15000,
        createdAt: created,
        updatedAt: created,
      });
    }

    if (conv.followUp) {
      const isDone = conv.followUp.status === "done";
      // "done" = o resgate já aconteceu na thread (~2 dias após o início da conversa).
      const dueAt = isDone ? spAt(Math.max(conv.daysAgo - 2, 0), 10) : spAt(-1, 9, convIdx);
      followRows.push({
        id: randomUUID(),
        clinicId,
        leadId,
        dueAt,
        status: conv.followUp.status,
        reason: conv.followUp.reason,
        suggestedMessage: `Olá, ${conv.leadName.split(" ")[0]}! Passando para saber se ainda faz sentido seguirmos com sua avaliação de ${conv.treatment.toLowerCase()}. Temos novos horários esta semana. Quer que eu te envie as opções?`,
        completedAt: isDone ? new Date(dueAt.getTime() + 5 * 60_000) : null,
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
    const leadName = genName();
    leadRows.push({
      id: leadId, clinicId, name: leadName, phone: genPhone(), channel: pick(CHANNELS, i),
      profilePicUrl: demoLeadAvatarUrl(leadName),
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
    const leadName = genName();
    leadRows.push({
      id: randomUUID(), clinicId, name: leadName, phone: genPhone(), channel: pick(CHANNELS, i),
      profilePicUrl: demoLeadAvatarUrl(leadName),
      treatmentInterest: treatment, status: "lost", temperature: null,
      createdAt: created, updatedAt: created,
    });
  }

  // ── Fila de follow-up (widget "follow-ups pendentes") — leads mornos com uma
  // mini-thread coerente que terminou em "vou pensar" e follow-up agendado.
  const FOLLOW_UP_QUEUE: { name: string; treatment: string; daysAgo: number; ask: string; reply: string }[] = [
    {
      name: "Vanessa Siqueira", treatment: "Clareamento dental", daysAgo: 3,
      ask: "Oi! Quanto custa o clareamento a laser de vocês?",
      reply: "Oi, Vanessa! Sou a Marina, da Odonto Marques 😊 O clareamento é a partir de R$ 690, e a avaliação custa R$ 150 — nela a Dra. Helena confere seu esmalte e fecha o valor certinho. Parcelamos no cartão. Quer que eu veja os horários?",
    },
    {
      name: "Gustavo Brandão", treatment: "Implante dentário", daysAgo: 4,
      ask: "Boa tarde, queria saber o valor do implante de um dente.",
      reply: "Boa tarde, Gustavo! Sou a Marina, da Odonto Marques. O implante é a partir de R$ 2.900, com o valor fechado após a avaliação e a imagem — custa R$ 150 e o Dr. Rafael já monta seu planejamento. Parcelamos no cartão. Posso te mostrar os horários?",
    },
    {
      name: "Tatiana Vasconcelos", treatment: "Lentes de porcelana", daysAgo: 2,
      ask: "Oi, vi o anúncio de vocês. As lentes de porcelana saem por quanto?",
      reply: "Oi, Tatiana! Que bom te ver por aqui 😊 Sou a Marina, da Odonto Marques. As lentes de porcelana são a partir de R$ 1.800 por dente, e a avaliação estética (R$ 150) já sai com o desenho digital do seu sorriso. Quer que eu reserve um horário com a Dra. Helena?",
    },
  ];
  for (let i = 0; i < FOLLOW_UP_QUEUE.length; i++) {
    const q = FOLLOW_UP_QUEUE[i];
    const created = spAt(q.daysAgo, 11 + i, (i * 13) % 50);
    const { leadId } = makeLead({
      clinicId,
      name: q.name,
      status: "follow_up_due",
      temperature: "warm",
      treatmentInterest: q.treatment,
      createdAt: created,
      channel: pick(CHANNELS, i + 2),
      thread: [
        { author: "lead", body: q.ask, at: created, intent: "lead" },
        { author: "agent", body: q.reply, at: new Date(created.getTime() + 90_000), intent: "price_inquiry" },
        { author: "lead", body: "Entendi! Vou pensar e te retorno, ok?", at: new Date(created.getTime() + 180_000), intent: "lead" },
        { author: "agent", body: "Claro! Sem pressa 😊 Deixo seu contato guardado e qualquer novidade de horários eu te aviso por aqui, combinado?", at: new Date(created.getTime() + 270_000), intent: "small_talk" },
      ],
    });
    followRows.push({
      id: randomUUID(),
      clinicId,
      leadId,
      dueAt: spAt(0, 9 + i, 15),
      status: "pending",
      reason: "reengajamento",
      suggestedMessage: `Olá, ${q.name.split(" ")[0]}! Passando para saber se ainda faz sentido seguirmos com sua avaliação de ${q.treatment.toLowerCase()}. Abriram novos horários esta semana — quer que eu te envie as opções?`,
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
