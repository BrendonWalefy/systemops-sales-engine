// Coração do sistema: coordena todo o fluxo de uma mensagem inbound.
// Substitui a lógica de orquestração espalhada no zapi/route.ts.
//
// Fluxo: mensagem → deduplicação → lead/conversa → intent → ação → resposta

import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db/client";
import { organizations, conversations as conversationsTable, leads as leadsTable, messages as messagesTable, appointments as appointmentsTable, treatmentGapReports } from "@/infrastructure/db/schema";
import { resolveSegmentVocab } from "@/application/onboarding/segment-vocab";
import { eq, and, or, count, gte, lt, isNull, inArray } from "drizzle-orm";
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
import { sendTextMessage, sendMediaMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import type { OutboundPart } from "@/infrastructure/adapters/channels/whatsapp/outbound-delivery-service";
import { resolveChannelConfig, type ClinicChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { fetchAndPersistLeadPhoto } from "@/infrastructure/adapters/channels/whatsapp/lead-photo-service";
import { createLogger, type Logger } from "@/infrastructure/logging/logger";
import { ttsConfigFromVoice, DEFAULT_TTS_CONFIG, TTS_SPEED_DEFAULTS, type TtsConfig } from "@/domain/entities/tts-config";
import type { VoiceElevenLabsConfig, VoiceTtsConfig } from "@/application/modules/module-configs";
import { shouldUseBWaveForMessage, type VoiceMode } from "@/domain/entities/voice-mode";
import { VercelBlobStorageGateway } from "@/infrastructure/adapters/storage/vercel-blob-storage-gateway";

import { ClinicTimezone, parseBusinessHours, getTimeGreeting } from "@/core/scheduling/ClinicTimezone";
import type { LocalDateParts, ParsedBusinessHours } from "@/core/scheduling/ClinicTimezone";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import { IntentClassifier, type IntentType } from "@/core/intelligence/IntentClassifier";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import type { ActionResult, ResponsePart } from "@/core/intelligence/ResponseComposer";
import { buildPromptContext } from "@/core/intelligence/PromptContextBuilder";
import { inferReceptionistNameFromGreeting } from "@/core/intelligence/receptionist-name";
import { resolveActiveEditorialConfig } from "@/application/config/editorial-config";
import { BookingService } from "@/core/scheduling/BookingService";
import { selectBestSlots } from "@/core/scheduling/SlotEngine";
import { resolveTreatmentDuration } from "@/core/scheduling/resolveTreatmentDuration";
import type { FormattedSlot } from "@/core/conversation/ConversationStateMachine";
import type { PipelineStep, ContentBlock } from "@/domain/entities/treatment";
import { NotifyClinicOperators } from "@/application/use-cases/notifications/notify-clinic-operators";
import { isSalesConversationCategory } from "@/domain/value-objects/conversation-category";
import { DrizzlePushSubscriptionRepository } from "@/infrastructure/repositories/drizzle-push-subscription-repository";
import { WebPushGateway } from "@/infrastructure/adapters/push/web-push-gateway";
import { getClinicModules } from "@/application/modules/module-gate";

import type { Organization, MenuItem, MenuItemIntent } from "@/domain/entities/clinic";
import type { ConversationExperience } from "@/domain/entities/clinic";
import type { Message } from "@/domain/entities/conversation";
import type { Treatment } from "@/domain/entities/treatment";
import type { CalendarSlot } from "@/domain/entities/calendar-slot";
import {
  CONCIERGE_MENU_ITEMS,
  DEFAULT_MENU_ITEMS,
} from "@/domain/entities/clinic";
import type { ProcedureListItem } from "@/core/conversation/ConversationStateMachine";
import { buildInitialAgentMessage } from "./outbound-message-persistence";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";
import type {
  ConversationOutboundPayload,
  PipelineAdvance,
} from "@/application/jobs/conversation-outbound-payload";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";

// ── Menu resolution ──────────────────────────────────────────────────────────

type MenuResolution =
  | { intent: "book_appointment" }
  | { intent: "price_inquiry" }
  | { intent: "needs_human" }
  | { intent: "general_question"; subtype: "procedures"; treatmentKeyword?: string }
  | { intent: "general_question"; subtype: "location" };

export function resolveVoiceOutputFlags(params: {
  hasElevenLabsModule: boolean;
  elevenLabsConfig: VoiceElevenLabsConfig | null;
  hasVoiceTtsModule: boolean;
  voiceTtsConfig: VoiceTtsConfig | null;
}): { bwaveEnabled: boolean; voiceBasicEnabled: boolean; voiceEnabled: boolean } {
  if (params.hasElevenLabsModule) {
    const bwaveEnabled = params.elevenLabsConfig?.voiceOutputEnabled !== false;
    return {
      bwaveEnabled,
      voiceBasicEnabled: false,
      voiceEnabled: bwaveEnabled,
    };
  }

  const voiceBasicEnabled =
    params.hasVoiceTtsModule && params.voiceTtsConfig?.voiceOutputEnabled !== false;

  return {
    bwaveEnabled: false,
    voiceBasicEnabled,
    voiceEnabled: voiceBasicEnabled,
  };
}

export function shouldForceTextOnlyForActionResult(actionResult: ActionResult): boolean {
  switch (actionResult.type) {
    case "slots_found":
    case "appointment_rescheduled":
    case "slots_expired":
    case "slot_taken_reoffered":
    case "evaluation_redirect":
      return true;
    case "no_slots_available":
      return Boolean(actionResult.alternativeSlots?.length);
    default:
      return false;
  }
}

function intentToMenuResolution(intent: MenuItemIntent, treatmentKeyword?: string): MenuResolution {
  switch (intent) {
    case "procedures": return { intent: "general_question", subtype: "procedures", treatmentKeyword };
    case "location": return { intent: "general_question", subtype: "location" };
    case "book_appointment": return { intent: "book_appointment" };
    case "price_inquiry": return { intent: "price_inquiry" };
    case "needs_human": return { intent: "needs_human" };
  }
}

function buildMenuText(items: MenuItem[]): string {
  return items.filter(i => i.enabled).map(i => `${i.number}. ${i.label}`).join("\n");
}

function getMenuItemsForExperience(clinic: Organization, experience: ConversationExperience): MenuItem[] {
  return clinic.menuItems ?? (experience === "concierge" ? CONCIERGE_MENU_ITEMS : DEFAULT_MENU_ITEMS);
}

// Retorna apenas o primeiro nome do lead para saudações — evita usar nome completo
// ou apelidos de contato como "Tânia Mara/Sinal Verde" na conversa.
// Guard: rejeita nomes de WhatsApp que não são nomes próprios de pessoa:
// frases religiosas ("Deus Ele É Deus."), siglas, nomes de negócios, etc.
function extractFirstName(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const first = fullName.split(/[\s\/]+/)[0] ?? null;
  if (!first) return null;

  // Menos de 2 caracteres → sem sentido como nome
  if (first.replace(/\./g, "").length < 2) return null;

  const cleanFirst = first.replace(/\./g, "");

  // Nomes de perfil com números não são tratados como nomes pessoais válidos (ex: "LOJA123")
  if (/\d/.test(cleanFirst)) return null;

  // Prefixos que indicam não ser nome de pessoa: religiosos, negócios, títulos
  const INVALID_FIRST_NAME_PREFIX_RE =
    /^(deus|senhor|sra?|nosso|loja|empresa|grupo|barbearia|clinica|clínica|salao|salão|studio|estudio|escritório|escritorio|atendimento|dr|dra)/i;
  if (INVALID_FIRST_NAME_PREFIX_RE.test(cleanFirst)) return null;

  return first;
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

function buildMenuBody(clinic: Organization, variant: "first" | "reoffer" | "stale", experience: ConversationExperience): string {
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

function buildConciergeStarter(clinic: Organization, timezone: ClinicTimezone, leadName?: string | null): string {
  const salutation = getDayGreeting(timezone);
  const firstName = extractFirstName(leadName);
  const nameGreeting = firstName ? `, ${firstName}` : "";
  const receptionistName = inferReceptionistNameFromGreeting(clinic.greetingMessage);
  const intro = receptionistName
    ? `Sou a ${receptionistName}, assistente virtual da ${clinic.name}.`
    : `Sou a assistente virtual da ${clinic.name}.`;

  return `${salutation}${nameGreeting}. Tudo bem?\n\n${intro} Me conta o que você gostaria de ver hoje: valores, agendamento ou algum serviço específico?`;
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

// Detecta a intenção do lead ao responder o lembrete D-1: confirmar presença ("yes"),
// remarcar ("reschedule"), cancelar/não comparecer ("no") ou resposta inconclusiva ("ambiguous").
export function detectAppointmentConfirmation(
  message: string,
): "yes" | "no" | "reschedule" | "ambiguous" {
  const n = message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

  // Remarcar tem prioridade: é o caminho mais prestativo. Sinais fortes ("remarc",
  // "reagend", "outro dia"…) valem em qualquer posição — "não posso nesse dia, dá pra
  // remarcar?" deve oferecer novos horários em vez de cancelar e acionar atendimento humano.
  const rescheduleSignals = ["remarc", "reagend", "outro dia", "outro horario", "noutro dia", "mudar o dia", "mudar a data", "mudar o horario", "mudar de horario", "mudar pra outro", "trocar o dia", "trocar o horario", "trocar de dia", "adiar", "antecipar", "pode ser outro", "tem outro horario", "tem outro dia", "transferir a consulta"];
  if (rescheduleSignals.some((t) => n.includes(t))) return "reschedule";

  const yesTokens = ["sim", "confirmo", "confirmado", "confirma", "vou", "vou sim", "estarei", "estarei la", "ok", "combinado", "perfeito", "claro", "com certeza", "pode contar", "to la", "ta", "blz", "beleza", "pode", "vou la", "confirmei", "certo", "certinho", "te vejo", "até la", "ate la", "estou confirmado", "estou confirmada"];
  const noTokens = ["nao", "não", "cancelar", "cancela", "desmarcar", "desmarca", "nao posso", "não posso", "nao vou", "não vou", "nao consigo", "não consigo", "impossivel", "impossível", "infelizmente", "preciso cancelar", "quero cancelar", "nao irei", "não irei", "nao vou conseguir", "não vou conseguir", "nao dou conta", "nao vou poder", "não vou poder"];
  if (yesTokens.some((t) => n === t || n.startsWith(t + " ") || n.startsWith(t + ",") || n.startsWith(t + "!") || n.startsWith(t + "."))) return "yes";
  if (noTokens.some((t) => n === t || n.startsWith(t + " ") || n.startsWith(t + ",") || n.startsWith(t + "!") || n.startsWith(t + "."))) return "no";
  return "ambiguous";
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
  if (byNumber) return intentToMenuResolution(byNumber.intent, byNumber.treatmentKeyword);

  // Rótulo textual de item ativo → determinístico, sem depender do LLM
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const byLabel = items.find(i => i.enabled && n === norm(i.label));
  if (byLabel) return intentToMenuResolution(byLabel.intent, byLabel.treatmentKeyword);

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
  if (n.includes("especialista") || n.includes("dentista") || n.includes("doutor") || n.includes("medico") || n.includes("medica") || n === "dr")
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
  return hasAnyKeyword(normalized, ["valor", "preco", "quanto", "custa", "custo", "pagamento", "parcela"]);
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
  return hasAnyKeyword(normalized, ["dentista", "doutor", "medico", "medica", "veterinario", "especialista", "atendente", "humano", "ligar", "desconto", "especial"]);
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

// Palavras genéricas de categoria clínica: descrevem "algum tratamento existe",
// não identificam QUAL. Nunca devem, sozinhas, resolver um match — mesmo que
// apareçam literalmente dentro do nome de um tratamento cadastrado (ex: uma
// clínica que registra "Tratamento de canal" faz qualquer mensagem contendo a
// palavra solta "tratamento" — inclusive respostas do próprio bot, como "plano
// de tratamento personalizado" — colidir com esse tratamento específico, sem o
// lead ter mencionado canal em momento algum). Isso não é regra de negócio de
// uma clínica específica: qualquer catálogo com um tratamento cujo nome contenha
// uma dessas palavras (comuns em português clínico) está sujeito ao mesmo bug.
const GENERIC_CLINICAL_CATEGORY_WORDS = [
  "tratamento",
  "tratamentos",
  "procedimento",
  "procedimentos",
  "consulta",
  "consultas",
  "avaliacao",
  "avaliacoes",
  "servico",
  "servicos",
  "atendimento",
  "atendimentos",
];

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
  ...GENERIC_CLINICAL_CATEGORY_WORDS,
]);

const TREATMENT_SCHEDULING_STOPWORDS = new Set([
  "quero",
  "queria",
  "agendar",
  "agenda",
  "marcar",
  "horario",
  "horarios",
  "fazer",
  "realizar",
  "ver",
  "vaga",
  "vagas",
  "disponibilidade",
  "disponivel",
  "tenho",
  "preciso",
  "para",
  "de",
  "das",
  "dos",
  "da",
  "do",
  ...GENERIC_CLINICAL_CATEGORY_WORDS,
]);

function findTreatmentByIdOrName(
  treatments: Treatment[],
  params: { treatmentId?: string | null; treatmentName?: string | null },
): Treatment | null {
  if (params.treatmentId) {
    const byId = treatments.find((t) => t.id === params.treatmentId);
    if (byId) return byId;
  }

  const normalizedName = params.treatmentName ? normalizeFreeText(params.treatmentName) : null;
  if (!normalizedName) return null;

  const byAlias = treatments.find((t) =>
    (t.aliases ?? []).some((alias) => normalizeFreeText(alias) === normalizedName),
  );
  if (byAlias) return byAlias;

  return (
    treatments.find((t) => normalizeFreeText(t.name) === normalizedName) ??
    null
  );
}

function matchTreatmentByNormalizedMessage(
  normalized: string,
  treatments: Treatment[],
  stopwords: Set<string>,
): Treatment | null {
  const tokens = normalized
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !stopwords.has(token));

  const matches = (treatment: Treatment): boolean => {
    if (!treatment.keywordMatchEnabled) return false;

    const treatmentName = normalizeFreeText(treatment.name);
    if (treatmentName === normalized) return true;
    if (normalized.length >= 4 && treatmentName.includes(normalized)) return true;
    if (treatmentName.length >= 4 && normalized.includes(treatmentName)) return true;
    if (tokens.some((token) => treatmentName.includes(token))) return true;

    const aliases = treatment.aliases ?? [];
    return aliases.some((alias) => {
      const normalizedAlias = normalizeFreeText(alias);
      return normalizedAlias.length >= 4 && normalized.includes(normalizedAlias);
    });
  };

  return (
    treatments.find((t) => matches(t) && t.pipelineSteps !== null) ??
    treatments.find((t) => matches(t)) ??
    null
  );
}

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
  return matchTreatmentByNormalizedMessage(normalized, treatments, TREATMENT_MENTION_STOPWORDS);
}

// Frases fortes de chegada física à clínica. Deliberadamente específicas
// ("estou aqui" sozinho é genérico demais) — falso negativo aqui é tolerável,
// falso positivo geraria alerta de presença indevido para a equipe.
const PATIENT_ARRIVAL_PHRASES = [
  "cheguei",
  "ja estou ai",
  "ja estou aqui",
  "ja to ai",
  "ja to aqui",
  "estou na frente",
  "to na frente",
  "aqui na frente",
  "estou na porta",
  "to na porta",
  "estou na recepcao",
  "to na recepcao",
  "estou esperando aqui",
];

export function detectPatientArrivalText(message: string): boolean {
  const normalized = normalizeFreeText(message);
  if (!normalized) return false;
  return PATIENT_ARRIVAL_PHRASES.some((phrase) => normalized.includes(phrase));
}

// ── Coerção determinística de intent para conteúdo de negócio ──
// O classificador (LLM) às vezes rotula pergunta de negócio como
// greeting/acknowledgment/unclear — e o starter genérico ("me conta o que você
// gostaria de ver hoje") engole a pergunta do lead. Casos reais: "Posso ter mais
// informações sobre custo?" → acknowledgment; áudio "estou aqui na frente e
// ninguém atende" → acknowledgment. O sistema decide: se a mensagem contém
// conteúdo de negócio detectável, o intent conversacional é sobrescrito.
export function coerceBusinessIntent(params: {
  message: string;
  intent: IntentType;
  treatments: Treatment[];
  isClinicSegment: boolean;
}): IntentType {
  const { message, intent, treatments, isClinicSegment } = params;
  if (intent !== "greeting" && intent !== "acknowledgment" && intent !== "unclear") return intent;

  const normalized = normalizeFreeText(message);
  if (!normalized) return intent;

  if (isClinicSegment && detectPatientArrivalText(message)) return "patient_arrived";
  if (isPriceRequestText(normalized)) return "price_inquiry";
  if (resolveDirectTreatmentMention(message, treatments)) return "general_question";
  return intent;
}

// ── Guard determinístico de ambiguidade entre variações do catálogo ──
// Não confia na LLM para sinalizar ambiguidade: recalcula em código quais
// tratamentos o termo do lead cobre. Se um mesmo termo (nome ou alias) casa com
// 2+ tratamentos (ex: "lentes de resina" → Técnica Simplificada E Estratificada)
// e a mensagem não contém um termo exclusivo de uma das variações, o lead não
// especificou qual quer — todas devem ser apresentadas.
export function detectAmbiguousTreatmentTerm(
  message: string,
  treatments: Treatment[],
): string[] | null {
  const normalized = normalizeFreeText(message);
  if (!normalized) return null;

  // termo normalizado → tratamentos que casam com ele na mensagem
  const termMatches = new Map<string, Treatment[]>();
  for (const t of treatments) {
    const seen = new Set<string>();
    for (const term of [t.name, ...(t.aliases ?? [])]) {
      const nt = normalizeFreeText(term);
      if (nt.length < 4 || seen.has(nt) || !normalized.includes(nt)) continue;
      seen.add(nt);
      const group = termMatches.get(nt) ?? [];
      group.push(t);
      termMatches.set(nt, group);
    }
  }

  const sharedGroups = [...termMatches.values()].filter((g) => g.length >= 2);
  if (sharedGroups.length === 0) return null;
  const group = sharedGroups.reduce((a, b) => (b.length > a.length ? b : a));

  // Se a mensagem contém um termo que casa com UM ÚNICO tratamento do grupo
  // (ex: "estratificada", "premium"), o lead especificou a variação.
  const exclusive = group.filter((t) =>
    [t.name, ...(t.aliases ?? [])].some((term) => {
      const nt = normalizeFreeText(term);
      return nt.length >= 4 && normalized.includes(nt) && termMatches.get(nt)?.length === 1;
    }),
  );
  if (exclusive.length === 1) return null;

  return group.map((t) => t.name);
}

// Serviços de manutenção/ajuste aplicados a um trabalho já realizado. Quando o
// lead pergunta preço de um destes, o tratamento citado junto é apenas contexto
// ("polimento NAS LENTES") — não é o que ele quer comprar.
const MAINTENANCE_SERVICE_KEYWORDS = [
  "polimento",
  "polir",
  "manutencao",
  "retoque",
  "retocar",
  "reparo",
  "reparar",
  "conserto",
  "consertar",
  "ajuste",
  "ajustar",
  "troca",
  "trocar",
];

// ── Localiza o horário expresso pelo lead na lista atualizada de slots ──
// Quando a oferta expirou (TTL 15 min) mas o lead expressou um horário
// ("As 12hs", "sexta às 9"), procura esse horário na lista recém-buscada.
// Retorna o índice do slot quando a preferência casa com EXATAMENTE um —
// ambíguo (dois dias com 12h) ou ausente retorna null.
export function findExpressedSlotIndex(params: {
  slots: { index: number; startsAt: string }[];
  preferredTime: string | null;
  preferredDay: Date | null;
  timezone: ClinicTimezone;
}): number | null {
  const { slots, preferredTime, preferredDay, timezone } = params;
  if (!preferredTime && !preferredDay) return null;

  const timeMatch = preferredTime?.match(/(\d{1,2})(?::|h)?(\d{2})?/);
  const wantedHour = timeMatch ? Number(timeMatch[1]) : null;
  const wantedMinute = timeMatch?.[2] ? Number(timeMatch[2]) : null;
  if (preferredTime && wantedHour === null) return null;

  const wantedDay = preferredDay ? timezone.toLocalParts(preferredDay) : null;

  const matches = slots.filter((slot) => {
    const local = timezone.toLocalParts(new Date(slot.startsAt));
    if (wantedHour !== null && local.hour !== wantedHour) return false;
    if (wantedMinute !== null && local.minute !== wantedMinute) return false;
    if (wantedDay && (local.year !== wantedDay.year || local.month !== wantedDay.month || local.day !== wantedDay.day)) return false;
    return true;
  });

  return matches.length === 1 ? matches[0].index : null;
}

// ── Verificação exata de um horário pedido explicitamente ──
// A grade de slots de computeAvailableSlots avança em passos fixos de
// slotDurationMinutes a partir de `from`. Quando a duração não divide 60min
// (ex: 40min), horários redondos como 15h podem nunca "cair" na grade mesmo
// estando genuinamente livres — o sistema então diz "não disponível" só porque
// aquele instante não foi enumerado, não porque está ocupado.
// Esta função não reimplementa a checagem de disponibilidade: pede ao mesmo
// CalendarGateway uma janela do tamanho exato de um slot iniciando no instante
// pedido, reaproveitando a mesma lógica de horário comercial + conflitos.
export async function resolveExactRequestedSlot(params: {
  calendarGateway: CalendarGateway;
  clinicId: string;
  dayParts: LocalDateParts;
  preferredTime: string;
  businessHours: ParsedBusinessHours;
  timezone: ClinicTimezone;
  durationMinutes: number;
  windowStart: Date;
  windowEnd: Date;
  localAppointments: { startsAt: Date; endsAt: Date }[];
  postAppointmentBufferMinutes: number;
}): Promise<CalendarSlot | null> {
  const timeMatch = params.preferredTime.match(/(\d{1,2})(?::|h)?(\d{2})?/);
  if (!timeMatch) return null;

  let hour = Number(timeMatch[1]);
  const minute = timeMatch[2] ? Number(timeMatch[2]) : 0;

  // Normaliza hora ambígua para horário comercial: "3" com clínica 8-18 → 15h.
  // Mesma regra usada ao ordenar por proximidade em fetchAndOfferSlots.
  const pmCandidate = hour + 12;
  if (
    hour < params.businessHours.startHour &&
    pmCandidate >= params.businessHours.startHour &&
    pmCandidate < params.businessHours.endHour
  ) {
    hour = pmCandidate;
  }

  const candidateStart = params.timezone.fromLocalParts(
    params.dayParts.year,
    params.dayParts.month,
    params.dayParts.day,
    hour,
    minute,
  );
  const candidateEnd = new Date(candidateStart.getTime() + params.durationMinutes * 60_000);

  if (candidateStart < params.windowStart || candidateStart >= params.windowEnd) return null;

  const exact = await params.calendarGateway.listAvailableSlots({
    clinicId: params.clinicId,
    from: candidateStart,
    to: candidateEnd,
    slotDurationMinutes: params.durationMinutes,
  });
  if (exact.length === 0) return null;

  const bufferMs = Math.max(0, params.postAppointmentBufferMinutes) * 60_000;
  const conflictsLocally = params.localAppointments.some(
    (a) => a.startsAt.getTime() < candidateEnd.getTime() && a.endsAt.getTime() + bufferMs > candidateStart.getTime(),
  );
  if (conflictsLocally) return null;

  return exact[0];
}

// ── Guard determinístico de manutenção não catalogada ──
// "qual valor pra fazer o polimento nas lentes?" NÃO é pergunta de preço das
// lentes: é manutenção de trabalho já feito. Se o serviço de manutenção não
// consta no catálogo, a IA não tem preço para dar — encaminha para a equipe em
// vez de cotar o tratamento base (funil errado + preço errado).
// Retorna a palavra-chave encontrada, ou null quando não é caso de manutenção.
export function detectUncataloguedMaintenanceInquiry(
  message: string,
  treatments: Treatment[],
): string | null {
  const tokens = new Set(normalizeFreeText(message).split(/\s+/).filter(Boolean));
  for (const keyword of MAINTENANCE_SERVICE_KEYWORDS) {
    if (!tokens.has(keyword)) continue;
    // Se algum tratamento do catálogo cobre a palavra (ex: clínica cadastrou
    // "Manutenção ortodôntica"), é serviço real com preço — não intercepta.
    const coveredByCatalog = treatments.some((t) =>
      [t.name, ...(t.aliases ?? [])].some((term) =>
        normalizeFreeText(term).split(/\s+/).includes(keyword),
      ),
    );
    if (!coveredByCatalog) return keyword;
  }
  return null;
}

export function resolveInformationalTreatmentTarget(params: {
  message: string;
  treatments: Treatment[];
  lastAgentMessage?: string | null;
  procedureSelection?: ProcedureListItem | null;
  identifiedTreatment?: string | null;
}): Treatment | null {
  const selectedTreatment = params.procedureSelection
    ? findTreatmentByIdOrName(params.treatments, {
        treatmentId: params.procedureSelection.treatmentId,
        treatmentName: params.procedureSelection.name,
      })
    : null;
  if (selectedTreatment) return selectedTreatment;

  const directMentionTreatment = resolveDirectTreatmentMention(
    params.message,
    params.treatments,
    params.lastAgentMessage,
  );

  const classifiedTreatment = findTreatmentByIdOrName(params.treatments, {
    treatmentName: params.identifiedTreatment ?? null,
  });
  if (classifiedTreatment) {
    if (
      directMentionTreatment &&
      directMentionTreatment.id !== classifiedTreatment.id &&
      directMentionTreatment.pipelineSteps?.length &&
      !classifiedTreatment.pipelineSteps?.length
    ) {
      return directMentionTreatment;
    }
    return classifiedTreatment;
  }

  return directMentionTreatment;
}

// Infere o tratamento em discussão a partir da última mensagem do agente.
// Usado para enriquecer o clinicContext do compose() quando a mensagem atual não
// menciona explicitamente nenhum tratamento (ex: "pode ser os vídeos", "quanto fica?").
// NÃO deve ser usada para iniciar pipeline — apenas para fornecer contexto editorial.
export function inferTreatmentContextFromHistory(params: {
  message: string;
  treatments: Treatment[];
  lastAgentMessage: string | null;
}): Treatment | null {
  if (!params.lastAgentMessage) return null;

  const normalized = normalizeFreeText(params.message);
  if (!normalized) return null;

  // Mensagens longas provavelmente introduzem novo tópico — não inferir
  if (normalized.split(/\s+/).length > 6) return null;

  // Solicitações com handlers próprios no Orchestrator — não inferir aqui
  if (
    isSchedulingRequestText(normalized) ||
    isPriceRequestText(normalized) ||
    isLocationRequestText(normalized) ||
    isProcedureCatalogRequestText(normalized)
  ) {
    return null;
  }

  // Busca keyword de tratamento na última mensagem do agente
  return matchTreatmentByNormalizedMessage(
    normalizeFreeText(params.lastAgentMessage),
    params.treatments,
    TREATMENT_MENTION_STOPWORDS,
  );
}

// Busca o tratamento mais recentemente mencionado no histórico completo da conversa.
// Usada como fallback no fluxo de agendamento quando o lead não especifica o tratamento
// na mensagem atual (ex: "quero marcar meu retorno") mas o discutiu anteriormente.
export function inferTreatmentFromConversationHistory(
  messages: Message[],
  treatments: Treatment[],
): Treatment | null {
  if (!treatments.length || !messages.length) return null;
  // Só o que o LEAD disse conta como "discutido anteriormente". Incluir
  // mensagens do próprio bot aqui faz qualquer palavra-chave que a IA usa nos
  // seus próprios textos (ex: "plano de tratamento personalizado") ser lida
  // de volta como se o lead tivesse pedido aquele tratamento.
  const recent = [...messages]
    .reverse()
    .filter((msg) => msg.author === "lead")
    .slice(0, 12);
  for (const msg of recent) {
    if (!msg.body) continue;
    const matched = matchTreatmentByNormalizedMessage(
      normalizeFreeText(msg.body),
      treatments,
      TREATMENT_MENTION_STOPWORDS,
    );
    if (matched) return matched;
  }
  return null;
}

// Registra uma menção de tratamento não encontrado no catálogo da clínica.
// Alimenta os insights operacionais do Inbox ("leads mencionaram X — cadastrar?").
// Fire-and-forget: sempre chamada com .catch(() => {}) para não bloquear a resposta.
async function maybeLogTreatmentGap(
  clinicId: string,
  conversationId: string,
  leadName: string | null,
  mentionedText: string,
  messageSnippet: string,
): Promise<void> {
  await db.insert(treatmentGapReports).values({
    clinicId,
    conversationId,
    leadName,
    mentionedText: mentionedText.slice(0, 200),
    messageSnippet: messageSnippet.slice(0, 300),
  });
}

export function resolveSchedulingTreatmentTarget(params: {
  message: string;
  treatments: Treatment[];
  identifiedTreatment?: string | null;
}): Treatment | null {
  const classifiedTreatment = findTreatmentByIdOrName(params.treatments, {
    treatmentName: params.identifiedTreatment ?? null,
  });
  if (classifiedTreatment) return classifiedTreatment;

  const normalized = normalizeFreeText(params.message);
  if (!normalized || !isSchedulingRequestText(normalized)) return null;

  return matchTreatmentByNormalizedMessage(
    normalized,
    params.treatments,
    TREATMENT_SCHEDULING_STOPWORDS,
  );
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

  const windowMs = params.windowMs ?? 4_000;
  return current.sentAt.getTime() - previousLead.sentAt.getTime() < windowMs;
}

function getDayGreeting(timezone: ClinicTimezone): string {
  const { hour } = timezone.toLocalParts(new Date());
  return getTimeGreeting(hour);
}
const SLOTS_WITH_DATE_AND_TIME = 2;
const SLOTS_WITH_DATE_ONLY = 5;

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
  if (address) {
    return `${base}\nEndereço: ${address}.\nATENÇÃO CRÍTICA: A clínica possui SOMENTE este endereço. NÃO confirme presença em outros bairros, ruas ou cidades — mesmo que o lead mencione um local diferente na mensagem. Se o lead perguntar sobre outro bairro, responda que a clínica está localizada no endereço acima.`;
  }
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

// Keywords padrão para segmentos de saúde/estética onde enviar uma foto ajuda a personalizar a resposta.
// Clínicas de outros segmentos podem sobrescrever via Treatment.isAesthetic = true (campo no banco).
const DEFAULT_AESTHETIC_TREATMENT_KEYWORDS = [
  "lente", "faceta", "clareamento", "harmonização", "harmonizacao",
  "gengivoplastia", "botox", "sorriso",
  "coloracao", "coloração", "mechas", "penteado",
];

export function isAestheticTreatment(treatmentName: string, extraKeywords?: string[]): boolean {
  const normalized = treatmentName.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const keywords = extraKeywords?.length ? extraKeywords : DEFAULT_AESTHETIC_TREATMENT_KEYWORDS;
  return keywords.some((kw) => normalized.includes(kw));
}

// Instrução de convite à foto — posicionada como benefício ao cliente, nunca obrigatória.
// Usada apenas em modo concierge e apenas para serviços estéticos visuais.
function buildPhotoInviteInstruction(): string {
  return `SE O LEAD AINDA NÃO ENVIOU FOTO e demonstrou interesse neste serviço: se fizer sentido depois de esclarecer a dúvida principal, convide-o de forma acolhedora e completamente opcional, posicionando como um benefício para ele — exemplo de tom: "Se quiser, e só se se sentir à vontade, você pode me mandar uma foto. Assim consigo te passar uma orientação mais personalizada de como poderia ficar 😊". REGRAS OBRIGATÓRIAS: (1) nunca pressione nem torne obrigatório; (2) use linguagem leve como "se quiser" ou "se se sentir à vontade"; (3) só faça esse convite UMA vez por conversa — se já foi pedido antes, não repita; (4) NÃO misture o convite da foto com pergunta de agenda no mesmo turno.`;
}

export function buildSelectedTreatmentContext(item: ProcedureListItem, commercialPolicy?: string | null, experience?: ConversationExperience): string {
  const shouldDelayScheduling = experience === "concierge" && isAestheticTreatment(item.name);
  const nextStep = shouldDelayScheduling
    ? "PRÓXIMO PASSO: responda a dúvida principal primeiro. Se o lead ainda estiver entendendo o tratamento, prefira encerrar com uma pergunta consultiva sobre a técnica ou a dúvida dele. Só conduza para avaliação depois de esclarecer o essencial. NÃO misture explicação técnica, convite de foto e pergunta de agenda na mesma resposta."
    : item.requiresEvaluationFirst
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
  const shouldDelayScheduling =
    experience === "concierge" &&
    (treatment.isAesthetic || isAestheticTreatment(treatment.name));
  const nextStep = shouldDelayScheduling
    ? "PRÓXIMO PASSO: responda a dúvida principal primeiro. Se o lead ainda estiver conhecendo o tratamento, prefira encerrar com uma pergunta consultiva sobre técnicas, resultado ou expectativas. Só conduza para avaliação depois de esclarecer o essencial. NÃO misture explicação técnica, convite de foto e pergunta de agenda na mesma resposta."
    : treatment.requiresEvaluationFirst
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
    "MÍDIA: se houver vídeo ou imagem na BIBLIOTECA DE MÍDIA com título relacionado a este tratamento, inclua [MEDIA:id] ao final da resposta conforme a regra da biblioteca.",
    experience === "concierge" && (treatment.isAesthetic || isAestheticTreatment(treatment.name)) ? buildPhotoInviteInstruction() : null,
    nextStep,
  ].filter(Boolean);

  // Não forçar bullet points aqui: o playbook de cada clínica define o formato
  // (prosa TTS-friendly ou bullets), e a instrução do actionContext sobreporia
  // as regras de voz das ORIENTAÇÕES DA CLÍNICA, causando bullets no áudio.
  const format = "Formato: até 2 parágrafos curtos. Siga as orientações de formato da clínica.";

  return `${details.join("\n")}\n${format}`;
}

type ClinicRow = typeof organizations.$inferSelect;

// Maps DB row (clinic_id column stays as-is per ADR-001 Layer 1) to domain type Organization
function buildOrganization(row: ClinicRow): Organization {
  return {
    id: row.id,
    name: row.name,
    specialty: row.specialty,
    plan: row.plan,
    segment: row.segment,
    city: row.city,
    address: row.address ?? null,
    timezone: row.timezone,
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
    rateLimitPerHour: row.rateLimitPerHour,
    unclearThreshold: row.unclearThreshold,
    staleConversationHours: row.staleConversationHours,
    slotOfferTtlMinutes: row.slotOfferTtlMinutes,
    maxSlotsToOffer: row.maxSlotsToOffer,
    slotLookaheadDays: row.slotLookaheadDays,
    mediaTakeoverTtlHours: row.mediaTakeoverTtlHours ?? null,
    rapidThrottleMs: row.rapidThrottleMs,
    messageDebounceMs: row.messageDebounceMs ?? null,
    serviceNoun: row.serviceNoun,
    bookingNoun: row.bookingNoun,
    contactNoun: row.contactNoun,
    agentRole: row.agentRole,
    businessDescriptor: row.businessDescriptor ?? null,
    businessNoun: resolveSegmentVocab(row.segment).businessNoun,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Baixa a mídia do CDN do Z-API e rehospeda no Vercel Blob para persistência longa.
 * Fire-and-forget: falhas são logadas mas não propagadas.
 * Atualiza o campo media_url do registro de mensagem após o upload.
 */
async function rehostLeadMedia(
  messageId: string,
  originalUrl: string,
  mediaType: "image" | "video" | "document" | "audio",
): Promise<void> {
  try {
    const res = await fetch(originalUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[MediaRehoster] Download falhou (${res.status}) para msg ${messageId}`);
      return;
    }
    const buffer = await res.arrayBuffer();
    const contentType =
      res.headers.get("content-type") ??
      (mediaType === "image"
        ? "image/jpeg"
        : mediaType === "video"
          ? "video/mp4"
          : mediaType === "audio"
            ? "audio/ogg"
            : "application/octet-stream");
    const ext =
      mediaType === "image" ? "jpg" : mediaType === "video" ? "mp4" : mediaType === "audio" ? "ogg" : "bin";
    const storage = new VercelBlobStorageGateway();
    const blobUrl = await storage.upload(`lead-media/${messageId}.${ext}`, buffer, { contentType });
    await db.update(messagesTable).set({ mediaUrl: blobUrl }).where(eq(messagesTable.id, messageId));
    console.log(`[MediaRehoster] ${mediaType} rehostado em Blob para msg ${messageId}`);
  } catch (err) {
    console.warn(`[MediaRehoster] Falha silenciosa para msg ${messageId}:`, err);
  }
}

// Resolve as tags [MEDIA:id] das partes compostas contra a biblioteca de mídia,
// produzindo partes prontas para entrega. IDs ausentes são logados como erro crítico
// (vídeo perdido silenciosamente é pior do que log ruidoso) e pulados.
function resolveOutboundParts(
  parts: ResponsePart[],
  mediaLibrary: { id: string; title: string; type: "video" | "image"; url: string }[] | undefined,
  log: Logger,
): OutboundPart[] {
  const out: OutboundPart[] = [];
  const libraryIds = mediaLibrary?.map((m) => m.id) ?? [];

  for (const part of parts) {
    if (part.type === "text") {
      out.push({ type: "text", content: part.content });
      continue;
    }
    const item = mediaLibrary?.find((m) => m.id === part.id);
    if (!item) {
      // Erro crítico: o vídeo era esperado mas será silenciosamente omitido ao lead.
      // Causas comuns: (1) pipeline step com mediaId de versão antiga do playbook,
      // (2) vídeo re-uploadado com novo ID sem re-seeded o pipeline,
      // (3) LLM gerou ID inventado.
      log.error("mediaId não encontrado na biblioteca — vídeo será omitido ao lead", {
        mediaId: part.id,
        libraryIds,
        librarySize: libraryIds.length,
      });
      continue;
    }
    if (!item.url) {
      log.error("item da biblioteca sem URL — vídeo será omitido ao lead", {
        mediaId: item.id,
        title: item.title,
      });
      continue;
    }
    out.push({
      type: "media",
      mediaId: item.id,
      url: item.url,
      mediaType: item.type,
      title: item.title,
      caption: part.caption,
    });
  }
  return out;
}

// ─── Pipeline helpers ─────────────────────────────────────────────────────────

// Converte os blocos de um step "content" em ResponseParts prontas para envio.
function buildPipelineContentParts(blocks: ContentBlock[]): ResponsePart[] {
  return blocks.map((b) =>
    b.kind === "text"
      ? { type: "text" as const, content: b.content }
      : { type: "media" as const, id: b.mediaId, caption: b.caption },
  );
}

// Retorna o próximo step do pipeline que requer condução ativa (content, qa, photo).
// Steps ask_availability / offer_slots / book são documentação para o doutor;
// o fluxo reativo existente os cobre quando o lead expressa intenção.
function nextActivePipelineStep(
  steps: PipelineStep[],
  fromIndex: number,
  options?: { skipOptionalPhoto?: boolean },
): { step: PipelineStep; index: number } | null {
  for (let i = fromIndex; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === "photo" && options?.skipOptionalPhoto && !s.required) {
      continue;
    }
    if (s.type === "content" || s.type === "qa" || s.type === "photo") {
      return { step: s, index: i };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

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
    senderPhoto?: string | null;
    timestamp: Date;
    replyEnabled?: boolean;
    mediaUrl?: string;
    mediaType?: "image" | "video" | "audio" | "document";
  }): Promise<{ replied: boolean }> {
    const { clinicId, phone, messageText, messageId, senderName, senderPhoto, timestamp } = params;
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
    // Janela de 2min baseada no wall-clock (não no timestamp da mensagem): retries tardios do
    // Z-API chegam com timestamp novo, o que fazia a janela de 5s original expirar. 2min cobre
    // o intervalo de retry sem bloquear mensagens legítimas repetidas além desse prazo.
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
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
          gte(messagesTable.sentAt, twoMinutesAgo),
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
      .from(organizations)
      .where(eq(organizations.id, clinicId))
      .limit(1);

    if (clinicRows.length === 0) {
      console.error(`[Orchestrator] Clinic not found: ${clinicId}`);
      return { replied: false };
    }

    const clinic = buildOrganization(clinicRows[0]);
    const timezone = new ClinicTimezone(clinic.timezone);
    const businessHours = parseBusinessHours(clinic.businessHours);

    // FONTE ÚNICA EDITORIAL + módulos carregados em paralelo para evitar waterfall.
    const [editorial, activeModules] = await Promise.all([
      resolveActiveEditorialConfig(clinicId),
      getClinicModules(clinicId),
    ]);
    const channelConfig = resolveChannelConfig(clinicRows[0]);

    // Derivados de módulos — usados em todo o método no lugar dos campos legados
    const elevenLabsMod = activeModules.find((m) => m.key === "voice_elevenlabs");
    const voiceMod = activeModules.find((m) => m.key === "voice_tts");
    const elevenLabsConfig = (elevenLabsMod?.config ?? null) as VoiceElevenLabsConfig | null;
    const voiceTtsConfig = (voiceMod?.config ?? null) as VoiceTtsConfig | null;
    const { bwaveEnabled, voiceBasicEnabled, voiceEnabled } = resolveVoiceOutputFlags({
      hasElevenLabsModule: !!elevenLabsMod,
      elevenLabsConfig,
      hasVoiceTtsModule: !!voiceMod,
      voiceTtsConfig,
    });
    // voiceEnabled: flag global indicando que a saída por voz está habilitada
    // (usado para prompt, mídia intercalada e decisão final de entrega).

    // inputWasAudio: detectado pelo prefixo [áudio] que o WhisperGateway adiciona
    const inputWasAudio = messageText.startsWith("[áudio]");

    let ttsConf: TtsConfig;
    let bwaveMode: VoiceMode = "impact";
    if (elevenLabsConfig) {
      bwaveMode = elevenLabsConfig.mode ?? "impact";
      ttsConf = {
        provider: "elevenlabs",
        speed: elevenLabsConfig.speed ?? TTS_SPEED_DEFAULTS.elevenlabs,
        elevenLabsVoiceId: elevenLabsConfig.voiceId,
        elevenLabsStability: elevenLabsConfig.stability,
        elevenLabsSimilarityBoost: elevenLabsConfig.similarityBoost,
      };
    } else if (voiceTtsConfig) {
      ttsConf = ttsConfigFromVoice(String(voiceTtsConfig.provider ?? "nova"));
    } else {
      ttsConf = DEFAULT_TTS_CONFIG;
    }

    // Resolve voz por mensagem: B-WAVE e voz básica usam a mesma lógica de modo.
    // Voz básica (Start/OpenAI) sem `mode` configurado cai em "greeting_only": só a
    // saudação vem em áudio. Decisão jul/2026 a partir de feedback real (áudio em
    // excesso incomoda) + a voz OpenAI é robótica — ouvida uma vez é novidade, repetida
    // irrita. A clínica pode subir para impact/mix/full no painel. Ver pricing-strategy §6.1.
    const voiceBasicMode: VoiceMode = voiceTtsConfig?.mode ?? "greeting_only";
    function resolveVoiceForReply(messageIntent: IntentType, responseText: string): boolean {
      if (bwaveEnabled) return shouldUseBWaveForMessage(bwaveMode, messageIntent, responseText, inputWasAudio);
      if (voiceBasicEnabled) return shouldUseBWaveForMessage(voiceBasicMode, messageIntent, responseText, inputWasAudio);
      return false;
    }
    const clinicExperience: ConversationExperience = activeModules.some((m) => m.key === "concierge_mode")
      ? "concierge"
      : "menu_first";

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
      followUpRepository: new DrizzleFollowUpRepository(),
      idGenerator: randomUUID,
      now: () => new Date(),
    });

    const { lead, conversation, message: incomingMessage } = await registerUseCase.execute({
      clinicId,
      message: {
        externalMessageId: messageId,
        externalContactId: channelAddress,
        phone,
        whatsappLid: params.whatsappLid ?? null,
        name: senderName ?? null,
        senderPhoto: senderPhoto ?? null,
        email: null,
        campaignId: null,
        channel: "whatsapp",
        externalThreadId: channelAddress,
        body: messageText,
        mediaUrl: params.mediaUrl ?? null,
        mediaType: params.mediaType ?? null,
        receivedAt: timestamp,
      },
    });

    const outboundAddress =
      resolveWhatsAppChannelAddress({ phone: lead.phone, whatsappLid: lead.whatsappLid }) ??
      channelAddress;

    // ── 3.1. Enriquecimento de foto (fire-and-forget) ──
    // Z-API não envia senderPhoto no webhook — buscamos sob demanda via /profile-picture
    // e re-hospedamos no Vercel Blob para evitar expiração de 48h das URLs do WhatsApp.
    if (!lead.profilePicUrl && lead.phone && channelConfig.zapi) {
      void fetchAndPersistLeadPhoto(lead.id, lead.phone, channelConfig.zapi);
    }

    // ── 3.1b. Rehost de áudio (fire-and-forget) ──
    // Áudio segue o fluxo normal de transcrição/resposta da IA — só persistimos o
    // arquivo original no Blob em paralelo, para o player do Inbox não quebrar
    // quando a URL da Z-API expirar.
    if (params.mediaType === "audio" && params.mediaUrl) {
      rehostLeadMedia(incomingMessage.id, params.mediaUrl, "audio")
        .catch(() => { /* já logado dentro da função */ });
    }

    // ── 3.2. Claim de processamento por conversa ──
    // Serializa webhooks concorrentes da mesma conversa: sem isso, dois handlers
    // processam em paralelo e as respostas saem intercaladas/duplicadas (o check
    // de debounce sozinho tem janela TOCTOU). CAS via UPDATE condicional — único
    // statement, atômico no Postgres mesmo com o driver neon-http.
    const claimed = await this.acquireConversationClaim(conversation.id);
    if (!claimed) {
      const acquired = await this.waitForConversationClaim(conversation.id);
      if (!acquired) {
        console.warn(`[Orchestrator] Claim não adquirido para ${conversation.id} — mensagem ${messageId} ignorada`);
        return { replied: false };
      }
      // Adquiriu após espera: outro handler terminou. Se chegou mensagem mais
      // recente do lead nesse meio tempo, ela (ou seu handler) cobre a resposta.
      const latestAfterWait = await this.conversationRepo.findLatestLeadMessage(conversation.id);
      if (latestAfterWait && latestAfterWait.id !== incomingMessage.id) {
        await this.releaseConversationClaim(conversation.id);
        return { replied: false };
      }
    }

    try {

    if (!isSalesConversationCategory(conversation.category)) {
      const displayName = lead.name ?? phone;
      const preview = params.mediaType
        ? `Nova mensagem ${params.mediaType === "image" ? "com imagem" : `com ${params.mediaType}`}`
        : messageText.slice(0, 100);
      await this.notifier
        .execute(clinicId, {
          title: displayName,
          body: preview,
          url: `/app/inbox/${conversation.id}`,
        })
        .catch((err) => console.error("[Orchestrator] Push falhou:", err));
      return { replied: false };
    }

    // ── 3.5. Mídia visual inbound (foto/vídeo/documento) ──
    // Rehospeda no Blob (persistência), encaminha para o doutor no WhatsApp e pausa a IA.
    // Áudio já foi rehostado em 3.1b e segue o pipeline normal de transcrição/resposta
    // da IA (não pausa e não é encaminhado ao doutor aqui).
    const inboundMediaType = params.mediaType;
    if (inboundMediaType === "image" || inboundMediaType === "video" || inboundMediaType === "document") {
      // ── Guard: mídia de anúncio (Click-to-WhatsApp) ──
      // Quando o lead clica em "Saiba mais" de um anúncio, o WhatsApp envia automaticamente
      // o card do anúncio (imagem/vídeo) junto com a mensagem de texto do lead.
      // Critérios para identificar como mídia de anúncio (não foto clínica do paciente):
      //   1. É o primeiro contato da conversa (IA ainda não respondeu), E
      //   2. Há poucas mensagens do lead no histórico (burst de chegada de anúncio), E
      //   3. A legenda (caption) coincide com frases típicas de preenchimento automático de anúncios.
      const AD_CAPTION_RE = /^(venho|vim|chego|cheguei|chegando|cliquei|vi\s+o?\s*(anúncio|anuncio|post|vídeo|video|reels?|story|stories)|olá|ola|oi|posso|gostaria|queria|me\s+passa)/i;
      const caption = params.messageText?.trim() ?? "";
      // Usa contagem de mensagens na conversa sem carregar todo o histórico (allMessages é carregado mais adiante)
      const [totalMsgRow] = await db
        .select({ total: count() })
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, conversation.id));
      const [agentMsgRow] = await db
        .select({ total: count() })
        .from(messagesTable)
        .where(and(eq(messagesTable.conversationId, conversation.id), eq(messagesTable.author, "agent")));
      const earlyLeadMsgTotal = Number(totalMsgRow?.total ?? 0);
      const hasAnyAgentMsg = Number(agentMsgRow?.total ?? 0) > 0;
      const isLikelyAdMedia =
        !hasAnyAgentMsg &&
        earlyLeadMsgTotal <= 3 &&
        AD_CAPTION_RE.test(caption);

      if (isLikelyAdMedia) {
        console.log(
          `[Orchestrator] Mídia detectada como card de anúncio — não encaminhando ao doutor nem pausando IA` +
          ` (conv=${conversation.id} lead=${lead.id} caption="${caption.slice(0, 80)}")`,
        );
        // Deixa o fluxo continuar normalmente como se fosse uma mensagem de texto.
        // O LLM responderá com base no texto que o lead enviou junto ao anúncio.
        // Não retorna aqui — o código abaixo não será atingido por causa do `if`.
      } else {

      // Rehospeda de forma assíncrona: Z-API URLs expiram em horas
      if (params.mediaUrl) {
        rehostLeadMedia(incomingMessage.id, params.mediaUrl, inboundMediaType)
          .catch(() => { /* já logado dentro da função */ });
      }

      // Encaminha para o WhatsApp do doutor com contexto + mídia original
      const receptionistPhone = clinic.receptionistPhone;
      if (receptionistPhone) {
        const mediaLabel = inboundMediaType === "image" ? "foto" : inboundMediaType === "video" ? "vídeo" : "documento";
        const artigo = inboundMediaType === "image" ? "uma" : "um";
        const leadName = lead.name ?? outboundAddress;
        const contextMsg = `📎 *${leadName}* enviou ${artigo} ${mediaLabel} para avaliação.\n\nResponda neste chat — sua resposta será encaminhada automaticamente ao lead.`;
        sendTextMessage(receptionistPhone, contextMsg, channelConfig)
          .catch(e => console.warn("[MediaForward] contexto falhou:", e));
        if (params.mediaUrl) {
          sendMediaMessage(receptionistPhone, params.mediaUrl, inboundMediaType, channelConfig)
            .catch(e => console.warn("[MediaForward] mídia falhou:", e));
        }
      }

      // Notifica operadores via push
      await this.notifier.execute(clinicId, {
        title: lead.name ?? phone,
        body: `Enviou ${inboundMediaType === "image" ? "uma foto" : "um " + inboundMediaType} para avaliação`,
        url: `/app/inbox/${conversation.id}`,
      }).catch(() => {});

      // Se IA está pausada ou auto-reply desligado, o doutor já está no controle — sem resposta automática
      if (!replyEnabled || conversation.aiPaused) {
        return { replied: false };
      }

      // Pipeline photo intercept: foto ou vídeo enviado enquanto pipeline aguarda step "photo"
      // OU enquanto está em Q&A com step de foto adiante (convite já foi feito no Q&A) →
      // retoma automaticamente sem pausar a IA. Doutor já foi notificado acima.
      if (inboundMediaType === "image" || inboundMediaType === "video") {
        const activePipelineState = await this.stateMachine.getTreatmentPipelineState(conversation.id);
        if (activePipelineState) {
          const pipelineTreatments = await this.treatmentRepo.listByClinic(clinicId);
          const pipelineTreatment = pipelineTreatments.find(t => t.id === activePipelineState.treatmentId);
          const currentStep = pipelineTreatment?.pipelineSteps?.[activePipelineState.stepIndex];
          const hasPhotoStepAhead = pipelineTreatment?.pipelineSteps?.some(
            (step, idx) => idx > activePipelineState.stepIndex && step.type === "photo",
          ) ?? false;
          const isPhotoContext = currentStep?.type === "photo" ||
            (currentStep?.type === "qa" && hasPhotoStepAhead);
          if (isPhotoContext) {
            await this.stateMachine.markPipelinePhotoReceived(conversation.id);
            // Se veio de Q&A, pula o photo step (foto já recebida antes de chegar lá)
            const next = nextActivePipelineStep(
              pipelineTreatment!.pipelineSteps!,
              activePipelineState.stepIndex + 1,
              { skipOptionalPhoto: currentStep?.type === "qa" },
            );
            const photoHistory = await this.conversationRepo.listMessages(conversation.id);
            const photoComposed = await this.responseComposer.compose({
              actionResult: { type: "pipeline_photo_received" },
              conversationHistory: photoHistory,
              clinic: {
                name: clinic.name,
                plan: clinic.plan,
                specialty: editorial?.specialty ?? clinic.specialty,
                toneOfVoice: editorial?.toneOfVoice ?? null,
                playbook: editorial?.playbookText ?? null,
                commercialPolicy: editorial?.commercialPolicy ?? null,
                installmentTable: null,
                receptionistName: inferReceptionistNameFromGreeting(clinic.greetingMessage) ?? undefined,
              },
              leadName: extractFirstName(lead.name),
              timezone,
              isFirstMessage: false,
              conversationExperience: clinicExperience,
              resumedFromHumanTakeover: false,
            });
            const photoNow = new Date();
            const photoAgentId = randomUUID();
            await this.conversationRepo.appendMessage({
              id: photoAgentId,
              conversationId: conversation.id,
              author: "agent",
              body: photoComposed.text,
              sentAt: photoNow,
              externalId: null,
              intent: "check_availability",
              deliveryFormat: null,
            });
            await this.enqueueConversationReply(clinicId, conversation.id, {
              version: 1,
              kind: "conversation_reply",
              to: outboundAddress,
              agentMessageId: photoAgentId,
              replyText: photoComposed.text,
              intent: "check_availability",
              useVoice: resolveVoiceForReply("check_availability", photoComposed.text),
              ttsConfig: ttsConf,
              interleavedParts: [],
              mediaParts: [],
              leadId: lead.id,
              pipelineAdvance: next
                ? { action: "advance", nextStepIndex: next.index }
                : { action: "exit" },
            });
            return { replied: true };
          }
        }
      }

      // IA ativa: foto/vídeo/documento fora de pipeline → responde e pausa para o doutor avaliar
      const mediaHistory = await this.conversationRepo.listMessages(conversation.id);
      const mediaComposed = await this.responseComposer.compose({
        actionResult: { type: "media_received", mediaType: inboundMediaType },
        conversationHistory: mediaHistory,
        clinic: {
          name: clinic.name,
          plan: clinic.plan,
          specialty: editorial?.specialty ?? clinic.specialty,
          toneOfVoice: editorial?.toneOfVoice ?? null,
          playbook: editorial?.playbookText ?? null,
          commercialPolicy: editorial?.commercialPolicy ?? null,
          installmentTable: null,
          receptionistName: inferReceptionistNameFromGreeting(clinic.greetingMessage) ?? undefined,
        },
        leadName: lead.name,
        timezone,
        isFirstMessage: mediaHistory.filter(m => m.author !== "lead").length === 0,
        conversationExperience: clinicExperience,
        resumedFromHumanTakeover: false,
      });
      const mediaReplyText = mediaComposed.text;

      const attentionReason = `Lead enviou ${inboundMediaType === "image" ? "foto" : inboundMediaType} para avaliação`;
      const now = new Date();
      const mediaTtl = clinic.mediaTakeoverTtlHours;
      const mediaTakeoverExpiresAt = mediaTtl && mediaTtl > 0
        ? new Date(Date.now() + mediaTtl * 3600_000)
        : null;
      await db.update(conversationsTable).set({
        aiPaused: true,
        takeoverExpiresAt: mediaTakeoverExpiresAt,
        needsAttention: true,
        attentionReason,
        updatedAt: now,
      }).where(eq(conversationsTable.id, conversation.id));

      const mediaAgentId = randomUUID();
      await this.conversationRepo.appendMessage({
        id: mediaAgentId,
        conversationId: conversation.id,
        author: "agent",
        body: mediaReplyText,
        sentAt: now,
        externalId: null,
        intent: "needs_human",
        deliveryFormat: null,
      });
      await this.enqueueConversationReply(clinicId, conversation.id, {
        version: 1,
        kind: "conversation_reply",
        to: outboundAddress,
        agentMessageId: mediaAgentId,
        replyText: mediaReplyText,
        intent: "needs_human",
        useVoice: resolveVoiceForReply("needs_human", mediaReplyText),
        ttsConfig: ttsConf,
        interleavedParts: [],
        mediaParts: [],
        leadId: lead.id,
        pipelineAdvance: null,
      });

      return { replied: true };
      } // end else (não é mídia de anúncio)
    }

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

    // ── 3.7. Debounce — aguarda burst de mensagens do lead ──
    // Após registrar, espera N ms e verifica se chegou mensagem mais recente.
    // Se sim, esta mensagem não gera resposta — a última do burst responde
    // com o histórico completo (que já inclui todas as anteriores).
    const debounceMs = clinic.messageDebounceMs ?? 5000;
    if (debounceMs > 0) {
      await new Promise((r) => setTimeout(r, debounceMs));
      const latest = await this.conversationRepo.findLatestLeadMessage(conversation.id);
      if (latest && latest.id !== incomingMessage.id) {
        console.log(
          `[Orchestrator] Debounce: msg ${incomingMessage.id} descartada` +
          ` (body="${incomingMessage.body?.slice(0, 60)}")` +
          ` — msg mais recente: ${latest.id} (body="${latest.body?.slice(0, 60)}")` +
          ` conv=${conversation.id} lead=${lead.id}`,
        );
        return { replied: false };
      }
      console.log(`[Orchestrator] Debounce: msg ${incomingMessage.id} é a mais recente — prosseguindo (conv=${conversation.id})`);
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
    if (msgCount >= clinic.rateLimitPerHour) {
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

    // ── 8.5. Verifica pipeline de tratamento ativo ──
    const pipelineState = await this.stateMachine.getTreatmentPipelineState(conversation.id);

    // ── 9. Resolve intenção: menu pré-classificado ou LLM estágio 1 ──
    const clinicTreatments = await this.treatmentRepo.listByClinic(clinicId);
    const experience = clinicExperience;

    const currentConversationState = await this.stateMachine.getCurrentState(conversation.id);

    // Se houve reset recente, usa apenas mensagens pós-reset para LLM (classifier + composer),
    // evitando que o modelo reutilize mídias já enviadas na sessão anterior.
    // isFirstMessage e demais checagens determinísticas continuam usando allMessages.
    const lastResetAt = currentConversationState?.state === "idle"
      ? (currentConversationState.payload as { lastResetAt?: string } | null)?.lastResetAt
      : undefined;
    const allMessagesForContext = lastResetAt
      ? allMessages.filter((m) => m.sentAt >= new Date(lastResetAt))
      : allMessages;

    // ── 8.6. Resposta do lead ao pedido de confirmação de presença (lembrete D-1) ──
    // Quando o lead pede para remarcar, sinalizamos aqui e deixamos o fluxo seguir para o
    // intent `reschedule_appointment` (rebooking automatizado), em vez de cancelar e acionar
    // atendimento humano. Mantém o lead num caminho self-service de ponta a ponta.
    let rescheduleAfterReminder = false;
    if (currentConversationState?.state === "awaiting_appointment_confirmation") {
      const confirmPayload = currentConversationState.payload as { appointmentId: string; appointmentLabel: string } | null;
      if (confirmPayload?.appointmentId) {
        const confirmationSignal = detectAppointmentConfirmation(messageText);
        if (confirmationSignal === "reschedule") {
          // Encerra o estado de confirmação e roteia para a remarcação automatizada abaixo.
          await this.stateMachine.invalidate(conversation.id);
          rescheduleAfterReminder = true;
        } else if (confirmationSignal !== "ambiguous") {
          await this.stateMachine.invalidate(conversation.id);
          const appt = await this.appointmentRepo.findById(confirmPayload.appointmentId);
          let confirmReplyText: string;
          if (confirmationSignal === "yes") {
            if (appt) {
              await this.appointmentRepo.save({ ...appt, status: "confirmed", updatedAt: new Date() });
            }
            confirmReplyText = await this.responseComposer.compose({
              actionResult: { type: "appointment_confirmation_accepted", appointmentLabel: confirmPayload.appointmentLabel },
              conversationHistory: allMessages.slice(-4),
              clinic: {
                name: clinic.name,
                plan: clinic.plan,
                specialty: editorial?.specialty ?? clinic.specialty,
                toneOfVoice: editorial?.toneOfVoice ?? null,
                playbook: editorial?.playbookText ?? null,
                commercialPolicy: editorial?.commercialPolicy ?? null,
                receptionistName: inferReceptionistNameFromGreeting(clinic.greetingMessage) ?? undefined,
              },
              leadName: extractFirstName(lead.name),
              timezone,
              isFirstMessage: false,
            }).then((c) => c.text);
          } else {
            if (appt) {
              await this.appointmentRepo.save({ ...appt, status: "cancelled", updatedAt: new Date() });
            }
            await db
              .update(conversationsTable)
              .set({ aiPaused: true, needsAttention: true, attentionReason: "Lead cancelou a consulta — reagendamento necessário", updatedAt: new Date() })
              .where(eq(conversationsTable.id, conversation.id));
            confirmReplyText = await this.responseComposer.compose({
              actionResult: { type: "appointment_confirmation_rejected" },
              conversationHistory: allMessages.slice(-4),
              clinic: {
                name: clinic.name,
                plan: clinic.plan,
                specialty: editorial?.specialty ?? clinic.specialty,
                toneOfVoice: editorial?.toneOfVoice ?? null,
                playbook: editorial?.playbookText ?? null,
                commercialPolicy: editorial?.commercialPolicy ?? null,
                receptionistName: inferReceptionistNameFromGreeting(clinic.greetingMessage) ?? undefined,
              },
              leadName: extractFirstName(lead.name),
              timezone,
              isFirstMessage: false,
            }).then((c) => c.text);
          }
          const confirmAgentId = randomUUID();
          await this.conversationRepo.appendMessage({
            id: confirmAgentId,
            conversationId: conversation.id,
            author: "agent",
            body: confirmReplyText,
            sentAt: new Date(),
            externalId: null,
            intent: null,
            deliveryFormat: null,
          });
          await this.enqueueConversationReply(clinicId, conversation.id, {
            version: 1,
            kind: "conversation_reply",
            to: outboundAddress,
            agentMessageId: confirmAgentId,
            replyText: confirmReplyText,
            intent: null,
            useVoice: resolveVoiceForReply("confirm_slot", confirmReplyText),
            ttsConfig: ttsConf,
            interleavedParts: [],
            mediaParts: [],
            leadId: lead.id,
            pipelineAdvance: null,
          });
          return { replied: true };
        }
      }
    }

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
      !rescheduleAfterReminder &&
      shouldThrottleRapidLeadMessage({
        messages: allMessages,
        currentExternalId: messageId,
        hasPendingSlotOffer: hasPendingOffer,
        isMenuActive,
        isProcedureListActive,
        treatments: clinicTreatments,
        windowMs: clinic.rapidThrottleMs,
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
    if (!isFirstMessage && !isMenuActive && !resetRequested && !menuReRequested && !rescheduleAfterReminder) {
      const prevLeadMsgs = allMessages.filter((m) => m.author === "lead");
      if (prevLeadMsgs.length >= 2) {
        const prev = prevLeadMsgs[prevLeadMsgs.length - 2];
        const gapHours = (timestamp.getTime() - new Date(prev.sentAt).getTime()) / (1000 * 60 * 60);
        isStaleConversation = gapHours >= clinic.staleConversationHours;
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
    // Permite disparar mesmo com pendingOffer ativo quando o número não corresponde a nenhum slot
    // oferecido — ex: slots [1,2,3] ativos mas lead digita "4" (item de menu válido).
    const numberMatchesPendingSlot = pendingSlots?.some(s => String(s.index) === nMsg) ?? false;
    const isOrphanedMenuNumber =
      !isMenuActive &&
      (!hasPendingOffer || !numberMatchesPendingSlot) &&
      !isProcedureListActive &&
      !resetRequested &&
      !menuReRequested &&
      !isFirstMessage &&
      /^\d+$/.test(nMsg) &&
      clinicMenuItems.some(i => i.enabled && nMsg === String(i.number));

    // isStaleConversation não está aqui: o LLM sempre classifica para capturar intents
    // explícitas (ex: "quero saber sobre custo") mesmo após longo silêncio.
    const skipLlm = procedureSelection !== null || menuReRequested || isolatedGreeting || resetRequested || isDisabledItemSelection || isInvalidMenuNumber || isOrphanedMenuNumber;

    const nullSlotPref = { preferredDate: null as null, preferredPeriod: null as null, preferredTime: null as null, slotChoice: null as null, identifiedTreatment: null as null, ambiguousTreatmentMatches: null as null };

    const promptContext = buildPromptContext(clinic);

    const classification = rescheduleAfterReminder
      ? {
          // Lead respondeu ao lembrete D-1 pedindo para remarcar: roteia direto para o
          // rebooking automatizado, sem depender do LLM (resposta curta e determinística).
          intent: "reschedule_appointment" as IntentType,
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
          allMessagesForContext,
          hasPendingOffer,
          clinicTreatments.map((t) => ({ name: t.name, aliases: t.aliases ?? [] })),
          promptContext,
        );

    const { intent, slotPreference } = classification;

    // ── Guard: rajada durante a classificação ──
    // O debounce cobre a janela pré-classificação; o claim serializa handlers.
    // Resta a janela da própria chamada de LLM (1-10s): se outra mensagem do
    // lead chegou nesse meio, descarta esta — a mais recente responde com o
    // histórico completo. Seguro aqui: nenhum efeito colateral aconteceu ainda.
    if (!skipLlm) {
      const latestAfterClassify = await this.conversationRepo.findLatestLeadMessage(conversation.id);
      if (latestAfterClassify && latestAfterClassify.id !== incomingMessage.id) {
        console.log(
          `[Orchestrator] Rajada pós-classificação: msg ${incomingMessage.id} superada por ${latestAfterClassify.id} — descartando resposta (conv=${conversation.id})`,
        );
        return { replied: false };
      }
    }

    // Coerção determinística: pergunta de negócio classificada como
    // greeting/acknowledgment/unclear é sobrescrita para o intent de negócio —
    // evita que o starter genérico engula a pergunta do lead. isolatedGreeting
    // (saudação pura, sem conteúdo) não passa por aqui e continua com o starter.
    const coercedIntent = skipLlm
      ? intent
      : coerceBusinessIntent({
          message: messageText,
          intent,
          treatments: clinicTreatments,
          isClinicSegment: promptContext.isClinicSegment,
        });

    // ── Interceptor: resposta de tratamento após clarificação de agendamento ──
    // Quando a AI perguntou "qual procedimento você gostaria de realizar?" e o lead
    // respondeu com um nome de tratamento (ex: "lentes"), o IntentClassifier classifica
    // como general_question porque a mensagem sozinha parece informativa. Aqui detectamos
    // esse padrão e redirecionamos para check_availability para buscar slots reais — sem
    // isso, o ResponseComposer alucinaria horários inventados.
    let effectiveIntent = coercedIntent;
    let clarificationTreatmentName: string | null = null;
    if (
      intent === "general_question" &&
      !hasPendingOffer &&
      !pipelineState &&
      didAgentAskForProcedure(lastAgentMessage?.body)
    ) {
      const matchedFromClarification = matchTreatmentByNormalizedMessage(
        normalizeFreeText(messageText),
        clinicTreatments,
        TREATMENT_SCHEDULING_STOPWORDS,
      );
      if (matchedFromClarification) {
        effectiveIntent = "check_availability";
        clarificationTreatmentName = matchedFromClarification.name;
      }
    }

    // ── Guard: preço de manutenção não catalogada → equipe ──
    // A LLM tende a travar no tratamento base ("polimento nas lentes" → cota
    // lentes). O sistema decide: pergunta de preço sobre serviço de manutenção
    // fora do catálogo vai para needs_human e registra o gap para o Inbox.
    let maintenanceHandoffReason: string | null = null;
    const isPriceShapedIntent =
      effectiveIntent === "price_inquiry" ||
      (effectiveIntent === "general_question" && isPriceRequestText(normalizeFreeText(messageText)));
    if (isPriceShapedIntent) {
      const maintenanceKeyword = detectUncataloguedMaintenanceInquiry(messageText, clinicTreatments);
      if (maintenanceKeyword) {
        effectiveIntent = "needs_human";
        maintenanceHandoffReason = `Preço de ${maintenanceKeyword} (manutenção) — requer equipe`;
        maybeLogTreatmentGap(
          clinicId,
          conversation.id,
          lead.name,
          maintenanceKeyword,
          messageText,
        ).catch((e) => console.warn("[TreatmentGap] Falhou ao salvar gap:", e));
      }
    }

    // ── Guard: termo genérico cobre 2+ variações do catálogo ──
    // Recalcula a ambiguidade em código; se o classificador escolheu uma variação
    // sozinho (ou nenhuma), força a apresentação de todas as opções que o termo cobre.
    const ambiguousTreatmentOverride =
      effectiveIntent === "price_inquiry"
        ? detectAmbiguousTreatmentTerm(messageText, clinicTreatments)
        : null;

    // ── 7. Executa ação e compõe resposta ──
    let replyText = "";
    let composerInputTokens = 0;
    let composerOutputTokens = 0;
    let composerModel = "gpt-4o-mini";
    // Listas numeradas de horários são muito mais claras em texto do que em voz —
    // nunca sintetizar áudio para essas respostas, independente do modo B-WAVE.
    let forceTextOnlyReply = false;

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
    let composedMediaIds: string[] = [];
    let composedParts: import("@/core/intelligence/ResponseComposer").ResponsePart[] = [];
    // Avanço de pipeline adiado: executado APÓS todo o conteúdo ser enviado para evitar
    // race condition onde um segundo webhook encontra pipelineState=Q&A durante o envio
    // dos blocos e injeta o texto de comparação no meio da sequência.
    let pendingPipelineAdvance: PipelineAdvance | null = null;
    const compose = async (
      actionResult: Parameters<ResponseComposer["compose"]>[0]["actionResult"],
    ) => {
      if (shouldForceTextOnlyForActionResult(actionResult)) forceTextOnlyReply = true;
      const composed = await this.responseComposer.compose({
        actionResult,
        conversationHistory: allMessagesForContext,
        clinic: {
          name: clinic.name,
          plan: clinic.plan,
          specialty: editorial?.specialty ?? clinic.specialty,
          toneOfVoice: editorial?.toneOfVoice ?? null,
          playbook: editorial?.playbookText ?? null,
          commercialPolicy: editorial?.commercialPolicy ?? null,
          installmentTable: clinic.installmentRates && editorial?.commercialPolicy
            ? buildInstallmentTable(editorial.commercialPolicy, clinic.installmentRates as InstallmentRate[])
            : null,
          mediaLibrary: editorial?.mediaLibrary ?? [],
          receptionistName: inferReceptionistNameFromGreeting(clinic.greetingMessage) ?? undefined,
        },
        context: promptContext,
        leadName: extractFirstName(lead.name),
        timezone,
        isFirstMessage,
        conversationExperience: experience,
        resumedFromHumanTakeover,
        voiceResponseEnabled: voiceEnabled,
      });
      composerInputTokens = composed.inputTokens;
      composerOutputTokens = composed.outputTokens;
      composerModel = composed.model;
      composedMediaIds = composed.mediaIds;
      composedParts = composed.parts;
      return composed.text;
    };

    if (isFirstMessage && shouldShowInitialMenu(experience, effectiveIntent)) {
      const salutation = getDayGreeting(timezone);
      const nameGreeting = extractFirstName(lead.name) ? `, ${extractFirstName(lead.name)}` : "";
      replyText = `${salutation}${nameGreeting}! ${buildMenuBody(clinic, "first", experience)}`;
      await this.stateMachine.offerMenu(conversation.id);
    } else if (isFirstMessage && shouldSendConciergeStarter(experience, effectiveIntent)) {
      replyText = buildConciergeStarter(clinic, timezone, lead.name);
    } else if (resetRequested) {
      // Zera estado e marca boundary para que a próxima mensagem receba histórico pós-reset
      await this.stateMachine.markResetBoundary(conversation.id);
      if (experience === "menu_first") {
        const salutation = getDayGreeting(timezone);
        const nameGreeting = extractFirstName(lead.name) ? `, ${extractFirstName(lead.name)}` : "";
        replyText = `${salutation}${nameGreeting}! ${buildMenuBody(clinic, "first", experience)}`;
        await this.stateMachine.offerMenu(conversation.id);
      } else {
        replyText = buildConciergeStarter(clinic, timezone, lead.name);
      }
    } else if (menuReRequested || (isStaleConversation && (effectiveIntent === "greeting" || effectiveIntent === "acknowledgment" || effectiveIntent === "unclear")) || isolatedGreeting || isDisabledItemSelection || isInvalidMenuNumber || isOrphanedMenuNumber) {
      if (menuReRequested || isDisabledItemSelection || isInvalidMenuNumber || isOrphanedMenuNumber) {
        replyText = buildMenuBody(clinic, "reoffer", experience);
        await this.stateMachine.offerMenu(conversation.id);
      } else if (experience === "menu_first") {
        const salutation = getDayGreeting(timezone);
        const nameGreeting = extractFirstName(lead.name) ? `, ${extractFirstName(lead.name)}` : "";
        replyText = `${salutation}${nameGreeting}! ${buildMenuBody(clinic, "stale", experience)}`;
        await this.stateMachine.offerMenu(conversation.id);
      } else if (isStaleConversation) {
        replyText = buildConciergeStarter(clinic, timezone, lead.name);
      } else {
        replyText = await compose({ type: "acknowledgment" });
      }
    } else switch (effectiveIntent) {
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
                undefined, undefined, undefined, voiceEnabled,
              );
              if (rdOutside) {
                replyText = await compose({ type: "clarification_needed", question: "Só consigo ver horários com até ${clinic.slotLookaheadDays} dias de antecedência. Tem algum dia mais próximo que funcione para você?" });
              } else if (rdNotOpen) {
                replyText = await compose({ type: "clarification_needed", question: "O atendimento de hoje já encerrou. Posso verificar os horários de amanhã ou outro dia para você?" });
              } else if (rdPeriod) {
                replyText = await compose({
                  type: "clarification_needed",
                  question: `Não temos atendimento no período da noite — nosso horário vai até as ${businessHours.endHour}h. Posso verificar outro período?`,
                });
              } else if (redirectSlots.length > 0 && !rdEmpty) {
                replyText = await compose({ type: "slots_found", slots: redirectSlots, askedForPreference: false });
                forceTextOnlyReply = true;
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
          // Lead escolheu (por número OU expressando dia/hora) mas a oferta expirou (15 min TTL)
          if (slotPreference.slotChoice !== null || slotPreference.preferredTime || slotPreference.preferredDate) {
            const { slots: freshSlots } = await this.fetchAndOfferSlots(
              conversation.id,
              clinic,
              calendarGateway,
              timezone,
              businessHours,
              undefined, undefined, undefined, undefined, undefined, voiceEnabled,
            );
            if (freshSlots.length > 0) {
              // Se o horário que o lead pediu segue livre na lista atualizada,
              // aponta a opção em vez de fazê-lo escolher do zero.
              const preferredDay = slotPreference.preferredDate
                ? timezone.resolvePreferredDate(slotPreference.preferredDate, new Date(), businessHours)
                : null;
              const preferredSlotIndex = findExpressedSlotIndex({
                slots: freshSlots,
                preferredTime: slotPreference.preferredTime ?? null,
                preferredDay,
                timezone,
              });
              replyText = await compose({ type: "slots_expired", freshSlots, preferredSlotIndex });
              forceTextOnlyReply = true;
            } else {
              replyText = await compose({ type: "no_slots_available" });
            }
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

        // Infere treatmentId e valueCents a partir do tratamento identificado
        const matchedTreatmentForBooking = offeredTreatment?.treatmentName
          ? clinicTreatments.find(
              (t) => t.name.toLowerCase() === offeredTreatment.treatmentName!.toLowerCase(),
            ) ?? null
          : null;

        const result = await bookingService.book({
          clinic,
          lead,
          startsAt: new Date(chosenSlot.startsAt),
          endsAt: new Date(chosenSlot.endsAt),
          treatmentName: offeredTreatment?.treatmentName,
          treatmentId: matchedTreatmentForBooking?.id ?? null,
          valueCents: matchedTreatmentForBooking?.priceCents ?? null,
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
            undefined, undefined, undefined, undefined, undefined, voiceEnabled,
          );
          if (newSlots.length > 0) {
            replyText = await compose({ type: "slot_taken_reoffered", newSlots });
            forceTextOnlyReply = true;
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
            voiceEnabled,
          );
          if (rejectOutside) {
            replyText = await compose({
              type: "clarification_needed",
              question: "Só consigo ver horários com até ${clinic.slotLookaheadDays} dias de antecedência. Tem algum dia mais próximo que funcione para você?",
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
            forceTextOnlyReply = true;
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
        // Pipeline ativo: verifica se foto obrigatória ainda não foi recebida.
        // Se sim, entrega o pedido de foto e aguarda — não avança para booking.
        // ⚠️ OPEN v2: quando a foto chegar, o intercept de mídia inbound deve marcar
        // photoReceived=true e avançar o pipeline automaticamente.
        if (pipelineState) {
          const pipelineTreatment = clinicTreatments.find(t => t.id === pipelineState.treatmentId);
          const photoStep = pipelineTreatment?.pipelineSteps?.find(
            (s): s is Extract<PipelineStep, { type: "photo" }> => s.type === "photo",
          );
          if (photoStep?.required && !pipelineState.photoReceived) {
            replyText = photoStep.message;
            break;
          }
          // Foto OK (ou não obrigatória) → sai do pipeline, fluxo de booking assume.
          await this.stateMachine.exitTreatmentPipeline(conversation.id);
        }

        // Invalida oferta anterior se houver nova mensagem com preferência
        if (hasPendingOffer && (slotPreference.preferredDate || slotPreference.preferredPeriod)) {
          await this.stateMachine.invalidate(conversation.id);
        }

        const schedulingTreatment = resolveSchedulingTreatmentTarget({
          message: messageText,
          treatments: clinicTreatments,
          identifiedTreatment: slotPreference.identifiedTreatment ?? null,
        });

        // Resolve tratamento e duração do slot.
        // clarificationTreatmentName: tratamento extraído quando a AI perguntou "qual procedimento?"
        // e o lead respondeu com o nome — não é detectado pelo resolveSchedulingTreatmentTarget normal.
        const effectiveTreatment =
          schedulingTreatment?.name ??
          slotPreference.identifiedTreatment ??
          clarificationTreatmentName ??
          lead.treatmentInterest ??
          null;

        // Fallback: se effectiveTreatment ainda é nulo, busca no histórico da conversa.
        // Cobre o caso "quero marcar meu retorno" onde o lead não repete o tratamento
        // mas ele foi discutido anteriormente (ex: lentes, facetas, etc.).
        const historyTreatment = !effectiveTreatment
          ? inferTreatmentFromConversationHistory(allMessagesForContext, clinicTreatments)
          : null;
        const finalEffectiveTreatment = effectiveTreatment ?? historyTreatment?.name ?? null;

        const resolution = resolveTreatmentDuration(
          finalEffectiveTreatment,
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
              voiceEnabled,
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
          voiceEnabled,
        );

        if (outsideBookingWindow) {
          replyText = await compose({
            type: "clarification_needed",
            question: "Só consigo ver horários com até ${clinic.slotLookaheadDays} dias de antecedência. Tem algum dia mais próximo que funcione para você?",
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
            treatmentInferredFromHistory: historyTreatment?.name ?? null,
          });
          forceTextOnlyReply = true;
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
          voiceEnabled,
        );

        if (rescheduleOutside) {
          replyText = await compose({
            type: "clarification_needed",
            question: "Só consigo ver horários com até ${clinic.slotLookaheadDays} dias de antecedência. Tem algum dia mais próximo que funcione para você?",
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
              label: voiceEnabled ? timezone.formatForVoice(a.startsAt) : timezone.formatForConfirmation(a.startsAt),
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
        const reason =
          maintenanceHandoffReason ??
          classification.handoffReason ??
          "Lead solicitou atendimento humano";
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
        // Guard de ambiguidade tem precedência sobre a escolha da LLM: termo
        // genérico → nenhum tratamento único, todas as variações apresentadas.
        const priceIdentifiedTreatment = ambiguousTreatmentOverride
          ? null
          : classification.slotPreference.identifiedTreatment ?? null;
        // Gap: lead perguntou preço de tratamento não cadastrado
        if (priceIdentifiedTreatment) {
          const matchedInCatalog = clinicTreatments.find(
            (t) => t.name.toLowerCase() === priceIdentifiedTreatment.toLowerCase() ||
              (t.aliases ?? []).some((a) => a.toLowerCase() === priceIdentifiedTreatment.toLowerCase()),
          );
          if (!matchedInCatalog) {
            maybeLogTreatmentGap(
              clinicId,
              conversation.id,
              lead.name,
              priceIdentifiedTreatment,
              messageText,
            ).catch((e) => console.warn("[TreatmentGap] Falhou ao salvar gap:", e));
          }
        }
        replyText = await compose({
          type: "price_inquiry",
          identifiedTreatment: priceIdentifiedTreatment,
          ambiguousTreatmentMatches:
            ambiguousTreatmentOverride ??
            classification.slotPreference.ambiguousTreatmentMatches ??
            null,
        });
        break;
      }

      // ── Saudação ──
      // Lead reiniciou a conversa: respeita a experiência configurada.
      case "greeting": {
        if (experience === "menu_first") {
          const salutation = getDayGreeting(timezone);
          const nameGreeting = extractFirstName(lead.name) ? `, ${extractFirstName(lead.name)}` : "";
          replyText = `${salutation}${nameGreeting}! ${buildMenuBody(clinic, "reoffer", experience)}`;
          await this.stateMachine.offerMenu(conversation.id);
        } else {
          const greetingText = buildConciergeStarter(clinic, timezone, lead.name);

          // Se a saudação também menciona um tratamento com pipeline, inicia o
          // pipeline imediatamente e entrega saudação + primeiro step juntos.
          const greetingTreatment = !pipelineState
            ? resolveDirectTreatmentMention(messageText, clinicTreatments)
            : null;

          if (greetingTreatment?.pipelineSteps?.length) {
            const firstActive = nextActivePipelineStep(greetingTreatment.pipelineSteps, 0);
            if (firstActive) {
              await this.stateMachine.startTreatmentPipeline(
                conversation.id,
                greetingTreatment.id,
                greetingTreatment.name,
                clinic.staleConversationHours * 60,
              );
              if (firstActive.step.type === "content") {
                const pipelineParts = buildPipelineContentParts(firstActive.step.blocks);
                const pipelineText = pipelineParts
                  .filter((p): p is { type: "text"; content: string } => p.type === "text")
                  .map((p) => p.content)
                  .join("\n\n");
                // Saudação como primeiro bloco de texto, seguido do conteúdo do pipeline
                composedParts = [{ type: "text", content: greetingText }, ...pipelineParts];
                composedMediaIds = pipelineParts
                  .filter((p): p is { type: "media"; id: string } => p.type === "media")
                  .map((p) => p.id);
                replyText = pipelineText ? `${greetingText}\n\n${pipelineText}` : greetingText;
                const next = nextActivePipelineStep(greetingTreatment.pipelineSteps!, firstActive.index + 1);
                pendingPipelineAdvance = next
                  ? { action: "advance", nextStepIndex: next.index }
                  : { action: "exit" };
                break;
              }
              // Para step type "qa": saudação normal — pipeline ativo aguarda próxima msg
            }
          }

          replyText = greetingText;
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
        let triggerPartsOverride: ResponsePart[] | null = null;
        const directProcedureCatalogRequested = !menuResolution && !procedureSelection && isProcedureCatalogRequest(messageText);
        const directLocationRequested = !menuResolution && !procedureSelection && isLocationRequest(messageText);
        const menuGeneralSubtype = menuResolution?.intent === "general_question" ? menuResolution.subtype : null;

        // ── Pipeline continuação ──
        // Se há pipeline ativo, ele tem prioridade sobre a lógica normal de contexto.
        // Isso garante que durante Q&A a instrução do passo seja usada mesmo quando
        // o lead não menciona o nome do tratamento na mensagem.
        if (pipelineState && !procedureSelection) {
          const pipelineTreatment = clinicTreatments.find(t => t.id === pipelineState.treatmentId) ?? null;
          const currentStep = pipelineTreatment?.pipelineSteps?.[pipelineState.stepIndex];

          if (currentStep?.type === "qa" && pipelineTreatment) {
            const maxTurns = currentStep.maxTurns ?? 10;
            const optionalPhotoStep = pipelineTreatment.pipelineSteps?.find(
              (step, index): step is Extract<PipelineStep, { type: "photo" }> =>
                index > pipelineState.stepIndex && step.type === "photo" && !step.required,
            );
            await this.stateMachine.incrementPipelineQaTurns(conversation.id);
            if (pipelineState.qaTurns + 1 >= maxTurns) {
              const next = nextActivePipelineStep(
                pipelineTreatment.pipelineSteps!,
                pipelineState.stepIndex + 1,
                { skipOptionalPhoto: true },
              );
              if (next) await this.stateMachine.advancePipelineStep(conversation.id, next.index);
              else await this.stateMachine.exitTreatmentPipeline(conversation.id);
            }
            clinicContext = [
              `Lead está em conversa consultiva sobre "${pipelineTreatment.name}".`,
              currentStep.instruction ?? null,
              optionalPhotoStep
                ? `CONVITE OPCIONAL: se fizer sentido dentro da dúvida atual ou se o lead demonstrar abertura, convide de forma leve e não obrigatória usando esta mensagem como base: "${optionalPhotoStep.message}". Faça esse convite no máximo uma vez e nunca como exigência para continuar.`
                : null,
              pipelineTreatment.description ? `Descrição do tratamento: ${pipelineTreatment.description}` : null,
              editorial?.commercialPolicy ? `Política comercial: ${editorial.commercialPolicy}` : null,
            ].filter(Boolean).join("\n");
            replyText = await compose({ type: "general_question", clinicContext });
            break;
          }

          if (currentStep?.type === "photo") {
            if (!currentStep.required && pipelineTreatment) {
              // Lead enviou texto em vez de foto (foto é opcional) → avança para disponibilidade
              const next = nextActivePipelineStep(pipelineTreatment.pipelineSteps!, pipelineState.stepIndex + 1);
              if (next) await this.stateMachine.advancePipelineStep(conversation.id, next.index);
              else await this.stateMachine.exitTreatmentPipeline(conversation.id);
              // Deixa o fluxo normal de intent assumir a resposta para este turno
              break;
            }
            replyText = currentStep.message;
            break;
          }
        }
        // ── Fim pipeline continuação ──

        const informationalTreatment = resolveInformationalTreatmentTarget({
          message: messageText,
          treatments: clinicTreatments,
          lastAgentMessage: lastAgentMessage?.body ?? null,
          procedureSelection,
          identifiedTreatment: classification.slotPreference.identifiedTreatment ?? null,
        });

        // Gap: LLM identificou um tratamento na mensagem mas ele não existe no catálogo.
        // Registra para exibição como insight operacional no Inbox da clínica.
        if (!informationalTreatment && classification.slotPreference.identifiedTreatment) {
          maybeLogTreatmentGap(
            clinicId,
            conversation.id,
            lead.name,
            classification.slotPreference.identifiedTreatment,
            messageText,
          ).catch((e) => console.warn("[TreatmentGap] Falhou ao salvar gap:", e));
        }

        if (informationalTreatment) {
          const matchedTreatment = informationalTreatment;
          const selectedTreatment = procedureSelection
            ? findTreatmentByIdOrName(clinicTreatments, {
                treatmentId: procedureSelection.treatmentId,
                treatmentName: procedureSelection.name,
              })
            : null;

          // ── Pipeline start ──
          // Tratamento com pipeline configurado: inicia o pipeline pelo step "content".
          // Se o primeiro step ativo não for content (ex: começa com qa), entrega diretamente.
          if (matchedTreatment.pipelineSteps?.length && !pipelineState) {
            const firstActive = nextActivePipelineStep(matchedTreatment.pipelineSteps, 0);
            if (firstActive) {
              await this.stateMachine.startTreatmentPipeline(
                conversation.id,
                matchedTreatment.id,
                matchedTreatment.name,
                clinic.staleConversationHours * 60,
              );
              if (firstActive.step.type === "content") {
                const parts = buildPipelineContentParts(firstActive.step.blocks);
                triggerPartsOverride = parts;
                composedParts = parts;
                composedMediaIds = parts
                  .filter((p): p is { type: "media"; id: string } => p.type === "media")
                  .map((p) => p.id);
                replyText = parts
                  .filter((p): p is { type: "text"; content: string } => p.type === "text")
                  .map((p) => p.content)
                  .join("\n\n");
                clinicContext = "";
                // Adia o avanço para depois do envio — ver declaração de pendingPipelineAdvance
                const next = nextActivePipelineStep(matchedTreatment.pipelineSteps!, firstActive.index + 1);
                pendingPipelineAdvance = next
                  ? { action: "advance", nextStepIndex: next.index }
                  : { action: "exit" };
                break;
              } else if (firstActive.step.type === "qa") {
                clinicContext = [
                  `Lead está em conversa consultiva sobre "${matchedTreatment.name}".`,
                  firstActive.step.instruction ?? null,
                  matchedTreatment.description ? `Descrição do tratamento: ${matchedTreatment.description}` : null,
                  editorial?.commercialPolicy ? `Política comercial: ${editorial.commercialPolicy}` : null,
                ].filter(Boolean).join("\n");
                replyText = await compose({ type: "general_question", clinicContext });
                break;
              }
            }
          }
          // ── Fim pipeline start ──

          if (selectedTreatment && procedureSelection) {
            clinicContext = buildSelectedTreatmentContext(procedureSelection, editorial?.commercialPolicy ?? null, experience);
          } else {
            // Item 5 (config ownership): `pipelineSteps` é o ÚNICO mecanismo estruturado
            // de trigger (tratado acima). Os caminhos legados `treatments.triggerTemplate`
            // e "TRIGGER FORMAT nas notes" foram removidos — sem uso em produção. Tratamento
            // casado sem pipeline usa a composição normal da IA.
            clinicContext = buildDirectTreatmentContext(matchedTreatment, editorial?.commercialPolicy ?? null, experience);
          }
        } else if (procedureSelection) {
          clinicContext = buildSelectedTreatmentContext(procedureSelection, editorial?.commercialPolicy ?? null, experience);
        } else if (menuResolution?.intent === "general_question" || directProcedureCatalogRequested || directLocationRequested) {
          if (menuGeneralSubtype === "procedures") {
            // Menu item com treatmentKeyword → tenta disparar pipeline do tratamento
            const menuTreatmentKeyword = menuResolution?.intent === "general_question" && menuResolution.subtype === "procedures"
              ? menuResolution.treatmentKeyword
              : undefined;
            if (menuTreatmentKeyword && !pipelineState) {
              const keywordNorm = normalizeFreeText(menuTreatmentKeyword);
              const keywordTreatment = clinicTreatments.find((t) => {
                const tNorm = normalizeFreeText(t.name);
                return tNorm.includes(keywordNorm) || keywordNorm.includes(tNorm) ||
                  (t.aliases ?? []).some((a) => normalizeFreeText(a).includes(keywordNorm));
              });
              if (keywordTreatment?.pipelineSteps?.length) {
                const firstActive = nextActivePipelineStep(keywordTreatment.pipelineSteps, 0);
                if (firstActive) {
                  await this.stateMachine.startTreatmentPipeline(
                    conversation.id, keywordTreatment.id, keywordTreatment.name, clinic.staleConversationHours * 60,
                  );
                  if (firstActive.step.type === "content") {
                    const parts = buildPipelineContentParts(firstActive.step.blocks);
                    triggerPartsOverride = parts;
                    composedParts = parts;
                    composedMediaIds = parts.filter((p): p is { type: "media"; id: string } => p.type === "media").map((p) => p.id);
                    replyText = parts.filter((p): p is { type: "text"; content: string } => p.type === "text").map((p) => p.content).join("\n\n");
                    clinicContext = "";
                    const next = nextActivePipelineStep(keywordTreatment.pipelineSteps!, firstActive.index + 1);
                    pendingPipelineAdvance = next
                      ? { action: "advance", nextStepIndex: next.index }
                      : { action: "exit" };
                    break;
                  }
                }
              }
            }
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
          // Mensagem sem tratamento explícito — tenta inferir tratamento em discussão
          // da última mensagem do agente (ex: "pode ser os vídeos" após explicação de lentes).
          // Não inicia pipeline; só enriquece o contexto do compose() com instruções de mídia.
          const contextualTreatment = inferTreatmentContextFromHistory({
            message: messageText,
            treatments: clinicTreatments,
            lastAgentMessage: lastAgentMessage?.body ?? null,
          });
          if (contextualTreatment) {
            console.log(`[Orchestrator] Tratamento inferido do histórico para contexto LLM: "${contextualTreatment.name}" (${contextualTreatment.id})`);
            clinicContext = buildDirectTreatmentContext(contextualTreatment, editorial?.commercialPolicy ?? null, experience);
          } else {
            // Fallback: contexto mínimo — commercialPolicy já está no system prompt via buildSystemPrompt
            clinicContext = `${clinic.name} — ${clinic.specialty}.`;
          }
        }
        if (!triggerPartsOverride) {
          replyText = await compose({ type: "general_question", clinicContext });
        }
        if ((menuGeneralSubtype === "procedures" || directProcedureCatalogRequested) && clinicTreatments.length > 0) {
          await this.stateMachine.offerProcedureList(conversation.id, clinicTreatments);
        }
        break;
      }

      // ── Unclear / Default ──
      case "unclear":
      default: {
        // Pipeline ativo: lead mandou algo confuso durante Q&A → mantém contexto do pipeline
        if (pipelineState) {
          const pipelineTreatment = clinicTreatments.find(t => t.id === pipelineState.treatmentId) ?? null;
          const currentStep = pipelineTreatment?.pipelineSteps?.[pipelineState.stepIndex];
          if (currentStep?.type === "qa" && pipelineTreatment) {
            const clinicContext = [
              `Lead está em conversa consultiva sobre "${pipelineTreatment.name}".`,
              currentStep.instruction ?? null,
              pipelineTreatment.description ? `Descrição do tratamento: ${pipelineTreatment.description}` : null,
              editorial?.commercialPolicy ? `Política comercial: ${editorial.commercialPolicy}` : null,
            ].filter(Boolean).join("\n");
            replyText = await compose({ type: "general_question", clinicContext });
            break;
          }
        }
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
      const hitThreshold = newCount === clinic.unclearThreshold;
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

    // Guard: nenhum branch montou resposta e não há mídia a entregar. Sem isso,
    // uma mensagem vazia seria salva e enviada silenciosamente (Z-API rejeita e
    // o lead fica sem resposta). O throw aciona o fallback determinístico do catch.
    if (!replyText.trim() && !composedParts.some((p) => p.type === "media")) {
      throw new Error(`replyText vazio para intent=${intent} — nenhum branch montou resposta`);
    }

    const hasInterleavedMedia =
      !voiceEnabled && composedParts.some((p) => p.type === "media");

    const deliveryLog = createLogger({
      scope: "OutboundDelivery",
      correlationId: messageId,
      clinicId,
      conversationId: conversation.id,
    });
    const outboundParts = hasInterleavedMedia
      ? resolveOutboundParts(composedParts, editorial?.mediaLibrary, deliveryLog)
      : [];

    // ── 9. Persiste resposta e outbox antes do envio técnico ──
    const agentMessageId = randomUUID();
    const agentSentAt = new Date();
    await this.conversationRepo.appendMessage(
      buildInitialAgentMessage({
        id: agentMessageId,
        conversationId: conversation.id,
        replyText,
        sentAt: agentSentAt,
        intent: intent ?? null,
        hasInterleavedMedia,
        outboundParts,
      }),
    );

    const mediaParts =
      !hasInterleavedMedia && composedMediaIds.length > 0 && editorial?.mediaLibrary
        ? resolveOutboundParts(
            composedParts.filter((part) => part.type === "media"),
            editorial.mediaLibrary,
            deliveryLog,
          )
        : [];
    await this.enqueueConversationReply(clinicId, conversation.id, {
      version: 1,
      kind: "conversation_reply",
      to: outboundAddress,
      agentMessageId,
      replyText,
      intent: intent ?? null,
      useVoice: forceTextOnlyReply ? false : resolveVoiceForReply(intent, replyText),
      ttsConfig: ttsConf,
      interleavedParts: hasInterleavedMedia ? outboundParts : [],
      mediaParts,
      leadId: lead.id,
      pipelineAdvance: pendingPipelineAdvance,
    });

    // ── 9.4 Push notification — avisa operadores que um lead enviou mensagem ──
    const leadDisplayName = lead.name ?? phone;
    await this.notifier
      .execute(clinicId, {
        title: leadDisplayName,
        body: messageText.slice(0, 100),
        url: `/app/inbox/${conversation.id}`,
      })
      .catch((err) => console.error("[Orchestrator] Push falhou:", err));

    // ── 11. Registra custo do LLM (classifier + composer) ──
    if (composerInputTokens > 0) {
      await usageCostTracker.trackAiUsage({
        clinicId,
        provider: "openai",
        model: composerModel,
        operation: "sales_conversation_analysis",
        inputTokens: composerInputTokens,
        outputTokens: composerOutputTokens,
      });
    }

    return { replied: true };

    } catch (err) {
      console.error("[Orchestrator] Falha no processamento:", err);
      // Persistir o fallback antes de entregar evita recomputar a conversa em retry técnico.
      try {
        const fallback = "Ops, tive um problema técnico por aqui. Pode tentar novamente? 🙏";
        const fallbackAgentId = randomUUID();
        await this.conversationRepo.appendMessage({
          id: fallbackAgentId,
          conversationId: conversation.id,
          author: "agent",
          body: fallback,
          sentAt: new Date(),
          externalId: null,
          intent: null,
        });
        await this.enqueueConversationReply(clinicId, conversation.id, {
          version: 1,
          kind: "conversation_reply",
          to: outboundAddress,
          agentMessageId: fallbackAgentId,
          replyText: fallback,
          intent: null,
          useVoice: false,
          ttsConfig: ttsConf,
          interleavedParts: [],
          mediaParts: [],
          leadId: lead.id,
          pipelineAdvance: null,
        });
      } catch (fallbackErr) {
        console.error("[Orchestrator] Fallback não foi persistido:", fallbackErr);
      }
      return { replied: false };
    }

    } finally {
      await this.releaseConversationClaim(conversation.id);
    }
  }

  private async enqueueConversationReply(
    clinicId: string,
    conversationId: string,
    payload: ConversationOutboundPayload,
  ): Promise<void> {
    await enqueueOutboundMessage(
      {
        clinicId,
        conversationId,
        channel: "whatsapp",
        payload,
        deliveryKind: "text",
        dedupeKey: `agent-message:${payload.agentMessageId}`,
      },
      {
        outboundMessageStore: new DrizzleOutboundMessageStore(),
        jobQueue: new DrizzleJobQueue(),
      },
    );
  }

  // ── Claim de processamento por conversa (CAS single-statement) ──────────────

  private async acquireConversationClaim(conversationId: string, ttlMs = 90_000): Promise<boolean> {
    const now = new Date();
    const rows = await db
      .update(conversationsTable)
      .set({ processingUntil: new Date(now.getTime() + ttlMs) })
      .where(
        and(
          eq(conversationsTable.id, conversationId),
          or(
            isNull(conversationsTable.processingUntil),
            lt(conversationsTable.processingUntil, now),
          ),
        ),
      )
      .returning({ id: conversationsTable.id });
    return rows.length > 0;
  }

  // Espera o detentor atual liberar (ou o TTL de 90s expirar em caso de crash).
  private async waitForConversationClaim(
    conversationId: string,
    maxWaitMs = 45_000,
    pollMs = 2_000,
  ): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      if (await this.acquireConversationClaim(conversationId)) return true;
    }
    return false;
  }

  private async releaseConversationClaim(conversationId: string): Promise<void> {
    try {
      await db
        .update(conversationsTable)
        .set({ processingUntil: null })
        .where(eq(conversationsTable.id, conversationId));
    } catch (err) {
      // Não-crítico: o TTL de 90s expira o claim sozinho.
      console.warn(`[Orchestrator] Falha ao liberar claim de ${conversationId}:`, err);
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
    clinic: Organization,
    calendarGateway: CalendarGateway,
    timezone: ClinicTimezone,
    businessHours: ReturnType<typeof parseBusinessHours>,
    preferredDate?: string,
    preferredPeriod?: string,
    preferredTime?: string,
    treatmentName?: string,
    slotDurationMinutes?: number,
    _voiceEnabled?: boolean,
  ): Promise<{ slots: FormattedSlot[]; preferredDayEmpty: boolean; outsideBookingWindow: boolean; outsideBusinessHours: boolean; preferredPeriodUnavailable: boolean }> {
    void _voiceEnabled;
    const from = this.slotWindowStart();
    const to = new Date(from.getTime() + clinic.slotLookaheadDays * 24 * 60 * 60_000);
    const duration = slotDurationMinutes ?? clinic.defaultAppointmentDurationMinutes;

    let allSlots = await calendarGateway.listAvailableSlots({
      clinicId: clinic.id,
      from,
      to,
      slotDurationMinutes: duration,
    });

    // Remove slots que conflitam com appointments locais (inclui blocos sintéticos de E2E
    // que não existem no Google Calendar e appointments reais como defesa contra lag da API).
    // Inclui "confirmed" porque appointments confirmados via fluxo D-1 também bloqueiam o slot.
    const localAppointments = await db
      .select({ startsAt: appointmentsTable.startsAt, endsAt: appointmentsTable.endsAt })
      .from(appointmentsTable)
      .where(
        and(
          eq(appointmentsTable.clinicId, clinic.id),
          inArray(appointmentsTable.status, ["scheduled", "confirmed"]),
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
    let targetDayParts: LocalDateParts | null = null;

    if (preferredDate) {
      const now = new Date();
      const targetDay = timezone.resolvePreferredDate(preferredDate, now, businessHours);
      if (targetDay !== null) {
        if (targetDay > to) {
          return { slots: [], preferredDayEmpty: false, outsideBookingWindow: true, outsideBusinessHours: false, preferredPeriodUnavailable: false };
        }
        const targetParts = timezone.toLocalParts(targetDay);
        targetDayParts = targetParts;
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

    // ── Correção de falso negativo de grade ──
    // Quando o lead pede um dia + horário específicos (ex: "terça às 15h") e esse
    // instante exato não apareceu entre os candidatos gerados, não assumimos que
    // está ocupado: verificamos a disponibilidade real daquele instante antes de
    // dizer "não temos". Cobre o caso em que a duração do slot não divide 60min
    // e a grade pula horários redondos que na verdade estão livres.
    if (preferredTime && targetDayParts) {
      const exactSlot = await resolveExactRequestedSlot({
        calendarGateway,
        clinicId: clinic.id,
        dayParts: targetDayParts,
        preferredTime,
        businessHours,
        timezone,
        durationMinutes: duration,
        windowStart: from,
        windowEnd: to,
        localAppointments,
        postAppointmentBufferMinutes: clinic.postAppointmentBufferMinutes ?? 0,
      });
      if (exactSlot) {
        // Reforça a invariante "filteredToDay=true ⇒ allSlots só contém o dia pedido":
        // se chegamos aqui vindo do ramo preferredDayEmpty, allSlots ainda é o pool
        // multi-dia completo (mantido como alternativas) — sem este filtro, o slot
        // exato injetado conviveria com ofertas de OUTROS dias na mesma resposta.
        const dayOnly = allSlots.filter((s) => {
          const p = timezone.toLocalParts(s.startsAt);
          return p.year === targetDayParts!.year && p.month === targetDayParts!.month && p.day === targetDayParts!.day;
        });
        const alreadyPresent = dayOnly.some((s) => s.startsAt.getTime() === exactSlot.startsAt.getTime());
        allSlots = alreadyPresent ? dayOnly : [exactSlot, ...dayOnly];
        filteredToDay = true;
        preferredDayEmpty = false;
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
        // Filtra para slots dentro de uma janela de 2h a partir do horário pedido.
        // Sem isso, selectBestSlots usa round-robin por período (manhã/tarde) e inclui
        // slots de manhã mesmo quando o lead pediu explicitamente um horário da tarde.
        const windowEnd = Math.min(preferredHour + 2, businessHours.endHour - 1);
        const inWindow = allSlots.filter((s) => {
          const h = timezone.toLocalParts(s.startsAt).hour;
          return h >= preferredHour! && h <= windowEnd;
        });
        if (inWindow.length >= 2) allSlots = inWindow;
      }
    }

    const count = (filteredToDay && preferredTime)
      ? SLOTS_WITH_DATE_AND_TIME
      : filteredToDay
      ? SLOTS_WITH_DATE_ONLY
      : clinic.maxSlotsToOffer;

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

    const slots = await this.stateMachine.offerSlots(conversationId, best, timezone, treatmentName, duration, clinic.slotOfferTtlMinutes, false);
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
    clinic: Organization,
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
