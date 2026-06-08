// Coração do sistema: coordena todo o fluxo de uma mensagem inbound.
// Substitui a lógica de orquestração espalhada no zapi/route.ts.
//
// Fluxo: mensagem → deduplicação → lead/conversa → intent → ação → resposta

import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db/client";
import { clinics, conversations as conversationsTable, leads as leadsTable, messages as messagesTable, appointments as appointmentsTable } from "@/infrastructure/db/schema";
import { eq, and, or, count, gte, lt } from "drizzle-orm";
import {
  buildContactIdentifiersFromWebhook,
  resolveWhatsAppChannelAddress,
} from "@/core/whatsapp/WhatsAppContactIdentity";

import { RegisterIncomingMessage } from "@/application/use-cases/leads/register-incoming-message";
import { DefaultUsageCostTracker } from "@/application/services/default-usage-cost-tracker";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { DrizzleUsageCostRepository } from "@/infrastructure/repositories/drizzle-usage-cost-repository";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleFollowUpRepository } from "@/infrastructure/repositories/drizzle-follow-up-repository";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import { resolveCalendarGateway } from "@/infrastructure/adapters/calendar/resolve-calendar-gateway";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import { resolveChannelConfig, type ClinicChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";

import { ClinicTimezone, parseBusinessHours, getTimeGreeting } from "@/core/scheduling/ClinicTimezone";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import { IntentClassifier, type IntentType } from "@/core/intelligence/IntentClassifier";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { resolveActiveEditorialConfig } from "@/application/config/editorial-config";
import { BookingService } from "@/core/scheduling/BookingService";
import { selectBestSlots } from "@/core/scheduling/SlotEngine";
import { resolveTreatmentDuration } from "@/core/scheduling/resolveTreatmentDuration";
import type { FormattedSlot } from "@/core/conversation/ConversationStateMachine";
import { NotifyClinicOperators } from "@/application/use-cases/notifications/notify-clinic-operators";
import { DrizzlePushSubscriptionRepository } from "@/infrastructure/repositories/drizzle-push-subscription-repository";
import { WebPushGateway } from "@/infrastructure/adapters/push/web-push-gateway";

import type { Clinic, MenuItem, MenuItemIntent } from "@/domain/entities/clinic";
import type { ConversationExperience } from "@/domain/entities/clinic";
import type { Message } from "@/domain/entities/conversation";
import type { Treatment } from "@/domain/entities/treatment";
import {
  CONCIERGE_MENU_ITEMS,
  DEFAULT_CONVERSATION_EXPERIENCE,
  DEFAULT_MENU_ITEMS,
} from "@/domain/entities/clinic";
import type { ProcedureListItem } from "@/core/conversation/ConversationStateMachine";

const SLOTS_LOOKAHEAD_DAYS = 14;

// ── Menu resolution ──────────────────────────────────────────────────────────

type MenuResolution =
  | { intent: "book_appointment" }
  | { intent: "price_inquiry" }
  | { intent: "needs_human" }
  | { intent: "general_question"; subtype: "procedures" | "location" };

function intentToMenuResolution(intent: MenuItemIntent): MenuResolution {
  switch (intent) {
    case "procedures": return { intent: "general_question", subtype: "procedures" };
    case "location": return { intent: "general_question", subtype: "location" };
    case "book_appointment": return { intent: "book_appointment" };
    case "price_inquiry": return { intent: "price_inquiry" };
    case "needs_human": return { intent: "needs_human" };
  }
}

function buildMenuText(items: MenuItem[]): string {
  return items.filter(i => i.enabled).map(i => `${i.number}. ${i.label}`).join("\n");
}

function getMenuItemsForExperience(clinic: Clinic, experience: ConversationExperience): MenuItem[] {
  return clinic.menuItems ?? (experience === "concierge" ? CONCIERGE_MENU_ITEMS : DEFAULT_MENU_ITEMS);
}

// Remove opener simples do greetingMessage ("Olá!", "Oi,", "Ei!") para evitar duplicação
// com a saudação temporal que o Orchestrator prepende no primeiro contato.
// Conservador: só remove openers de uma palavra — não toca frases compostas como
// "Seja bem-vindo à Ximendes" ou saudações temporais ("Bom dia!").
function stripGreetingPrefix(text: string): string {
  const stripped = text.replace(/^(?:olá|ola|oi|ei|e\s+aí|e\s+ai|hey)[!.,]?\s+/i, "");
  if (stripped === text) return text;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function buildMenuBody(clinic: Clinic, variant: "first" | "reoffer" | "stale", experience: ConversationExperience): string {
  const items = getMenuItemsForExperience(clinic, experience);
  const menuText = buildMenuText(items);

  if (experience === "concierge") {
    const intro = variant === "first"
      ? "Claro. Você pode escolher por onde quer começar:"
      : "Aqui estão as opções novamente:";
    return `${intro}\n\n${menuText}`;
  }

  if (clinic.menuItems !== null) {
    // Structured mode: greetingMessage só no primeiro contato; reoffer usa texto neutro.
    // stripGreetingPrefix evita "Boa tarde! Olá! Sou a..." quando greetingMessage
    // começa com uma saudação própria.
    const raw = variant === "first"
      ? (clinic.greetingMessage ?? `Seja bem-vindo à ${clinic.name}. Como posso ajudá-lo?`)
      : variant === "stale"
      ? "Retomando nossa conversa — como posso ajudá-lo?"
      : "Como posso ajudá-lo?";
    const intro = variant === "first" ? stripGreetingPrefix(raw) : raw;
    return `${intro}\n\n${menuText}`;
  }

  // Modo legado: greetingMessage substitui tudo apenas no primeiro contato
  if (variant === "stale") {
    return `Retomando nossa conversa — como posso ajudá-lo?\n\n${menuText}`;
  }
  if (variant === "first") {
    const raw = clinic.greetingMessage ?? `Seja bem-vindo à ${clinic.name}. Como posso ajudá-lo?\n\n${menuText}`;
    return stripGreetingPrefix(raw);
  }
  return `Como posso ajudá-lo?\n\n${menuText}`;
}

export function shouldShowInitialMenu(experience: ConversationExperience, intent: IntentType): boolean {
  if (intent === "clinical_urgency" || intent === "needs_human" || intent === "patient_arrived") {
    return false;
  }

  if (experience === "concierge") return false;

  return intent === "greeting" || intent === "acknowledgment" || intent === "unclear";
}

function shouldSendConciergeStarter(experience: ConversationExperience, intent: IntentType): boolean {
  if (experience !== "concierge") return false;
  return intent === "greeting" || intent === "acknowledgment" || intent === "unclear";
}

function buildConciergeStarter(clinic: Clinic, timezone: ClinicTimezone, leadName?: string | null): string {
  const salutation = getDayGreeting(timezone);
  const nameGreeting = leadName ? `, ${leadName}` : "";
  const specialtyHint = clinic.specialty.toLowerCase().includes("estética")
    ? "lentes, avaliação, valores ou algum tratamento específico"
    : "avaliação, valores ou algum tratamento específico";

  return `${salutation}${nameGreeting}. Tudo bem?\n\nMe conta o que você gostaria de ver hoje: ${specialtyHint}?`;
}

function isMenuRerequest(message: string): boolean {
  const n = message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  return (
    n === "menu" ||
    n === "voltar" ||
    n.includes("tem menu") ||
    n.includes("ver menu") ||
    n.includes("mostrar menu") ||
    n.includes("qual o menu") ||
    n.includes("quero ver o menu") ||
    n.includes("me manda o menu") ||
    n.includes("voltar ao menu") ||
    n.includes("volta ao menu") ||
    n.includes("voltar pro menu") ||
    n.includes("volta pro menu") ||
    n.includes("menu anterior") ||
    n.includes("menu principal")
  );
}

// Saudação isolada sem conteúdo de negócio — indica recomeço de conversa.
function isIsolatedGreeting(message: string): boolean {
  const n = message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const patterns = [
    "oi", "ola", "bom dia", "boa tarde", "boa noite",
    "hey", "e ai", "e la", "oi tudo bem", "ola tudo bem",
    "tudo bem", "tudo bom", "como vai", "oi boa tarde",
    "oi bom dia", "oi boa noite",
  ];
  return patterns.some((p) => n === p || n === p + "!" || n === p + "." || n === p + "?");
}

// Comando de reset — uso exclusivo para testes, zera estado e reinicia saudação.
function isResetCommand(message: string): boolean {
  const n = message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  return n === "/reset" || n === "reset" || n === "resetar" || n === "/resetar";
}

function resolveMenuSelection(message: string, items: MenuItem[]): MenuResolution | null {
  const n = message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

  // Número digitado → mapeia pelo item correspondente na configuração da clínica
  const byNumber = items.find(i => i.enabled && n === String(i.number));
  if (byNumber) return intentToMenuResolution(byNumber.intent);

  // Rótulo textual de item ativo → determinístico, sem depender do LLM
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const byLabel = items.find(i => i.enabled && n === norm(i.label));
  if (byLabel) return intentToMenuResolution(byLabel.intent);

  // "remarcar" e "desmarcar" contêm "marcar" como substring — retornam null para o
  // LLM classificar como reschedule_appointment / cancel_appointment corretamente.
  if (n.includes("remarcar") || n.includes("desmarcar")) return null;

  // Palavras-chave universais (funcionam independente da ordem do menu)
  if (n.includes("procedimento") || n.includes("tratamento") || n.includes("servico"))
    return { intent: "general_question", subtype: "procedures" };
  // "consulta" removida: palavra ambígua que aparece em urgências, cancelamentos e
  // remarcações — o LLM classifica com mais precisão nesses casos.
  if (n.includes("agendar") || n.includes("agenda") || n.includes("horario") || n.includes("marcar") || n.includes("avaliacao"))
    return { intent: "book_appointment" };
  if (n.includes("pagamento") || n.includes("valor") || n.includes("preco") || n.includes("parcela") || n.includes("forma"))
    return { intent: "price_inquiry" };
  if (n.includes("localizacao") || n.includes("endereco") || n.includes("onde") || n.includes("fica"))
    return { intent: "general_question", subtype: "location" };
  if (n.includes("especialista") || n.includes("dentista") || n.includes("doutor") || n === "dr")
    return { intent: "needs_human" };

  return null;
}

function isLocationRequest(message: string): boolean {
  const n = message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  return n.includes("localizacao") || n.includes("endereco") || n.includes("onde") || n.includes("fica");
}

function isProcedureCatalogRequest(message: string): boolean {
  const n = message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  return n.includes("procedimento") || n.includes("tratamento") || n.includes("servico") || n.includes("opcoes");
}

function normalizeFreeText(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAnyKeyword(normalized: string, keywords: string[]): boolean {
  return keywords.some((keyword) => normalized.includes(keyword));
}

function isSchedulingRequestText(normalized: string): boolean {
  return hasAnyKeyword(normalized, [
    "agendar",
    "agenda",
    "marcar",
    "horario",
    "consulta",
    "remarcar",
    "cancelar",
  ]);
}

function isPriceRequestText(normalized: string): boolean {
  return hasAnyKeyword(normalized, ["valor", "preco", "quanto", "custa", "pagamento", "parcela"]);
}

function isLocationRequestText(normalized: string): boolean {
  return hasAnyKeyword(normalized, ["localizacao", "endereco", "onde", "fica"]);
}

function isProcedureCatalogRequestText(normalized: string): boolean {
  return hasAnyKeyword(normalized, ["procedimento", "tratamento", "servico", "opcoes"]);
}

function isUrgencyRequestText(normalized: string): boolean {
  return hasAnyKeyword(normalized, ["dor", "urgencia", "sangramento", "emergencia", "urgente"]);
}

function isHumanRequestText(normalized: string): boolean {
  return hasAnyKeyword(normalized, ["dentista", "doutor", "atendente", "humano", "ligar", "desconto", "especial"]);
}

function isPeriodPreferenceText(normalized: string): boolean {
  return hasAnyKeyword(normalized, ["manha", "tarde", "noite", "cedo"]);
}

function didAgentAskForProcedure(lastAgentMessage?: string | null): boolean {
  if (!lastAgentMessage) return false;
  const n = normalizeFreeText(lastAgentMessage);
  return (
    n.includes("qual procedimento") ||
    n.includes("qual tratamento") ||
    n.includes("procedimento voce") ||
    n.includes("tratamento voce")
  );
}

const TREATMENT_MENTION_STOPWORDS = new Set([
  "sobre",
  "quais",
  "qual",
  "opcoes",
  "opcao",
  "voces",
  "fazem",
  "fazer",
  "tenho",
  "interesse",
  "saber",
  "mais",
  "tem",
  "me",
  "fala",
  "explica",
]);

export function resolveDirectTreatmentMention(
  message: string,
  treatments: Treatment[],
  lastAgentMessage?: string | null,
): Treatment | null {
  const normalized = normalizeFreeText(message);
  if (!normalized || /^\d+$/.test(normalized)) return null;
  if (normalized.split(/\s+/).length > 8) return null;
  if (isSchedulingRequestText(normalized) || isPriceRequestText(normalized)) return null;
  if (didAgentAskForProcedure(lastAgentMessage)) return null;
  const tokens = normalized
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !TREATMENT_MENTION_STOPWORDS.has(token));

  return treatments.find((treatment) => {
    const treatmentName = normalizeFreeText(treatment.name);
    if (treatmentName === normalized) return true;
    if (normalized.length >= 4 && treatmentName.includes(normalized)) return true;
    if (treatmentName.length >= 4 && normalized.includes(treatmentName)) return true;
    if (tokens.some((token) => treatmentName.includes(token))) return true;
    return false;
  }) ?? null;
}

function isLikelyBusinessMessage(message: string, treatments: Treatment[]): boolean {
  const normalized = normalizeFreeText(message);
  if (!normalized) return false;
  if (
    isSchedulingRequestText(normalized) ||
    isPriceRequestText(normalized) ||
    isLocationRequestText(normalized) ||
    isProcedureCatalogRequestText(normalized) ||
    isUrgencyRequestText(normalized) ||
    isHumanRequestText(normalized) ||
    isPeriodPreferenceText(normalized)
  ) {
    return true;
  }

  return resolveDirectTreatmentMention(message, treatments) !== null;
}

export function shouldThrottleRapidLeadMessage(params: {
  messages: Message[];
  currentExternalId: string;
  hasPendingSlotOffer: boolean;
  isMenuActive: boolean;
  isProcedureListActive?: boolean;
  treatments: Treatment[];
  windowMs?: number;
}): boolean {
  if (params.hasPendingSlotOffer || params.isMenuActive || params.isProcedureListActive) return false;

  const current = params.messages.find((m) => m.externalId === params.currentExternalId);
  if (!current || current.author !== "lead") return false;
  if (isLikelyBusinessMessage(current.body, params.treatments)) return false;

  const previousLead = params.messages
    .filter((m) => m.author === "lead" && m.id !== current.id && m.sentAt <= current.sentAt)
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
    .at(-1);
  if (!previousLead) return false;

  const windowMs = params.windowMs ?? RAPID_LEAD_MESSAGE_THROTTLE_MS;
  return current.sentAt.getTime() - previousLead.sentAt.getTime() < windowMs;
}

function getDayGreeting(timezone: ClinicTimezone): string {
  const { hour } = timezone.toLocalParts(new Date());
  return getTimeGreeting(hour);
}
const MAX_SLOTS_TO_OFFER = 5;
const RATE_LIMIT_MESSAGES_PER_HOUR = 30;
const SLOTS_WITH_DATE_AND_TIME = 2;
// Quantas classificações unclear consecutivas disparam notificação ao operador
const UNCLEAR_THRESHOLD = 3;
const SLOTS_WITH_DATE_ONLY = 3;
// Gap de inatividade (horas) que sinaliza recomeço de conversa
const CONVERSATION_RESTART_HOURS = 4;
const RAPID_LEAD_MESSAGE_THROTTLE_MS = 4_000;

const TEMP_RANK = { hot: 2, warm: 1, cold: 0 } as const;

export function temperatureFromIntent(intent: IntentType): "hot" | "warm" | "cold" {
  switch (intent) {
    case "book_appointment":
    case "check_availability":
    case "confirm_slot":
    case "reject_slots":
    case "reschedule_appointment":
    case "cancel_appointment":
    case "list_appointments":
      return "hot";
    case "price_inquiry":
    case "general_question":
    case "clinical_urgency":
    case "needs_human":
    case "patient_arrived":
      return "warm";
    default:
      return "cold";
  }
}

export function buildLocationClinicContext(address: string | null): string {
  const base = `Lead selecionou "Localização" no menu. Informe o endereço e os horários de atendimento da clínica. Sem convite para agendar ao final.`;
  if (address) return `${base}\nEndereço: ${address}.`;
  // Endereço não cadastrado — instrução explícita para não inventar
  return `${base}\nEndereço: não cadastrado no sistema. Informe que a equipe pode passar o endereço, ou que o lead pode entrar em contato diretamente. NÃO invente endereço.`;
}

// ─── Cálculo de parcelas (flat rate exato) ───────────────────────────────────

export type InstallmentRate = { n: number; rate: number; active: boolean };

/** Parcela exata usando taxa flat da maquininha: preço ÷ (1 − taxa) ÷ N */
export function calculateFlatInstallment(principal: number, flatRatePercent: number, n: number): number {
  return Math.ceil(principal / (1 - flatRatePercent / 100) / n);
}

/**
 * Gera tabela de parcelamento com taxas flat exatas da maquininha.
 * Extrai preços da política comercial e aplica cada faixa ativa.
 */
export function buildInstallmentTable(
  policy: string,
  rates: InstallmentRate[],
): string | null {
  const activeRates = rates.filter((r) => r.active).sort((a, b) => a.n - b.n);
  if (activeRates.length === 0) return null;

  const matches = [...policy.matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/g)];
  const prices = [
    ...new Set(
      matches
        .map((m) => parseFloat(m[1].replace(/\./g, "").replace(",", ".")))
        .filter((v) => !isNaN(v) && v >= 200),
    ),
  ].sort((a, b) => a - b);

  if (prices.length === 0) return null;

  const rows = prices.map((price) => {
    const opts = activeRates
      .map((r) => `${r.n}x R$${calculateFlatInstallment(price, r.rate, r.n).toLocaleString("pt-BR")}`)
      .join(" | ");
    return `• R$${price.toLocaleString("pt-BR")}: ${opts}`;
  });

  return `TABELA DE PARCELAMENTO (taxa já embutida — apresente estes valores diretamente, sem mencionar taxa adicional):
${rows.join("\n")}
Se o lead pedir faixa não listada, indique a mais próxima. NUNCA diga "+ taxa" — a taxa já está nos valores acima.`;
}

// Tratamentos estéticos visíveis onde o contexto visual do sorriso ajuda a
// personalizar a resposta. Chave: nome normalizado do tratamento.
const AESTHETIC_TREATMENT_KEYWORDS = [
  "lente", "faceta", "clareamento", "harmonização", "harmonizacao",
  "gengivoplastia", "botox", "sorriso",
];

export function isAestheticTreatment(treatmentName: string): boolean {
  const normalized = treatmentName.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return AESTHETIC_TREATMENT_KEYWORDS.some((kw) => normalized.includes(kw));
}

// Instrução de convite à foto — posicionada como benefício ao paciente, nunca obrigatória.
// Usada apenas em modo concierge e apenas para tratamentos estéticos visuais.
function buildPhotoInviteInstruction(): string {
  return `SE O LEAD AINDA NÃO ENVIOU FOTO DO SORRISO e demonstrou interesse neste procedimento: APÓS apresentar os benefícios e valores (mas ANTES da pergunta de agendamento), convide-o de forma acolhedora e completamente opcional, posicionando como um benefício para ele — exemplo de tom: "Me manda uma foto do seu sorriso quando quiser — assim consigo te dar uma ideia mais personalizada de como ficaria 😊". REGRAS OBRIGATÓRIAS: (1) nunca pressione nem torne obrigatório; (2) use "quando quiser" ou "se quiser"; (3) só faça esse convite UMA vez por conversa — se já foi pedido antes, não repita.`;
}

export function buildSelectedTreatmentContext(item: ProcedureListItem, commercialPolicy?: string | null, experience?: ConversationExperience): string {
  const nextStep = item.requiresEvaluationFirst
    ? "FECHAMENTO: use uma pergunta aberta que pressuponha que o lead vai agendar — ex: 'Qual seria o melhor momento para você fazer a avaliação?' ou 'Quando você teria disponibilidade?'. Nunca pergunte 'Quer verificar?' (fechado). Pressuposto de avanço, não pedido de permissão."
    : "FECHAMENTO: use uma pergunta aberta que pressuponha que o lead vai agendar — ex: 'Qual seria o melhor momento para você?' ou 'Que dia fica melhor para você?'. Nunca pergunte 'Quer agendar?' (fechado). Pressuposto de avanço, não pedido de permissão.";

  const details = [
    `Lead selecionou o procedimento "${item.name}" em uma lista numerada.`,
    item.description ? `Descrição cadastrada: ${item.description}` : null,
    item.requiresEvaluationFirst
      ? "Este procedimento exige avaliação antes do agendamento definitivo. Explique isso com naturalidade e conduza para avaliação."
      : "Explique o procedimento com naturalidade.",
    commercialPolicy ? `Política comercial: ${commercialPolicy}` : null,
    experience === "concierge" && isAestheticTreatment(item.name) ? buildPhotoInviteInstruction() : null,
    nextStep,
    experience !== "concierge" ? "Mencione que o lead pode digitar *menu* a qualquer momento para ver outras opções." : null,
  ].filter(Boolean);

  const format = experience === "concierge"
    ? "FORMATO: tópicos — apresente os destaques do procedimento em até 4 bullet points (•), um por linha. Depois de listar, faça a pergunta de próximo passo."
    : "Formato: até 2 parágrafos curtos, sem lista.";

  return `${details.join("\n")}\n${format}`;
}

export function buildDirectTreatmentContext(treatment: Treatment, commercialPolicy?: string | null, experience?: ConversationExperience): string {
  const nextStep = treatment.requiresEvaluationFirst
    ? "FECHAMENTO: use uma pergunta aberta que pressuponha que o lead vai agendar — ex: 'Qual seria o melhor momento para você fazer a avaliação?' ou 'Quando você teria disponibilidade?'. Nunca pergunte 'Quer verificar?' (fechado). Pressuposto de avanço, não pedido de permissão."
    : "FECHAMENTO: use uma pergunta aberta que pressuponha que o lead vai agendar — ex: 'Qual seria o melhor momento para você?' ou 'Que dia fica melhor para você?'. Nunca pergunte 'Quer agendar?' (fechado). Pressuposto de avanço, não pedido de permissão.";

  const details = [
    `Lead mencionou diretamente o tratamento "${treatment.name}".`,
    treatment.description ? `Descrição cadastrada: ${treatment.description}` : null,
    treatment.requiresEvaluationFirst
      ? "Este procedimento exige avaliação antes do agendamento definitivo. Explique isso com naturalidade e conduza para avaliação."
      : "Explique o procedimento com naturalidade.",
    commercialPolicy ? `Política comercial: ${commercialPolicy}` : null,
    "Se a política comercial ou as orientações da clínica trouxerem valores, condições, técnicas ou limites explícitos para este tratamento, preserve esses dados na resposta.",
    experience === "concierge" && isAestheticTreatment(treatment.name) ? buildPhotoInviteInstruction() : null,
    nextStep,
  ].filter(Boolean);

  const format = experience === "concierge"
    ? "FORMATO: tópicos — apresente os destaques do tratamento em até 4 bullet points (•), um por linha. Depois de listar, faça a pergunta de próximo passo."
    : "Formato: até 2 parágrafos curtos.";

  return `${details.join("\n")}\n${format}`;
}

type ClinicRow = typeof clinics.$inferSelect;

function buildClinic(row: ClinicRow): Clinic {
  return {
    id: row.id,
    name: row.name,
    specialty: row.specialty,
    city: row.city,
    address: row.address ?? null,
    timezone: row.timezone,
    conversationExperience: row.conversationExperience ?? DEFAULT_CONVERSATION_EXPERIENCE,
    greetingMessage: row.greetingMessage ?? null,
    menuItems: (row.menuItems as MenuItem[] | null) ?? null,
    businessHours: row.businessHours,
    googleCalendarId: row.googleCalendarId,
    calendarMode: row.calendarMode,
    receptionistPhone: row.receptionistPhone ?? null,
    takeoverTtlHours: row.takeoverTtlHours,
    postAppointmentBufferMinutes: row.postAppointmentBufferMinutes,
    defaultAppointmentDurationMinutes: row.defaultAppointmentDurationMinutes,
    installmentRates: (row.installmentRates as { n: number; rate: number; active: boolean }[] | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ConversationOrchestrator {
  private stateMachine = new ConversationStateMachine();
  private intentClassifier = new IntentClassifier();
  private responseComposer = new ResponseComposer();

  private leadRepo = new DrizzleLeadRepository();
  private conversationRepo = new DrizzleConversationRepository();
  private appointmentRepo = new DrizzleAppointmentRepository();
  private usageCostRepo = new DrizzleUsageCostRepository();
  private treatmentRepo = new DrizzleTreatmentRepository();
  private notifier = new NotifyClinicOperators(
    new DrizzlePushSubscriptionRepository(),
    new WebPushGateway(),
  );

  async handle(params: {
    clinicId: string;
    phone: string;
    whatsappLid?: string | null;
    messageText: string;
    messageId: string;
    senderName?: string;
    timestamp: Date;
    replyEnabled?: boolean;
    channelClinicId?: string;
  }): Promise<{ replied: boolean }> {
    const { clinicId, phone, messageText, messageId, senderName, timestamp } = params;
    const replyEnabled = params.replyEnabled ?? true;
    const contactIdentifiers = buildContactIdentifiersFromWebhook({
      phone,
      chatLid: params.whatsappLid,
    });
    const channelAddress = resolveWhatsAppChannelAddress(contactIdentifiers) ?? phone;

    // ── 1. Deduplicação por ID: retorna se já processamos esta mensagem ──
    const alreadyProcessed = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(eq(messagesTable.externalId, messageId))
      .limit(1);

    if (alreadyProcessed.length > 0) {
      return { replied: false };
    }

    // ── 1.5. Dedup por conteúdo — Z-API pode entregar o mesmo webhook com IDs distintos ──
    // Janela de 5s: suficiente para cobrir o lag do Z-API sem bloquear mensagens legítimas iguais.
    const fiveSecondsAgo = new Date(timestamp.getTime() - 5_000);
    const identityMatch = contactIdentifiers.phone
      ? contactIdentifiers.whatsappLid
        ? or(
            eq(leadsTable.phone, contactIdentifiers.phone),
            eq(leadsTable.whatsappLid, contactIdentifiers.whatsappLid),
            eq(leadsTable.phone, contactIdentifiers.whatsappLid),
          )
        : eq(leadsTable.phone, contactIdentifiers.phone)
      : contactIdentifiers.whatsappLid
        ? or(
            eq(leadsTable.whatsappLid, contactIdentifiers.whatsappLid),
            eq(leadsTable.phone, contactIdentifiers.whatsappLid),
          )
        : eq(leadsTable.phone, phone);

    const [contentDupe] = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .innerJoin(conversationsTable, eq(conversationsTable.id, messagesTable.conversationId))
      .innerJoin(leadsTable, eq(leadsTable.id, conversationsTable.leadId))
      .where(
        and(
          eq(leadsTable.clinicId, clinicId),
          identityMatch,
          eq(messagesTable.author, "lead"),
          eq(messagesTable.body, messageText),
          gte(messagesTable.sentAt, fiveSecondsAgo),
        ),
      )
      .limit(1);

    if (contentDupe) {
      console.log(`[Orchestrator] Webhook duplicado por conteúdo para ${channelAddress} — ignorado`);
      return { replied: false };
    }

    // ── 2. Busca clínica ──
    const clinicRows = await db
      .select()
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);

    if (clinicRows.length === 0) {
      console.error(`[Orchestrator] Clinic not found: ${clinicId}`);
      return { replied: false };
    }

    const clinic = buildClinic(clinicRows[0]);
    const timezone = new ClinicTimezone(clinic.timezone);
    const businessHours = parseBusinessHours(clinic.businessHours);

    // FONTE ÚNICA EDITORIAL: versão ativa de playbook_versions via resolveActiveEditorialConfig.
    const editorial = await resolveActiveEditorialConfig(clinicId);
    // Credenciais de canal podem vir de uma clínica fonte de QA, mantendo dados
    // e decisões na clínica lógica acima.
    let channelClinicRow = clinicRows[0];
    if (params.channelClinicId && params.channelClinicId !== clinicId) {
      const channelClinicRows = await db
        .select()
        .from(clinics)
        .where(eq(clinics.id, params.channelClinicId))
        .limit(1);

      if (channelClinicRows.length === 0) {
        console.error(`[Orchestrator] Channel clinic not found: ${params.channelClinicId}`);
        return { replied: false };
      }

      channelClinicRow = channelClinicRows[0];
    }
    const channelConfig = resolveChannelConfig(channelClinicRow);

    // ── 3. Registra lead, conversa e mensagem ──
    const usageCostTracker = new DefaultUsageCostTracker({
      usageCostRepository: this.usageCostRepo,
      idGenerator: randomUUID,
      now: () => new Date(),
    });

    const registerUseCase = new RegisterIncomingMessage({
      leadRepository: this.leadRepo,
      conversationRepository: this.conversationRepo,
      usageCostTracker,
      idGenerator: randomUUID,
      now: () => new Date(),
    });

    const { lead, conversation } = await registerUseCase.execute({
      clinicId,
      message: {
        externalMessageId: messageId,
        externalContactId: channelAddress,
        phone,
        whatsappLid: params.whatsappLid ?? null,
        name: senderName ?? null,
        email: null,
        campaignId: null,
        channel: "whatsapp",
        externalThreadId: channelAddress,
        body: messageText,
        receivedAt: timestamp,
      },
    });

    const outboundAddress =
      resolveWhatsAppChannelAddress({ phone: lead.phone, whatsappLid: lead.whatsappLid }) ??
      channelAddress;

    if (!replyEnabled) {
      const leadDisplayName = lead.name ?? channelAddress;
      await this.notifier
        .execute(clinicId, {
          title: leadDisplayName,
          body: messageText.slice(0, 100),
          url: `/app/inbox/${conversation.id}`,
        })
        .catch((err) => console.error("[Orchestrator] Push falhou:", err));
      return { replied: false };
    }

    // ── 4–11. Processamento principal — erros aqui enviam fallback ao lead ──
    // O try começa aqui (após registrar lead+conversa) para proteger aiPaused,
    // rate limit e toda a lógica de IA com o mesmo fallback gracioso.
    try {

    // ── 4. Verifica se a IA está pausada para esta conversa ──
    // Se há TTL expirado → retoma automaticamente e sinaliza ao Composer para contextualizar.
    // Se pausada sem TTL (pause manual) ou TTL ainda vigente → silêncio.
    let resumedFromHumanTakeover = false;
    if (conversation.aiPaused) {
      const now = new Date();
      if (conversation.takeoverExpiresAt && conversation.takeoverExpiresAt < now) {
        await db
          .update(conversationsTable)
          .set({ aiPaused: false, takeoverExpiresAt: null, updatedAt: now })
          .where(eq(conversationsTable.id, conversation.id));
        resumedFromHumanTakeover = true;
        console.log(`[Orchestrator] Takeover TTL expirado para ${conversation.id} — IA retomada`);
      } else {
        console.log(`[Orchestrator] AI pausada para ${conversation.id}, ignorando resposta`);
        // Notifica operador que lead respondeu enquanto atendimento estava em pausa manual
        const displayName = lead.name ?? phone;
        await this.notifier
          .execute(clinicId, {
            title: displayName,
            body: messageText.slice(0, 100),
            url: `/app/inbox/${conversation.id}`,
          })
          .catch((err) => console.error("[Orchestrator] Push falhou:", err));
        return { replied: false };
      }
    }

    // ── 5. Rate limit — máx 20 msgs/hora do lead por conversa ──
    // Protege custo OpenAI contra spam e loops. A mensagem já foi salva no passo 3.
    const oneHourAgo = new Date(Date.now() - 60 * 60_000);
    const rateRows = await db
      .select({ total: count() })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.conversationId, conversation.id),
          eq(messagesTable.author, "lead"),
          gte(messagesTable.sentAt, oneHourAgo),
        ),
      );
    const msgCount = Number(rateRows[0]?.total ?? 0);
    if (msgCount >= RATE_LIMIT_MESSAGES_PER_HOUR) {
      console.warn(`[Orchestrator] Rate limit: ${phone} atingiu ${msgCount} msgs/h na conversa ${conversation.id}`);
      return { replied: false };
    }

    // ── 7. Carrega histórico de mensagens ──
    const allMessages = await this.conversationRepo.listMessages(conversation.id);

    const isFirstMessage = allMessages.filter((m) => m.author !== "lead").length === 0;
    const lastAgentMessage = [...allMessages].reverse().find((m) => m.author === "agent");

    // ── 8. Verifica oferta de slots pendente ──
    const pendingSlots = await this.stateMachine.getPendingSlotOffer(conversation.id);
    const hasPendingOffer = pendingSlots !== null;

    // ── 9. Resolve intenção: menu pré-classificado ou LLM estágio 1 ──
    const clinicTreatments = await this.treatmentRepo.listByClinic(clinicId);
    const experience = clinic.conversationExperience ?? DEFAULT_CONVERSATION_EXPERIENCE;

    const currentConversationState = await this.stateMachine.getCurrentState(conversation.id);
    const isMenuActive = currentConversationState?.state === "menu_offered";
    const isProcedureListActive = currentConversationState?.state === "procedure_list_offered";
    const clinicMenuItems = getMenuItemsForExperience(clinic, experience);
    let menuResolution: MenuResolution | null = null;
    if (isMenuActive) {
      menuResolution = resolveMenuSelection(messageText, clinicMenuItems);
      await this.stateMachine.invalidate(conversation.id);
    }

    const procedureSelection = await this.stateMachine.getOfferedProcedureByIndex(conversation.id, messageText);
    if (procedureSelection) {
      await this.stateMachine.invalidate(conversation.id);
    }

    if (
      procedureSelection === null &&
      shouldThrottleRapidLeadMessage({
        messages: allMessages,
        currentExternalId: messageId,
        hasPendingSlotOffer: hasPendingOffer,
        isMenuActive,
        isProcedureListActive,
        treatments: clinicTreatments,
      })
    ) {
      console.log(`[Orchestrator] Mensagem rápida de baixa informação para ${phone} — resposta suprimida`);
      return { replied: false };
    }

    // Comando de reset (testes): zera estado e reinicia conversa com saudação completa
    const resetRequested = !isFirstMessage && isResetCommand(messageText);

    // Lead pediu explicitamente para ver o menu fora do fluxo inicial
    const menuReRequested = !isMenuActive && !isFirstMessage && !resetRequested && isMenuRerequest(messageText);

    // Gap de inatividade: se o lead sumiu por ≥ CONVERSATION_RESTART_HOURS, recomeça
    let isStaleConversation = false;
    if (!isFirstMessage && !isMenuActive && !resetRequested && !menuReRequested) {
      const prevLeadMsgs = allMessages.filter((m) => m.author === "lead");
      if (prevLeadMsgs.length >= 2) {
        const prev = prevLeadMsgs[prevLeadMsgs.length - 2];
        const gapHours = (timestamp.getTime() - new Date(prev.sentAt).getTime()) / (1000 * 60 * 60);
        isStaleConversation = gapHours >= CONVERSATION_RESTART_HOURS;
      }
    }

    // Saudação isolada mid-conversa (sem oferta pendente, sem seleção válida de menu)
    const isolatedGreeting =
      !isFirstMessage && !hasPendingOffer &&
      !resetRequested && !menuReRequested && !isStaleConversation &&
      menuResolution === null &&
      isIsolatedGreeting(messageText);

    // Lead enviou número ou rótulo de item desabilitado — não rotear via LLM
    const nMsg = messageText.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    const isDisabledItemSelection =
      isMenuActive && menuResolution === null && !isolatedGreeting &&
      clinicMenuItems.some(i => {
        if (i.enabled) return false;
        const normalizedLabel = i.label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
        return nMsg === String(i.number) || nMsg === normalizedLabel;
      });

    // Lead enviou número que não existe no menu (válido nem desabilitado) — reapresenta sem LLM
    const isInvalidMenuNumber =
      isMenuActive && menuResolution === null && !isolatedGreeting && !isDisabledItemSelection &&
      /^\d+$/.test(nMsg) &&
      !clinicMenuItems.some(i => nMsg === String(i.number));

    // Lead digitou um número de item válido do menu sem o menu estar ativo (ex: escolheu opção 4,
    // a IA respondeu, e mandou "1" sem ter voltado ao menu). Reapresenta o menu sem chamar o LLM
    // para evitar o false-positive de confirm_slot que gera a mensagem de "horário indisponível".
    const isOrphanedMenuNumber =
      !isMenuActive &&
      !hasPendingOffer &&
      !isProcedureListActive &&
      !resetRequested &&
      !menuReRequested &&
      !isFirstMessage &&
      /^\d+$/.test(nMsg) &&
      clinicMenuItems.some(i => i.enabled && nMsg === String(i.number));

    const directTreatmentMention = !hasPendingOffer &&
      !isMenuActive &&
      menuResolution === null &&
      procedureSelection === null &&
      !resetRequested &&
      !menuReRequested &&
      !isStaleConversation &&
      !isolatedGreeting
        ? resolveDirectTreatmentMention(messageText, clinicTreatments, lastAgentMessage?.body ?? null)
        : null;

    const skipLlm = procedureSelection !== null || menuReRequested || isStaleConversation || isolatedGreeting || resetRequested || isDisabledItemSelection || isInvalidMenuNumber || isOrphanedMenuNumber;

    const nullSlotPref = { preferredDate: null as null, preferredPeriod: null as null, preferredTime: null as null, slotChoice: null as null, identifiedTreatment: null as null };

    const classification = directTreatmentMention
      ? {
          intent: "general_question" as IntentType,
          slotPreference: nullSlotPref,
          confidence: 1,
          shouldAskClarification: false,
          clarificationQuestion: null as null,
          handoffReason: null as null,
        }
      : procedureSelection
      ? {
          intent: "general_question" as IntentType,
          slotPreference: nullSlotPref,
          confidence: 1,
          shouldAskClarification: false,
          clarificationQuestion: null as null,
          handoffReason: null as null,
        }
      : menuResolution
      ? {
          intent: menuResolution.intent as IntentType,
          slotPreference: nullSlotPref,
          confidence: 1,
          shouldAskClarification: false,
          clarificationQuestion: null as null,
          handoffReason: menuResolution.intent === "needs_human" ? "Lead solicitou falar com um especialista" : null as null,
        }
      : skipLlm
      ? {
          intent: "acknowledgment" as IntentType,
          slotPreference: nullSlotPref,
          confidence: 1,
          shouldAskClarification: false,
          clarificationQuestion: null as null,
          handoffReason: null as null,
        }
      : await this.intentClassifier.classify(
          messageText,
          allMessages,
          hasPendingOffer,
          clinicTreatments.map((t) => t.name),
        );

    const { intent, slotPreference } = classification;

    // ── 7. Executa ação e compõe resposta ──
    let replyText: string;
    let composerInputTokens = 0;
    let composerOutputTokens = 0;

    const calendarGateway = resolveCalendarGateway({
      clinicId: clinic.id,
      calendarMode: clinic.calendarMode,
      googleCalendarId: clinic.googleCalendarId,
      timezone,
      businessHours: clinic.businessHours,
      postAppointmentBufferMinutes: clinic.postAppointmentBufferMinutes,
    });

    const bookingService = new BookingService(
      calendarGateway,
      this.appointmentRepo,
      this.leadRepo,
      undefined,
      new DrizzleFollowUpRepository(),
    );

    // Helper para compor resposta
    const compose = async (
      actionResult: Parameters<ResponseComposer["compose"]>[0]["actionResult"],
    ) => {
      const composed = await this.responseComposer.compose({
        actionResult,
        conversationHistory: allMessages,
        clinic: {
          name: clinic.name,
            specialty: editorial?.specialty ?? clinic.specialty,
            toneOfVoice: editorial?.toneOfVoice ?? null,
            playbook: editorial?.playbookText ?? null,
            commercialPolicy: editorial?.commercialPolicy ?? null,
            installmentTable: clinic.installmentRates && editorial?.commercialPolicy
              ? buildInstallmentTable(editorial.commercialPolicy, clinic.installmentRates as InstallmentRate[])
              : null,
          },
          leadName: lead.name,
          timezone,
          isFirstMessage,
          conversationExperience: experience,
          resumedFromHumanTakeover,
        });
      composerInputTokens = composed.inputTokens;
      composerOutputTokens = composed.outputTokens;
      return composed.text;
    };

    if (isFirstMessage && shouldShowInitialMenu(experience, intent)) {
      const salutation = getDayGreeting(timezone);
      const nameGreeting = lead.name ? `, ${lead.name}` : "";
      replyText = `${salutation}${nameGreeting}! ${buildMenuBody(clinic, "first", experience)}`;
      await this.stateMachine.offerMenu(conversation.id);
    } else if (isFirstMessage && shouldSendConciergeStarter(experience, intent)) {
      replyText = buildConciergeStarter(clinic, timezone, lead.name);
    } else if (resetRequested) {
      // Zera estado e reinicia como se fosse primeiro contato
      await this.stateMachine.invalidate(conversation.id);
      if (experience === "menu_first") {
        const salutation = getDayGreeting(timezone);
        const nameGreeting = lead.name ? `, ${lead.name}` : "";
        replyText = `${salutation}${nameGreeting}! ${buildMenuBody(clinic, "first", experience)}`;
        await this.stateMachine.offerMenu(conversation.id);
      } else {
        replyText = buildConciergeStarter(clinic, timezone, lead.name);
      }
    } else if (menuReRequested || isStaleConversation || isolatedGreeting || isDisabledItemSelection || isInvalidMenuNumber || isOrphanedMenuNumber) {
      if (menuReRequested || isDisabledItemSelection || isInvalidMenuNumber || isOrphanedMenuNumber) {
        replyText = buildMenuBody(clinic, "reoffer", experience);
        await this.stateMachine.offerMenu(conversation.id);
      } else if (experience === "menu_first") {
        const salutation = getDayGreeting(timezone);
        const nameGreeting = lead.name ? `, ${lead.name}` : "";
        replyText = `${salutation}${nameGreeting}! ${buildMenuBody(clinic, "stale", experience)}`;
        await this.stateMachine.offerMenu(conversation.id);
      } else if (isStaleConversation) {
        replyText = buildConciergeStarter(clinic, timezone, lead.name);
      } else {
        replyText = await compose({ type: "acknowledgment" });
      }
    } else switch (intent) {
      // ── Confirmação de slot ──
      case "confirm_slot": {
        // Guarda de segurança: se o lead não escolheu pelo número mas mencionou uma data
        // que não bate com nenhum slot pendente, trata como nova solicitação para essa data.
        if (!slotPreference.slotChoice && slotPreference.preferredDate && pendingSlots) {
          const targetDay = timezone.resolvePreferredDate(slotPreference.preferredDate, new Date(), businessHours);
          if (targetDay) {
            const dateMatchesPending = pendingSlots.some((s) => {
              const p = timezone.toLocalParts(new Date(s.startsAt));
              const t = timezone.toLocalParts(targetDay);
              return p.year === t.year && p.month === t.month && p.day === t.day;
            });
            if (!dateMatchesPending) {
              await this.stateMachine.invalidate(conversation.id);
              const { slots: redirectSlots, preferredDayEmpty: rdEmpty, outsideBookingWindow: rdOutside, outsideBusinessHours: rdNotOpen, preferredPeriodUnavailable: rdPeriod } = await this.fetchAndOfferSlots(
                conversation.id, clinic, calendarGateway, timezone, businessHours,
                slotPreference.preferredDate, slotPreference.preferredPeriod ?? undefined,
              );
              if (rdOutside) {
                replyText = await compose({ type: "clarification_needed", question: "Só consigo ver horários com até 14 dias de antecedência. Tem algum dia mais próximo que funcione para você?" });
              } else if (rdNotOpen) {
                replyText = await compose({ type: "clarification_needed", question: "O atendimento de hoje já encerrou. Posso verificar os horários de amanhã ou outro dia para você?" });
              } else if (rdPeriod) {
                replyText = await compose({
                  type: "clarification_needed",
                  question: `Não temos atendimento no período da noite — nosso horário vai até as ${businessHours.endHour}h. Posso verificar outro período?`,
                });
              } else if (redirectSlots.length > 0 && !rdEmpty) {
                replyText = await compose({ type: "slots_found", slots: redirectSlots, askedForPreference: false });
              } else if (rdEmpty) {
                replyText = await compose({ type: "no_slots_available", alternativeSlots: redirectSlots.length > 0 ? redirectSlots : undefined });
              } else {
                replyText = await compose({ type: "no_slots_available" });
              }
              break;
            }
          }
        }

        const choiceIndex = slotPreference.slotChoice ?? 1;
        const chosenSlot = pendingSlots
          ? pendingSlots.find((s) => s.index === choiceIndex) ?? pendingSlots[0]
          : null;

        if (!chosenSlot) {
          // Lead tentou escolher um número mas a oferta expirou (15 min TTL)
          if (slotPreference.slotChoice !== null) {
            const { slots: freshSlots } = await this.fetchAndOfferSlots(
              conversation.id,
              clinic,
              calendarGateway,
              timezone,
              businessHours,
            );
            replyText = freshSlots.length > 0
              ? await compose({ type: "slots_expired", freshSlots })
              : await compose({ type: "no_slots_available" });
          } else {
            replyText = await compose({ type: "clarification_needed", question: "Qual horário você prefere? Posso mostrar as opções disponíveis." });
          }
          break;
        }

        // Guarda o appointment ativo (se houver) mas só cancela APÓS a nova reserva ser confirmada.
        // Cancelar antes de book() é perigoso: se book() falhar (slot_taken ou calendar_error),
        // o lead ficaria sem agendamento nenhum.
        const existingAppointment = await this.appointmentRepo.findActiveByLeadId(lead.id);

        const offeredTreatment = await this.stateMachine.getOfferedTreatment(conversation.id);
        const result = await bookingService.book({
          clinic,
          lead,
          startsAt: new Date(chosenSlot.startsAt),
          endsAt: new Date(chosenSlot.endsAt),
          treatmentName: offeredTreatment?.treatmentName,
        });

        if (result.success) {
          // Só agora é seguro cancelar o agendamento anterior (remarcação implícita)
          if (existingAppointment) {
            await bookingService.cancel({ lead, appointment: existingAppointment });
          }
          await this.stateMachine.transition(conversation.id, "idle");
          replyText = await compose({
            type: "appointment_confirmed",
            slot: chosenSlot,
            clinicName: clinic.name,
            clinicAddress: clinic.address,
          });
        } else if (result.reason === "slot_taken") {
          // Slot foi tomado por outro lead entre a oferta e a confirmação
          const { slots: newSlots } = await this.fetchAndOfferSlots(
            conversation.id,
            clinic,
            calendarGateway,
            timezone,
            businessHours,
          );
          if (newSlots.length > 0) {
            replyText = await compose({ type: "slot_taken_reoffered", newSlots });
          } else {
            replyText = await compose({ type: "no_slots_available" });
          }
        } else {
          replyText = await compose({
            type: "clarification_needed",
            question: "Tivemos um problema ao confirmar o agendamento. Pode tentar novamente?",
          });
        }
        break;
      }

      // ── Rejeição dos slots oferecidos ──
      case "reject_slots": {
        const previousTreatment = await this.stateMachine.getOfferedTreatment(conversation.id);
        await this.stateMachine.invalidate(conversation.id);

        // Se o lead rejeitou E expressou preferência (ex: "não quero quinta, só tenho sexta"),
        // busca imediatamente para aquele dia em vez de perguntar novamente.
        if (slotPreference.preferredDate || slotPreference.preferredPeriod) {
          const { slots: preferredSlots, preferredDayEmpty: rejectDayEmpty, outsideBookingWindow: rejectOutside, outsideBusinessHours: rejectNotOpen, preferredPeriodUnavailable: rejectPeriodUnavail } = await this.fetchAndOfferSlots(
            conversation.id,
            clinic,
            calendarGateway,
            timezone,
            businessHours,
            slotPreference.preferredDate ?? undefined,
            slotPreference.preferredPeriod ?? undefined,
            undefined,
            previousTreatment?.treatmentName,
            previousTreatment?.durationMinutes,
          );
          if (rejectOutside) {
            replyText = await compose({
              type: "clarification_needed",
              question: "Só consigo ver horários com até 14 dias de antecedência. Tem algum dia mais próximo que funcione para você?",
            });
          } else if (rejectNotOpen) {
            replyText = await compose({
              type: "clarification_needed",
              question: "O atendimento de hoje já encerrou. Posso verificar os horários de amanhã ou outro dia para você?",
            });
          } else if (rejectPeriodUnavail) {
            replyText = await compose({
              type: "clarification_needed",
              question: `Não temos atendimento no período da noite — nosso horário vai até as ${businessHours.endHour}h. Posso verificar outro período?`,
            });
          } else if (preferredSlots.length > 0 && !rejectDayEmpty) {
            replyText = await compose({ type: "slots_found", slots: preferredSlots, askedForPreference: false });
          } else if (rejectDayEmpty) {
            replyText = await compose({
              type: "no_slots_available",
              alternativeSlots: preferredSlots.length > 0 ? preferredSlots : undefined,
            });
          } else {
            replyText = await compose({ type: "no_slots_available" });
          }
        } else {
          replyText = await compose({
            type: "clarification_needed",
            question: "Sem problemas! Qual período te atende melhor — manhã ou tarde? Ou tem algum dia específico em mente?",
          });
        }
        break;
      }

      // ── Verificar disponibilidade ou agendar ──
      case "book_appointment":
      case "check_availability": {
        // Invalida oferta anterior se houver nova mensagem com preferência
        if (hasPendingOffer && (slotPreference.preferredDate || slotPreference.preferredPeriod)) {
          await this.stateMachine.invalidate(conversation.id);
        }

        // Resolve tratamento e duração do slot
        const resolution = resolveTreatmentDuration(
          slotPreference.identifiedTreatment ?? null,
          clinicTreatments,
          clinic.defaultAppointmentDurationMinutes,
          classification.shouldAskClarification,
        );

        if (resolution.kind === "ask_clarification") {
          replyText = await compose({
            type: "clarification_needed",
            question: classification.clarificationQuestion ?? "Qual procedimento você gostaria de realizar?",
          });
          break;
        }

        // Fase 3: tratamento exige avaliação prévia → redireciona para avaliação
        if (resolution.kind === "matched") {
          const matchedTreatment = clinicTreatments.find(
            (t) => t.name.toLowerCase() === resolution.treatmentName.toLowerCase(),
          );
          if (matchedTreatment?.requiresEvaluationFirst) {
            const evalTreatment = clinicTreatments.find((t) => /avalia[cç][aã]o/i.test(t.name));
            const evalDuration = evalTreatment?.durationMinutes ?? 60;
            const evalName = evalTreatment?.name ?? "Avaliação";
            const { slots: evalSlots } = await this.fetchAndOfferSlots(
              conversation.id, clinic, calendarGateway, timezone, businessHours,
              slotPreference.preferredDate ?? undefined,
              slotPreference.preferredPeriod ?? undefined,
              slotPreference.preferredTime ?? undefined,
              evalName,
              evalDuration,
            );
            replyText = evalSlots.length > 0
              ? await compose({ type: "evaluation_redirect", treatmentName: resolution.treatmentName, evaluationSlots: evalSlots })
              : await compose({ type: "no_slots_available" });
            break;
          }
        }

        const resolvedTreatmentName = resolution.kind === "matched" ? resolution.treatmentName : undefined;
        const resolvedDurationMinutes = resolution.durationMinutes;

        const { slots: formattedSlots, preferredDayEmpty, outsideBookingWindow, outsideBusinessHours, preferredPeriodUnavailable } = await this.fetchAndOfferSlots(
          conversation.id,
          clinic,
          calendarGateway,
          timezone,
          businessHours,
          slotPreference.preferredDate ?? undefined,
          slotPreference.preferredPeriod ?? undefined,
          slotPreference.preferredTime ?? undefined,
          resolvedTreatmentName,
          resolvedDurationMinutes,
        );

        if (outsideBookingWindow) {
          replyText = await compose({
            type: "clarification_needed",
            question: "Só consigo ver horários com até 14 dias de antecedência. Tem algum dia mais próximo que funcione para você?",
          });
        } else if (outsideBusinessHours) {
          replyText = await compose({
            type: "clarification_needed",
            question: "O atendimento de hoje já encerrou. Posso verificar os horários de amanhã ou outro dia para você?",
          });
        } else if (preferredPeriodUnavailable) {
          replyText = await compose({
            type: "clarification_needed",
            question: `Não temos atendimento no período da noite — nosso horário vai até as ${businessHours.endHour}h. Posso verificar outro período?`,
          });
        } else if (formattedSlots.length > 0 && !preferredDayEmpty) {
          replyText = await compose({
            type: "slots_found",
            slots: formattedSlots,
            askedForPreference: false,
          });
        } else if (preferredDayEmpty) {
          replyText = await compose({
            type: "no_slots_available",
            alternativeSlots: formattedSlots.length > 0 ? formattedSlots : undefined,
          });
        } else if (!slotPreference.preferredDate && !slotPreference.preferredPeriod) {
          replyText = await compose({
            type: "clarification_needed",
            question: "Qual período te atende melhor — manhã ou tarde? E tem algum dia específico em mente?",
          });
        } else {
          replyText = await compose({ type: "no_slots_available" });
        }
        break;
      }

      // ── Cancelamento ──
      case "cancel_appointment": {
        const allActive = await this.appointmentRepo.findAllActiveByLeadId(lead.id);

        if (allActive.length === 0) {
          replyText = await compose({ type: "no_appointments" });
          break;
        }

        // Cancela todos os appointments ativos em paralelo
        const results = await Promise.all(
          allActive.map((a) => bookingService.cancel({ lead, appointment: a })),
        );
        const anyFailed = results.some((r) => !r.success);

        if (!anyFailed) {
          replyText = await compose({ type: "appointment_cancelled", count: allActive.length });
        } else {
          replyText = await compose({
            type: "clarification_needed",
            question: "Tivemos um problema ao cancelar. Pode tentar novamente ou entrar em contato conosco?",
          });
        }
        break;
      }

      // ── Remarcação ──
      case "reschedule_appointment": {
        // Preserva o treatment do agendamento anterior (se havia oferta ativa) para manter duração correta
        const rescheduleOfferedTreatment = await this.stateMachine.getOfferedTreatment(conversation.id);
        const activeAppointment = await this.appointmentRepo.findActiveByLeadId(lead.id);

        if (activeAppointment) {
          await bookingService.cancel({ lead, appointment: activeAppointment });
        }

        const { slots: newSlots, preferredDayEmpty: rescheduleEmpty, outsideBookingWindow: rescheduleOutside, outsideBusinessHours: rescheduleNotOpen, preferredPeriodUnavailable: reschedulePeriodUnavail } = await this.fetchAndOfferSlots(
          conversation.id,
          clinic,
          calendarGateway,
          timezone,
          businessHours,
          slotPreference.preferredDate ?? undefined,
          slotPreference.preferredPeriod ?? undefined,
          slotPreference.preferredTime ?? undefined,
          rescheduleOfferedTreatment?.treatmentName,
          rescheduleOfferedTreatment?.durationMinutes,
        );

        if (rescheduleOutside) {
          replyText = await compose({
            type: "clarification_needed",
            question: "Só consigo ver horários com até 14 dias de antecedência. Tem algum dia mais próximo que funcione para você?",
          });
        } else if (rescheduleNotOpen) {
          replyText = await compose({
            type: "clarification_needed",
            question: "O atendimento de hoje já encerrou. Posso verificar os horários de amanhã ou outro dia para você?",
          });
        } else if (reschedulePeriodUnavail) {
          replyText = await compose({
            type: "clarification_needed",
            question: `Não temos atendimento no período da noite — nosso horário vai até as ${businessHours.endHour}h. Posso verificar outro período?`,
          });
        } else if (newSlots.length > 0 && !rescheduleEmpty) {
          replyText = await compose({ type: "appointment_rescheduled", newSlots });
        } else if (rescheduleEmpty) {
          replyText = await compose({
            type: "no_slots_available",
            alternativeSlots: newSlots.length > 0 ? newSlots : undefined,
          });
        } else {
          replyText = await compose({ type: "no_slots_available" });
        }
        break;
      }

      // ── Listar agendamentos ──
      case "list_appointments": {
        const activeAppointments = await this.appointmentRepo.findAllActiveByLeadId(lead.id);

        if (activeAppointments.length === 0) {
          replyText = await compose({ type: "no_appointments" });
        } else {
          replyText = await compose({
            type: "appointments_listed",
            appointments: activeAppointments.map((a) => ({
              label: timezone.formatForConfirmation(a.startsAt),
              status: a.status,
            })),
          });
        }
        break;
      }

      // ── Paciente avisa chegada ou atraso para consulta agendada ──
      case "patient_arrived": {
        const todayAppointment = await this.findTodayAppointment(lead.id, timezone);
        const arrivalReason = todayAppointment
          ? `Paciente chegou/avisou presença para consulta das ${timezone.formatForHuman(todayAppointment.startsAt)}`
          : "Paciente avisou chegada à clínica";

        await db
          .update(conversationsTable)
          .set({
            needsAttention: true,
            attentionReason: arrivalReason,
            updatedAt: new Date(),
          })
          .where(eq(conversationsTable.id, conversation.id));

        replyText = await compose({ type: "patient_arrived", appointmentTime: todayAppointment?.startsAt ?? null });
        await this.notifyAttentionNeeded(clinic, channelConfig, phone, lead.name ?? null, arrivalReason);
        break;
      }

      // ── Precisa de humano (mídia, negociação, falar com dentista, situação especial) ──
      case "needs_human": {
        const reason = classification.handoffReason ?? "Lead solicitou atendimento humano";
        replyText = await compose({ type: "handoff_requested", handoffReason: reason });
        await db
          .update(conversationsTable)
          .set({
            aiPaused: true,
            takeoverExpiresAt: null, // pausa permanente — operador decide quando retomar
            needsAttention: true,
            attentionReason: reason,
            updatedAt: new Date(),
          })
          .where(eq(conversationsTable.id, conversation.id));
        await this.notifyAttentionNeeded(clinic, channelConfig, phone, lead.name ?? null, reason);
        break;
      }

      // ── Urgência clínica ──
      case "clinical_urgency": {
        replyText = await compose({ type: "clinical_urgency" });
        await db
          .update(conversationsTable)
          .set({ needsAttention: true, attentionReason: "Urgência clínica relatada pelo lead", updatedAt: new Date() })
          .where(eq(conversationsTable.id, conversation.id));
        await this.notifyAttentionNeeded(clinic, channelConfig, phone, lead.name ?? null, "Urgência clínica relatada");
        break;
      }

      // ── Preço ──
      case "price_inquiry": {
        replyText = await compose({ type: "price_inquiry" });
        break;
      }

      // ── Saudação ──
      // Lead reiniciou a conversa: respeita a experiência configurada.
      case "greeting": {
        if (experience === "menu_first") {
          const salutation = getDayGreeting(timezone);
          const nameGreeting = lead.name ? `, ${lead.name}` : "";
          replyText = `${salutation}${nameGreeting}! ${buildMenuBody(clinic, "reoffer", experience)}`;
          await this.stateMachine.offerMenu(conversation.id);
        } else {
          replyText = buildConciergeStarter(clinic, timezone, lead.name);
        }
        break;
      }

      // ── Reconhecimento mid-conversa ──
      case "acknowledgment": {
        // Apenas responde com mensagem calorosa; se o menu ainda estiver ativo (TTL),
        // o lead pode selecionar por número normalmente — sem necessidade de reapresenter.
        replyText = await compose({ type: "acknowledgment" });
        break;
      }

      // ── Encerramento de conversa ──
      case "farewell": {
        replyText = await compose({ type: "farewell" });
        break;
      }

      // ── Pergunta geral (inclui seleções de menu: procedimentos e localização) ──
      case "general_question": {
        let clinicContext: string;
        const directProcedureCatalogRequested = !menuResolution && !procedureSelection && isProcedureCatalogRequest(messageText);
        const directLocationRequested = !menuResolution && !procedureSelection && isLocationRequest(messageText);
        const menuGeneralSubtype = menuResolution?.intent === "general_question" ? menuResolution.subtype : null;

        if (procedureSelection) {
          clinicContext = buildSelectedTreatmentContext(procedureSelection, editorial?.commercialPolicy ?? null, experience);
        } else if (directTreatmentMention) {
          clinicContext = buildDirectTreatmentContext(directTreatmentMention, editorial?.commercialPolicy ?? null, experience);
        } else if (menuResolution?.intent === "general_question" || directProcedureCatalogRequested || directLocationRequested) {
          if (menuGeneralSubtype === "procedures") {
            const items = clinicTreatments.length > 0
              ? clinicTreatments.map((t, i) => `${i + 1}. ${t.name}`).join("\n")
              : "";
            clinicContext = `Lead selecionou "Procedimentos" no menu.\nFORMATO OBRIGATÓRIO: apresente os procedimentos exatamente como a lista numerada abaixo, um por linha, sem adicionar descrições. Ao final, acrescente uma linha em branco seguida de: "Quer saber mais sobre algum? É só digitar o número. Para voltar ao menu principal, é só digitar *menu*." Sem convite para agendar.\n${items}`;
          } else if (directProcedureCatalogRequested) {
            const items = clinicTreatments.length > 0
              ? clinicTreatments.map((t, i) => `${i + 1}. ${t.name}`).join("\n")
              : "";
            clinicContext = `Lead pediu para ver procedimentos/tratamentos.\nFORMATO OBRIGATÓRIO: apresente os procedimentos exatamente como a lista numerada abaixo, um por linha, sem adicionar descrições. Ao final, acrescente uma linha em branco seguida de: "Quer saber mais sobre algum? É só digitar o número. Para voltar ao menu principal, é só digitar *menu*." Sem convite para agendar.\n${items}`;
          } else {
            clinicContext = buildLocationClinicContext(clinic.address);
          }
        } else {
          clinicContext = `${clinic.name} — ${clinic.specialty}. ${editorial?.commercialPolicy ?? ""}`;
        }
        replyText = await compose({ type: "general_question", clinicContext });
        if ((menuGeneralSubtype === "procedures" || directProcedureCatalogRequested) && clinicTreatments.length > 0) {
          await this.stateMachine.offerProcedureList(conversation.id, clinicTreatments);
        }
        break;
      }

      // ── Unclear / Default ──
      case "unclear":
      default: {
        // Paciente respondeu ao menu com input inválido ou confuso — reapresenta o menu
        if (isMenuActive && !menuResolution) {
          replyText = buildMenuBody(clinic, "reoffer", experience);
          await this.stateMachine.offerMenu(conversation.id);
        } else if (classification.shouldAskClarification && classification.clarificationQuestion) {
          replyText = await compose({
            type: "clarification_needed",
            question: classification.clarificationQuestion,
          });
        } else {
          replyText = await compose({
            type: "general_question",
            clinicContext: `${clinic.name} — ${clinic.specialty}. ${editorial?.commercialPolicy ?? ""}`,
          });
        }
        break;
      }
    }

    // ── 8. Atualiza contador de unclear e flag needsAttention ──
    const isUnclear = intent === "unclear";
    const resetsClarity = !isUnclear && intent !== "greeting" && intent !== "acknowledgment";

    if (isUnclear) {
      const newCount = (conversation.consecutiveUnclearCount ?? 0) + 1;
      const hitThreshold = newCount === UNCLEAR_THRESHOLD;
      await db
        .update(conversationsTable)
        .set({
          consecutiveUnclearCount: newCount,
          ...(hitThreshold && {
            needsAttention: true,
            attentionReason: "Lead enviou 3 mensagens sem que a IA conseguisse entender",
          }),
          updatedAt: new Date(),
        })
        .where(eq(conversationsTable.id, conversation.id));

      if (hitThreshold) {
        await this.notifyAttentionNeeded(clinic, channelConfig, phone, lead.name ?? null, "Não conseguiu entender o lead após 3 tentativas");
      }
    } else if (resetsClarity && (conversation.consecutiveUnclearCount ?? 0) > 0) {
      await db
        .update(conversationsTable)
        .set({ consecutiveUnclearCount: 0, updatedAt: new Date() })
        .where(eq(conversationsTable.id, conversation.id));
    }

    // ── 8.5. Atualiza temperatura do lead (nunca rebaixa) ──
    const inferredTemp = temperatureFromIntent(intent);
    const currentTempRank = TEMP_RANK[lead.temperature ?? "cold"];
    if (TEMP_RANK[inferredTemp] > currentTempRank) {
      await this.leadRepo.save({ ...lead, temperature: inferredTemp, updatedAt: new Date() });
    }

    // ── 9. Envia resposta e captura messageId para deduplicar o echo fromMe do Z-API ──
    const zapiMessageId = await sendTextMessage(outboundAddress, replyText, channelConfig);

    // ── 9.1 Push notification — avisa operadores que um lead enviou mensagem ──
    const leadDisplayName = lead.name ?? phone;
    await this.notifier
      .execute(clinicId, {
        title: leadDisplayName,
        body: messageText.slice(0, 100),
        url: `/app/inbox/${conversation.id}`,
      })
      .catch((err) => console.error("[Orchestrator] Push falhou:", err));

    // ── 10. Salva mensagem do agente no histórico ──
    const agentMessageId = randomUUID();
    await this.conversationRepo.appendMessage({
      id: agentMessageId,
      conversationId: conversation.id,
      author: "agent",
      body: replyText,
      sentAt: new Date(),
      externalId: zapiMessageId ?? null,
      intent: intent ?? null,
    });

    // ── 11. Registra custo do LLM (classifier + composer) ──
    if (composerInputTokens > 0) {
      await usageCostTracker.trackAiUsage({
        clinicId,
        provider: "openai",
        model: "gpt-4o-mini",
        operation: "sales_conversation_analysis",
        inputTokens: composerInputTokens,
        outputTokens: composerOutputTokens,
      });
    }

    return { replied: true };

    } catch (err) {
      console.error("[Orchestrator] Falha no processamento:", err);
      // Garante que o lead sempre recebe resposta — evita silêncio em erros de Calendar/LLM.
      try {
        const fallback = "Ops, tive um problema técnico por aqui. Pode tentar novamente? 🙏";
        const fallbackMsgId = await sendTextMessage(outboundAddress, fallback, channelConfig);
        await this.conversationRepo.appendMessage({
          id: randomUUID(),
          conversationId: conversation.id,
          author: "agent",
          body: fallback,
          sentAt: new Date(),
          externalId: fallbackMsgId ?? null,
          intent: null,
        });
      } catch (fallbackErr) {
        console.error("[Orchestrator] Fallback também falhou:", fallbackErr);
      }
      return { replied: false };
    }
  }

  // Snapa para a próxima hora cheia com antecedência mínima de 2h.
  // Evita que o cursor do SlotEngine gere slots em :51 ou :37.
  private slotWindowStart(): Date {
    const minAdvanceMs = 2 * 60 * 60_000;
    const earliest = new Date(Date.now() + minAdvanceMs);
    const hourMs = 60 * 60_000;
    return new Date(Math.ceil(earliest.getTime() / hourMs) * hourMs);
  }

  // ── Helper: busca slots e salva oferta na state machine ──
  // Retorna { slots, preferredDayEmpty, outsideBookingWindow, outsideBusinessHours, preferredPeriodUnavailable } onde:
  //   - outsideBookingWindow=true      → data pedida está além da janela de 14 dias
  //   - outsideBusinessHours=true      → dia pedido é hoje mas o expediente já encerrou
  //   - preferredPeriodUnavailable=true→ lead pediu noite mas a clínica fecha às 18h ou antes
  //   - preferredDayEmpty=true         → dia está na janela mas sem horários; slots são alternativas
  //                                      NÃO salvos na state machine (lead não escolheu nada ainda)
  //   - preferredDayEmpty=false        → slots confirmáveis, salvos na state machine
  private async fetchAndOfferSlots(
    conversationId: string,
    clinic: Clinic,
    calendarGateway: CalendarGateway,
    timezone: ClinicTimezone,
    businessHours: ReturnType<typeof parseBusinessHours>,
    preferredDate?: string,
    preferredPeriod?: string,
    preferredTime?: string,
    treatmentName?: string,
    slotDurationMinutes?: number,
  ): Promise<{ slots: FormattedSlot[]; preferredDayEmpty: boolean; outsideBookingWindow: boolean; outsideBusinessHours: boolean; preferredPeriodUnavailable: boolean }> {
    const from = this.slotWindowStart();
    const to = new Date(from.getTime() + SLOTS_LOOKAHEAD_DAYS * 24 * 60 * 60_000);
    const duration = slotDurationMinutes ?? clinic.defaultAppointmentDurationMinutes;

    let allSlots = await calendarGateway.listAvailableSlots({
      clinicId: clinic.id,
      from,
      to,
      slotDurationMinutes: duration,
    });

    // Remove slots que conflitam com appointments locais (inclui blocos sintéticos de E2E
    // que não existem no Google Calendar e appointments reais como defesa contra lag da API).
    const localAppointments = await db
      .select({ startsAt: appointmentsTable.startsAt, endsAt: appointmentsTable.endsAt })
      .from(appointmentsTable)
      .where(
        and(
          eq(appointmentsTable.clinicId, clinic.id),
          eq(appointmentsTable.status, "scheduled"),
          lt(appointmentsTable.startsAt, to),
          gte(appointmentsTable.endsAt, from),
        ),
      );

    if (localAppointments.length > 0) {
      const bufferMs = (clinic.postAppointmentBufferMinutes ?? 0) * 60_000;
      allSlots = allSlots.filter(
        (slot) =>
          !localAppointments.some(
            (a) =>
              a.startsAt.getTime() < slot.endsAt.getTime() &&
              (a.endsAt.getTime() + bufferMs) > slot.startsAt.getTime(),
          ),
      );
    }

    let filteredToDay = false;
    let preferredDayEmpty = false;

    if (preferredDate) {
      const now = new Date();
      const targetDay = timezone.resolvePreferredDate(preferredDate, now, businessHours);
      if (targetDay !== null) {
        if (targetDay > to) {
          return { slots: [], preferredDayEmpty: false, outsideBookingWindow: true, outsideBusinessHours: false, preferredPeriodUnavailable: false };
        }
        const targetParts = timezone.toLocalParts(targetDay);
        const slotsOnDay = allSlots.filter((slot) => {
          const p = timezone.toLocalParts(slot.startsAt);
          return p.year === targetParts.year && p.month === targetParts.month && p.day === targetParts.day;
        });
        const nowParts = timezone.toLocalParts(now);
        const isToday = targetParts.year === nowParts.year && targetParts.month === nowParts.month && targetParts.day === nowParts.day;
        if (slotsOnDay.length > 0) {
          allSlots = slotsOnDay;
          filteredToDay = true;
        } else if (isToday && nowParts.hour >= businessHours.endHour - 1) {
          return { slots: [], preferredDayEmpty: false, outsideBookingWindow: false, outsideBusinessHours: true, preferredPeriodUnavailable: false };
        } else {
          // Dia preferido sem disponibilidade — sinaliza e mantém pool completo como alternativas.
          // Alternativas NÃO serão salvas na state machine: lead ainda não escolheu nenhum dia.
          preferredDayEmpty = true;
        }
      }
    }

    // Filtra por período apenas quando o dia preferido foi encontrado
    if (!preferredDayEmpty && preferredPeriod) {
      const byPeriod = allSlots.filter((slot) => {
        const parts = timezone.toLocalParts(slot.startsAt);
        if (preferredPeriod === "morning") return parts.hour >= 8 && parts.hour < 12;
        if (preferredPeriod === "afternoon") return parts.hour >= 12 && parts.hour < 18;
        if (preferredPeriod === "evening") return parts.hour >= 18;
        return true;
      });
      if (byPeriod.length > 0) {
        allSlots = byPeriod;
      } else if (preferredPeriod === "evening" && businessHours.endHour <= 18) {
        return { slots: [], preferredDayEmpty: false, outsideBookingWindow: false, outsideBusinessHours: false, preferredPeriodUnavailable: true };
      }
    }

    // Ordena por proximidade à hora solicitada quando o lead especificou horário.
    // Normaliza hora ambígua para horário comercial: "3" com clínica 8-18 → 15h, não 3am.
    if (preferredTime) {
      const hourMatch = preferredTime.match(/(\d{1,2})/);
      let preferredHour = hourMatch ? parseInt(hourMatch[1], 10) : null;
      if (preferredHour !== null) {
        const pmCandidate = preferredHour + 12;
        if (
          preferredHour < businessHours.startHour &&
          pmCandidate >= businessHours.startHour &&
          pmCandidate < businessHours.endHour
        ) {
          preferredHour = pmCandidate;
        }
        allSlots.sort((a, b) => {
          const aHour = timezone.toLocalParts(a.startsAt).hour;
          const bHour = timezone.toLocalParts(b.startsAt).hour;
          return Math.abs(aHour - preferredHour!) - Math.abs(bHour - preferredHour!);
        });
      }
    }

    const count = (filteredToDay && preferredTime)
      ? SLOTS_WITH_DATE_AND_TIME
      : filteredToDay
      ? SLOTS_WITH_DATE_ONLY
      : MAX_SLOTS_TO_OFFER;

    const best = selectBestSlots(allSlots, count, timezone);
    // Garante que a lista exibida e os índices salvos no banco estejam sempre em ordem
    // cronológica, independente do sort por proximidade de horário feito acima.
    best.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    if (best.length === 0) return { slots: [], preferredDayEmpty, outsideBookingWindow: false, outsideBusinessHours: false, preferredPeriodUnavailable: false };

    if (preferredDayEmpty) {
      // Formata para exibição sem salvar na state machine
      const formatted: FormattedSlot[] = best.map((s, i) => ({
        index: i + 1,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        label: timezone.formatForHuman(s.startsAt),
      }));
      return { slots: formatted, preferredDayEmpty: true, outsideBookingWindow: false, outsideBusinessHours: false, preferredPeriodUnavailable: false };
    }

    const slots = await this.stateMachine.offerSlots(conversationId, best, timezone, treatmentName, duration);
    return { slots, preferredDayEmpty: false, outsideBookingWindow: false, outsideBusinessHours: false, preferredPeriodUnavailable: false };
  }

  // Retorna o appointment ativo mais próximo de agora (futuro imediato ou passado recente ≤30min).
  private async findTodayAppointment(
    leadId: string,
    timezone: ClinicTimezone,
  ): Promise<{ startsAt: Date } | null> {
    const now = new Date();
    const { year, month, day } = timezone.toLocalParts(now);
    const startOfDay = timezone.fromLocalParts(year, month, day, 0, 0);
    const endOfDay = timezone.fromLocalParts(year, month, day, 23, 59);

    const rows = await db
      .select({ startsAt: appointmentsTable.startsAt })
      .from(appointmentsTable)
      .where(
        and(
          eq(appointmentsTable.leadId, leadId),
          eq(appointmentsTable.status, "scheduled"),
          gte(appointmentsTable.startsAt, startOfDay),
          lt(appointmentsTable.startsAt, endOfDay),
        ),
      );

    if (rows.length === 0) return null;

    // Retorna o appointment com startsAt mais próximo de agora
    const nowMs = now.getTime();
    const nearest = rows.sort(
      (a, b) => Math.abs(a.startsAt.getTime() - nowMs) - Math.abs(b.startsAt.getTime() - nowMs),
    )[0];
    return { startsAt: nearest.startsAt };
  }

  private async notifyAttentionNeeded(
    clinic: Clinic,
    channelConfig: ClinicChannelConfig,
    leadPhone: string,
    leadName: string | null,
    reason: string,
  ): Promise<void> {
    const displayName = leadName ?? leadPhone;

    // WhatsApp para o número da recepção da clínica (se configurado).
    const receptPhone = clinic.receptionistPhone;
    if (receptPhone) {
      try {
        await sendTextMessage(
          receptPhone,
          `⚠️ *${displayName} precisa de você*\n\n${reason}\n\nAcesse o Inbox para responder.`,
          channelConfig,
        );
      } catch (err) {
        console.error("[Orchestrator] Failed to send attention WhatsApp notification:", err);
      }
    }

    // Push notification para todos os operadores com app instalado
    await this.notifier
      .execute(clinic.id, {
        title: `${displayName} precisa de você`,
        body: reason,
        url: "/app/inbox",
      })
      .catch((err) => console.error("[Orchestrator] Push falhou:", err));
  }

}
