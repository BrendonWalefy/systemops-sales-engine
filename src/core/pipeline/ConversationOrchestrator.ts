// Coração do sistema: coordena todo o fluxo de uma mensagem inbound.
// Substitui a lógica de orquestração espalhada no zapi/route.ts.
//
// Fluxo: mensagem → deduplicação → lead/conversa → intent → ação → resposta

import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db/client";
import { organizations, conversations as conversationsTable, leads as leadsTable, messages as messagesTable, appointments as appointmentsTable, treatmentGapReports, mediaAssets, humanReviewRequests, slotReservations } from "@/infrastructure/db/schema";
import { resolveSegmentVocab } from "@/application/onboarding/segment-vocab";
import { eq, and, or, count, gt, gte, lt, inArray } from "drizzle-orm";
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
import { sendTextMessage, sendMediaMessage, sendButtonListMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import { resolveChannelConfig, type ClinicChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { fetchAndPersistLeadPhoto } from "@/infrastructure/adapters/channels/whatsapp/lead-photo-service";
import { createLogger, type Logger } from "@/infrastructure/logging/logger";
import { ttsConfigFromVoice, DEFAULT_TTS_CONFIG, TTS_SPEED_DEFAULTS, type TtsConfig } from "@/domain/entities/tts-config";
import type {
  VoiceElevenLabsConfig,
  VoiceTtsConfig,
  ConciergeModeConfig,
  ConciergeVerbosity,
} from "@/application/modules/module-configs";
import { shouldUseBWaveForMessage, type VoiceMode } from "@/domain/entities/voice-mode";
import { VercelBlobStorageGateway } from "@/infrastructure/adapters/storage/vercel-blob-storage-gateway";

import { ClinicTimezone, parseBusinessHours, getTimeGreeting } from "@/core/scheduling/ClinicTimezone";
import type { LocalDateParts, ParsedBusinessHours } from "@/core/scheduling/ClinicTimezone";
import { ConversationStateMachine, SLOT_OFFER_TTL_MINUTES } from "@/core/conversation/ConversationStateMachine";
import { IntentClassifier, type IntentType, type SlotPreference } from "@/core/intelligence/IntentClassifier";
import type {
  ActionResult,
  ComposerInput,
  ResponsePart,
} from "@/core/intelligence/ResponseComposer";
import {
  ConversationResponsePlanner,
  type PlannedResponse,
} from "@/core/conversation/ConversationResponsePlanner";
import type { BuildResponsePlanInput } from "@/core/conversation/response-plan";
import { TurnSafetyHandoffGuard } from "@/core/conversation/TurnSafetyHandoffGuard";
import { buildPromptContext } from "@/core/intelligence/PromptContextBuilder";
import { inferReceptionistNameFromGreeting } from "@/core/intelligence/receptionist-name";
import { resolveQuantityPriceQuery, extractQuantity } from "@/core/intelligence/quantity-price";
import { extractReferencedPrice } from "@/core/intelligence/price-reference";
import {
  detectAtypicalClinicalCase,
  detectCommercialPauseText,
  detectExistingWorkProblem,
  detectOldPriceObjection,
  detectSelfDeclaredPastWork,
} from "@/core/intelligence/objection-triage";
import {
  composeWarrantySection,
  resolveActiveEditorialConfig,
  type WarrantyPolicy,
} from "@/application/config/editorial-config";
import { getActivePriceCampaignsByTreatment, resolveEffectivePrice } from "@/application/config/price-campaigns";
import { BookingService } from "@/core/scheduling/BookingService";
import { SlotReservationService } from "@/core/scheduling/SlotReservationService";
import {
  buildAppointmentConfirmationMessage,
  buildDepositRequestMessage,
  buildDepositProofReceivedMessage,
  buildDepositProofMissingMessage,
} from "@/core/conversation/DepositTemplates";
import { buildAddressAnswer } from "@/core/conversation/AddressBlock";
import { selectBestSlots } from "@/core/scheduling/SlotEngine";
import { resolveTreatmentDuration } from "@/core/scheduling/resolveTreatmentDuration";
import type {
  FormattedSlot,
  TreatmentPipelinePayload,
} from "@/core/conversation/ConversationStateMachine";
import type { PipelineStep } from "@/domain/entities/treatment";
import { NotifyClinicOperators } from "@/application/use-cases/notifications/notify-clinic-operators";
import { isSalesConversationCategory } from "@/domain/value-objects/conversation-category";
import { DrizzlePushSubscriptionRepository } from "@/infrastructure/repositories/drizzle-push-subscription-repository";
import { WebPushGateway } from "@/infrastructure/adapters/push/web-push-gateway";
import { getClinicModules } from "@/application/modules/module-gate";
import { resolveStopContactDecision } from "@/application/channel-safety/stop-contact-policy";

import type { Organization, MenuItem, MenuItemIntent } from "@/domain/entities/clinic";
import type { ConversationExperience } from "@/domain/entities/clinic";
import type { Conversation, Message } from "@/domain/entities/conversation";
import type { Lead } from "@/domain/entities/lead";
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
import { DrizzleHumanReviewRequestRepository } from "@/infrastructure/repositories/drizzle-human-review-request-repository";
import { DrizzleConversationTurnLeaseStore } from "@/infrastructure/repositories/drizzle-conversation-turn-lease-store";
import { ConversationTurnCoordinator } from "@/core/pipeline/ConversationTurnCoordinator";
import { buildForwardedMediaFileName } from "@/application/conversations/forwarded-media-file-name";
import {
  buildHumanReviewButtons,
  buildHumanReviewContextUpdateMessage,
  buildHumanReviewPendingLeadMessage,
  buildHumanReviewFollowUpAckMessage,
  buildHumanReviewRequestMessage,
  type HumanReviewDecision,
} from "@/domain/entities/human-review";
import {
  buildDepositProofButtons,
  buildDepositProofReviewRequestMessage,
  nextAvailableDepositProofReviewCode,
} from "@/application/conversations/deposit-proof-review";
import {
  noopDecisionTraceSink,
  recordDeterministicDecisionTraceCompletion,
  recordDecisionTrace,
  type DeterministicDecisionTraceCompletion,
  type DecisionTraceSink,
} from "@/core/observability/DecisionTrace";
import {
  fingerprintRuntimeConfig,
  RUNTIME_CONFIG_FINGERPRINT_SCHEMA,
} from "@/application/config/runtime-config-fingerprint";
import { NamedDecisionOverrideTracker } from "@/core/observability/NamedDecisionOverride";
import { runtimeNow } from "@/core/time/RuntimeClock";
import {
  matchesHumanReviewPipelineContext,
  resolvePipelineMediaRoute,
} from "@/core/pipeline/PipelineMediaRouter";
import { resolvePipelineQaMaxTurns } from "@/core/pipeline/PipelineLimits";
import {
  buildAlignedResponseMediaProjection, buildAnswerFirstPipelineContent,
  buildDeferredPipelineAnswerContext, buildDirectTreatmentContext, buildEvaluationDepositClarification,
  buildInstallmentTable, buildLocationClinicContext, buildMediaClarificationClinicContext,
  buildPipelineContentParts, buildPipelineContentReply, buildSelectedTreatmentContext,
  buildSocialProfileClinicContext, canAppendQaFollowUpContent, collectCurrentLeadBurstBodies,
  collectMediaIds, collectPreviousAgentTurnBodies, contextualizeReplyWhileAwaitingDeposit,
  filterMediaLibraryForComposer, formatBrl, hasAgentRequestedPhoto, hasAnyKeyword,
  hasPipelineContentStepBeenSent, isAffirmativeReplyToOpenOffer, isClinicalTreatmentPlanJudgmentRequest,
  isEvaluationPriceRequest, isGenericTreatmentInterestMessage, isPipelinePhotoInstructionContentStep,
  isRemotePreEvaluationRequest, isShortAffirmativeReply, isShowcaseRequestText, isValidMediaAssetId,
  mergeDeliveryMediaLibrary, nextActivePipelineStep, nextUnsentPipelineContentStep, normalizeFreeText,
  pickShowcaseMedia, resolveOutboundParts, shouldSuppressNextStepCta,
  stripPriceProseWhenSystemQuoted,
  type DeliveryMediaLibraryItem, type InstallmentRate,
} from "@/core/conversation/conversation-response-parts";

export {
  buildAlignedResponseMediaProjection, buildAnswerFirstPipelineContent, buildDeferredPipelineAnswerContext,
  buildDirectTreatmentContext, buildEvaluationDepositClarification, buildInstallmentTable,
  buildLocationClinicContext, buildMediaClarificationClinicContext, buildSelectedTreatmentContext,
  calculateFlatInstallment, canAppendQaFollowUpContent, collectCurrentLeadBurstBodies,
  collectPreviousAgentTurnBodies, contextualizeReplyWhileAwaitingDeposit, filterMediaLibraryForComposer,
  filterMediaLibraryForTreatment, hasAgentRequestedPhoto, hasPipelineContentStepBeenSent,
  isAestheticTreatment, isAffirmativeReplyToOpenOffer, isClinicalTreatmentPlanJudgmentRequest,
  isEvaluationPriceRequest, isGenericTreatmentInterestMessage, isPipelinePhotoInstructionContentStep,
  isRemotePreEvaluationRequest, isShortAffirmativeReply, isShowcaseRequestText, isValidMediaAssetId,
  mergeDeliveryMediaLibrary, nextActivePipelineStep, pickShowcaseMedia, resolveOutboundParts,
  shouldSuppressNextStepCta, stripPriceProseWhenSystemQuoted,
  trimAnswerToBridge, type InstallmentRate,
} from "@/core/conversation/conversation-response-parts";

// ── Menu resolution ──────────────────────────────────────────────────────────

type MenuResolution =
  | { intent: "book_appointment" }
  | { intent: "price_inquiry" }
  | { intent: "needs_human" }
  | { intent: "general_question"; subtype: "procedures"; treatmentKeyword?: string }
  | { intent: "general_question"; subtype: "location" };

type ConversationDeterministicTraceCompletion = Omit<
  DeterministicDecisionTraceCompletion,
  "turnId" | "clinicId" | "conversationId" | "state"
>;

const RESPONSE_PLAN_ATTENTION_REASON = "Resposta segura requer revisão humana";

export function resolveResponseMaxCharacters(
  verbosity: ConciergeVerbosity | undefined,
): number {
  if (verbosity === "concisa") return 280;
  if (verbosity === "detalhada") return 1_200;
  return 600;
}

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

// `extractFirstName` mudou para `core/intelligence/lead-display-name` para que o
// ResponseComposer possa aplicá-lo sem importar o orquestrador. Reexportado aqui
// porque é a origem histórica do símbolo e vários caminhos já o importam daqui.
export { extractFirstName };

// A9 — Detecta reenvio idêntico do lead: mesma mensagem (≥ minChars) já enviada antes,
// dentro da janela, e que JÁ recebeu resposta do agente. Casos reais: duplo clique no
// anúncio CTWA reenvia o mesmo texto-template horas depois. Retorna a mensagem anterior
// casada (para logging/contexto) ou null. Pura para testabilidade — o Orchestrator a usa
// apenas quando não há pipeline ativo (com pipeline, a 2ª msg dispara o conteúdo deferido).
export function findLeadMessageRepeat(params: {
  currentBody: string;
  history: Pick<Message, "author" | "body" | "sentAt">[];
  now: number;
  minChars?: number;
  windowMs?: number;
}): Pick<Message, "author" | "body" | "sentAt"> | null {
  const minChars = params.minChars ?? 20;
  const windowMs = params.windowMs ?? 24 * 3600_000;
  const body = params.currentBody.trim();
  if (body.length < minChars) return null;

  const leadMsgs = params.history.filter((m) => m.author === "lead");
  // A última mensagem do lead no histórico é a atual — comparamos com as anteriores.
  const prior = leadMsgs.slice(0, -1).find((m) => m.body.trim() === body);
  if (!prior) return null;

  const withinWindow = params.now - prior.sentAt.getTime() < windowMs;
  const gotReplyAfter = params.history.some(
    (m) => m.author === "agent" && m.sentAt > prior.sentAt,
  );
  return withinWindow && gotReplyAfter ? prior : null;
}

// Click-to-WhatsApp pode entregar o criativo do anúncio em um webhook separado
// da mensagem escrita pelo lead. Nesse caso a imagem chega como
// "[imagem recebida]" e o texto comercial fica na mensagem anterior. Não é
// possível tratá-la como foto clínica sem antes considerar essa proximidade.
const AD_MEDIA_PLACEHOLDER_RE = /^\[(?:imagem|v[ií]deo) recebid[oa]\]$/i;
const AD_CAPTION_RE = /^(venho|vim|chego|cheguei|chegando|cliquei|vi\s+o?\s*(anúncio|anuncio|post|vídeo|video|reels?|story|stories)|olá|ola|oi|posso|gostaria|queria|me\s+passa)/i;
const AD_MEDIA_BURST_WINDOW_MS = 2 * 60 * 1000;

/**
 * Janela de agrupamento de mensagens do lead, quando a clínica não define a sua.
 *
 * Rajada (2+ mensagens do lead em sequência) é comportamento do canal, não política
 * de clínica: o gap MEDIANO dentro de uma rajada é de 10s tanto na Vitalli quanto na
 * Ximendes, com distribuições quase idênticas (n=1.174). Por isso o default é da
 * plataforma; a coluna por clínica fica como exceção, não como regra.
 *
 * O valor 15s vem da cobertura medida em produção:
 *   7s  → agrupa ~40% dos pares da rajada
 *   15s → agrupa ~67%
 *   30s → agrupa ~85%
 *
 * Não sobe além disso porque o debounce atrasa o início do processamento. Na prática
 * o custo é pequeno: a mensagem já espera o tick do message-worker (até 60s), então a
 * janela costuma ser absorvida por essa espera.
 *
 * Antes este número era `?? 5000` repetido em 4 pontos do arquivo — default global de
 * fato, mas duplicado e sem origem documentada.
 */
import { shouldDiscardComposedReply } from "@/core/pipeline/composed-reply-supersession";
import { resolveMessageDebounceMs } from "@/core/pipeline/message-debounce";
import { extractFirstName } from "@/core/intelligence/lead-display-name";
import { buildComposerTelemetryMetadata } from "@/core/conversation/composer-telemetry";
import { buildTurnFailureReport } from "@/core/pipeline/turn-failure-report";
export { DEFAULT_MESSAGE_DEBOUNCE_MS } from "@/core/pipeline/message-debounce";

// Fallback quando a clínica não tem conversationRestartHours definido.
// 24h cobre o padrão real do WhatsApp: o gap p90 entre mensagens consecutivas do
// mesmo lead é de 17h (n=3.183, amostra histórica).
export const DEFAULT_CONVERSATION_RESTART_HOURS = 24;

/**
 * O lead sumiu tempo suficiente para a conversa recomeçar do zero (saudação de
 * abertura em vez de continuidade)?
 *
 * Compara o gap entre as DUAS ÚLTIMAS mensagens do lead — a atual já está em
 * `leadMessages`, então o antecessor é o penúltimo item.
 *
 * Usa `conversationRestartHours`, NUNCA `staleConversationHours`: aquele campo é o
 * TTL do pipeline de tratamento. Enquanto os dois eram o mesmo valor, a janela de
 * reinício herdava 4h (Vitalli) / 6h (Ximendes) e 17,2% das respostas de lead
 * caíam como "conversa nova" — o lead recebia a saudação no meio do atendimento.
 */
export function shouldRestartConversation(params: {
  leadMessages: { sentAt: Date }[];
  now: Date;
  restartHours?: number | null;
}): boolean {
  const { leadMessages, now, restartHours } = params;
  // Menos de 2 mensagens do lead = não há gap anterior para medir.
  if (leadMessages.length < 2) return false;
  const previous = leadMessages[leadMessages.length - 2];
  const gapHours = (now.getTime() - new Date(previous.sentAt).getTime()) / (1000 * 60 * 60);
  const threshold = restartHours ?? DEFAULT_CONVERSATION_RESTART_HOURS;
  return gapHours >= threshold;
}

export function resolveAdMediaContext(params: {
  currentMessageId: string;
  currentMessageText: string;
  // T2 (caso Barbara): a proteção contra tratar criativo como foto clínica não
  // é "o agente já respondeu" (o lead encaminha o criativo DEPOIS da saudação o
  // tempo todo) — é "o agente já pediu foto". Antes do pedido, mídia colada num
  // opener de anúncio em conversa jovem ainda é criativo.
  agentRequestedPhoto: boolean;
  totalConversationMessages: number;
  history: Pick<Message, "id" | "author" | "body" | "sentAt">[];
  now: number;
}): { isAdMedia: boolean; contextText: string | null } {
  if (params.agentRequestedPhoto || params.totalConversationMessages > 5) {
    return { isAdMedia: false, contextText: null };
  }

  const currentText = params.currentMessageText.trim();
  const currentCaption = AD_MEDIA_PLACEHOLDER_RE.test(currentText) ? "" : currentText;
  if (AD_CAPTION_RE.test(currentCaption)) {
    return { isAdMedia: true, contextText: currentCaption };
  }

  const previousLeadMessage = [...params.history]
    .reverse()
    .find((message) => message.author === "lead" && message.id !== params.currentMessageId);
  if (!previousLeadMessage) return { isAdMedia: false, contextText: null };

  const elapsedMs = Math.abs(params.now - previousLeadMessage.sentAt.getTime());
  const previousText = previousLeadMessage.body.trim();
  const isSeparatedAdBurst =
    AD_MEDIA_PLACEHOLDER_RE.test(currentText) &&
    elapsedMs <= AD_MEDIA_BURST_WINDOW_MS &&
    AD_CAPTION_RE.test(previousText);

  return isSeparatedAdBurst
    ? { isAdMedia: true, contextText: previousText }
    : { isAdMedia: false, contextText: null };
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

/**
 * Um reconhecimento do lead pode ser o fechamento natural do Q&A, não uma
 * despedida. Só ofertamos agenda quando o pipeline já passou pela foto ou
 * está explicitamente na etapa de disponibilidade.
 */
export function shouldOfferSlotsAfterPipelinePhoto(
  currentStepType: PipelineStep["type"] | null,
  photoReceived: boolean,
): boolean {
  return currentStepType === "ask_availability" ||
    (currentStepType === "photo" && photoReceived);
}

export function shouldSendConciergeStarter(experience: ConversationExperience, intent: IntentType): boolean {
  if (experience !== "concierge") return false;
  return intent === "greeting" || intent === "acknowledgment" || intent === "unclear";
}

export function buildConciergeStarter(
  clinic: Organization,
  timezone: ClinicTimezone,
  leadName?: string | null,
  receptionistName?: string | null,
): string {
  const salutation = getDayGreeting(timezone);
  const firstName = extractFirstName(leadName);
  const nameGreeting = firstName ? `, ${firstName}` : "";

  // greetingMessage é o opener curado da clínica — quando existe, ele é o corpo do
  // starter (a clínica é dona do próprio tom, não um template genérico). A persona
  // nunca se apresenta como "assistente virtual": o atendimento fala como a equipe.
  const custom = clinic.greetingMessage?.trim();
  if (custom) {
    if (/^(bom\s*dia|boa\s*tarde|boa\s*noite)/i.test(custom)) {
      // Já abre com saudação temporal própria — usa verbatim para não duplicar.
      return custom;
    }
    return `${salutation}${nameGreeting}! ${stripGreetingPrefix(custom)}`;
  }

  const persona =
    receptionistName ?? inferReceptionistNameFromGreeting(clinic.greetingMessage);
  const intro = persona
    ? `Sou a ${persona}, da ${clinic.name}.`
    : `Aqui é a equipe da ${clinic.name}.`;

  return `${salutation}${nameGreeting}. Tudo bem?\n\n${intro} Me conta o que você gostaria de ver hoje: valores, agendamento ou algum serviço específico?`;
}

export function isRepeatedConversationalReply(
  previous: string | null | undefined,
  candidate: string,
): boolean {
  if (!previous?.trim() || !candidate.trim()) return false;
  return normalizeFreeText(previous) === normalizeFreeText(candidate);
}

export function buildConversationReentryAcknowledgment(message: string): string {
  const normalized = normalizeFreeText(message);
  if (normalized.startsWith("bom dia")) return "Bom dia! 😊";
  if (normalized.startsWith("boa tarde")) return "Boa tarde! 😊";
  if (normalized.startsWith("boa noite")) return "Boa noite! 😊";
  return "Oi! 😊";
}

// Remove uma saudação redundante que a própria LLM tenha aberto no texto (apesar da
// instrução em ResponseComposer.ts para não fazer isso quando isFirstMessage=true) —
// defesa de profundidade: não depender só do prompt, mesmo que ele já peça pra LLM
// não se auto-saudar. O pipeline de tratamento nunca abre com saudação (texto fixo do
// playbook), então isto é um no-op seguro para esse caminho.
// Contempla nome do lead intercalado entre a saudação e a pontuação (ex: "Boa noite,
// Ariana! ...") — sem o grupo de nome opcional, "Boa noite, Ariana!" não batia e a
// saudação da LLM sobrevivia ao lado da saudação canônica prependada (bug P0.7).
const LEADING_GREETING_RE = /^(bom\s*dia|boa\s*tarde|boa\s*noite|ol[áa]|oi)\s*,?\s*([A-ZÀ-Ú][\wà-úÀ-Ú']*\s*)?[!,.]+\s*/i;

function stripLeadingGreeting(text: string): string {
  const stripped = text.replace(LEADING_GREETING_RE, "").trimStart();
  if (stripped.length === 0) return text;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

// Prefixa a saudação temporal (Bom dia/Boa tarde/Boa noite [, nome]) no primeiro bloco
// de texto da resposta. Usado quando isFirstMessage=true para intents que NÃO são
// greeting/acknowledgment/unclear (esses já ganham abertura própria via
// buildConciergeStarter/shouldShowInitialMenu, antes do switch principal) — cobre o
// pipeline de tratamento e a resposta geral da LLM, que hoje entregam o conteúdo "seco"
// direto ao ponto quando a primeira mensagem do lead já vem com uma pergunta real.
export function prependFirstMessageSalutation(
  parts: ResponsePart[],
  timezone: ClinicTimezone,
  leadName?: string | null,
): ResponsePart[] {
  const salutation = getDayGreeting(timezone);
  const nameGreeting = extractFirstName(leadName) ? `, ${extractFirstName(leadName)}` : "";
  const opener = `${salutation}${nameGreeting}!`;

  if (parts.length === 0) return [{ type: "text", content: opener }];

  // Strip em TODOS os parts de texto, não só no primeiro: quando a LLM quebra a
  // resposta em múltiplos parágrafos/parts, ela às vezes reabre com saudação em
  // mais de um deles (contra a instrução do prompt) — sem isso, só a saudação do
  // primeiro part era removida e a dos parts seguintes sobrevivia ao lado da
  // saudação canônica prependada (bug P0.7, ex: "Boa noite, Ariana!" duplicado).
  const [first, ...rest] = parts;
  const cleanedRest = rest.map((part) =>
    part.type === "text" ? { ...part, content: stripLeadingGreeting(part.content) } : part,
  );

  if (first.type === "text") {
    const body = stripLeadingGreeting(first.content);
    return [{ type: "text", content: `${opener} ${body}`.trim() }, ...cleanedRest];
  }
  return [{ type: "text", content: opener }, first, ...cleanedRest];
}

/**
 * Saudação RICA de primeira mensagem para quando um pipeline de CONTEÚDO dispara
 * (ex.: lead abre com "quero saber das lentes"). É o DONO ÚNICO da saudação nesse
 * caminho.
 *
 * Por que existe separada de `prependFirstMessageSalutation`: o caminho de pipeline
 * de conteúdo monta as `parts` a partir dos blocos do playbook e NÃO passa pelo
 * ResponseComposer — então o `deduplicateGreetings` do composer nunca roda nele.
 * Antes, esse caminho chamava `prependFirstMessageSalutation` ("Boa noite, X!") E
 * ainda recebia este prefixo rico ("Boa noite, X. Tudo bem? Sou a assistente...")
 * depois do switch: as duas saudações se somavam (bug P0.7 reaparecendo só no
 * pipeline). Agora o pipeline de conteúdo entrega os blocos crus e esta função é a
 * única a saudar.
 *
 * Defensivo: limpa qualquer saudação que o primeiro bloco de texto já traga
 * (`stripLeadingGreeting`), para nunca duplicar mesmo se um bloco for mal configurado.
 */
export function prependPipelineIntroGreeting(
  parts: ResponsePart[],
  timezone: ClinicTimezone,
  clinicName: string,
  leadName: string | null,
  receptionistName: string | null,
): ResponsePart[] {
  const salutation = getDayGreeting(timezone);
  const firstName = extractFirstName(leadName);
  const nameGreeting = firstName ? `, ${firstName}` : "";
  const intro = receptionistName
    ? `Sou a ${receptionistName}, da ${clinicName}.`
    : `Aqui é a equipe da ${clinicName}.`;
  const greetingPrefix = `${salutation}${nameGreeting}. Tudo bem?\n${intro}\n\n`;

  const firstTextIdx = parts.findIndex((p) => p.type === "text");
  // Se a apresentação começa por mídia, prefixar o primeiro texto sem
  // reposicioná-lo fazia o lead receber vídeos antes de qualquer contexto. Em
  // rajadas, a saudação anterior é corretamente descartada pelo debounce e
  // esse bug ficava visível. A introdução é um part próprio antes da mídia;
  // o bloco canônico vídeo→vídeo→preços permanece intacto em seguida.
  if (firstTextIdx !== 0) {
    return [
      { type: "text", content: greetingPrefix.trimEnd() },
      ...parts,
    ];
  }
  return parts.map((part, i) =>
    i === firstTextIdx && part.type === "text"
      ? { type: "text", content: greetingPrefix + stripLeadingGreeting(part.content) }
      : part,
  );
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
  if (isLocationRequestText(n))
    return { intent: "general_question", subtype: "location" };
  if (n.includes("especialista") || n.includes("dentista") || n.includes("doutor") || n.includes("medico") || n.includes("medica") || n === "dr")
    return { intent: "needs_human" };

  return null;
}

function isLocationRequest(message: string): boolean {
  return isLocationRequestText(normalizeFreeText(message));
}

export function isSocialProfileRequest(message: string): boolean {
  const n = normalizeFreeText(message);
  return hasAnyKeyword(n, ["instagram", "instagran", "insta", "arroba", "rede social", "redes sociais"]);
}

export function isMediaClarificationRequest(message: string): boolean {
  const n = normalizeFreeText(message);
  const hasMediaReference = hasAnyKeyword(n, ["foto", "imagem", "card", "dessa", "desse", "essa", "esse"]);
  const hasTechniqueReference = hasAnyKeyword(n, ["premium", "premio", "estratificada", "qual"]);
  return hasMediaReference && hasTechniqueReference;
}

export function shouldBypassPendingPipelineContent(message: string): boolean {
  return isLocationRequest(message) || isSocialProfileRequest(message) || isMediaClarificationRequest(message);
}

export function extractSocialProfileInfo(...sources: (string | null | undefined)[]): string | null {
  const text = sources.filter(Boolean).join("\n");
  if (!text.trim()) return null;

  const instagramUrl = text.match(/https?:\/\/(?:www\.)?instagram\.com\/[a-z0-9._]+\/?/i)?.[0];
  if (instagramUrl) return instagramUrl.replace(/[),.;:!?]+$/, "");

  const normalized = normalizeFreeText(text);
  if (!isSocialProfileRequest(normalized)) return null;

  for (const line of text.split(/\r?\n/)) {
    if (!isSocialProfileRequest(line)) continue;
    const handle = line.match(/(^|[\s:])(@[a-z0-9._]+)/i)?.[2];
    if (handle) return handle.replace(/[),.;:!?]+$/, "");
  }

  return null;
}

// W3.3 (caso Henrique 19/07): "Tenho dúvidas sobre o procedimento" despejava o
// catálogo de 26 itens numa conversa que era sobre lentes. Referência definida
// no singular fala do assunto em discussão; catálogo só com intenção de navegar.
export function isProcedureCatalogRequest(message: string): boolean {
  const n = normalizeFreeText(message);
  if (!/\b(?:procedimentos?|tratamentos?|servicos?|opcoes)\b/.test(n)) return false;
  const wantsCatalog =
    /\b(?:quais|lista|listar|todos|todas|outros|outras|opcoes|menu|catalogo)\b/.test(n) ||
    /\b(?:procedimentos|tratamentos|servicos)\b/.test(n) ||
    /\b(?:um|algum|alguma)\s+(?:procedimento|tratamento|servico)\b/.test(n);
  const definiteSingular =
    /\b(?:o|do|no|desse|deste|esse|este)\s+(?:procedimento|tratamento|servico)\b/.test(n);
  return wantsCatalog && !definiteSingular;
}


// Anexo determinístico de mídia num step "qa": retorna o mediaId da primeira
// entrada cujas palavras-chave casam com a mensagem (já normalizada) do lead.
// Ver PipelineStep qa.mediaOnKeywords.
export function matchMediaOnKeywords(
  entries: { keywords: string[]; mediaId: string }[] | undefined,
  normalizedMessage: string,
): string | null {
  if (!entries?.length) return null;
  for (const entry of entries) {
    if (hasAnyKeyword(normalizedMessage, entry.keywords)) return entry.mediaId;
  }
  return null;
}

export function isSchedulingRequestText(normalized: string): boolean {
  return hasAnyKeyword(normalized, [
    "agendar",
    "agenda",
    "marcar",
    "horario",
    "reservar",
    "reserva",
    "consulta",
    "remarcar",
    "cancelar",
  ]);
}

export function shouldResumeManualTakeoverForScheduling(
  message: string,
  takeoverExpiresAt: Date | null | undefined,
): boolean {
  if (takeoverExpiresAt) return false;
  return isSchedulingRequestText(normalizeFreeText(message));
}

function isPriceRequestText(normalized: string): boolean {
  return hasAnyKeyword(normalized, ["valor", "preco", "quanto", "custa", "custo", "pagamento", "parcela"]);
}

export function isSimplePaymentPolicyQuestion(message: string): boolean {
  const normalized = normalizeFreeText(message);
  if (!normalized) return false;
  const asksPaymentPolicy = hasAnyKeyword(normalized, [
    "parcela",
    "parcelado",
    "parcelamento",
    "cartao",
    "credito",
    "debito",
    "pix",
    "pagamento",
  ]);
  if (!asksPaymentPolicy) return false;

  return !hasAnyKeyword(normalized, [
    "diferente",
    "especial",
    "desconto",
    "negociar",
    "negocia",
    "condicao especial",
    "fora",
    "excecao",
    "combinado",
    "promocao",
    "permuta",
    "troca",
  ]);
}

export function isBusinessHoursQuestion(message: string): boolean {
  const raw = normalizeFreeText(message);
  if (!raw) return false;

  // Saudação NÃO é pergunta de expediente. "bom dia/boa tarde/boa noite" fazia
  // "dia/tarde/noite" casarem como período do dia — falso positivo clássico com
  // "Bom dia, como funciona o orçamento?" (caso SP/ZN 23/07, lead querendo iniciar
  // tratamento recebeu o texto de horário). Removemos SÓ a saudação; "atendem à
  // tarde?" continua valendo (o "tarde" ali não é saudação).
  const normalized = raw
    .replace(/\bbo[ma]\s+(dia|tarde|noite|madrugada)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;

  // "como funciona o X" pergunta o PROCESSO (orçamento, pagamento, tratamento),
  // não o horário. Nesse padrão, "funciona" não conta como sinal de expediente —
  // exige um verbo real de atendimento (atende/abre/horario/expediente/funcionamento).
  const asksHowItWorks = /\bcomo funciona/.test(normalized);
  // O stem "funciona" é ambíguo e casa por substring, então quem decide é o
  // SUJEITO: "a clínica funciona de manhã" pergunta expediente, "o aparelho
  // funciona bem" e "tenho uma operação funcionANDO" não. Sem sujeito de
  // negócio explícito, só valem as formas que já são institucionais por si —
  // "funcionam" (2ª pessoa) e "funcionamento" (substantivo). Caso real
  // SystemOps 13/08: a dor do lead ("operação funcionando... durante o dia")
  // virou tabela de horário.
  const hasBusinessSubject = hasAnyKeyword(normalized, [
    "clinica",
    "consultorio",
    "voces",
    "vcs",
  ]);
  const ambiguousOperatingVerbs = hasBusinessSubject ? ["funciona"] : [];
  const operatingVerbs = asksHowItWorks
    ? ["atende", "atendem", "atendimento", "abrem", "abre", "horario", "expediente", "funcionamento"]
    : [
        "atende", "atendem", "atendimento", "abrem", "abre", "horario", "expediente",
        "funcionamento", "funcionam", ...ambiguousOperatingVerbs,
      ];

  const hasExplicitDate = extractExplicitPreferredDateFromText(message) !== null;
  const explicitlyAsksOperatingHours = hasAnyKeyword(
    normalized,
    asksHowItWorks
      ? ["funcionamento", "abrem", "abre", "expediente"]
      : ["funcionam", "funcionamento", "abrem", "abre", "expediente", ...ambiguousOperatingVerbs],
  );
  // Uma data concreta acompanhada de "horário" é uma consulta de
  // disponibilidade, não uma pergunta institucional. Caso Tatiana (19/07):
  // "Me agenda ... dia 8/8 se tiver horário" não pode cair no texto de
  // funcionamento da clínica.
  if (hasExplicitDate && !explicitlyAsksOperatingHours) return false;
  const asksAttendance =
    hasAnyKeyword(normalized, operatingVerbs) &&
    hasAnyKeyword(normalized, ["sabado", "domingo", "semana", "dia", "dias", "manha", "tarde", "noite", "horario", "expediente"]);
  return asksAttendance && !hasAnyKeyword(normalized, [
    "agenda",
    "agende",
    "agendamento",
    "agendar",
    "marcar",
    "reservar",
    "consulta",
    "vaga",
  ]);
}

/**
 * Horário que o lead pediu quando ele está NEGOCIANDO disponibilidade, não
 * perguntando o expediente: "posso ir após as 18h", "só consigo antes das 9h",
 * "atendem depois das 19:30?".
 *
 * Devolve a hora em minutos desde a meia-noite, ou null quando a mensagem não
 * traz esse tipo de pedido.
 */
export function extractRequestedTimeBoundary(message: string): { minutes: number; direction: "after" | "before" } | null {
  // Deliberadamente NÃO usa normalizeFreeText: ele troca pontuação por espaço, e
  // "19:30" viraria "19 30" — o minuto se perderia. Aqui só acentos são removidos.
  const text = message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // O artigo é opcional e vem com ou sem "d": "após AS 18h" (caso real 19/07),
  // "depois DAS 19:30", "a partir DE 18h", "apos 18h".
  const ARTICLE = String.raw`(?:d?[ao]s?\s+)?`;
  const TIME = String.raw`(\d{1,2})(?:\s*[h:]\s*(\d{2}))?`;

  const after = text.match(new RegExp(String.raw`(?:apos|depois|a partir)\s+${ARTICLE}${TIME}`));
  if (after) {
    return { minutes: Number(after[1]) * 60 + Number(after[2] ?? 0), direction: "after" };
  }
  const before = text.match(new RegExp(String.raw`(?:antes|ate)\s+${ARTICLE}${TIME}`));
  if (before) {
    return { minutes: Number(before[1]) * 60 + Number(before[2] ?? 0), direction: "before" };
  }
  return null;
}

/**
 * O horário pedido cai FORA da janela de atendimento?
 *
 * "após as 18h" com expediente até 18h → fora. "após as 14h" → dentro.
 */
export function isRequestedTimeOutsideBusinessHours(
  boundary: { minutes: number; direction: "after" | "before" },
  hours: ParsedBusinessHours,
): boolean {
  const openMinutes = hours.startHour * 60 + hours.startMinute;
  const closeMinutes = hours.endHour * 60 + hours.endMinute;
  return boundary.direction === "after"
    ? boundary.minutes >= closeMinutes
    : boundary.minutes <= openMinutes;
}

/**
 * A resposta de horário vai prometer verificação com a equipe?
 *
 * Existe para o orquestrador sinalizar `needsAttention` no mesmo caso em que o
 * texto promete retorno — promessa sem escalação é pior do que uma recusa clara.
 */
/**
 * A mensagem é uma QUANTIDADE que continua a pergunta de preço anterior?
 *
 * Rajada comum: o lead manda "qual o valor pra tirar?" e, logo depois, "tenho 13
 * lentes". Isolada, a segunda parece um comentário genérico — o classificador a
 * lê como `acknowledgment` ou `general_question` e a cotação se perde.
 *
 * Medido em produção: **3 de 6** continuações de quantidade após pergunta de preço
 * caíam fora de `price_inquiry` ("Tem 13 lentes" → acknowledgment; "Das 20 lente" →
 * general_question). O sistema mantém o assunto sem depender de a LLM reconstruir
 * essa relação — regra determinística, como manda o AGENTS.md.
 */
export function isQuantityFollowupToPriceQuestion(params: {
  message: string;
  incomingMessageId: string;
  history: { id: string; author: string; body: string }[];
}): boolean {
  if (extractQuantity(params.message) === null) return false;
  const previousLeadMessage = [...params.history]
    .reverse()
    .find((m) => m.author === "lead" && m.id !== params.incomingMessageId);
  if (!previousLeadMessage) return false;
  return isPriceRequestText(normalizeFreeText(previousLeadMessage.body));
}

export function requiresTeamCheckForHours(
  message: string,
  businessHoursRaw: string | null,
  outsideHoursExceptionEnabled = false,
): boolean {
  if (!outsideHoursExceptionEnabled) return false;
  const boundary = extractRequestedTimeBoundary(message);
  if (!boundary) return false;
  return isRequestedTimeOutsideBusinessHours(boundary, parseBusinessHours(businessHoursRaw));
}

export function buildBusinessHoursAnswer(
  businessHoursRaw: string | null,
  message: string,
  outsideHoursExceptionEnabled = false,
): string {
  const normalized = normalizeFreeText(message);
  const businessHours = parseBusinessHours(businessHoursRaw);
  const hoursText = businessHoursRaw?.trim() || "Segunda a sexta, das 8h às 18h";
  const asksSaturday = normalized.includes("sabado");
  const asksSunday = normalized.includes("domingo");

  const boundary = extractRequestedTimeBoundary(message);
  if (boundary && isRequestedTimeOutsideBusinessHours(boundary, businessHours)) {
    const limite = boundary.direction === "after"
      ? `Nosso horário padrão vai até ${businessHours.endHour}h`
      : `Nosso horário padrão começa às ${businessHours.startHour}h`;
    if (outsideHoursExceptionEnabled) {
      return `${limite}. Esta clínica permite solicitar uma análise de exceção; vou verificar com a equipe e já te retorno.`;
    }
    return `${limite}. Posso te ajudar a encontrar uma opção dentro do nosso horário de atendimento: ${hoursText}.`;
  }

  // Sábado/domingo: responde pelo que está CADASTRADO. Não consulta a agenda real
  // A resposta certa é olhar a
  // disponibilidade do dia, não só a configuração.
  if (asksSaturday) {
    if (businessHours.days.includes(6)) {
      return `Sim, atendemos aos sábados. Horário cadastrado: ${hoursText}.`;
    }
    return outsideHoursExceptionEnabled
      ? `Pelo horário cadastrado, atendemos ${hoursText}. Sábado não consta na agenda padrão; vou verificar com a equipe se existe uma exceção disponível.`
      : `Pelo horário cadastrado, atendemos ${hoursText}. Sábado não consta na agenda padrão.`;
  }

  if (asksSunday) {
    if (businessHours.days.includes(0)) {
      return `Sim, atendemos aos domingos. Horário cadastrado: ${hoursText}.`;
    }
    return outsideHoursExceptionEnabled
      ? `Pelo horário cadastrado, atendemos ${hoursText}. Domingo não consta na agenda padrão; vou verificar com a equipe se existe uma exceção disponível.`
      : `Pelo horário cadastrado, atendemos ${hoursText}. Domingo não consta na agenda padrão.`;
  }

  return `Nosso horário de atendimento é: ${hoursText}.`;
}

/**
 * A pergunta é sobre SÁBADO numa clínica que atende no sábado?
 *
 * Existe por causa de uma inconsistência gramatical com efeito comercial: no
 * singular ("Sábado. Atende?") `extractExplicitPreferredDateFromText` casa
 * `\bsabado\b`, `isBusinessHoursQuestion` devolve false e a mensagem segue para
 * o caminho de agendamento — que consulta a agenda real. No plural ("Vocês
 * atendem aos sábados?") o `\bsabado\b` não casa com "sabados", a mensagem cai
 * no ramo institucional e morre em "Sim, atendemos aos sábados." Duas respostas
 * opostas para a mesma pergunta, medidas em produção na Vitalli com um dia de
 * diferença (18/07 ofertou horários reais, 19/07 recitou o cadastro).
 *
 * **Só sábado, de propósito.** `parseBusinessHours` é o único juiz de quais dias
 * a clínica opera, e ele só decide o sábado: segunda a sexta é assumido sempre,
 * domingo nunca é representável. Na NC Beauty o cadastro diz "Terça a sexta" e o
 * parser devolve [1..6] — afirmar "Sim, atendemos às segundas!" ali seria
 * inventar. Enquanto o parser não souber o resto da semana, o sistema não
 * afirma o que não sabe. Ver item #19 do plano de correção.
 *
 * Sábado fora da escala não passa por aqui: já tem tratamento próprio (escala
 * para a equipe avaliar exceção — ver item #5).
 */
export function isSaturdayQuestionForOperatingClinic(
  message: string,
  hours: ParsedBusinessHours,
): boolean {
  const normalized = normalizeFreeText(message);
  if (!normalized) return false;
  return /\bsabados?\b/.test(normalized) && hours.days.includes(6);
}

/**
 * Confirma o dia e emenda a disponibilidade REAL — o que o operador da Vitalli
 * faz à mão ("Próximo horário disponível no sábado seria 01.08 às 8:00 tudo
 * bem?"). Confirmar sem ofertar é beco sem saída: quem pergunta pelo sábado
 * quer vir no sábado.
 *
 * `dayIsFull` = o dia está na escala mas sem vaga na janela; os slots são
 * alternativas de outros dias, e a frase precisa dizer isso para não parecer
 * que a IA ignorou o pedido.
 */
export function buildSaturdayAvailabilityAnswer(params: {
  slots: { index: number; label: string }[];
  dayIsFull: boolean;
}): string {
  const { slots, dayIsFull } = params;
  const opening = dayIsFull
    ? "Atendemos aos sábados, mas as vagas mais próximas já foram preenchidas. Consigo estes horários:"
    : "Sim, atendemos aos sábados! Tenho estes horários:";
  return [
    opening,
    ...slots.map((slot) => `${slot.index}. ${slot.label}`),
    "",
    "Responda apenas com o número da opção que prefere.",
  ].join("\n");
}

// Mais estrito que isLocationRequest: durante a pausa de revisão clínica, "onde"/
// "fica" soltos são ambíguos (ex.: "onde está minha avaliação?") e não devem
// disparar o endereço. Exige intenção explícita de localização.
export function isDirectAddressQuestion(message: string): boolean {
  const n = normalizeFreeText(message);
  if (!n) return false;
  if (hasAnyKeyword(n, ["endereco", "localizacao", "como chego", "como chegar", "maps"])) return true;
  return /\b(?:onde|aonde)\b/.test(n) &&
    /\b(?:fica|ficam|clinica|consultorio|voces)\b/.test(n);
}

// Perguntas factuais 100% seguras que podem ser respondidas por template mesmo
// com a IA pausada aguardando revisão humana da foto (caso Nataly): endereço e
// horário de funcionamento. Não reabre o classificador nem avança o funil — só
// devolve o dado institucional já cadastrado. Retorna null quando a mensagem não
// é uma dessas perguntas seguras.
export function buildSafeReviewPauseAnswer(
  clinic: { address?: string | null; addressComplement?: string | null; mapsUrl?: string | null; businessHours?: string | null },
  message: string,
): string | null {
  if (isBusinessHoursQuestion(message)) {
    return buildBusinessHoursAnswer(clinic.businessHours ?? null, message);
  }
  if (isDirectAddressQuestion(message) && clinic.address?.trim()) {
    return buildAddressAnswer(clinic);
  }
  return null;
}

function isLocationRequestText(normalized: string): boolean {
  return /\b(?:localizacao|endereco|onde|aonde|fica|ficam)\b/.test(normalized);
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

  const score = (treatment: Treatment): number => {
    if (!treatment.keywordMatchEnabled) return -1;

    const treatmentName = normalizeFreeText(treatment.name);
    let result = -1;
    if (treatmentName === normalized) result = Math.max(result, 4_000 + treatmentName.length);
    if (normalized.length >= 4 && treatmentName.includes(normalized)) {
      result = Math.max(result, 3_000 + normalized.length);
    }
    if (treatmentName.length >= 4 && normalized.includes(treatmentName)) {
      result = Math.max(result, 2_000 + treatmentName.length);
    }
    const treatmentNameTokens = new Set(treatmentName.split(/\s+/));
    const matchingTokens = tokens.filter((token) => treatmentNameTokens.has(token));
    if (matchingTokens.length > 0) {
      result = Math.max(
        result,
        100 + matchingTokens.reduce((total, token) => total + token.length, 0),
      );
    }

    const aliases = treatment.aliases ?? [];
    for (const alias of aliases) {
      const normalizedAlias = normalizeFreeText(alias);
      if (normalizedAlias === normalized) {
        result = Math.max(result, 3_500 + normalizedAlias.length);
      } else if (
        normalizedAlias.length > 0 &&
        ` ${normalized} `.includes(` ${normalizedAlias} `)
      ) {
        result = Math.max(result, 1_500 + normalizedAlias.length);
      }
    }
    return result;
  };

  return treatments
    .map((treatment, index) => ({
      treatment,
      index,
      score: score(treatment),
    }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) =>
      b.score - a.score ||
      Number(Boolean(b.treatment.pipelineSteps?.length)) -
        Number(Boolean(a.treatment.pipelineSteps?.length)) ||
      a.index - b.index,
    )[0]?.treatment ?? null;
}

// Enquanto uma revisão clínica está pendente, toda mensagem do lead volta pelo
// mesmo caminho. O aviso completo ("encaminhei ao Doutor, a automação fica
// pausada") é de primeiro contato: se a última fala do agente já foi esse aviso,
// o lead já leu a explicação e o que cabe é um ack curto.
export function shouldSendShortReviewAck(messages: Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.author === "agent") return message.intent === "needs_human";
  }
  return false;
}

// Descarta candidatos que se sobrepõem a uma reserva ativa. Mesma detecção de
// overlap usada por SlotReservationService.reserve() — ofertar um slot que o
// reserve() vai recusar produz o falso "seu horário ficou indisponível" logo
// depois do lead escolher.
export function rejectSlotsOverlappingReservations<T extends { startsAt: Date; endsAt: Date }>(
  slots: T[],
  reservations: { startsAt: Date; endsAt: Date }[],
): T[] {
  if (reservations.length === 0) return slots;
  return slots.filter(
    (slot) =>
      !reservations.some(
        (r) =>
          r.startsAt.getTime() < slot.endsAt.getTime() &&
          r.endsAt.getTime() > slot.startsAt.getTime(),
      ),
  );
}

// Resolve a resposta do lead à lista de horários quando ela vem como dia
// ("segunda"), período ("de manhã") ou hora ("às 9h") em vez do número da opção.
// Sem isso o confirm_slot assumia a opção 1 — "segunda" com a lista
// [1. Seg 9h, 2. Qua 16h] podia confirmar silenciosamente a quarta — e, quando a
// reserva da opção 1 falhava, o lead ouvia o falso "seu horário ficou
// indisponível" mesmo tendo pedido um dia presente na lista.
//
// Retorna "passthrough" sempre que não tiver base para decidir: o chamador
// mantém o comportamento anterior (guarda de data + fallback existentes).
export function resolvePendingSlotChoice(params: {
  slotPreference: SlotPreference;
  // Estrutural de propósito: só precisa do que usa, então FormattedSlot serve sem
  // obrigar os testes a montar campos irrelevantes para a decisão.
  pendingSlots: Array<{ index: number; startsAt: string; label: string }> | null | undefined;
  timezone: ClinicTimezone;
  businessHours: ParsedBusinessHours;
}):
  | { kind: "passthrough" }
  | { kind: "resolved"; index: number }
  | { kind: "ambiguous"; matches: Array<{ index: number; label: string }> }
  | { kind: "no_match" } {
  const { slotPreference, pendingSlots, timezone, businessHours } = params;
  // slotChoice explícito (o lead digitou o número) segue o caminho normal.
  if (slotPreference.slotChoice != null || !pendingSlots?.length) return { kind: "passthrough" };

  const hasDate = Boolean(slotPreference.preferredDate);
  const hasPeriod = Boolean(slotPreference.preferredPeriod);
  const hasTime = Boolean(slotPreference.preferredTime);
  if (!hasDate && !hasPeriod && !hasTime) return { kind: "passthrough" };

  const targetDay = hasDate
    ? timezone.resolvePreferredDate(slotPreference.preferredDate!, runtimeNow(), businessHours)
    : null;
  const targetDayParts = targetDay ? timezone.toLocalParts(targetDay) : null;

  let preferredHour: number | null = null;
  if (hasTime) {
    const hourMatch = slotPreference.preferredTime!.match(/(\d{1,2})/);
    preferredHour = hourMatch ? parseInt(hourMatch[1], 10) : null;
    if (preferredHour !== null) {
      // Normaliza hora ambígua para horário comercial: "às 3" com clínica 8-18 → 15h.
      const pmCandidate = preferredHour + 12;
      if (
        preferredHour < businessHours.startHour &&
        pmCandidate >= businessHours.startHour &&
        pmCandidate < businessHours.endHour
      ) {
        preferredHour = pmCandidate;
      }
    }
  }

  // Nenhum filtro utilizável (ex.: data que não parseia e nada mais) — não decide.
  if (!targetDayParts && !hasPeriod && preferredHour === null) return { kind: "passthrough" };

  const matches = pendingSlots.filter((slot) => {
    const parts = timezone.toLocalParts(new Date(slot.startsAt));
    if (
      targetDayParts &&
      (parts.year !== targetDayParts.year || parts.month !== targetDayParts.month || parts.day !== targetDayParts.day)
    ) {
      return false;
    }
    if (hasPeriod) {
      const period = slotPreference.preferredPeriod;
      if (period === "morning" && parts.hour >= 12) return false;
      if (period === "afternoon" && (parts.hour < 12 || parts.hour >= 18)) return false;
      if (period === "evening" && parts.hour < 18) return false;
    }
    if (preferredHour !== null && parts.hour !== preferredHour) return false;
    return true;
  });

  if (matches.length === 1) return { kind: "resolved", index: matches[0].index };
  if (matches.length > 1) {
    return { kind: "ambiguous", matches: matches.map((m) => ({ index: m.index, label: m.label })) };
  }
  return { kind: "no_match" };
}

export function resolveDirectTreatmentMention(
  message: string,
  treatments: Treatment[],
  lastAgentMessage?: string | null,
): Treatment | null {
  const normalized = normalizeFreeText(message);
  if (!normalized || /^\d+$/.test(normalized)) return null;
  if (normalized.split(/\s+/).length > 8) return null;
  if (
    isSchedulingRequestText(normalized) ||
    isPriceRequestText(normalized) ||
    isLocationRequestText(normalized)
  ) {
    return null;
  }
  if (didAgentAskForProcedure(lastAgentMessage)) return null;
  return matchTreatmentByNormalizedMessage(normalized, treatments, TREATMENT_MENTION_STOPWORDS);
}

export function resolvePipelineTreatmentMention(
  message: string,
  treatments: Treatment[],
): Treatment | null {
  const normalized = normalizeFreeText(message);
  if (!normalized || /^\d+$/.test(normalized)) return null;
  if (
    isSchedulingRequestText(normalized) ||
    isPriceRequestText(normalized) ||
    isLocationRequestText(normalized) ||
    isProcedureCatalogRequestText(normalized)
  ) {
    return null;
  }

  const matched = matchTreatmentByNormalizedMessage(
    normalized,
    treatments,
    TREATMENT_MENTION_STOPWORDS,
  );
  return matched && resolvePipelineSourceTreatment(matched, treatments).pipelineSteps?.length
    ? matched
    : null;
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

export function extractExplicitPreferredDateFromText(message: string): string | null {
  const punctuationPreserved = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  const directDmy = punctuationPreserved.match(/\b(\d{1,2})[.\-\/](\d{1,2})(?:[.\-\/](\d{2,4}))?\b/);
  if (directDmy) {
    return directDmy[3]
      ? `${directDmy[1]}/${directDmy[2]}/${directDmy[3]}`
      : `${directDmy[1]}/${directDmy[2]}`;
  }

  const normalized = normalizeFreeText(message);
  if (!normalized) return null;

  const dayWithMonth = normalized.match(
    /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/,
  );
  if (dayWithMonth) return dayWithMonth[0];

  const dayOnly = normalized.match(/\bdia\s+(\d{1,2})\b/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    if (day >= 1 && day <= 31) return `dia ${day}`;
  }

  const relativeOrWeekday = normalized.match(
    /\b(hoje|amanha|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo)\b/,
  );
  return relativeOrWeekday?.[0] ?? null;
}

function normalizePreferredDateText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const punctuationPreserved = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  const directDmy = punctuationPreserved.match(/^(\d{1,2})[.\-\/](\d{1,2})(?:[.\-\/](\d{2,4}))?$/);
  if (directDmy) {
    return directDmy[3]
      ? `${directDmy[1]}/${directDmy[2]}/${directDmy[3]}`
      : `${directDmy[1]}/${directDmy[2]}`;
  }

  const normalized = normalizeFreeText(raw);
  if (!normalized) return null;

  const dayOnly = normalized.match(/^(\d{1,2})$/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    if (day >= 1 && day <= 31) return `dia ${day}`;
  }

  const dmy = normalized.match(/^(\d{1,2})\s+(\d{1,2})(?:\s+(\d{2,4}))?$/);
  if (dmy) {
    return dmy[3] ? `${dmy[1]}/${dmy[2]}/${dmy[3]}` : `${dmy[1]}/${dmy[2]}`;
  }

  return raw;
}

export function withDeterministicSlotPreferenceFallback(
  message: string,
  slotPreference: SlotPreference,
): SlotPreference {
  const normalizedPreferredDate = normalizePreferredDateText(slotPreference.preferredDate);
  const preferredDate = normalizedPreferredDate ?? extractExplicitPreferredDateFromText(message);
  if (!preferredDate || preferredDate === slotPreference.preferredDate) return slotPreference;
  return { ...slotPreference, preferredDate };
}

export function normalizeSchedulingIntentForMissingPendingOffer(
  intent: IntentType,
  slotPreference: SlotPreference,
  message: string,
  hasPendingOffer: boolean,
  lastAgentMessage?: string | null,
): IntentType {
  const messageHasExplicitDate = extractExplicitPreferredDateFromText(message) !== null;
  const normalized = normalizeFreeText(message);
  const isOnlyOrphanedNumber = /^\d+$/.test(normalized);
  if (
    intent === "confirm_slot" &&
    !hasPendingOffer &&
    !isOnlyOrphanedNumber &&
    isShortAffirmativeReply(normalized) &&
    didAgentAskToShowAvailability(lastAgentMessage)
  ) {
    return "check_availability";
  }
  if (
    intent === "confirm_slot" &&
    !hasPendingOffer &&
    !isOnlyOrphanedNumber &&
    (
      messageHasExplicitDate ||
      slotPreference.preferredDate ||
      slotPreference.preferredPeriod ||
      slotPreference.preferredTime ||
      isSchedulingRequestText(normalized)
    )
  ) {
    return "check_availability";
  }
  return intent;
}


// W4.3 (caso Paula, 19/07): o operador (clinic_user) assume o agendamento
// manualmente — faz a pré-avaliação, avança o lead além da avaliação e oferta um
// horário concreto PARA O PROCEDIMENTO. A IA é cega às mensagens do operador
// (lastAgentMessage só lê author==="agent") e, quando o lead confirma esse
// horário, reverte ao script "avaliação é o primeiro passo", re-ofertando o
// mesmo horário como se fosse avaliação — contradizendo o operador num lead
// quase fechando. Detecta se a ÚLTIMA oferta concreta de horário no histórico
// foi feita pelo operador; nesse caso o booking é gerido por ele e a IA não pode
// sobrepor com sua própria lógica de avaliação.
const CONCRETE_SLOT_TIME_RE = /\b\d{1,2}(?:[:h]\d{2}|\s*h(?:oras?)?)\b/i;
const SLOT_OFFER_CONTEXT_RE =
  /\b(?:horario|horarios|vagou|vaga|disponivel|disponiveis|marcar|agendar|agendamento|reserv|sabado|sab|domingo|segunda|terca|quarta|quinta|sexta|dia)\b/;

function messageOffersConcreteSlot(body: string): boolean {
  if (!CONCRETE_SLOT_TIME_RE.test(body)) return false;
  return SLOT_OFFER_CONTEXT_RE.test(normalizeFreeText(body));
}

// Retorna true se a oferta de horário concreta MAIS RECENTE do histórico partiu
// do operador (clinic_user), não da IA. Se a IA fez a última oferta, o fluxo
// normal (pendingSlots) cuida da confirmação.
export function lastSlotOfferWasByOperator(
  history: Pick<Message, "author" | "body">[],
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.author !== "clinic_user" && m.author !== "agent") continue;
    if (!messageOffersConcreteSlot(m.body)) continue;
    return m.author === "clinic_user";
  }
  return false;
}

export function didAgentAskToShowAvailability(message?: string | null): boolean {
  const normalized = normalizeFreeText(message ?? "");
  if (!normalized) return false;
  const mentionsAvailability =
    normalized.includes("horario") ||
    normalized.includes("horarios") ||
    normalized.includes("agenda") ||
    normalized.includes("agendar");
  const asksPermission =
    normalized.includes("posso ver") ||
    normalized.includes("posso mostrar") ||
    normalized.includes("posso te mostrar") ||
    normalized.includes("posso te mandar") ||
    normalized.includes("quer que eu veja") ||
    normalized.includes("quer ver") ||
    normalized.includes("podemos agendar");
  return mentionsAvailability && asksPermission;
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
  commercialPolicy?: string | null;
}): IntentType {
  const { message, intent, treatments, isClinicSegment, commercialPolicy } = params;
  if (intent !== "greeting" && intent !== "acknowledgment" && intent !== "unclear") return intent;

  const normalized = normalizeFreeText(message);
  if (!normalized) return intent;

  // P0.1: Guard Anti-Saudação — Se a pergunta contém conteúdo de negócio,
  // NUNCA responder com saudação genérica. O sistema decide (determinístico).
  if (isClinicSegment && detectPatientArrivalText(message)) return "patient_arrived";
  // P0.5: Menção ao nome antigo da clínica ou pergunta sobre mudança de
  // endereço precisa ir para general_question (composer). Sem este guard, o
  // intent permanecia "greeting" e shouldShowInitialMenu/shouldSendConciergeStarter
  // capturavam a mensagem ANTES que o contexto de nome antigo (calculado mais
  // adiante no pipeline) tivesse qualquer chance de ser usado — a menção a
  // "Dental Luxe" era completamente ignorada (bug real: 5+ conversas
  // idênticas pós-deploy P0.5, ex: Julie, Thiago, Jeny, Jose Mota).
  if (isClinicNameOrAddressChangeQuestion(normalized, commercialPolicy).isMatch) return "general_question";
  // P0.2: Prioridade — Garantia antes de Manutenção (ambos redirectam para needs_human, mas contexto diferente)
  if (isWarrantyQuestion(normalized)) return "needs_human";
  if (isMaintenanceInquiryText(normalized)) return "needs_human";
  if (isBusinessHoursQuestion(message)) return "general_question";
  if (isPriceRequestText(normalized)) return "price_inquiry";
  if (isSchedulingRequestText(normalized)) return "book_appointment";  // ← P0.1: Novo
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

// P0.2: Detectar pergunta de manutenção (não é novo tratamento, é serviço em já-realizado)
function isMaintenanceInquiryText(normalized: string): boolean {
  return MAINTENANCE_SERVICE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

// P0.2: Detectar pergunta de garantia (cobertura, procedimento recente, etc)
//
// Precisão importa mais aqui do que antes: este detector passou a decidir um trilho
// que responde pela config em qualquer intent. Duas correções em relação à lista
// original de palavras-chave:
//   • "ainda está coberto" e "é grátis" nunca casavam — a comparação é feita contra
//     texto normalizado (sem acento), e as chaves vinham acentuadas.
//   • "cobre" era comparado como substring solta, então "cobrei" e "descobre" também
//     entravam. Sozinho ele é ambíguo ("quanto vocês cobram") — agora só conta perto
//     de algo que indique trabalho já realizado.
const WARRANTY_TERM_RE = /\bgarantias?\b|\bcobertura\b|\bcaiu em garantia\b|\bprocedimento recente\b/;
const WARRANTY_COVERAGE_RE =
  /\b(cobre|coberto|coberta)\b[^.?!]{0,40}\b(procedimento|tratamento|lente|lentes|faceta|facetas|conserto|reparo|troca|refazer)\b/;
const WARRANTY_COVERAGE_REVERSE_RE =
  /\b(procedimento|tratamento|lente|lentes|faceta|facetas)\b[^.?!]{0,40}\b(cobre|coberto|coberta)\b/;

function isWarrantyQuestion(normalized: string): boolean {
  return (
    WARRANTY_TERM_RE.test(normalized) ||
    WARRANTY_COVERAGE_RE.test(normalized) ||
    WARRANTY_COVERAGE_REVERSE_RE.test(normalized)
  );
}

// Palavras vazias que não distinguem uma objeção — ignoradas ao casar a mensagem
// do lead contra os gatilhos cadastrados.
//
// Os verbos de pedido entraram depois de um falso positivo medido: "Posso ver os
// horários de sexta?" casava com a objeção "Posso cancelar ou remarcar meu
// horário?" pela palavra "posso" — 5 letras, logo "forte" pelo critério antigo.
// Enquanto o matcher só rodava no handoff isso ficava contido; qualquer ampliação
// do alcance espalharia a resposta errada.
const OBJECTION_MATCH_STOPWORDS = new Set([
  "as", "os", "um", "uma", "uns", "tem", "têm", "ter", "de", "da", "do", "das",
  "dos", "que", "qual", "quais", "com", "sem", "por", "para", "pra", "voce",
  "voces", "vcs", "meu", "minha", "meus", "minhas", "esse", "essa", "esses",
  "essas", "isso", "aqui", "ainda", "muito", "sobre", "tipo", "como", "quanto",
  "quando", "onde", "ser", "sao", "mas", "nao", "sim", "ele", "ela", "eles",
  // Verbos e pronomes de pedido: aparecem em qualquer pergunta de lead e não
  // dizem nada sobre QUAL objeção é.
  "posso", "podem", "poderia", "pode", "quero", "queria", "gostaria", "preciso",
  "precisa", "consigo", "tenho", "estou", "fazer", "seria", "gostei", "sabia",
  "dessa", "desse", "deste", "desta", "aquele", "aquela", "algum", "alguma",
  "outro", "outra", "mesmo", "mesma", "tambem", "depois", "antes", "agora",
  "entao", "assim", "vezes",
]);

// Substantivos que aparecem em qualquer conversa de clínica e não distinguem
// objeção nenhuma. Mesma ideia dos nomes de tratamento, que já eram descartados:
// "Posso ver os horários de sexta?" não é a objeção "Posso cancelar ou remarcar meu
// horário?" só porque as duas falam de horário. Ficam de fora de propósito palavras
// que REALMENTE distinguem uma objeção quando a clínica a cadastra ("avaliação",
// "sinal", "garantia", "manutenção").
const OBJECTION_GENERIC_DOMAIN_TOKENS = new Set([
  "horario", "agenda", "agendamento", "consulta", "valor", "preco", "atendimento",
  "clinica", "dentista", "doutor", "doutora", "sorriso", "dente",
]);

// Plural simples do português. O lead escreve "Garantias" numa lista de dúvidas
// (caso Adriano, Vitalli 10/07) e o gatilho cadastrado diz "garantia" — sem isso a
// clínica tem a resposta cadastrada e o sistema conclui que não tem. Só para
// tokens longos, onde cortar o "s" final não muda a palavra.
function singularize(token: string): string {
  return token.length >= 6 && token.endsWith("s") ? token.slice(0, -1) : token;
}

// Termos do catálogo que não distinguem objeção: nome E apelidos. Só o nome não
// bastava — o anúncio da Vitalli ("Quero saber como posso transformar meu sorriso
// com facetas de resina?") casava com a objeção "Como funciona a troca de facetas
// antigas por novas?" pela palavra "facetas", que é alias e não nome. Eram 106 dos
// 218 casamentos da clínica no corpus.
export function treatmentTermsForObjectionMatch(
  treatments: Pick<Treatment, "name" | "aliases">[],
): string[] {
  return treatments.flatMap((t) => [t.name, ...(t.aliases ?? [])]);
}

// Casa a mensagem do lead contra as objeções cadastradas pela clínica. Quando a
// clínica cadastra uma objeção (ex.: "…tem garantia e como é a manutenção?") com
// resposta, ela DECIDIU que a IA responde aquilo — este matcher é o que permite
// honrar essa decisão em vez de cair no handoff genérico de "manda foto".
//
// Conservador por construção: só casa por um token DISTINTIVO — uma palavra forte
// (≥5 letras) que aparece no gatilho de UMA única objeção (não em várias) e que
// NÃO é um nome de produto do nicho (ex.: "lentes", "resina" — genéricos, aparecem
// em tudo). Assim "…tem garantia?" casa pela palavra "garantia" (única da objeção
// de garantia), mas "as lentes são boas?" não casa por "lentes". Gatilhos compostos
// (a Vitalli cadastra "Quanto tempo dura? Tem garantia e como é a manutenção?" numa
// linha só) funcionam porque o casamento é por token distintivo, não por proporção.
export function matchRegisteredObjection(
  message: string,
  objections: { objection: string; response: string }[] | null | undefined,
  treatmentTerms: string[] = [],
): { objection: string; response: string } | null {
  if (!objections?.length) return null;
  const msg = normalizeFreeText(message);
  if (!msg) return null;
  const msgTokens = new Set(msg.split(" ").filter((t) => t.length >= 5).map(singularize));
  if (msgTokens.size === 0) return null;

  const valid = objections.filter((o) => o.objection?.trim() && o.response?.trim());
  if (!valid.length) return null;

  // Tokens genéricos do nicho (nomes de tratamento) não distinguem objeção nenhuma.
  const genericTokens = new Set<string>();
  for (const name of treatmentTerms) {
    for (const t of normalizeFreeText(name).split(" ")) {
      if (t.length >= 5) genericTokens.add(singularize(t));
    }
  }

  const trigTokens = valid.map((o) =>
    normalizeFreeText(o.objection)
      .split(" ")
      .filter((t) => t.length >= 5 && !OBJECTION_MATCH_STOPWORDS.has(t))
      .map(singularize)
      .filter((t) => !genericTokens.has(t) && !OBJECTION_GENERIC_DOMAIN_TOKENS.has(t)),
  );
  // Frequência de cada token entre os gatilhos — um token que aparece em 2+ objeções
  // não é distintivo (ex.: "tempo" em "quanto tempo dura" e "o procedimento demora").
  const df = new Map<string, number>();
  for (const tokens of trigTokens) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  let bestObj: { objection: string; response: string } | null = null;
  let bestScore = 0;
  for (let i = 0; i < valid.length; i++) {
    const distinctive = new Set(trigTokens[i].filter((t) => df.get(t) === 1));
    const overlap = [...distinctive].filter((t) => msgTokens.has(t)).length;
    if (overlap >= 1 && overlap > bestScore) {
      bestObj = valid[i];
      bestScore = overlap;
    }
  }
  return bestObj;
}

// Diretiva autoritativa injetada no clinicContext do composer quando uma objeção
// cadastrada casa com a dúvida do lead. Segue o padrão provado do
// atypicalTriageContext: a resposta específica vira o contexto primário, em vez de
// ficar diluída no playbook geral (que a LLM ignorava — bug garantia jul/2026).
function buildObjectionDirectiveContext(matched: { objection: string; response: string }): string {
  return [
    `O lead levantou um ponto que a clínica JÁ respondeu oficialmente (objeção cadastrada: "${matched.objection}").`,
    `RESPONDA usando esta informação da clínica, no seu tom acolhedor, sem alterar o conteúdo nem inventar política diferente:`,
    `"${matched.response}"`,
    `NÃO substitua essa resposta por um pedido de foto nem por "isso depende de avaliação presencial" — a clínica já definiu a resposta acima. Se o lead perguntou mais de uma coisa na mesma mensagem, responda também as outras partes com base nas orientações da clínica.`,
  ].join("\n");
}

// ── Garantia: a resposta é a que a clínica cadastrou ──
// Bug medido: a objeção de garantia da Vitalli está cadastrada desde 07/07 22:04
// ("2 anos caso a lente descole por completo; 30 dias contra pigmentação ou quebra
// por descuido"). Em 18/07 a Giuliana perguntou "tempo de garantia" e recebeu uma
// descrição das técnicas de lente — 11 dias depois de cadastrada. A causa: o
// matcher de objeção só era consultado dentro de `effectiveIntent === "needs_human"`,
// e pergunta de garantia é classificada `general_question` pela LLM. A objeção
// existia apenas como dica solta no bloco "COMO LIDAR COM OBJEÇÕES" do prompt, e a
// LLM passou por cima — o padrão que a casa já resolveu em outros pontos: o sistema
// decide, a LLM verbaliza.
//
// Sem nada cadastrado, a IA NÃO inventa: em 06/07 a Tatiana perguntou o tempo de
// garantia e ouviu "depende do tipo de procedimento… o ideal é passar por uma
// avaliação" — política inventada + pivô comercial. Passa a dizer que confirma com
// a equipe. A Ximendes cai nesse caminho hoje: 11 objeções cadastradas, nenhuma
// sobre garantia.
// A objeção continua valendo como FALLBACK: a Vitalli já tinha a política escrita
// lá, e trocar a fonte não pode derrubar quem já estava configurado. Quando o campo
// estruturado estiver preenchido, ele ganha — é ele que o painel mostra vazio para
// quem ainda não preencheu.
export type WarrantyAnswer =
  | { kind: "registered"; source: "structured" | "objection"; clinicContext: string }
  | { kind: "no_policy"; clinicContext: string };

function buildWarrantyDirectiveContext(section: string): string {
  return [
    `O lead perguntou sobre GARANTIA. A clínica cadastrou esta política no sistema — ela é a fonte:`,
    section,
    `Responda com base nisso, no seu tom acolhedor. NÃO altere prazo nem cobertura e NÃO acrescente regra que não esteja acima.`,
    `NÃO substitua por pedido de foto nem por "isso depende de avaliação presencial", e NÃO conduza para avaliação por causa da garantia.`,
    `Se o lead estiver relatando um problema concreto com o trabalho dele, informe a política e diga que a equipe confirma o caso — quem decide cobertura é a equipe, não você.`,
    `Se ele perguntou outras coisas na mesma mensagem, responda também essas partes com base nas orientações da clínica.`,
  ].join("\n");
}

export function resolveWarrantyAnswer(params: {
  message: string;
  warrantyPolicy: WarrantyPolicy | null | undefined;
  objections: { objection: string; response: string }[] | null | undefined;
  treatmentTerms: string[];
}): WarrantyAnswer | null {
  if (!isWarrantyQuestion(normalizeFreeText(params.message))) return null;

  const structured = composeWarrantySection(params.warrantyPolicy);
  if (structured) {
    return {
      kind: "registered",
      source: "structured",
      clinicContext: buildWarrantyDirectiveContext(structured),
    };
  }

  const registered = matchRegisteredObjection(
    params.message,
    params.objections,
    params.treatmentTerms,
  );
  if (registered) {
    return {
      kind: "registered",
      source: "objection",
      clinicContext: buildObjectionDirectiveContext(registered),
    };
  }

  return {
    kind: "no_policy",
    clinicContext: [
      `O lead perguntou sobre GARANTIA e a clínica NÃO tem política de garantia cadastrada neste sistema.`,
      `NÃO invente prazo, cobertura nem condição. Especificamente: não diga "depende do procedimento", não diga "varia conforme o caso" e não descreva regra nenhuma de garantia — isso é inventar com outras palavras.`,
      `Diga de forma curta e acolhedora que você vai confirmar essa informação com a equipe e já retorna. A equipe já foi avisada em paralelo.`,
      `NÃO peça foto, NÃO ofereça horários, NÃO cote preço de manutenção e NÃO conduza para avaliação por causa da garantia.`,
      `Se o lead perguntou OUTRAS coisas na mesma mensagem (valores, formas de pagamento, material, técnica), responda essas partes normalmente com base nas orientações da clínica — só a parte da garantia fica pendente da equipe. Seja breve.`,
    ].join("\n"),
  };
}

// P0.5: Detectar pergunta sobre nome antigo da clínica ou mudança de endereço
// Extrai nome antigo e endereço anterior da policy/playbook
export function extractPreviousClinicInfo(policy: string | null | undefined): {
  previousClinicName?: string;
  previousAddress?: string;
} {
  if (!policy) return {};
  const clinicNameMatch = policy.match(/(?:éramos?|era|somos?)\s+["']?([^"'.,;!\n?]+?)["']?(?:\s*[,;\n]|$)/i);
  // "ficávamos/ficava" é o padrão usado para descrever o endereço ANTIGO (ex:
  // "Antes ficávamos no bairro Sabará... hoje estamos na Avenida X"). Precisa
  // ser checado ANTES do fallback de "Avenida/Av." — esse fallback captura o
  // PRIMEIRO "Avenida/Av." do texto, que normalmente é o endereço ATUAL, não o
  // antigo (bug real: capturava "Adolfo Pinheiro" — o endereço de hoje — como
  // se fosse o endereço anterior, quando o antigo era "Sabará, próximo a
  // Interlagos").
  const previousAddressMatch = policy.match(/fic[áa]vamos?\s+(?:no|na|em)\s+([^;.\n]+)/i);
  const fallbackAddressMatch = previousAddressMatch
    ? null
    : policy.match(/(?:Avenida|Av\.)\s+([^,;!\n?]+)/i);
  return {
    previousClinicName: clinicNameMatch?.[1]?.trim(),
    previousAddress: (previousAddressMatch ?? fallbackAddressMatch)?.[1]?.trim(),
  };
}

function isClinicNameOrAddressChangeQuestion(normalized: string, policy: string | null | undefined): {
  isMatch: boolean;
  type: "clinic_name" | "address" | null;
} {
  const info = extractPreviousClinicInfo(policy);

  // Menção direta ao nome antigo da clínica já é sinal suficiente — o lead pode
  // só estar repetindo um nome que viu num anúncio/indicação antiga ("queria
  // informações sobre a Dental Luxe"), sem usar nenhuma palavra de "mudança".
  // Exigir uma keyword de mudança aqui fazia essa menção cair como "greeting"
  // genérico e ignorar completamente o nome antigo citado (bug real: Julie,
  // Thiago, Jeny, Jose Mota — 5+ ocorrências idênticas pós-deploy P0.5).
  // `normalized` já passou por normalizeFreeText (sem acento) — o nome antigo
  // extraído da política precisa da mesma normalização, senão nomes com acento
  // nunca bateriam.
  if (info.previousClinicName && normalized.includes(normalizeFreeText(info.previousClinicName))) {
    return { isMatch: true, type: "clinic_name" };
  }

  // Pergunta sobre endereço, essa sim, só faz sentido junto de uma keyword de
  // mudança — "qual o endereço" sozinho não indica que o lead desconfia de uma
  // mudança. Lista inclui "trocaram/trocou" (bug real: Rafaela perguntou "Vcs
  // trocaram de endereço?" e não batia com a lista antiga, que só tinha
  // "mudaram/mudou"). "endereco" sem cedilha porque normalized não tem acentos
  // (bug adicional: a checagem original comparava "endereço" com cedilha contra
  // um texto já normalizado sem acento — nunca batia).
  if (info.previousAddress && normalized.includes("endereco")) {
    const addressChangeKeywords = [
      "mudaram", "mudou", "trocaram", "trocou", "eram", "era", "sempre foi", "sempre esteve",
    ];
    if (addressChangeKeywords.some((kw) => normalized.includes(kw))) {
      return { isMatch: true, type: "address" };
    }
  }

  return { isMatch: false, type: null };
}

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

/**
 * O lead disse data E hora, e sobrou exatamente UM horário — que é o dele.
 *
 * Caso real (Vitalli, 18/07, conversa ff8fbb07): às 20:10 a IA ofertou 5 opções
 * numeradas, sendo a 5 "Ter 28/07 às 16h". Uma hora depois — já fora do TTL de
 * 15 min — o lead respondeu **"Dia 28/07 as 16h"**, escolhendo pelo nome em vez
 * do número. Sem oferta pendente, a mensagem virou nova busca, que devolveu o
 * único horário que casava e pediu *"responda apenas com o número da opção"*
 * para uma lista de **um item**. O lead teve de digitar "1".
 *
 * Devolve o índice do slot quando a lista tem um único item e ele bate com o
 * dia/hora pedidos; null quando há ambiguidade real ou o lead não foi
 * específico — aí a lista numerada continua sendo a resposta certa.
 */
export function resolveSingleExactSlot(params: {
  slots: { index: number; startsAt: string; label: string }[];
  preferredDate: string | null;
  preferredTime: string | null;
  timezone: ClinicTimezone;
  businessHours: ParsedBusinessHours;
  now: Date;
}): { index: number; label: string } | null {
  const { slots, preferredDate, preferredTime, timezone, businessHours, now } = params;
  // Exige os dois: só a data ("dia 28") deixa a hora em aberto e a lista
  // numerada é legítima; só a hora ("às 16h") não diz o dia.
  if (!preferredDate || !preferredTime) return null;
  if (slots.length !== 1) return null;
  const preferredDay = timezone.resolvePreferredDate(preferredDate, now, businessHours);
  if (!preferredDay) return null;
  const index = findExpressedSlotIndex({ slots, preferredTime, preferredDay, timezone });
  if (index === null) return null;
  const slot = slots.find((s) => s.index === index);
  return slot ? { index: slot.index, label: slot.label } : null;
}

/**
 * Confirmação direta no lugar da lista de um item só.
 *
 * O operador da Vitalli responde nessa forma — *"Próximo horário disponível no
 * sábado seria 01.08 às 8:00 tudo bem?"*. Um "sim" já resolve para o único slot
 * pendente pelo caminho normal de `confirm_slot`, então a etapa numérica não
 * some do funil: ela deixa de existir.
 */
export function buildSingleExactSlotConfirmation(label: string, ttlMinutes: number): string {
  return [
    `Consigo sim: ${label}. Posso confirmar esse horário para você?`,
    "",
    `Deixo reservado por ${ttlMinutes} minutos aguardando sua resposta.`,
  ].join("\n");
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

// Aceite curto ("sim", "pode ser", "quero") a uma oferta que citou um
// procedimento com jornada guiada é evidência determinística de que o lead quer
// ENTRAR nessa jornada — a mensagem atual não repete o nome do tratamento, mas a
// última fala do agente (a oferta) sim. O match é feito SÓ entre tratamentos com
// pipeline de propósito: o opener costuma citar "valores/avaliação" no mesmo
// texto, e o gatilho de funil deve resolver o procedimento oferecido, não o item
// avulso. Assim "Sim" depois de "quer conhecer melhor nossas lentes?" entra no
// pipeline de lentes (envia os vídeos das técnicas) em vez de cair num texto
// informativo solto sem mídia. Genérico: vale para qualquer clínica/tratamento
// com jornada configurada, sem depender do palpite do classificador.
export function resolveOfferedPipelineTreatment(params: {
  message: string;
  treatments: Treatment[];
  lastAgentMessage?: string | null;
}): Treatment | null {
  if (!params.lastAgentMessage) return null;
  if (
    !isAffirmativeReplyToOpenOffer({
      lastAgentMessage: params.lastAgentMessage,
      message: params.message,
    })
  ) {
    return null;
  }
  const pipelineTreatments = params.treatments.filter(
    (treatment) =>
      resolvePipelineSourceTreatment(treatment, params.treatments).pipelineSteps?.length,
  );
  return matchTreatmentByNormalizedMessage(
    normalizeFreeText(params.lastAgentMessage),
    pipelineTreatments,
    TREATMENT_MENTION_STOPWORDS,
  );
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
  // Uma pergunta de endereço não pode virar tratamento por coincidência de
  // substring ("fica" casava com "estratificada") nem por palpite do
  // classificador. O ramo de localização é o único dono desse pedido.
  if (isLocationRequestText(normalizeFreeText(params.message))) return null;

  const directMentionTreatment = resolveDirectTreatmentMention(
    params.message,
    params.treatments,
    params.lastAgentMessage,
  );
  const pipelineMentionTreatment = resolvePipelineTreatmentMention(
    params.message,
    params.treatments,
  );

  const classifiedTreatment = findTreatmentByIdOrName(params.treatments, {
    treatmentName: params.identifiedTreatment ?? null,
  });

  // Aceite de uma oferta que citou uma jornada guiada é evidência mais forte que
  // um palpite do classificador sobre um "sim" seco (que não carrega o nome do
  // tratamento). Só assume quando a mensagem atual não traz menção própria — se
  // trouxer, direct/pipeline abaixo é que mandam.
  const offeredPipelineTreatment = resolveOfferedPipelineTreatment({
    message: params.message,
    treatments: params.treatments,
    lastAgentMessage: params.lastAgentMessage,
  });
  if (offeredPipelineTreatment && !directMentionTreatment && !pipelineMentionTreatment) {
    return offeredPipelineTreatment;
  }

  if (classifiedTreatment) {
    // A mensagem atual é evidência determinística e tem precedência sobre o
    // treatmentName probabilístico do classificador. Isso é especialmente
    // importante quando variantes compartilham aliases: a LLM pode devolver
    // registros diferentes entre execuções e fazer o pipeline iniciar somente
    // em algumas delas, apesar de o texto do lead ser idêntico.
    if (directMentionTreatment) return directMentionTreatment;
    if (
      pipelineMentionTreatment &&
      pipelineMentionTreatment.id !== classifiedTreatment.id
    ) {
      return pipelineMentionTreatment;
    }
    return classifiedTreatment;
  }

  return directMentionTreatment ?? pipelineMentionTreatment ?? offeredPipelineTreatment;
}

// Um tratamento identificado apenas pelo contexto do histórico não é gatilho
// suficiente para iniciar uma jornada comercial. O lead precisa mencioná-lo na
// mensagem atual ou selecioná-lo explicitamente no menu.
export function hasExplicitPipelineTreatmentTrigger(params: {
  message: string;
  treatments: Treatment[];
  lastAgentMessage?: string | null;
  procedureSelection?: ProcedureListItem | null;
  treatment: Treatment;
}): boolean {
  if (params.procedureSelection) return true;
  const directMention = resolveDirectTreatmentMention(
    params.message,
    params.treatments,
    params.lastAgentMessage,
  );
  if (directMention?.id === params.treatment.id) return true;
  // resolveDirectTreatmentMention descarta mensagens com mais de 8 palavras — o
  // opener de anúncio ("Olá! Quero saber como posso transformar meu sorriso com
  // as lentes de resina?") menciona o tratamento explicitamente e ainda assim
  // caía fora do gate, derrubando a saudação concierge e o pipeline inteiro
  // para todo lead de tráfego pago. A menção textual na mensagem atual é o que
  // este gate exige; o teto de palavras não se aplica aqui.
  const pipelineMention = resolvePipelineTreatmentMention(params.message, params.treatments);
  if (pipelineMention?.id === params.treatment.id) return true;
  // J2: afirmativa curta aceitando uma oferta aberta que MENCIONA o tratamento
  // é gatilho explícito — o lead disse "sim" para esta oferta específica.
  // Identificação puramente contextual (sem oferta + aceite) continua bloqueada.
  // Usa a MESMA resolução do alvo informacional (só tratamentos com pipeline),
  // para que o "sim" a um opener que oferece a jornada entre no funil de forma
  // determinística, sem depender do classificador nem divergir entre variantes.
  const offeredPipelineTreatment = resolveOfferedPipelineTreatment({
    message: params.message,
    treatments: params.treatments,
    lastAgentMessage: params.lastAgentMessage,
  });
  if (offeredPipelineTreatment?.id === params.treatment.id) return true;
  return false;
}

export function resolvePipelineSourceTreatment(
  treatment: Treatment,
  treatments: Treatment[],
): Treatment {
  if (!treatment.pipelineSourceTreatmentId) return treatment;
  const source = treatments.find(
    (candidate) =>
      candidate.id === treatment.pipelineSourceTreatmentId &&
      candidate.clinicId === treatment.clinicId &&
      (candidate.pipelineSteps?.length ?? 0) > 0,
  );
  return source ?? treatment;
}

// Mídia que os passos do pipeline entregam por conta própria: os vídeos de
// técnica dos blocos de conteúdo e a mídia anexada por palavra-chave na Q&A. O
// pipeline é o dono dela e escolhe o momento; nenhuma resposta avulsa pode
// antecipá-la nem reenviá-la por token [MEDIA:id]. Resolve o pipeline canônico
// da família, porque variação herda os passos do tratamento-fonte.
export function collectPipelineStepMediaIds(
  treatment: Treatment | null | undefined,
  treatments: Treatment[],
): Set<string> {
  const ids = new Set<string>();
  if (!treatment) return ids;
  for (const step of resolvePipelineSourceTreatment(treatment, treatments).pipelineSteps ?? []) {
    if (step.type === "content") {
      for (const block of step.blocks) {
        if (block.kind === "media") ids.add(block.mediaId);
      }
    } else if (step.type === "qa") {
      for (const entry of step.mediaOnKeywords ?? []) ids.add(entry.mediaId);
    }
  }
  return ids;
}

export function resolveMediaScopeTreatmentId(params: {
  pipelineTreatmentId?: string | null;
  classifiedTreatment?: Treatment | null;
  treatments: Treatment[];
}): string | null {
  if (params.pipelineTreatmentId) return params.pipelineTreatmentId;
  return params.classifiedTreatment
    ? resolvePipelineSourceTreatment(
        params.classifiedTreatment,
        params.treatments,
      ).id
    : null;
}

export function resolvePriceTreatmentTarget(params: {
  message: string;
  treatments: Treatment[];
  identifiedTreatment?: string | null;
  activePipelineTreatmentId?: string | null;
  activeSelectedTreatmentId?: string | null;
}): Treatment | null {
  const directEvidence = matchTreatmentByNormalizedMessage(
    normalizeFreeText(params.message),
    params.treatments,
    TREATMENT_MENTION_STOPWORDS,
  );
  if (directEvidence) return directEvidence;

  // Sem evidência textual nova, a variante preservada no estado é mais
  // confiável que um palpite probabilístico do classificador. Isso impede que
  // perguntas contextuais como "este valor é da técnica refinada?" saltem de
  // lentes para outro tratamento do catálogo. Uma menção explícita na
  // mensagem atual continua vencendo o contexto acima.
  const activeContext = findTreatmentByIdOrName(params.treatments, {
    treatmentId:
      params.activeSelectedTreatmentId ??
      params.activePipelineTreatmentId ??
      null,
  });
  if (activeContext) return activeContext;

  return findTreatmentByIdOrName(params.treatments, {
    treatmentName: params.identifiedTreatment ?? null,
  });
}

export function resolvePipelineEntryBehavior(
  treatment: Treatment,
  treatments: Treatment[],
): Treatment["pipelineEntryBehavior"] {
  const source = resolvePipelineSourceTreatment(treatment, treatments);
  return treatment.pipelineEntryBehavior ?? source.pipelineEntryBehavior ?? null;
}

export function shouldDeferTreatmentPipelineEntry(params: {
  treatment: Treatment;
  treatments: Treatment[];
  isConversationOpening: boolean;
  legacyShouldDefer: boolean;
}): boolean {
  if (!params.isConversationOpening) return false;
  const behavior = resolvePipelineEntryBehavior(params.treatment, params.treatments);
  if (behavior === "immediate") return false;
  if (behavior === "qualify_then_present") return true;
  return params.legacyShouldDefer;
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

  const windowMs = params.windowMs ?? 4_000;
  // Adia esta mensagem SÓ quando um follow-up rápido do lead já chegou DEPOIS
  // dela (mesma rajada) — aí a resposta sai da mensagem mais recente, com o
  // histórico completo. A mensagem TERMINAL do burst (nada mais novo dentro da
  // janela) SEMPRE responde; caso contrário a rajada inteira fica muda.
  // Regressão real: Ximendes 23/07, "…mande pelo menos duas midias" quebrado em
  // 6 mensagens rápidas — a última ("midias", 1s após "duas") era suprimida e
  // ninguém respondia, porque a regra antiga olhava a mensagem ANTERIOR (a
  // terminal sempre vem logo após outra) em vez de olhar se há uma mais nova.
  return params.messages.some(
    (m) =>
      m.author === "lead" &&
      m.id !== current.id &&
      m.sentAt.getTime() > current.sentAt.getTime() &&
      m.sentAt.getTime() - current.sentAt.getTime() < windowMs,
  );
}

function getDayGreeting(timezone: ClinicTimezone): string {
  const { hour } = timezone.toLocalParts(runtimeNow());
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
    addressComplement: row.addressComplement ?? null,
    mapsUrl: row.mapsUrl ?? null,
    locationMessage: row.locationMessage ?? null,
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
    conversationRestartHours: row.conversationRestartHours,
    slotOfferTtlMinutes: row.slotOfferTtlMinutes,
    maxSlotsToOffer: row.maxSlotsToOffer,
    slotLookaheadDays: row.slotLookaheadDays,
    offerSlotsAfterPriceEnabled: row.offerSlotsAfterPriceEnabled,
    outsideHoursExceptionEnabled: row.outsideHoursExceptionEnabled,
    depositEnabled: row.depositEnabled,
    depositAmountCents: row.depositAmountCents ?? null,
    depositPixKey: row.depositPixKey ?? null,
    depositPixKeyType: row.depositPixKeyType ?? null,
    depositRecipientName: row.depositRecipientName ?? null,
    depositTtlHours: row.depositTtlHours,
    depositNotes: row.depositNotes ?? null,
    depositConfirmationNotes: row.depositConfirmationNotes ?? null,
    mediaTakeoverTtlHours: row.mediaTakeoverTtlHours ?? null,
    rapidThrottleMs: row.rapidThrottleMs,
    messageDebounceMs: row.messageDebounceMs ?? null,
    aiContextWindowMessages: row.aiContextWindowMessages ?? null,
    pipelineQaDefaultMaxTurns: row.pipelineQaDefaultMaxTurns ?? null,
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



// "23/06" — data de uma consulta passada. Ano só quando não é o ano corrente:
// "esteve com a gente em 23/06" lê melhor do que "em 23/06/2026".
function formatVisitDate(timezone: ClinicTimezone, date: Date): string {
  const parts = timezone.toLocalParts(date);
  const today = timezone.toLocalParts(runtimeNow());
  const day = String(parts.day).padStart(2, "0");
  const month = String(parts.month + 1).padStart(2, "0");
  return parts.year === today.year ? `${day}/${month}` : `${day}/${month}/${parts.year}`;
}

// #21 — decide se o trilho de relato de dano assume a resposta. Separado do
// detector porque a decisão não é sobre o texto: é sobre o que o sistema sabe do
// lead. Regras, em ordem de risco:
//   • alvo "work" (a lente/faceta/coroa quebrou) sempre assume, com ou sem
//     vínculo — só cede a um pipeline em curso quando não há vínculo nenhum.
//   • alvo "tooth" ("meu dente quebrou") é ambíguo: sem vínculo é dente natural
//     comprometido (caso clínico novo, tratado pela triagem atípica). Com vínculo
//     é relato de dano — exceto quando vem dentro de uma pergunta de preço, que é
//     alguém pedindo orçamento e mencionando um dente lascado de passagem
//     (Ana Paula, Vitalli 18/07): sequestrar isso mata uma venda legítima.
export function shouldEngageDamageRail(params: {
  target: "work" | "tooth";
  relationship: "known_patient" | "self_declared" | "unknown";
  askedPrice: boolean;
  hasActivePipeline: boolean;
}): boolean {
  const hasBond = params.relationship !== "unknown";
  if (params.target === "tooth") return hasBond && !params.askedPrice;
  return hasBond || !params.hasActivePipeline;
}

// O preço da manutenção sai RESOLVIDO do catálogo para a resposta de handoff.
// Antes, o template mandava a LLM "informar o valor conforme configurado" e ela
// inventava: Ximendes, 16/07 — "manutenção sai a partir de R$ 100", quando o
// catálogo diz R$500 (manutenção) e R$200 (conserto); R$100 é o da Avaliação.
// Só devolve os serviços que o lead citou, e só se a clínica autorizou cotar.
export function resolveMaintenancePriceLabel(
  message: string,
  treatments: Treatment[],
): string | null {
  const tokens = new Set(normalizeFreeText(message).split(/\s+/).filter(Boolean));
  const labels: string[] = [];
  for (const treatment of treatments) {
    if (!treatment.priceQuotableInChat) continue;
    const priceCents = treatment.priceCents ?? treatment.minPriceCents;
    if (!priceCents) continue;
    const matchesAskedService = [treatment.name, ...(treatment.aliases ?? [])].some((term) =>
      normalizeFreeText(term)
        .split(/\s+/)
        .some((word) => MAINTENANCE_SERVICE_KEYWORDS.includes(word) && tokens.has(word)),
    );
    if (!matchesAskedService) continue;
    const prefix = treatment.priceKind === "from" ? "a partir de " : "";
    const unit = treatment.priceUnit ? ` (${treatment.priceUnit})` : "";
    labels.push(`${treatment.name}: ${prefix}${formatBrl(priceCents)}${unit}`);
  }
  return labels.length > 0 ? labels.join(" | ") : null;
}


async function resolveDeliveryMediaLibrary(params: {
  clinicId: string;
  parts: ResponsePart[];
  editorialMediaLibrary: DeliveryMediaLibraryItem[] | undefined;
  log: Logger;
}): Promise<DeliveryMediaLibraryItem[]> {
  const editorialMediaLibrary = params.editorialMediaLibrary ?? [];
  const requestedMediaIds = collectMediaIds(params.parts);
  if (requestedMediaIds.length === 0) return editorialMediaLibrary;

  const editorialIds = new Set(editorialMediaLibrary.map((m) => m.id));
  const missingIds = requestedMediaIds.filter((id) => !editorialIds.has(id));
  const invalidIds = missingIds.filter((id) => !isValidMediaAssetId(id));
  for (const mediaId of invalidIds) {
    params.log.error("mediaId inválido gerado pela IA — mídia será omitida", { mediaId });
  }

  const queryableMissingIds = missingIds.filter(isValidMediaAssetId);
  if (queryableMissingIds.length === 0) return editorialMediaLibrary;

  const rows = await db
    .select({
      id: mediaAssets.id,
      title: mediaAssets.title,
      type: mediaAssets.type,
      url: mediaAssets.url,
      treatmentId: mediaAssets.treatmentId,
    })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.clinicId, params.clinicId), inArray(mediaAssets.id, queryableMissingIds)));

  const deliverableAssets: DeliveryMediaLibraryItem[] = [];
  for (const row of rows) {
    if (row.type !== "video" && row.type !== "image") {
      params.log.error("mediaId aponta para tipo não entregável no WhatsApp — mídia será omitida", {
        mediaId: row.id,
        mediaType: row.type,
      });
      continue;
    }
    deliverableAssets.push({
      id: row.id,
      title: row.title,
      type: row.type,
      url: row.url,
      treatmentId: row.treatmentId,
    });
  }

  return mergeDeliveryMediaLibrary(editorialMediaLibrary, deliverableAssets);
}


export function findPipelineTreatmentContextForPriceRequest(params: {
  message: string;
  treatments: Treatment[];
  identifiedTreatment?: string | null;
  activePipelineTreatmentId?: string | null;
  history?: Pick<Message, "author" | "body">[];
}): Treatment | null {
  const byActivePipeline = findTreatmentByIdOrName(params.treatments, {
    treatmentId: params.activePipelineTreatmentId ?? null,
  });
  if (byActivePipeline) {
    const source = resolvePipelineSourceTreatment(byActivePipeline, params.treatments);
    if (source.pipelineSteps?.length) return source;
  }

  const byClassification = findTreatmentByIdOrName(params.treatments, {
    treatmentName: params.identifiedTreatment ?? null,
  });
  if (byClassification) {
    const source = resolvePipelineSourceTreatment(byClassification, params.treatments);
    if (source.pipelineSteps?.length) return source;
  }

  const currentMention = matchTreatmentByNormalizedMessage(
    normalizeFreeText(params.message),
    params.treatments,
    TREATMENT_MENTION_STOPWORDS,
  );
  if (currentMention) {
    const source = resolvePipelineSourceTreatment(currentMention, params.treatments);
    if (source.pipelineSteps?.length) return source;
  }

  const recent = [...(params.history ?? [])].reverse().slice(0, 8);
  for (const item of recent) {
    const contextualMention = matchTreatmentByNormalizedMessage(
      normalizeFreeText(item.body),
      params.treatments,
      TREATMENT_MENTION_STOPWORDS,
    );
    if (contextualMention) {
      const source = resolvePipelineSourceTreatment(contextualMention, params.treatments);
      if (source.pipelineSteps?.length) return source;
    }
  }

  return null;
}


// ─────────────────────────────────────────────────────────────────────────────

export type ConversationAuxiliaryExternalEffect =
  | { kind: "lead_photo_lookup" }
  | {
      kind: "media_rehost";
      mediaType: "image" | "video" | "document" | "audio";
    }
  | { kind: "operator_push" }
  | { kind: "operator_whatsapp_text" }
  | {
      kind: "operator_whatsapp_media";
      mediaType: Parameters<typeof sendMediaMessage>[2];
    }
  | { kind: "operator_whatsapp_buttons" };

export class ConversationOrchestrator {
  private readonly decisionTraceSink: DecisionTraceSink;
  private readonly responsePlanner: ConversationResponsePlanner;
  private readonly calendarGatewayResolver: typeof resolveCalendarGateway;
  private readonly suppressAuxiliaryExternalEffects: boolean;
  private readonly onAuxiliaryExternalEffect?: (
    effect: ConversationAuxiliaryExternalEffect,
  ) => void;
  private readonly turnCoordinator: ConversationTurnCoordinator;
  private stateMachine = new ConversationStateMachine();
  private reservationService = new SlotReservationService();
  private intentClassifier = new IntentClassifier();

  private leadRepo = new DrizzleLeadRepository();
  private conversationRepo = new DrizzleConversationRepository();
  private appointmentRepo = new DrizzleAppointmentRepository();
  private usageCostRepo = new DrizzleUsageCostRepository();
  private treatmentRepo = new DrizzleTreatmentRepository();
  private humanReviewRepo = new DrizzleHumanReviewRequestRepository();
  private notifier = new NotifyClinicOperators(
    new DrizzlePushSubscriptionRepository(),
    new WebPushGateway(),
  );

  constructor(deps: {
    decisionTraceSink?: DecisionTraceSink;
    responsePlanner?: ConversationResponsePlanner;
    calendarGatewayResolver?: typeof resolveCalendarGateway;
    suppressAuxiliaryExternalEffects?: boolean;
    onAuxiliaryExternalEffect?: (
      effect: ConversationAuxiliaryExternalEffect,
    ) => void;
    turnCoordinator?: ConversationTurnCoordinator;
  } = {}) {
    this.decisionTraceSink = deps.decisionTraceSink ?? noopDecisionTraceSink;
    this.responsePlanner = deps.responsePlanner ?? new ConversationResponsePlanner();
    this.calendarGatewayResolver =
      deps.calendarGatewayResolver ?? resolveCalendarGateway;
    this.suppressAuxiliaryExternalEffects =
      deps.suppressAuxiliaryExternalEffects ?? false;
    this.onAuxiliaryExternalEffect = deps.onAuxiliaryExternalEffect;
    this.turnCoordinator = deps.turnCoordinator ?? new ConversationTurnCoordinator(
      new DrizzleConversationTurnLeaseStore(),
      {
        onReleaseError: (conversationId, error) => {
          console.warn(
            `[Orchestrator] Falha ao liberar claim de ${conversationId}:`,
            error,
          );
        },
      },
    );
  }

  private async executeResponsePlan(input: {
    composerInput: ComposerInput;
    planInput: Omit<BuildResponsePlanInput, "actionResult">;
    turnId: string;
    clinicId: string;
    conversationId: string;
    safetyHandoffGuard?: TurnSafetyHandoffGuard;
    onRequiresHandoff: (reason: string) => Promise<void>;
  }): Promise<PlannedResponse> {
    const planned = await this.responsePlanner.execute({
      composerInput: input.composerInput,
      planInput: input.planInput,
    });
    const traceBase = {
      turnId: input.turnId,
      occurredAt: runtimeNow().toISOString(),
      clinicId: input.clinicId,
      conversationId: input.conversationId,
    };

    await recordDecisionTrace(this.decisionTraceSink, {
      ...traceBase,
      stage: "response.plan_built",
      metadata: {
        action: planned.plan.action,
        planVersion: planned.plan.version,
        allowedPriceCount: planned.plan.allowedPriceCents.length,
        allowedScheduleFactCount: planned.plan.allowedScheduleFacts.length,
        allowedMediaCount: planned.plan.allowedMediaIds.length,
        maxCharacters: planned.plan.maxCharacters,
        expectedState: planned.plan.expectedState,
      },
    });
    await recordDecisionTrace(this.decisionTraceSink, {
      ...traceBase,
      stage: "response.validated",
      metadata: {
        action: planned.plan.action,
        valid: planned.source === "composer",
        violationCount: planned.violations.length,
        violations: planned.violations.join(","),
        requiresHandoff: planned.requiresHandoff,
        ...buildComposerTelemetryMetadata({
          response: planned.response,
          latencyMs: planned.composerLatencyMs,
        }),
      },
    });

    if (planned.source === "deterministic_fallback") {
      await recordDecisionTrace(this.decisionTraceSink, {
        ...traceBase,
        stage: "response.fallback_applied",
        metadata: {
          action: planned.plan.action,
          fallbackReason: planned.fallbackReason,
          requiresHandoff: planned.requiresHandoff,
        },
      });
    }

    if (planned.requiresHandoff) {
      if (input.safetyHandoffGuard) {
        await input.safetyHandoffGuard.applySafetyHandoff(
          () => input.onRequiresHandoff(RESPONSE_PLAN_ATTENTION_REASON),
        );
      } else {
        await input.onRequiresHandoff(RESPONSE_PLAN_ATTENTION_REASON);
      }
    }

    return planned;
  }

  private captureAuxiliaryExternalEffect(
    effect: ConversationAuxiliaryExternalEffect,
  ): boolean {
    if (!this.suppressAuxiliaryExternalEffects) return false;
    this.onAuxiliaryExternalEffect?.(effect);
    return true;
  }

  private async rehostInboundMedia(
    messageId: string,
    originalUrl: string,
    mediaType: "image" | "video" | "document" | "audio",
  ): Promise<void> {
    if (this.captureAuxiliaryExternalEffect({
      kind: "media_rehost",
      mediaType,
    })) return;
    await rehostLeadMedia(messageId, originalUrl, mediaType);
  }

  private async persistLeadPhoto(
    leadId: string,
    phone: string,
    credentials: Parameters<typeof fetchAndPersistLeadPhoto>[2],
  ): Promise<void> {
    if (this.captureAuxiliaryExternalEffect({ kind: "lead_photo_lookup" })) return;
    await fetchAndPersistLeadPhoto(leadId, phone, credentials);
  }

  private async notifyOperators(
    clinicId: string,
    payload: Parameters<NotifyClinicOperators["execute"]>[1],
  ): Promise<void> {
    if (this.captureAuxiliaryExternalEffect({ kind: "operator_push" })) return;
    await this.notifier.execute(clinicId, payload);
  }

  private async sendAuxiliaryTextMessage(
    to: string,
    text: string,
    channelConfig: ClinicChannelConfig,
  ): Promise<string | null> {
    if (this.captureAuxiliaryExternalEffect({
      kind: "operator_whatsapp_text",
    })) return "replay-auxiliary-capture";
    return sendTextMessage(to, text, channelConfig);
  }

  private async sendAuxiliaryMediaMessage(
    ...args: Parameters<typeof sendMediaMessage>
  ): Promise<string | null> {
    if (this.captureAuxiliaryExternalEffect({
      kind: "operator_whatsapp_media",
      mediaType: args[2],
    })) return "replay-auxiliary-capture";
    return sendMediaMessage(...args);
  }

  private async sendAuxiliaryButtonListMessage(
    ...args: Parameters<typeof sendButtonListMessage>
  ): Promise<string | null> {
    if (this.captureAuxiliaryExternalEffect({
      kind: "operator_whatsapp_buttons",
    })) return "replay-auxiliary-capture";
    return sendButtonListMessage(...args);
  }

  // Carrega mensagem/conversa/lead existentes para o modo replay do handle()
  // (ação guiada do operador). Retorna null se a mensagem não pertencer à
  // clínica ou não for de lead — replay nunca deve responder a mensagem do agente.
  private async loadReplayContext(
    clinicId: string,
    messageDbId: string,
  ): Promise<{ lead: Lead; conversation: Conversation; incomingMessage: Message } | null> {
    const [messageRow] = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.id, messageDbId))
      .limit(1);
    if (!messageRow || messageRow.author !== "lead") return null;

    const [conversationRow] = await db
      .select()
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.id, messageRow.conversationId),
          eq(conversationsTable.clinicId, clinicId),
        ),
      )
      .limit(1);
    if (!conversationRow) return null;

    const lead = await this.leadRepo.findById(conversationRow.leadId);
    if (!lead) return null;

    return {
      lead,
      conversation: {
        id: conversationRow.id,
        clinicId: conversationRow.clinicId,
        leadId: conversationRow.leadId,
        channel: conversationRow.channel,
        category: conversationRow.category,
        externalThreadId: conversationRow.externalThreadId,
        summary: conversationRow.summary,
        aiPaused: conversationRow.aiPaused,
        takeoverExpiresAt: conversationRow.takeoverExpiresAt,
        needsAttention: conversationRow.needsAttention,
        attentionReason: conversationRow.attentionReason,
        consecutiveUnclearCount: conversationRow.consecutiveUnclearCount,
        lastMessageAt: conversationRow.lastMessageAt,
        createdAt: conversationRow.createdAt,
        updatedAt: conversationRow.updatedAt,
      },
      incomingMessage: {
        id: messageRow.id,
        conversationId: messageRow.conversationId,
        author: messageRow.author,
        body: messageRow.body,
        mediaUrl: messageRow.mediaUrl ?? null,
        mediaType: (messageRow.mediaType as Message["mediaType"]) ?? null,
        sentAt: messageRow.sentAt,
        externalId: messageRow.externalId,
        intent: messageRow.intent ?? null,
        deliveryFormat: (messageRow.deliveryFormat as Message["deliveryFormat"]) ?? null,
      },
    };
  }

  // T1 — mídia respeita o mesmo debounce de burst do texto: aguarda a janela e,
  // se o lead mandou mensagem mais recente, quem responde é o turno dela (os
  // efeitos de estado do turno de mídia já foram aplicados antes desta espera).
  private async mediaReplySuperseded(
    conversationId: string,
    incomingMessageId: string,
    debounceMs: number,
  ): Promise<boolean> {
    if (debounceMs <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, debounceMs));
    const latest = await this.conversationRepo.findLatestLeadMessage(conversationId);
    if (latest && latest.id !== incomingMessageId) {
      console.log(
        `[Orchestrator] Debounce(mídia): msg ${incomingMessageId} superada por ${latest.id} — o turno mais recente responde (conv=${conversationId})`,
      );
      return true;
    }
    return false;
  }

  async handle(params: {
    clinicId: string;
    phone: string;
    whatsappLid?: string | null;
    messageText: string;
    messageId: string;
    turnId?: string;
    senderName?: string;
    senderPhoto?: string | null;
    timestamp: Date;
    replyEnabled?: boolean;
    // Shadow seguro: registra inbound e encerra antes de qualquer decisão/efeito
    // da IA. A resposta hipotética é calculada pelo replay em sandbox.
    observationOnly?: boolean;
    mediaUrl?: string;
    mediaType?: "image" | "video" | "audio" | "document";
    // Reprocessa uma mensagem de lead JÁ REGISTRADA como se tivesse acabado de
    // chegar (ação guiada do operador: "entrar no trilho do pipeline"). Pula
    // dedup, registro e debounce — a mensagem não é nova; só a resposta é.
    replayOfMessageDbId?: string;
  }): Promise<{ replied: boolean; reason?: string }> {
    const { clinicId, phone, messageId, senderName, senderPhoto, timestamp } = params;
    const turnId = params.turnId ?? messageId;
    await recordDecisionTrace(this.decisionTraceSink, {
      turnId,
      stage: "orchestrator.started",
      occurredAt: runtimeNow().toISOString(),
      clinicId,
      metadata: {
        replay: Boolean(params.replayOfMessageDbId),
        mediaType: params.mediaType ?? "text",
        replyEnabled: params.replyEnabled ?? true,
        observationOnly: params.observationOnly ?? false,
      },
    });
    const isReplay = !!params.replayOfMessageDbId;
    // Efeito externo irreversível neste turno (reserva, oferta de horário,
    // booking). Enquanto for false, a resposta composta pode ser descartada sem
    // deixar rastro; depois de true, descartar deixaria slot preso.
    let turnTouchedScheduling = false;
    let messageText = params.messageText;
    const replyEnabled = params.replyEnabled ?? true;
    const contactIdentifiers = buildContactIdentifiersFromWebhook({
      phone,
      chatLid: params.whatsappLid,
    });
    const channelAddress = resolveWhatsAppChannelAddress(contactIdentifiers) ?? phone;

    // ── 1. Deduplicação por ID: retorna se já processamos esta mensagem ──
    // (replay reprocessa deliberadamente uma mensagem existente — dedup não se aplica)
    if (!isReplay) {
      const alreadyProcessed = await db
        .select({ id: messagesTable.id })
        .from(messagesTable)
        .where(eq(messagesTable.externalId, messageId))
        .limit(1);

      if (alreadyProcessed.length > 0) {
        return { replied: false, reason: "duplicate_provider_message" };
      }

      // ── 1.5. Dedup por conteúdo — Z-API pode entregar o mesmo webhook com IDs distintos ──
      // Janela de 2min baseada no wall-clock (não no timestamp da mensagem): retries tardios do
      // Z-API chegam com timestamp novo, o que fazia a janela de 5s original expirar. 2min cobre
      // o intervalo de retry sem bloquear mensagens legítimas repetidas além desse prazo.
      const twoMinutesAgo = new Date(runtimeNow().getTime() - 2 * 60 * 1000);
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
        return { replied: false, reason: "duplicate_content" };
      }
    }

    // ── 2. Busca clínica ──
    const clinicRows = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, clinicId))
      .limit(1);

    if (clinicRows.length === 0) {
      console.error(`[Orchestrator] Clinic not found: ${clinicId}`);
      return { replied: false, reason: "clinic_not_found" };
    }

    const clinic = buildOrganization(clinicRows[0]);
    const timezone = new ClinicTimezone(clinic.timezone);
    const businessHours = parseBusinessHours(clinic.businessHours);

    // FONTE ÚNICA EDITORIAL + módulos carregados em paralelo para evitar waterfall.
    const [editorial, activeModules] = await Promise.all([
      resolveActiveEditorialConfig(clinicId),
      getClinicModules(clinicId),
    ]);
    const runtimeConfigFingerprint = fingerprintRuntimeConfig({
      clinic: clinicRows[0] as Record<string, unknown>,
      editorial,
      modules: activeModules,
    });
    await recordDecisionTrace(this.decisionTraceSink, {
      turnId,
      stage: "tenant.config_loaded",
      occurredAt: runtimeNow().toISOString(),
      clinicId,
      metadata: {
        clinicConfigUpdatedAt: clinicRows[0].updatedAt.toISOString(),
        playbookVersionId: editorial?.versionId ?? null,
        timezone: clinic.timezone,
        segment: clinic.segment ?? "unknown",
        hasActiveEditorial: editorial !== null,
        activeModuleCount: activeModules.length,
        procedureCount: editorial?.procedures.length ?? 0,
        mediaAssetCount: editorial?.mediaLibrary.length ?? 0,
        configFingerprint: runtimeConfigFingerprint.fingerprint,
        configFingerprintSchema: RUNTIME_CONFIG_FINGERPRINT_SCHEMA,
        configFieldCount: runtimeConfigFingerprint.fieldCount,
      },
    });
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
    const conciergeModule = activeModules.find((m) => m.key === "concierge_mode");
    const clinicExperience: ConversationExperience = conciergeModule ? "concierge" : "menu_first";
    const conciergeConfig = (conciergeModule?.config ?? undefined) as ConciergeModeConfig | undefined;

    // ── 3. Registra lead, conversa e mensagem ──
    const usageCostTracker = new DefaultUsageCostTracker({
      usageCostRepository: this.usageCostRepo,
      idGenerator: randomUUID,
      now: () => runtimeNow(),
    });

    let lead: Lead;
    let conversation: Conversation;
    let incomingMessage: Message;
    if (isReplay) {
      // Replay: a mensagem já está registrada — carrega o trio existente sem
      // tocar em status de lead, follow-ups ou lastMessageAt (nada novo chegou).
      const replayContext = await this.loadReplayContext(clinicId, params.replayOfMessageDbId!);
      if (!replayContext) {
        console.warn(
          `[Orchestrator] Replay abortado — mensagem ${params.replayOfMessageDbId} não encontrada/não é de lead (clinic=${clinicId})`,
        );
        return { replied: false, reason: "replay_context_missing" };
      }
      ({ lead, conversation, incomingMessage } = replayContext);
      messageText = incomingMessage.body;
    } else {
      const registerUseCase = new RegisterIncomingMessage({
        leadRepository: this.leadRepo,
        conversationRepository: this.conversationRepo,
        usageCostTracker,
        followUpRepository: new DrizzleFollowUpRepository(),
        idGenerator: randomUUID,
        now: () => runtimeNow(),
      });

      ({ lead, conversation, message: incomingMessage } = await registerUseCase.execute({
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
      }));
    }

    const outboundAddress =
      resolveWhatsAppChannelAddress({ phone: lead.phone, whatsappLid: lead.whatsappLid }) ??
      channelAddress;

    // ── 3.1. Enriquecimento de foto (fire-and-forget) ──
    // Z-API não envia senderPhoto no webhook — buscamos sob demanda via /profile-picture
    // e re-hospedamos no Vercel Blob para evitar expiração de 48h das URLs do WhatsApp.
    if (!lead.profilePicUrl && lead.phone && channelConfig.zapi) {
      void this.persistLeadPhoto(lead.id, lead.phone, channelConfig.zapi);
    }

    // ── 3.1b. Rehost de áudio (fire-and-forget) ──
    // Áudio segue o fluxo normal de transcrição/resposta da IA — só persistimos o
    // arquivo original no Blob em paralelo, para o player do Inbox não quebrar
    // quando a URL da Z-API expirar.
    if (params.mediaType === "audio" && params.mediaUrl) {
      this.rehostInboundMedia(incomingMessage.id, params.mediaUrl, "audio")
        .catch(() => { /* já logado dentro da função */ });
    }

    // ── 3.2. Claim de processamento por conversa ──
    // Serializa webhooks concorrentes da mesma conversa: sem isso, dois handlers
    // processam em paralelo e as respostas saem intercaladas/duplicadas (o check
    // de debounce sozinho tem janela TOCTOU). CAS via UPDATE condicional — único
    // statement, atômico no Postgres mesmo com o driver neon-http.
    const claimed = await this.turnCoordinator.acquire(conversation.id);
    if (!claimed) {
      console.warn(`[Orchestrator] Claim não adquirido para ${conversation.id} — mensagem ${messageId} ignorada`);
      return { replied: false, reason: "conversation_claim_timeout" };
    }

    // ── 3.3. Batching / Debounce de burst de mensagens ──
    // Independentemente de ter adquirido o claim de primeira ou após espera:
    // se uma mensagem MAIS RECENTE do lead já foi inserida no banco (por ex, 
    // um webhook concorrente no mesmo run do worker), nós abortamos este processamento.
    // O job da mensagem mais recente vai assumir a resposta com todo o contexto unificado.
    // (replay reprocessa uma mensagem antiga deliberadamente — mensagens mais
    // recentes do lead, ex. a mídia de um burst, não devem abortar a resposta)
    const latestAfterClaim = isReplay ? null : await this.conversationRepo.findLatestLeadMessage(conversation.id);
    if (latestAfterClaim && latestAfterClaim.id !== incomingMessage.id) {
      if (latestAfterClaim.sentAt.getTime() >= incomingMessage.sentAt.getTime()) {
        console.log(
          `[Orchestrator] Batching/Debounce: Mensagem mais recente detectada para conv=${conversation.id}. Abortando msg=${incomingMessage.id}`
        );
        await this.turnCoordinator.release(conversation.id);
        return { replied: false, reason: "superseded_by_newer_message" };
      }
    }

    try {

    if (params.observationOnly) {
      if (
        params.mediaUrl &&
        (params.mediaType === "image" || params.mediaType === "video" || params.mediaType === "document")
      ) {
        this.rehostInboundMedia(incomingMessage.id, params.mediaUrl, params.mediaType)
          .catch(() => { /* já logado dentro da função */ });
      }
      await this.notifyOperators(clinicId, {
          title: lead.name ?? phone,
          body: params.mediaType
            ? `Nova mensagem com ${params.mediaType}`
            : messageText.slice(0, 100),
          url: `/app/inbox/${conversation.id}`,
        })
        .catch((err) => console.error("[Orchestrator] Push shadow falhou:", err));
      await recordDecisionTrace(this.decisionTraceSink, {
        turnId,
        stage: "turn.ignored",
        occurredAt: runtimeNow().toISOString(),
        clinicId,
        conversationId: conversation.id,
        metadata: { reason: "shadow_observation_only" },
      });
      return { replied: false, reason: "shadow_observation_only" };
    }

    if (!isSalesConversationCategory(conversation.category)) {
      const displayName = lead.name ?? phone;
      const preview = params.mediaType
        ? `Nova mensagem ${params.mediaType === "image" ? "com imagem" : `com ${params.mediaType}`}`
        : messageText.slice(0, 100);
      await this.notifyOperators(clinicId, {
          title: displayName,
          body: preview,
          url: `/app/inbox/${conversation.id}`,
        })
        .catch((err) => console.error("[Orchestrator] Push falhou:", err));
      return {
        replied: false,
        reason: `non_sales_conversation:${conversation.category}`,
      };
    }

    // ── 3.5. Mídia visual inbound (foto/vídeo/documento) ──
    // Rehospeda no Blob (persistência), encaminha para o doutor no WhatsApp e pausa a IA.
    // Áudio já foi rehostado em 3.1b e segue o pipeline normal de transcrição/resposta
    // da IA (não pausa e não é encaminhado ao doutor aqui).
    const inboundMediaType = params.mediaType;
    let adMediaContextText: string | null = null;
    if (inboundMediaType === "image" || inboundMediaType === "video" || inboundMediaType === "document") {
      // ── A7: Intercept de comprovante do sinal ──
      // Qualquer imagem/PDF enviada enquanto aguardamos o comprovante É o comprovante
      // (decisão de produto: a IA NÃO valida comprovante). Estende o hold, sinaliza
      // atenção para o operador validar e responde com confirmação de recebimento.
      if (inboundMediaType === "image" || inboundMediaType === "document") {
        const depositState = await this.stateMachine.getDepositState(conversation.id);
        if (depositState?.state === "awaiting_deposit_proof") {
          if (params.mediaUrl) {
            this.rehostInboundMedia(incomingMessage.id, params.mediaUrl, inboundMediaType).catch(() => {});
          }
          const proofReviewCode = await nextAvailableDepositProofReviewCode(clinicId);
          const receptionistPhone = clinic.receptionistPhone;
          if (receptionistPhone) {
            const leadName = lead.name ?? outboundAddress;
            const proofReviewMessage = buildDepositProofReviewRequestMessage({
              reviewCode: proofReviewCode,
              leadName,
              slotLabel: depositState.payload.slotLabel,
              depositAmountCents: depositState.payload.depositAmountCents,
            });
            void (async () => {
              // Uma mensagem só: o texto viaja junto com os botões. Se a camada
              // interativa falhar, reenvia como texto puro — o mesmo conteúdo já
              // traz o código e as opções, então a decisão continua possível.
              try {
                await this.sendAuxiliaryButtonListMessage(
                  receptionistPhone,
                  proofReviewMessage,
                  buildDepositProofButtons(proofReviewCode),
                  channelConfig,
                );
              } catch (err) {
                console.warn("[DepositReview] botões falharam; caindo para texto:", err);
                await this.sendAuxiliaryTextMessage(receptionistPhone, proofReviewMessage, channelConfig)
                  .catch((textErr) => console.warn("[DepositReview] texto de validação falhou:", textErr));
              }

              if (params.mediaUrl) {
                await this.sendAuxiliaryMediaMessage(
                  receptionistPhone,
                  params.mediaUrl,
                  inboundMediaType,
                  channelConfig,
                  undefined,
                  buildForwardedMediaFileName({
                    leadName,
                    contextLabel: depositState.payload.slotLabel,
                    mediaType: inboundMediaType,
                  }),
                ).catch(() => {});
              }
            })();
          }
          await this.notifyOperators(clinicId, {
            title: lead.name ?? phone,
            body: "Enviou o comprovante do sinal — validar e confirmar",
            url: `/app/inbox/${conversation.id}`,
          }).catch(() => {});

          if (depositState.payload.reservationId) {
            turnTouchedScheduling = true;
            await this.reservationService.extend(depositState.payload.reservationId, (clinic.depositTtlHours ?? 24) * 60);
          }
          await this.stateMachine.markDepositProofReceived(conversation.id, incomingMessage.id, proofReviewCode);
          await db
            .update(conversationsTable)
            .set({
              needsAttention: true,
              attentionReason: `Comprovante de sinal recebido — validar Pix P${proofReviewCode}`,
              updatedAt: runtimeNow(),
            })
            .where(eq(conversationsTable.id, conversation.id));

          if (replyEnabled && !conversation.aiPaused) {
            const proofAgentId = randomUUID();
            const proofText = buildDepositProofReceivedMessage();
            await this.conversationRepo.appendMessage({
              id: proofAgentId,
              conversationId: conversation.id,
              author: "agent",
              body: proofText,
              sentAt: runtimeNow(),
              externalId: null,
              intent: "acknowledgment",
              deliveryFormat: null,
            });
            await this.enqueueConversationReply(clinicId, conversation.id, {
              version: 1,
              kind: "conversation_reply",
              turnId,
              to: outboundAddress,
              agentMessageId: proofAgentId,
              replyText: proofText,
              intent: "acknowledgment",
              useVoice: false,
              ttsConfig: ttsConf,
              interleavedParts: [],
              mediaParts: [],
              leadId: lead.id,
              pipelineAdvance: null,
            }, {
              source: "deposit_proof_media",
              classifiedIntent: "acknowledgment",
              finalIntent: "acknowledgment",
              confidence: 1,
              missingStages: [
                "state.loaded",
                "intent.classified",
                "intent.resolved",
              ],
            });
          }
          return { replied: replyEnabled && !conversation.aiPaused };
        }
      }
      // ── Guard: mídia de anúncio (Click-to-WhatsApp) ──
      // Quando o lead clica em "Saiba mais" de um anúncio, o WhatsApp envia automaticamente
      // o card do anúncio (imagem/vídeo) junto com a mensagem de texto do lead.
      // Critérios para identificar como mídia de anúncio (não foto clínica do paciente):
      //   1. A equipe ainda NÃO pediu foto ao lead (T2: antes do pedido, mídia colada
      //      num opener de anúncio é criativo — mesmo que a saudação já tenha saído), E
      //   2. A conversa é jovem (poucas mensagens — burst de chegada de anúncio), E
      //   3. A legenda (caption), ou o texto lead imediatamente anterior no mesmo burst,
      //      coincide com frases típicas de preenchimento automático de anúncios.
      const caption = params.messageText?.trim() ?? "";
      // Usa contagem de mensagens na conversa sem carregar todo o histórico (allMessages é carregado mais adiante)
      const [totalMsgRow] = await db
        .select({ total: count() })
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, conversation.id));
      const earlyLeadMsgTotal = Number(totalMsgRow?.total ?? 0);
      const adMediaHistory = await this.conversationRepo.listMessages(conversation.id);
      const adMediaDecision = resolveAdMediaContext({
        currentMessageId: incomingMessage.id,
        currentMessageText: caption,
        agentRequestedPhoto: hasAgentRequestedPhoto(adMediaHistory),
        totalConversationMessages: earlyLeadMsgTotal,
        history: adMediaHistory,
        now: timestamp.getTime(),
      });
      const isLikelyAdMedia = adMediaDecision.isAdMedia;

      if (isLikelyAdMedia) {
        adMediaContextText = adMediaDecision.contextText;
        // A mensagem textual anterior é a intenção real do lead. Reutilizá-la
        // aqui permite que o classificador dispare o pipeline do tratamento,
        // em vez de classificar apenas "[imagem recebida]".
        if (adMediaContextText) messageText = adMediaContextText;
        console.log(
          `[Orchestrator] Mídia detectada como card de anúncio — não encaminhando ao doutor nem pausando IA` +
          ` (conv=${conversation.id} lead=${lead.id} context="${adMediaContextText?.slice(0, 80) ?? caption.slice(0, 80)}")`,
        );
        // Deixa o fluxo continuar normalmente como se fosse uma mensagem de texto.
        // O LLM responderá com base no texto do lead associado ao anúncio.
        // Não retorna aqui — o código abaixo não será atingido por causa do `if`.
      } else {

      // Rehospeda de forma assíncrona: Z-API URLs expiram em horas
      if (params.mediaUrl) {
        this.rehostInboundMedia(incomingMessage.id, params.mediaUrl, inboundMediaType)
          .catch(() => { /* já logado dentro da função */ });
      }

      let humanReviewContext: {
        reviewCode: number;
        treatmentName: string | null;
      } | null = null;
      if (inboundMediaType === "image" || inboundMediaType === "video") {
        const activePipelineState = await this.stateMachine.getTreatmentPipelineState(conversation.id);
        const pipelineTreatments = activePipelineState
          ? await this.treatmentRepo.listByClinic(clinicId)
          : [];
        const mediaRoute = resolvePipelineMediaRoute({
          mediaType: inboundMediaType,
          state: activePipelineState,
          treatments: pipelineTreatments,
        });
        if (mediaRoute.kind === "invalid_pipeline_target") {
          console.error("[PipelineMediaRouter] Contexto inconsistente; mídia ficará em revisão manual", {
            clinicId,
            conversationId: conversation.id,
            reason: mediaRoute.reason,
          });
        }
        if (mediaRoute.kind === "human_review") {
            const existingReview = await this.humanReviewRepo.findPendingByConversation({
              clinicId,
              conversationId: conversation.id,
            });
            const review = existingReview ?? await this.humanReviewRepo.createPending({
              clinicId,
              conversationId: conversation.id,
              leadId: lead.id,
              sourceMessageId: incomingMessage.id,
              treatmentId: mediaRoute.pipelineTreatment.id,
              targetTreatmentId: mediaRoute.targetTreatment.id,
              sourceMediaType: inboundMediaType,
              sourceMediaUrl: params.mediaUrl ?? null,
              expiresAt: new Date(runtimeNow().getTime() + 24 * 3600_000),
            });
            humanReviewContext = {
              reviewCode: review.reviewCode,
              treatmentName: mediaRoute.targetTreatment.name,
            };
            await this.stateMachine.markPipelinePhotoReceived(conversation.id, review.expiresAt);
        }
      }

      // Encaminha para o WhatsApp do doutor com contexto + mídia original
      const receptionistPhone = clinic.receptionistPhone;
      let operatorNotificationIssue: string | null = null;
      if (receptionistPhone) {
        const mediaLabel = inboundMediaType === "image" ? "foto" : inboundMediaType === "video" ? "vídeo" : "documento";
        const artigo = inboundMediaType === "image" ? "uma" : "um";
        const leadName = lead.name ?? outboundAddress;
        const contextMsg = humanReviewContext
          ? buildHumanReviewRequestMessage({
              reviewCode: humanReviewContext.reviewCode,
              leadName,
              treatmentName: humanReviewContext.treatmentName,
              mediaLabel,
            })
          : `📎 *${leadName}* enviou ${artigo} ${mediaLabel} para avaliação.\n\nPara responder ao lead, abra o WhatsApp da clínica e responda diretamente no chat dele. A IA fica pausada enquanto o humano assume.`;
        if (humanReviewContext) {
          // Uma mensagem só: contexto e botões viajam juntos. Se a camada
          // interativa falhar, o mesmo texto vai puro — ele já carrega Axx e as
          // opções 1..4, então a decisão continua possível.
          try {
            await this.sendAuxiliaryButtonListMessage(
              receptionistPhone,
              contextMsg,
              buildHumanReviewButtons(humanReviewContext.reviewCode),
              channelConfig,
            );
          } catch (err) {
            console.warn("[HumanReview] botões falharam; caindo para texto:", err);
            try {
              await this.sendAuxiliaryTextMessage(receptionistPhone, contextMsg, channelConfig);
              operatorNotificationIssue = "Botões de avaliação falharam; decisão textual Axx continua disponível";
            } catch (textErr) {
              console.warn("[HumanReview] contexto textual falhou:", textErr);
              operatorNotificationIssue = "Falha ao enviar o contexto da avaliação ao doutor";
            }
          }
        } else {
          try {
            await this.sendAuxiliaryTextMessage(receptionistPhone, contextMsg, channelConfig);
          } catch (err) {
            console.warn("[MediaForward] contexto falhou:", err);
            operatorNotificationIssue = "Falha ao avisar o doutor sobre mídia recebida";
          }
        }
        if (params.mediaUrl) {
          try {
            await this.sendAuxiliaryMediaMessage(
              receptionistPhone,
              params.mediaUrl,
              inboundMediaType,
              channelConfig,
              undefined,
              buildForwardedMediaFileName({
                leadName,
                contextLabel: humanReviewContext?.treatmentName ?? null,
                mediaType: inboundMediaType,
              }),
            );
          } catch (err) {
            console.warn("[MediaForward] mídia falhou:", err);
            operatorNotificationIssue ??= "Aviso enviado, mas a mídia não foi encaminhada ao doutor";
          }
        }
      } else if (humanReviewContext) {
        operatorNotificationIssue = "Telefone do doutor/responsável não configurado para receber avaliação";
      }

      // Notifica operadores via push
      await this.notifyOperators(clinicId, {
        title: lead.name ?? phone,
        body: `Enviou ${inboundMediaType === "image" ? "uma foto" : "um " + inboundMediaType} para avaliação`,
        url: `/app/inbox/${conversation.id}`,
      }).catch(() => {});

      if (humanReviewContext) {
        const attentionReason = [
          `Avaliação A${humanReviewContext.reviewCode}: aguardando decisão humana`,
          operatorNotificationIssue,
        ].filter(Boolean).join(" — ");
        const now = runtimeNow();
        await db.update(conversationsTable).set({
          aiPaused: true,
          takeoverExpiresAt: null,
          needsAttention: true,
          attentionReason,
          updatedAt: now,
        }).where(eq(conversationsTable.id, conversation.id));

        if (!replyEnabled || conversation.aiPaused) {
          return {
            replied: false,
            reason: !replyEnabled ? "automation_reply_disabled" : "ai_paused",
          };
        }

        if (await this.mediaReplySuperseded(conversation.id, incomingMessage.id, resolveMessageDebounceMs({ isReplayOfMessage: isReplay, clinicDebounceMs: clinic.messageDebounceMs, env: process.env }))) {
          return { replied: false, reason: "superseded_by_newer_message" };
        }

        const pendingReviewText = shouldSendShortReviewAck(
          await this.conversationRepo.listMessages(conversation.id),
        )
          ? buildHumanReviewFollowUpAckMessage(lead.name)
          : buildHumanReviewPendingLeadMessage(lead.name);
        const photoAgentId = randomUUID();
        await this.conversationRepo.appendMessage({
          id: photoAgentId,
          conversationId: conversation.id,
          author: "agent",
          body: pendingReviewText,
          sentAt: now,
          externalId: null,
          intent: "needs_human",
          deliveryFormat: null,
        });
        await this.enqueueConversationReply(clinicId, conversation.id, {
          version: 1,
          kind: "conversation_reply",
          turnId,
          to: outboundAddress,
          agentMessageId: photoAgentId,
          replyText: pendingReviewText,
          intent: "needs_human",
          useVoice: resolveVoiceForReply("needs_human", pendingReviewText),
          ttsConfig: ttsConf,
          interleavedParts: [],
          mediaParts: [],
          leadId: lead.id,
          pipelineAdvance: null,
        }, {
          source: "human_review_media",
          classifiedIntent: "needs_human",
          finalIntent: "needs_human",
          confidence: 1,
          missingStages: [
            "state.loaded",
            "intent.classified",
            "intent.resolved",
          ],
        });
        return { replied: true };
      }

      // Se IA está pausada ou auto-reply desligado, o doutor já está no controle — sem resposta automática
      if (!replyEnabled || conversation.aiPaused) {
        return {
          replied: false,
          reason: !replyEnabled ? "automation_reply_disabled" : "ai_paused",
        };
      }

      // IA ativa: foto/vídeo/documento fora de pipeline → responde e pausa para o doutor avaliar
      const mediaHistory = await this.conversationRepo.listMessages(conversation.id);
      const mediaActionResult: ActionResult = {
        type: "media_received",
        mediaType: inboundMediaType,
      };
      const mediaCommercialPolicy = editorial?.commercialPolicy ?? null;
      const mediaInstallmentTable = clinic.installmentRates && mediaCommercialPolicy
        ? buildInstallmentTable(
            mediaCommercialPolicy,
            clinic.installmentRates as InstallmentRate[],
          )
        : null;
      const filteredMediaLibrary = filterMediaLibraryForComposer(
        editorial?.mediaLibrary ?? [],
        null,
        mediaActionResult,
      );
      const mediaProjection = buildAlignedResponseMediaProjection(filteredMediaLibrary);
      let responsePlanAttentionReason: string | null = null;
      const mediaPlanned = await this.executeResponsePlan({
        composerInput: {
          actionResult: mediaActionResult,
          conversationHistory: mediaHistory,
          historyWindowMessages: clinic.aiContextWindowMessages,
          clinic: {
            name: clinic.name,
            plan: clinic.plan,
            specialty: editorial?.specialty ?? clinic.specialty,
            toneOfVoice: editorial?.toneOfVoice ?? null,
            playbook: editorial?.playbookText ?? null,
            commercialPolicy: mediaCommercialPolicy,
            mediaLibrary: mediaProjection.composerMediaLibrary,
            receptionistName: editorial?.receptionistName ?? inferReceptionistNameFromGreeting(clinic.greetingMessage) ?? undefined,
          },
          leadName: extractFirstName(lead.name),
          timezone,
          isFirstMessage: mediaHistory.filter(m => m.author !== "lead").length === 0,
          conversationExperience: clinicExperience,
          conciergeVerbosity: conciergeConfig?.verbosity,
          conciergeDrive: conciergeConfig?.drive,
          maxCharacters: resolveResponseMaxCharacters(conciergeConfig?.verbosity),
          resumedFromHumanTakeover: false,
        },
        planInput: {
          commercialPolicy: mediaCommercialPolicy,
          installmentTable: mediaInstallmentTable,
          allowedMediaIds: mediaProjection.allowedMediaIds,
          expectedState: "none",
          maxCharacters: resolveResponseMaxCharacters(conciergeConfig?.verbosity),
        },
        turnId,
        clinicId,
        conversationId: conversation.id,
        onRequiresHandoff: async (reason) => {
          responsePlanAttentionReason = reason;
        },
      });
      const mediaReplyText = mediaPlanned.response.text;

      const attentionReason = responsePlanAttentionReason
        ?? `Lead enviou ${inboundMediaType === "image" ? "foto" : inboundMediaType} para avaliação`;
      const now = runtimeNow();
      const mediaTtl = clinic.mediaTakeoverTtlHours;
      const mediaTakeoverExpiresAt = mediaTtl && mediaTtl > 0
        ? new Date(runtimeNow().getTime() + mediaTtl * 3600_000)
        : null;
      await db.update(conversationsTable).set({
        aiPaused: true,
        takeoverExpiresAt: mediaTakeoverExpiresAt,
        needsAttention: true,
        attentionReason,
        updatedAt: now,
      }).where(eq(conversationsTable.id, conversation.id));
      if (responsePlanAttentionReason) {
        await this.notifyAttentionNeeded(
          clinic,
          channelConfig,
          phone,
          lead.name ?? null,
          responsePlanAttentionReason,
        );
      }

      // T1 — pausa/atenção acima permanecem (doutor assume); só a resposta é
      // suprimida quando outra mensagem do lead chegou na janela de burst.
      if (await this.mediaReplySuperseded(conversation.id, incomingMessage.id, resolveMessageDebounceMs({ isReplayOfMessage: isReplay, clinicDebounceMs: clinic.messageDebounceMs, env: process.env }))) {
        return { replied: false, reason: "superseded_by_newer_message" };
      }

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
        turnId,
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
      }, {
        source: "media_received",
        classifiedIntent: "needs_human",
        finalIntent: "needs_human",
        confidence: 1,
        missingStages: [
          "state.loaded",
          "intent.classified",
          "intent.resolved",
        ],
      }, mediaPlanned);

      return { replied: true };
      } // end else (não é mídia de anúncio)
    }

    if (!replyEnabled) {
      const leadDisplayName = lead.name ?? channelAddress;
      await this.notifyOperators(clinicId, {
          title: leadDisplayName,
          body: messageText.slice(0, 100),
          url: `/app/inbox/${conversation.id}`,
        })
        .catch((err) => console.error("[Orchestrator] Push falhou:", err));
      return { replied: false, reason: "automation_reply_disabled" };
    }

    // ── 3.7. Debounce — aguarda burst de mensagens do lead ──
    // Após registrar, espera N ms e verifica se chegou mensagem mais recente.
    // Se sim, esta mensagem não gera resposta — a última do burst responde
    // com o histórico completo (que já inclui todas as anteriores).
    const debounceMs = resolveMessageDebounceMs({ isReplayOfMessage: isReplay, clinicDebounceMs: clinic.messageDebounceMs, env: process.env });
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
        return { replied: false, reason: "superseded_by_newer_message" };
      }
      console.log(`[Orchestrator] Debounce: msg ${incomingMessage.id} é a mais recente — prosseguindo (conv=${conversation.id})`);
    }

    // Uma foto clínica com revisão Axx pendente é uma trava, não apenas um
    // badge de atenção. Mensagens posteriores complementam o caso do doutor e
    // recebem somente um reconhecimento seguro; não passam pelo classificador
    // nem podem reabrir agenda/pipeline antes da decisão humana (caso Nataly).
    const pendingHumanReview = await this.humanReviewRepo.findPendingByConversation({
      clinicId,
      conversationId: conversation.id,
    });
    if (pendingHumanReview) {
      const leadContext = messageText.trim();
      if (leadContext) {
        await this.humanReviewRepo.appendReviewContext({
          id: pendingHumanReview.id,
          context: leadContext,
        });
      }

      const reviewAttentionReason = `Avaliação A${pendingHumanReview.reviewCode}: aguardando decisão humana`;
      await db
        .update(conversationsTable)
        .set({
          aiPaused: true,
          takeoverExpiresAt: null,
          needsAttention: true,
          attentionReason: reviewAttentionReason,
          updatedAt: runtimeNow(),
        })
        .where(eq(conversationsTable.id, conversation.id));

      if (clinic.receptionistPhone && leadContext) {
        await this.sendAuxiliaryTextMessage(
          clinic.receptionistPhone,
          buildHumanReviewContextUpdateMessage({
            reviewCode: pendingHumanReview.reviewCode,
            leadName: lead.name ?? outboundAddress,
            leadMessage: leadContext,
          }),
          channelConfig,
        ).catch((err) => console.warn("[HumanReview] atualização de contexto falhou:", err));
      }

      await this.notifyOperators(clinicId, {
        title: lead.name ?? phone,
        body: `Nova informação para a avaliação A${pendingHumanReview.reviewCode}`,
        url: `/app/inbox/${conversation.id}`,
      }).catch(() => {});

      const baseReviewText = shouldSendShortReviewAck(
        await this.conversationRepo.listMessages(conversation.id),
      )
        ? buildHumanReviewFollowUpAckMessage(lead.name)
        : buildHumanReviewPendingLeadMessage(lead.name);
      // Se o lead fez uma pergunta factual segura (endereço/horário) enquanto o
      // doutor avalia, responde por template e ainda reafirma a pausa — sem reabrir
      // o classificador nem avançar o funil (a trava do caso Nataly segue intacta).
      const safeReviewAnswer = buildSafeReviewPauseAnswer(clinic, messageText);
      const pendingText = safeReviewAnswer
        ? `${safeReviewAnswer}\n\n${baseReviewText}`
        : baseReviewText;
      const pendingAgentId = randomUUID();
      await this.conversationRepo.appendMessage({
        id: pendingAgentId,
        conversationId: conversation.id,
        author: "agent",
        body: pendingText,
        sentAt: runtimeNow(),
        externalId: null,
        intent: "needs_human",
        deliveryFormat: null,
      });
      await this.enqueueConversationReply(clinicId, conversation.id, {
        version: 1,
        kind: "conversation_reply",
        turnId,
        to: outboundAddress,
        agentMessageId: pendingAgentId,
        replyText: pendingText,
        intent: "needs_human",
        useVoice: false,
        ttsConfig: ttsConf,
        interleavedParts: [],
        mediaParts: [],
        leadId: lead.id,
        pipelineAdvance: null,
      }, {
        source: "pending_human_review",
        classifiedIntent: "needs_human",
        finalIntent: "needs_human",
        confidence: 1,
        missingStages: [
          "state.loaded",
          "intent.classified",
          "intent.resolved",
        ],
      });
      return { replied: true };
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
      const now = runtimeNow();
      if (conversation.takeoverExpiresAt && conversation.takeoverExpiresAt < now) {
        await db
          .update(conversationsTable)
          .set({ aiPaused: false, takeoverExpiresAt: null, updatedAt: now })
          .where(eq(conversationsTable.id, conversation.id));
        resumedFromHumanTakeover = true;
        console.log(`[Orchestrator] Takeover TTL expirado para ${conversation.id} — IA retomada`);
      } else if (shouldResumeManualTakeoverForScheduling(messageText, conversation.takeoverExpiresAt)) {
        await db
          .update(conversationsTable)
          .set({ aiPaused: false, takeoverExpiresAt: null, updatedAt: now })
          .where(eq(conversationsTable.id, conversation.id));
        resumedFromHumanTakeover = true;
        console.log(`[Orchestrator] Pausa manual retomada por pedido explícito de agendamento para ${conversation.id}`);
      } else {
        console.log(`[Orchestrator] AI pausada para ${conversation.id}, ignorando resposta`);
        // Notifica operador que lead respondeu enquanto atendimento estava em pausa manual
        const displayName = lead.name ?? phone;
        await this.notifyOperators(clinicId, {
            title: displayName,
            body: messageText.slice(0, 100),
            url: `/app/inbox/${conversation.id}`,
          })
          .catch((err) => console.error("[Orchestrator] Push falhou:", err));
        return { replied: false, reason: "ai_paused" };
      }
    }

    // ── 5. Rate limit — máx 20 msgs/hora do lead por conversa ──
    // Protege custo OpenAI contra spam e loops. A mensagem já foi salva no passo 3.
    const oneHourAgo = new Date(runtimeNow().getTime() - 60 * 60_000);
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
      return { replied: false, reason: "inbound_rate_limited" };
    }

    // ── 7. Carrega histórico de mensagens ──
    const allMessages = await this.conversationRepo.listMessages(conversation.id);

    // Ninguém respondeu ainda. Governa a APRESENTAÇÃO: saudação rica, nome da
    // clínica dito uma vez. Continua verdadeiro mesmo com várias mensagens do
    // lead — quem nunca foi atendido merece a apresentação, seja na 1ª ou na 4ª.
    const isFirstMessage = allMessages.filter((m) => m.author !== "lead").length === 0;
    // Mais estrito: além de ninguém ter respondido, o lead falou UMA vez só.
    // Governa a ABERTURA enlatada (menu inicial / concierge starter), que
    // substitui a resposta em vez de complementá-la.
    //
    // `isFirstMessage` sozinho media "ninguém respondeu ainda", não "é a 1ª
    // mensagem do lead": quem mandava 4 mensagens sem resposta seguia sendo
    // "primeiro contato" e recebia a saudação genérica no lugar da resposta.
    // Medido em produção: 123 primeiras respostas saíram com o lead já tendo 2+
    // mensagens; 69 (56%) abriram com apresentação. Um lead da Vitalli chegou a
    // 14 mensagens nessa condição.
    const leadMessageCount = allMessages.filter((m) => m.author === "lead").length;
    const isConversationOpening = isFirstMessage && leadMessageCount <= 1;
    const lastAgentMessage = [...allMessages].reverse().find((m) => m.author === "agent");
    const stateAsOf = isReplay ? undefined : incomingMessage.sentAt;
    const [currentConversationState, lastResetBoundary] = await Promise.all([
      this.stateMachine.getCurrentState(conversation.id, stateAsOf),
      this.stateMachine.getLastResetBoundary(conversation.id),
    ]);
    await recordDecisionTrace(this.decisionTraceSink, {
      turnId,
      stage: "state.loaded",
      occurredAt: runtimeNow().toISOString(),
      clinicId,
      conversationId: conversation.id,
      metadata: {
        state: currentConversationState?.state ?? "none",
        hasResetBoundary: lastResetBoundary !== null,
        leadMessageCount,
        isConversationOpening,
      },
    });

    // Se houve reset recente, usa apenas mensagens pós-reset para LLM (classifier + composer),
    // evitando que o modelo reutilize mídias já enviadas na sessão anterior.
    // isFirstMessage e demais checagens determinísticas continuam usando allMessages.
    const allMessagesForContext = lastResetBoundary
      ? allMessages.filter((m) => m.sentAt >= lastResetBoundary)
      : allMessages;

    // Mapa id→título da biblioteca de mídia. O dedup de content step de mídia
    // (hasPipelineContentStepBeenSent) casa pelo TÍTULO — que é o que fica gravado
    // no corpo da mensagem enviada — e não pela legenda. Sem ele, um content step
    // só-de-mídia reenviava a cada virada (loop de vídeos da Ximendes, 23/07).
    //
    // Lê a biblioteca CHEIA da clínica (media_assets), não a seleção do playbook
    // (editorial.mediaLibrary): o pipeline determinístico entrega o vídeo por id
    // mesmo quando ele NÃO está na seleção do playbook (resolveDeliveryMediaLibrary
    // busca no banco). Se o mapa dependesse da seleção, desmarcar o vídeo no editor
    // do playbook — para a LLM parar de emiti-lo — reintroduziria o loop, porque o
    // dedup perderia o título. Desacoplado, desmarcar vira o fix limpo.
    const clinicMediaTitleRows = await db
      .select({ id: mediaAssets.id, title: mediaAssets.title })
      .from(mediaAssets)
      .where(eq(mediaAssets.clinicId, clinicId));
    const pipelineMediaTitleById = new Map<string, string>(
      clinicMediaTitleRows.map((m) => [m.id, m.title] as const),
    );

    // ── 8. Verifica oferta de slots pendente ──
    const pendingSlots = await this.stateMachine.getPendingSlotOffer(conversation.id, stateAsOf);
    const hasPendingOffer = pendingSlots !== null;

    // ── 8.5. Verifica pipeline de tratamento ativo ──
    const pipelineState = await this.stateMachine.getTreatmentPipelineState(conversation.id, stateAsOf);

    // ── 9. Resolve intenção: menu pré-classificado ou LLM estágio 1 ──
    const clinicTreatments = await this.treatmentRepo.listByClinic(clinicId);
    const experience = clinicExperience;

    // A3 — Qualificar antes do pitch: no 1º contato em modo concierge, o opener curado
    // da clínica já faz a pergunta de qualificação (padrão da operadora humana). Nesse
    // caso não despejamos explicação + mídia do pipeline junto; posicionamos o pipeline
    // no passo de conteúdo (deferido) e ele dispara na resposta seguinte do lead.
    // Usa a condição estrita: o deferimento existe porque o opener curado já faz
    // a pergunta de qualificação. Sem opener (lead com 2+ mensagens), segurar o
    // conteúdo do pipeline deixaria a resposta vazia.
    const deferFirstContactPitch = isConversationOpening && experience === "concierge";

    // A9 — Reenvio idêntico do lead (duplo clique no anúncio CTWA dispara o mesmo texto
    // 2x com horas de intervalo; a janela de dedup de 2min lá em cima não pega). Sem
    // pipeline ativo, reprocessar geraria um SEGUNDO pitch, possivelmente diferente do
    // primeiro (LLM) — o lead percebe como "a IA não presta atenção". Respondemos com um
    // aceno curto e determinístico. Com pipeline ativo NÃO entra aqui: a 2ª mensagem é o
    // gatilho que faz o conteúdo deferido (A3) disparar.
    if (!adMediaContextText && !pipelineState && replyEnabled) {
      const priorIdentical = findLeadMessageRepeat({
        currentBody: messageText,
        history: allMessagesForContext,
        now: runtimeNow().getTime(),
      });
      if (priorIdentical) {
        const mentioned = resolveDirectTreatmentMention(messageText, clinicTreatments);
        const nudge = mentioned
          ? `Oi de novo! 😊 Ficou alguma dúvida sobre ${mentioned.name}? Me conta que eu te ajudo.`
          : "Oi de novo! 😊 Ficou alguma dúvida? Me conta que eu te ajudo.";
        const nudgeAgentId = randomUUID();
        await this.conversationRepo.appendMessage({
          id: nudgeAgentId,
          conversationId: conversation.id,
          author: "agent",
          body: nudge,
          sentAt: runtimeNow(),
          externalId: null,
          intent: "acknowledgment",
          deliveryFormat: null,
        });
        await this.enqueueConversationReply(clinicId, conversation.id, {
          version: 1,
          kind: "conversation_reply",
          turnId,
          to: outboundAddress,
          agentMessageId: nudgeAgentId,
          replyText: nudge,
          intent: "acknowledgment",
          useVoice: false,
          ttsConfig: ttsConf,
          interleavedParts: [],
          mediaParts: [],
          leadId: lead.id,
          pipelineAdvance: null,
        }, {
          source: "duplicate_lead_message",
          classifiedIntent: "acknowledgment",
          finalIntent: "acknowledgment",
          confidence: 1,
          missingStages: ["intent.classified", "intent.resolved"],
        });
        return { replied: true };
      }
    }

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
          let confirmationPlannedResponse: PlannedResponse | undefined;
          const composeAppointmentConfirmation = async (
            actionResult: Extract<
              ActionResult,
              {
                type:
                  | "appointment_confirmation_accepted"
                  | "appointment_confirmation_rejected";
              }
            >,
          ): Promise<string> => {
            const commercialPolicy = editorial?.commercialPolicy ?? null;
            const installmentTable = clinic.installmentRates && commercialPolicy
              ? buildInstallmentTable(
                  commercialPolicy,
                  clinic.installmentRates as InstallmentRate[],
                )
              : null;
            const planned = await this.executeResponsePlan({
              composerInput: {
                actionResult,
                conversationHistory: allMessages,
                historyWindowMessages: clinic.aiContextWindowMessages,
                clinic: {
                  name: clinic.name,
                  plan: clinic.plan,
                  specialty: editorial?.specialty ?? clinic.specialty,
                  toneOfVoice: editorial?.toneOfVoice ?? null,
                  playbook: editorial?.playbookText ?? null,
                  commercialPolicy,
                  receptionistName: editorial?.receptionistName ?? inferReceptionistNameFromGreeting(clinic.greetingMessage) ?? undefined,
                },
                leadName: extractFirstName(lead.name),
                timezone,
                isFirstMessage: false,
              },
              planInput: {
                commercialPolicy,
                installmentTable,
                allowedMediaIds: [],
                expectedState: currentConversationState?.state ?? "none",
                maxCharacters: resolveResponseMaxCharacters(conciergeConfig?.verbosity),
              },
              turnId,
              clinicId,
              conversationId: conversation.id,
              onRequiresHandoff: async (reason) => {
                await db
                  .update(conversationsTable)
                  .set({
                    needsAttention: true,
                    attentionReason: reason,
                    updatedAt: runtimeNow(),
                  })
                  .where(eq(conversationsTable.id, conversation.id));
                await this.notifyAttentionNeeded(
                  clinic,
                  channelConfig,
                  phone,
                  lead.name ?? null,
                  reason,
                );
              },
            });
            confirmationPlannedResponse = planned;
            return planned.response.text;
          };
          if (confirmationSignal === "yes") {
            if (appt) {
              await this.appointmentRepo.save({ ...appt, status: "confirmed", updatedAt: runtimeNow() });
            }
            confirmReplyText = await composeAppointmentConfirmation({
              type: "appointment_confirmation_accepted",
              appointmentLabel: confirmPayload.appointmentLabel,
            });
          } else {
            if (appt) {
              await this.appointmentRepo.save({ ...appt, status: "cancelled", updatedAt: runtimeNow() });
            }
            await db
              .update(conversationsTable)
              .set({ aiPaused: true, needsAttention: true, attentionReason: "Lead cancelou a consulta — reagendamento necessário", updatedAt: runtimeNow() })
              .where(eq(conversationsTable.id, conversation.id));
            confirmReplyText = await composeAppointmentConfirmation({
              type: "appointment_confirmation_rejected",
            });
          }
          const confirmAgentId = randomUUID();
          await this.conversationRepo.appendMessage({
            id: confirmAgentId,
            conversationId: conversation.id,
            author: "agent",
            body: confirmReplyText,
            sentAt: runtimeNow(),
            externalId: null,
            intent: null,
            deliveryFormat: null,
          });
          await this.enqueueConversationReply(clinicId, conversation.id, {
            version: 1,
            kind: "conversation_reply",
            turnId,
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
          }, {
            source: "appointment_confirmation",
            classifiedIntent: "acknowledgment",
            finalIntent: null,
            confidence: 1,
            missingStages: ["intent.classified", "intent.resolved"],
          }, confirmationPlannedResponse);
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

    const procedureSelection = await this.stateMachine.getOfferedProcedureByIndex(
      conversation.id,
      messageText,
      stateAsOf,
    );
    if (procedureSelection) {
      await this.stateMachine.invalidate(conversation.id);
    }
    const expiredSlotSelection = !hasPendingOffer
      ? await this.stateMachine.getRecentlyExpiredSlotSelection(
          conversation.id,
          messageText,
          stateAsOf,
        )
      : null;

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
      return { replied: false, reason: "rapid_low_information_throttled" };
    }

    // Comando de reset (testes): zera estado e reinicia conversa com saudação completa
    const resetRequested = !isFirstMessage && isResetCommand(messageText);

    // Lead pediu explicitamente para ver o menu fora do fluxo inicial
    const menuReRequested = !isMenuActive && !isFirstMessage && !resetRequested && isMenuRerequest(messageText);

    // Gap de inatividade: se o lead sumiu por tempo demais, recomeça com saudação.
    //
    // Usa conversationRestartHours (default 24h), NÃO staleConversationHours: aquele
    // campo é o TTL do pipeline de tratamento e porteia 6 pontos de decisão abaixo —
    // acoplar os dois fazia a janela de reinício herdar 4h/6h.
    //
    // Medido em produção: o gap p90 entre mensagens consecutivas do mesmo lead é de
    // 17h. Com 4h, 17,2% das respostas de lead eram tratadas como conversa nova e o
    // lead recebia a saudação de abertura no meio do atendimento (a maior causa de
    // perda de contexto). Ver docs/architecture/current.md.
    const isStaleConversation =
      !isFirstMessage && !isMenuActive && !resetRequested && !menuReRequested && !rescheduleAfterReminder &&
      shouldRestartConversation({
        leadMessages: allMessages.filter((m) => m.author === "lead"),
        now: timestamp,
        restartHours: clinic.conversationRestartHours,
      });

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
      expiredSlotSelection === null &&
      (!hasPendingOffer || !numberMatchesPendingSlot) &&
      !isProcedureListActive &&
      !resetRequested &&
      !menuReRequested &&
      !isFirstMessage &&
      /^\d+$/.test(nMsg) &&
      clinicMenuItems.some(i => i.enabled && nMsg === String(i.number));

    // isStaleConversation não está aqui: o LLM sempre classifica para capturar intents
    // explícitas (ex: "quero saber sobre custo") mesmo após longo silêncio.
    const skipLlm = expiredSlotSelection !== null || procedureSelection !== null || menuReRequested || isolatedGreeting || resetRequested || isDisabledItemSelection || isInvalidMenuNumber || isOrphanedMenuNumber;

    const nullSlotPref = { preferredDate: null as null, preferredPeriod: null as null, preferredTime: null as null, slotChoice: null as null, identifiedTreatment: null as null, ambiguousTreatmentMatches: null as null };

    const promptContext = buildPromptContext(clinic);

    const classification = expiredSlotSelection !== null
      ? {
          intent: "confirm_slot" as IntentType,
          slotPreference: { ...nullSlotPref, slotChoice: expiredSlotSelection },
          confidence: 1,
          shouldAskClarification: false,
          clarificationQuestion: null as null,
          handoffReason: null as null,
        }
      : rescheduleAfterReminder
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
          clinic.aiContextWindowMessages,
        );
    await recordDecisionTrace(this.decisionTraceSink, {
      turnId,
      stage: "intent.classified",
      occurredAt: runtimeNow().toISOString(),
      clinicId,
      conversationId: conversation.id,
      metadata: {
        intent: classification.intent,
        confidence: classification.confidence,
        source:
          expiredSlotSelection !== null
            ? "expired_slot"
            : rescheduleAfterReminder
              ? "appointment_reminder"
              : procedureSelection
                ? "procedure_selection"
                : menuResolution
                  ? "menu"
                  : skipLlm
                    ? "deterministic_skip"
                    : "llm",
        hasPendingOffer,
        pipelineActive: pipelineState !== null,
      },
    });

    const slotPreference = withDeterministicSlotPreferenceFallback(
      messageText,
      classification.slotPreference,
    );
    // Isolamento de mídia entre procedimentos: o tratamento "ativo" desta virada
    // — pipeline em curso tem prioridade sobre o que o classificador identificou
    // na mensagem livre. Usado para (a) filtrar o que entra na BIBLIOTECA DE
    // MÍDIA do prompt e (b) bloquear no envio qualquer [MEDIA:id] cujo
    // treatmentId divirja deste (ver resolveOutboundParts). null = sem
    // isolamento aplicável nesta virada (comportamento de hoje, sem filtro).
    const classifiedActiveTreatment = findTreatmentByIdOrName(
      clinicTreatments,
      { treatmentName: slotPreference.identifiedTreatment },
    );
    const activeTreatmentId = resolveMediaScopeTreatmentId({
      pipelineTreatmentId: pipelineState?.treatmentId,
      classifiedTreatment: classifiedActiveTreatment,
      treatments: clinicTreatments,
    });
    const stopContactDecision = resolveStopContactDecision({
      classifiedIntent: classification.intent,
      messageText,
    });
    const intent = (
      stopContactDecision?.intent ??
      (classification.intent === "stop_contact" ? "unclear" : classification.intent)
    ) as IntentType;
    const intentOverrides = new NamedDecisionOverrideTracker<IntentType>(
      classification.intent as IntentType,
    );
    intentOverrides.apply(intent, "stop_contact_normalization");

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
        return { replied: false, reason: "superseded_by_newer_message" };
      }
    }

    // ── Opt-out durável (Channel Safety Engine) ──
    // Lead pediu para parar de receber mensagens. Regra determinística: grava o
    // consentimento revogado no lead (o Safety Gate passa a bloquear
    // follow_up/recovery/campaign), confirma com respeito e sinaliza o owner. A
    // confirmação é texto fixo de propósito — nunca deixar o LLM tentar
    // reengajar quem acabou de pedir para sair. Reply a inbound não é gated,
    // então esta confirmação sai normalmente.
    if (intent === "stop_contact") {
      const decision = stopContactDecision;
      if (!decision) {
        return { replied: false, reason: "stop_contact_decision_missing" };
      }
      const optOutNow = decision.revokedAt;
      await db
        .update(leadsTable)
        .set({
          contactConsentRevokedAt: optOutNow,
          contactConsentSource: decision.source,
          updatedAt: optOutNow,
        })
        .where(eq(leadsTable.id, lead.id));
      await db
        .update(conversationsTable)
        .set({
          needsAttention: true,
          attentionReason: decision.attentionReason,
          updatedAt: optOutNow,
        })
        .where(eq(conversationsTable.id, conversation.id));

      const optOutText = decision.confirmationText;
      const optOutAgentId = randomUUID();
      await this.conversationRepo.appendMessage({
        id: optOutAgentId,
        conversationId: conversation.id,
        author: "agent",
        body: optOutText,
        sentAt: optOutNow,
        externalId: null,
        intent: "stop_contact",
        deliveryFormat: null,
      });
      await this.enqueueConversationReply(clinicId, conversation.id, {
        version: 1,
        kind: "conversation_reply",
        turnId,
        to: outboundAddress,
        agentMessageId: optOutAgentId,
        replyText: optOutText,
        intent: "stop_contact",
        useVoice: false,
        ttsConfig: ttsConf,
        interleavedParts: [],
        mediaParts: [],
        leadId: lead.id,
        pipelineAdvance: null,
      }, {
        source: "stop_contact_policy",
        classifiedIntent: "stop_contact",
        finalIntent: "stop_contact",
        confidence: 1,
        missingStages: ["intent.resolved"],
      });
      return { replied: true };
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
          commercialPolicy: editorial?.commercialPolicy,
        });
    intentOverrides.apply(coercedIntent, "business_intent_coercion");

    // ── Interceptor: resposta de tratamento após clarificação de agendamento ──
    // Quando a AI perguntou "qual procedimento você gostaria de realizar?" e o lead
    // respondeu com um nome de tratamento (ex: "lentes"), o IntentClassifier classifica
    // como general_question porque a mensagem sozinha parece informativa. Aqui detectamos
    // esse padrão e redirecionamos para check_availability para buscar slots reais — sem
    // isso, o ResponseComposer alucinaria horários inventados.
    let effectiveIntent = intentOverrides.value;
    const commercialPauseDetected = detectCommercialPauseText(messageText);
    if (commercialPauseDetected) {
      effectiveIntent = intentOverrides.apply("farewell", "commercial_pause");
      // Uma pausa comercial encerra qualquer jornada/oferta que ainda estivesse
      // aberta. A próxima mensagem da lead poderá retomar normalmente.
      if (pipelineState || hasPendingOffer) {
        await this.stateMachine.invalidate(conversation.id);
      }
    }
    const simplePaymentPolicyQuestion = isSimplePaymentPolicyQuestion(messageText);
    const businessHoursQuestion = isBusinessHoursQuestion(messageText);
    if (!commercialPauseDetected && simplePaymentPolicyQuestion && effectiveIntent === "needs_human") {
      effectiveIntent = intentOverrides.apply("price_inquiry", "payment_policy_question");
    }
    if (!commercialPauseDetected && businessHoursQuestion) {
      effectiveIntent = intentOverrides.apply("general_question", "business_hours_question");
    }
    // Quantidade que continua a pergunta de preço anterior ("qual o valor?" →
    // "tenho 13 lentes"). Isolada, a segunda mensagem parece comentário genérico e
    // a cotação se perde. Só coage intents "vazios" — nunca sobrepõe uma intenção
    // de agenda que o lead tenha manifestado depois.
    if (
      !commercialPauseDetected &&
      (effectiveIntent === "acknowledgment" || effectiveIntent === "general_question" || effectiveIntent === "unclear") &&
      isQuantityFollowupToPriceQuestion({
        message: messageText,
        incomingMessageId: incomingMessage.id,
        history: allMessagesForContext,
      })
    ) {
      effectiveIntent = intentOverrides.apply("price_inquiry", "quantity_price_followup");
    }
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
        effectiveIntent = intentOverrides.apply("check_availability", "procedure_clarification");
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
        effectiveIntent = intentOverrides.apply("needs_human", "uncatalogued_maintenance");
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

    if (
      (effectiveIntent === "general_question" || effectiveIntent === "price_inquiry") &&
      isClinicalTreatmentPlanJudgmentRequest(messageText)
    ) {
      effectiveIntent = intentOverrides.apply("needs_human", "clinical_judgment_handoff");
      maintenanceHandoffReason = "Definição clínica de quantidade/combinação de procedimentos — avaliação do doutor necessária";
    }

    // W4.3 (caso Paula): o operador ofertou um horário concreto manualmente e o
    // lead está respondendo a ELE. Sem oferta do sistema pendente, a IA não pode
    // re-derivar slots de avaliação (contradiz o operador) — devolve o controle a
    // ele com um aceno caloroso e determinístico. Só para intenções de agenda ou
    // quando o lead cita uma data.
    const leadIsRespondingToBooking =
      effectiveIntent === "book_appointment" ||
      effectiveIntent === "check_availability" ||
      effectiveIntent === "confirm_slot" ||
      effectiveIntent === "reject_slots" ||
      extractExplicitPreferredDateFromText(messageText) !== null;
    const operatorManagedBooking =
      !hasPendingOffer &&
      leadIsRespondingToBooking &&
      lastSlotOfferWasByOperator(allMessages);

    // ── A6: Triagem de caso clínico atípico ──
    // Dente fraturado, só raiz, ponte, prótese, implante, extração: a IA empurrava o
    // pitch padrão de lentes. O sistema decide: não cotar; fazer a triagem que o doutor
    // precisa (radiografia/foto) e sinalizar atenção. Não interrompe pipeline em curso.
    let atypicalTriageContext: string | null = null;
    let atypicalCaseLabel: string | null = null;
    // Preenchido quando uma objeção cadastrada casa com uma dúvida de
    // garantia/manutenção que, sem isto, cairia no handoff genérico "manda foto".
    let objectionDirectiveContext: string | null = null;
    if (
      (effectiveIntent === "general_question" || effectiveIntent === "price_inquiry") &&
      !pipelineState
    ) {
      const atypical = detectAtypicalClinicalCase(messageText);
      if (atypical) {
        atypicalCaseLabel = atypical;
        atypicalTriageContext =
          `CASO CLÍNICO ATÍPICO detectado (${atypical}). NÃO cote o preço padrão de lentes nem empurre o pitch de lentes. ` +
          `Acolha o relato com empatia e explique que, nesses casos (${atypical}), o doutor precisa avaliar individualmente. ` +
          `Peça, se possível, uma radiografia recente e uma foto do sorriso atual, e explique que a partir disso a equipe ` +
          `orienta o melhor caminho e o orçamento certo para o caso. Conduza gentilmente para agendar a avaliação. ` +
          `Seja acolhedor e específico ao que o lead relatou.`;
        effectiveIntent = intentOverrides.apply("general_question", "atypical_case_triage");
        await db
          .update(conversationsTable)
          .set({
            needsAttention: true,
            attentionReason: `Caso clínico atípico (${atypical}) — avaliar antes de cotar`,
            updatedAt: runtimeNow(),
          })
          .where(eq(conversationsTable.id, conversation.id));
      }
    }

    // A5: Objeção de preço antigo ("vocês me passaram um valor menor antes").
    const oldPriceObjectionDetected =
      isPriceShapedIntent && !atypicalTriageContext && detectOldPriceObjection(messageText);

    // P0.2: Detectar pergunta de manutenção (garantia tem trilho próprio, abaixo)
    if (effectiveIntent === "needs_human" && !maintenanceHandoffReason) {
      const normalized = normalizeFreeText(messageText);
      if (isMaintenanceInquiryText(normalized)) {
        // A clínica pode ter cadastrado uma objeção que JÁ responde essa dúvida
        // (ex.: "como é a manutenção?"). Nesse caso ela decidiu que a IA responde —
        // pausar e mandar "manda foto" ignora a config. Honra a objeção cadastrada;
        // só cai no handoff quando não há resposta pronta.
        const matchedObjection = matchRegisteredObjection(
          messageText,
          editorial?.objections,
          treatmentTermsForObjectionMatch(clinicTreatments),
        );
        if (matchedObjection) {
          objectionDirectiveContext = buildObjectionDirectiveContext(matchedObjection);
        } else {
          maintenanceHandoffReason = "Pergunta sobre manutenção/reparo — requer avaliação com foto";
        }
      }
    }

    // ── #21: relato de dano em trabalho existente ──
    // "Um dos dentes quebrou" tem três desfechos comerciais opostos — garantia
    // (trabalho nosso, recente), manutenção paga (trabalho nosso, fora da garantia)
    // ou venda nova (trabalho de outra clínica) — e a IA não pode escolher sozinha.
    // O que ela nunca pode fazer é o que fez com a Carla em 16/07: responder um
    // relato de dano com lista de horários. O trilho roda sobre QUALQUER intent,
    // fora do alcance da LLM, porque é justamente o rótulo dela que falha aqui
    // (reject_slots, general_question, book_appointment nos casos medidos).
    // Não roda quando a clínica cadastrou uma objeção que já responde a dúvida:
    // config da clínica tem precedência sobre trilho nosso.
    let existingWorkProblem: {
      damageLabel: string;
      relationship: "known_patient" | "self_declared" | "unknown";
      lastVisitLabel: string | null;
      lastVisitTreatment: string | null;
      askedPrice: boolean;
    } | null = null;
    if (!objectionDirectiveContext) {
      const damage = detectExistingWorkProblem(messageText);
      if (damage) {
        const pastVisits = await this.appointmentRepo.findPastByLeadId(lead.id);
        const relationship = pastVisits.length > 0
          ? "known_patient"
          : detectSelfDeclaredPastWork(messageText)
            ? "self_declared"
            : "unknown";
        const askedPrice = isPriceRequestText(normalizeFreeText(messageText));
        if (
          shouldEngageDamageRail({
            target: damage.target,
            relationship,
            askedPrice,
            hasActivePipeline: pipelineState !== null,
          })
        ) {
          const lastVisit = pastVisits[0] ?? null;
          const lastVisitTreatment = lastVisit?.treatmentId
            ? clinicTreatments.find((t) => t.id === lastVisit.treatmentId)?.name ?? null
            : null;
          const lastVisitLabel = lastVisit ? formatVisitDate(timezone, lastVisit.startsAt) : null;
          existingWorkProblem = {
            damageLabel: damage.label,
            relationship,
            lastVisitLabel,
            lastVisitTreatment,
            askedPrice,
          };
          effectiveIntent = intentOverrides.apply("needs_human", "existing_work_damage");
          maintenanceHandoffReason =
            relationship === "known_patient"
              ? `Relato de dano (${damage.label}) — paciente com consulta em ${lastVisitLabel}` +
                `${lastVisitTreatment ? ` (${lastVisitTreatment})` : ""}. Verificar garantia.`
              : relationship === "self_declared"
                ? `Relato de dano (${damage.label}) — lead diz que o trabalho foi feito aqui. Verificar garantia.`
                : `Relato de dano (${damage.label}) — origem do trabalho não confirmada`;
          // O trilho substitui a triagem de caso atípico: mesma mensagem, leitura
          // mais específica (não é dente natural comprometido, é trabalho quebrado).
          atypicalTriageContext = null;
        }
      }
    }

    // ── Garantia: segue o que a clínica cadastrou, em qualquer intent ──
    // Roda depois do trilho de dano de propósito. "Minha lente descolou, tem
    // garantia?" é decisão sobre um caso concreto, e essa é do operador — foi o que
    // ele fez em produção ("Cobre o descolamento por completo da lente", 07/07).
    // Aqui é a pergunta sobre a POLÍTICA, que a clínica já respondeu no cadastro.
    const warrantyAnswer = existingWorkProblem
      ? null
      : resolveWarrantyAnswer({
          message: messageText,
          warrantyPolicy: editorial?.warrantyPolicy,
          objections: editorial?.objections,
          treatmentTerms: treatmentTermsForObjectionMatch(clinicTreatments),
        });
    if (warrantyAnswer) {
      // general_question porque a resposta é informativa e sai da config. O
      // contexto é consumido no topo daquele ramo, antes de qualquer resolução de
      // tratamento — a Vitalli cadastrou "garantia" como alias de "Manutenção
      // Preventiva de lentes" (R$400), e sem isso a pergunta viraria cotação.
      effectiveIntent = intentOverrides.apply("general_question", "warranty_policy");
    }

    // P0.5: Detectar pergunta sobre nome antigo da clínica ou mudança de endereço
    let previousClinicNameContext: string | null = null;
    if (effectiveIntent === "general_question" || effectiveIntent === "greeting") {
      const normalized = normalizeFreeText(messageText);
      const changeInfo = isClinicNameOrAddressChangeQuestion(normalized, editorial?.commercialPolicy);
      if (changeInfo.isMatch) {
        const info = extractPreviousClinicInfo(editorial?.commercialPolicy);
        if (changeInfo.type === "clinic_name" && info.previousClinicName) {
          previousClinicNameContext = `Pergunta sobre nome antigo: era "${info.previousClinicName}", agora é "${clinic.name}"`;
        } else if (changeInfo.type === "address" && info.previousAddress) {
          previousClinicNameContext = `Pergunta sobre endereço antigo: era "${info.previousAddress}", agora é "${clinic.address}"`;
        }
        // Não muda intent, apenas adiciona contexto para ResponseComposer
      }
    }

    // ── Guard: termo genérico cobre 2+ variações do catálogo ──
    // Recalcula a ambiguidade em código; se o classificador escolheu uma variação
    // sozinho (ou nenhuma), força a apresentação de todas as opções que o termo cobre.
    const ambiguousTreatmentOverride =
      effectiveIntent === "price_inquiry"
        ? detectAmbiguousTreatmentTerm(messageText, clinicTreatments)
        : null;

    // ── A4: Guard determinístico de preço por quantidade (pacotes) ──
    // Pergunta com quantidade de pacote (ex.: "16 lentes") é resolvida pelo sistema:
    // valor exato do pacote OU escalonamento para a equipe. A LLM nunca extrapola.
    const quantityPriceResolution = isPriceShapedIntent
      ? resolveQuantityPriceQuery(messageText, clinicTreatments)
      : null;
    const referencedPrice = isPriceShapedIntent
      ? extractReferencedPrice(messageText)
      : null;

    // ── 7. Executa ação e compõe resposta ──
    let replyText = "";
    let composerInputTokens = 0;
    let composerOutputTokens = 0;
    let composerModel = "gpt-4o-mini";
    // Listas numeradas de horários são muito mais claras em texto do que em voz —
    // nunca sintetizar áudio para essas respostas, independente do modo B-WAVE.
    let forceTextOnlyReply = false;

    const calendarGateway = this.calendarGatewayResolver({
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
    let plannedResponse: PlannedResponse | undefined;
    let triggerPartsOverride: import("@/core/intelligence/ResponseComposer").ResponsePart[] | null = null;
    const turnSafetyHandoff = new TurnSafetyHandoffGuard();
    // Avanço de pipeline adiado: executado APÓS todo o conteúdo ser enviado para evitar
    // race condition onde um segundo webhook encontra pipelineState=Q&A durante o envio
    // dos blocos e injeta o texto de comparação no meio da sequência.
    let pendingPipelineAdvance: PipelineAdvance | null = null;
    // J7 — Gate de ritmo de CTA: se o turno anterior do agente/operador já fez
    // convite de avaliação/agenda/foto e o lead não reagiu a ele, este turno
    // responde sem repetir o convite (o sistema decide, a LLM verbaliza).
    const ctaSuppressed = shouldSuppressNextStepCta({
      previousAgentMessages: collectPreviousAgentTurnBodies(allMessagesForContext),
      currentLeadMessage: messageText,
    });
    // Calculado uma vez: compose() pode rodar duas vezes na mesma virada.
    const pipelineStepMediaIds = collectPipelineStepMediaIds(
      activeTreatmentId
        ? clinicTreatments.find((candidate) => candidate.id === activeTreatmentId)
        : null,
      clinicTreatments,
    );
    // P0.6: Fallback para IA indisponível (timeout, OpenAI errors)
    // Aciona needs_human silenciosamente + log Sentry (sem alerta por mensagem)
    const compose = async (
      actionResult: ComposerInput["actionResult"],
      // Segunda chamada na mesma vez (ex.: oferta de horários após a resposta de
      // preço): a resposta já composta entra no histórico como fala do agente —
      // sem isso o LLM re-responde a última pergunta do lead antes de agir.
      options?: { extraHistory?: Message[] },
    ) => {
      try {
        if (shouldForceTextOnlyForActionResult(actionResult)) forceTextOnlyReply = true;
        const commercialPolicy = editorial?.commercialPolicy ?? null;
        const installmentTable = clinic.installmentRates && commercialPolicy
          ? buildInstallmentTable(commercialPolicy, clinic.installmentRates as InstallmentRate[])
          : null;
        const filteredMediaLibrary = filterMediaLibraryForComposer(
          editorial?.mediaLibrary ?? [],
          activeTreatmentId,
          actionResult,
          pipelineStepMediaIds,
        );
        const mediaProjection = buildAlignedResponseMediaProjection(filteredMediaLibrary);
        const planned = await this.executeResponsePlan({
          composerInput: {
            actionResult,
            suppressNextStepCta: ctaSuppressed,
            conversationHistory: options?.extraHistory
              ? [...allMessagesForContext, ...options.extraHistory]
              : allMessagesForContext,
            historyWindowMessages: clinic.aiContextWindowMessages,
            clinic: {
              name: clinic.name,
              plan: clinic.plan,
              specialty: editorial?.specialty ?? clinic.specialty,
              toneOfVoice: editorial?.toneOfVoice ?? null,
              playbook: editorial?.playbookText ?? null,
              commercialPolicy,
              installmentTable,
              mediaLibrary: mediaProjection.composerMediaLibrary,
              receptionistName: editorial?.receptionistName ?? inferReceptionistNameFromGreeting(clinic.greetingMessage) ?? undefined,
            },
            context: promptContext,
            leadName: extractFirstName(lead.name),
            timezone,
            isFirstMessage,
            conversationExperience: experience,
            conciergeVerbosity: conciergeConfig?.verbosity,
            conciergeDrive: conciergeConfig?.drive,
            maxCharacters: resolveResponseMaxCharacters(conciergeConfig?.verbosity),
            resumedFromHumanTakeover,
            voiceResponseEnabled: voiceEnabled,
          },
          planInput: {
            commercialPolicy,
            installmentTable,
            allowedMediaIds: mediaProjection.allowedMediaIds,
            expectedState: currentConversationState?.state ?? "none",
            maxCharacters: resolveResponseMaxCharacters(conciergeConfig?.verbosity),
          },
          turnId,
          clinicId,
          conversationId: conversation.id,
          safetyHandoffGuard: turnSafetyHandoff,
          onRequiresHandoff: async (reason) => {
            await db
              .update(conversationsTable)
              .set({
                needsAttention: true,
                attentionReason: reason,
                updatedAt: runtimeNow(),
              })
              .where(eq(conversationsTable.id, conversation.id));
            await this.notifyAttentionNeeded(
              clinic,
              channelConfig,
              phone,
              lead.name ?? null,
              reason,
            );
          },
        });
        plannedResponse = planned;
        const composed = planned.response;
        composerInputTokens = composed.inputTokens;
        composerOutputTokens = composed.outputTokens;
        composerModel = composed.model;
        const parts = isFirstMessage
          ? prependFirstMessageSalutation(composed.parts, timezone, lead.name)
          : composed.parts;
        composedMediaIds = composed.mediaIds;
        composedParts = parts;
        return parts
          .filter((p): p is { type: "text"; content: string } => p.type === "text")
          .map((p) => p.content)
          .join("\n\n")
          .trim();
      } catch (err) {
        // P0.6: IA falhou — aciona needs_human silenciosamente
        // Log em Sentry para monitoramento (sem alerta por mensagem)
        const errorContext = {
          clinicId: clinic.id,
          conversationId: conversation.id,
          leadId: lead.id,
          actionResult: actionResult.type,
          errorMessage: err instanceof Error ? err.message : String(err),
          timestamp: runtimeNow().toISOString(),
        };
        console.error("[P0.6] IA indisponível, acionando needs_human:", errorContext);
        // TODO: Log estruturado em Sentry com agregação de erros
        // Se taxa de erro > 3% em organização, dispara alerta

        // Interrompe o ramo imediatamente. Devolver string vazia permitia que o
        // switch continuasse e alterasse estado/agenda antes do catch externo.
        throw err;
      }
    };

    const offerReadyPipelineSlots = async (): Promise<boolean> => {
      if (!pipelineState) return false;

      const pipelineTreatment = clinicTreatments.find((t) => t.id === pipelineState.treatmentId);
      const currentStepType = pipelineTreatment?.pipelineSteps?.[pipelineState.stepIndex]?.type ?? null;
      if (!shouldOfferSlotsAfterPipelinePhoto(currentStepType, pipelineState.photoReceived)) {
        return false;
      }

      const selectedTreatment = pipelineState.selectedTreatmentId
        ? clinicTreatments.find((t) => t.id === pipelineState.selectedTreatmentId) ?? null
        : null;
      const commercialTreatment = selectedTreatment ?? pipelineTreatment;
      const evaluationTreatment = commercialTreatment?.requiresEvaluationFirst
        ? clinicTreatments.find((t) => /avalia[cç][aã]o/i.test(t.name))
        : null;
      const bookingTreatment = evaluationTreatment ?? commercialTreatment;
      if (!bookingTreatment) return false;

      turnTouchedScheduling = true;
      const { slots } = await this.fetchAndOfferSlots(
        conversation.id,
        clinic,
        calendarGateway,
        timezone,
        businessHours,
        undefined,
        undefined,
        undefined,
        bookingTreatment.name,
        bookingTreatment.durationMinutes,
        voiceEnabled,
      );

      replyText = slots.length > 0
        ? evaluationTreatment
          ? await compose({
              type: "evaluation_redirect",
              treatmentName: pipelineTreatment?.name ?? bookingTreatment.name,
              evaluationSlots: slots,
            })
          : await compose({ type: "slots_found", slots, askedForPreference: false })
        : await compose({ type: "no_slots_available" });
      return true;
    };

    // ── A7: Guards de texto do fluxo de sinal ──
    // Roda antes da decisão normal. Comprovante em si (imagem/PDF) já foi tratado na
    // seção de mídia; aqui cobrimos os caminhos de TEXTO enquanto há sinal pendente.
    const depositTextState = await this.stateMachine.getDepositState(conversation.id, stateAsOf);
    let releasedDepositHoldForChange = false;
    if (depositTextState) {
      const normalizedDep = normalizeFreeText(messageText);
      const saysPaid = /\b(paguei|ja paguei|fiz o pix|fiz pix|transferi|enviei o pix|pix feito|comprovante|mandei o pix)\b/.test(normalizedDep);
      const wantsChange =
        effectiveIntent === "book_appointment" ||
        effectiveIntent === "check_availability" ||
        effectiveIntent === "reject_slots" ||
        effectiveIntent === "reschedule_appointment" ||
        effectiveIntent === "cancel_appointment";

      if (depositTextState.state === "awaiting_deposit_proof") {
        if (saysPaid) {
          // Diz que pagou mas não anexou o comprovante → pede o anexo, mantém o hold.
          const missingText = buildDepositProofMissingMessage();
          const missingAgentId = randomUUID();
          await this.conversationRepo.appendMessage({
            id: missingAgentId,
            conversationId: conversation.id,
            author: "agent",
            body: missingText,
            sentAt: runtimeNow(),
            externalId: null,
            intent: "acknowledgment",
            deliveryFormat: null,
          });
          await this.enqueueConversationReply(clinicId, conversation.id, {
            version: 1,
            kind: "conversation_reply",
            turnId,
            to: outboundAddress,
            agentMessageId: missingAgentId,
            replyText: missingText,
            intent: "acknowledgment",
            useVoice: false,
            ttsConfig: ttsConf,
            interleavedParts: [],
            mediaParts: [],
            leadId: lead.id,
            pipelineAdvance: null,
          });
          return { replied: true };
        }
        if (wantsChange) {
          // Quer outro horário/cancelar → libera o hold e deixa o fluxo normal reofertar.
          if (depositTextState.payload.reservationId) {
            turnTouchedScheduling = true;
            await this.reservationService.release(depositTextState.payload.reservationId);
          }
          await this.stateMachine.invalidate(conversation.id);
          releasedDepositHoldForChange = true;
          // Cai para o fluxo normal abaixo (estado de sinal já limpo).
        }
        // Pergunta geral durante a espera → responde normalmente, mantém o estado.
      } else if (depositTextState.state === "deposit_proof_received" && wantsChange) {
        // Comprovante já enviado (dinheiro em jogo) e lead quer mudar → operador decide.
        effectiveIntent = intentOverrides.apply("needs_human", "deposit_change_after_proof");
        maintenanceHandoffReason = "Lead pagou o sinal e pediu alteração — operador decide";
      }
    }

    const normalizedSchedulingIntent = normalizeSchedulingIntentForMissingPendingOffer(
      effectiveIntent,
      slotPreference,
      messageText,
      hasPendingOffer,
      lastAgentMessage?.body ?? null,
    );
    effectiveIntent = intentOverrides.apply(
      normalizedSchedulingIntent,
      "missing_pending_offer_normalization",
    );
    // Nenhuma regra posterior pode transformar uma pausa comercial em uma nova
    // pergunta de negócio ou em uma confirmação de agenda.
    if (commercialPauseDetected) {
      effectiveIntent = intentOverrides.apply("farewell", "commercial_pause");
    }
    // J2 — Aceite de oferta aberta: "Boa noite pode sim" respondendo a "posso te
    // ajudar com informações?" é aceite, não saudação/ack. Coage para
    // general_question para o fluxo ENTREGAR a oferta — em vez de cair na
    // re-saudação stale (que reapresentava a Gleice) ou num aceno genérico.
    // Com oferta de horários pendente, a confirmação de slot tem prioridade.
    if (
      !commercialPauseDetected &&
      !hasPendingOffer &&
      (effectiveIntent === "greeting" || effectiveIntent === "acknowledgment" || effectiveIntent === "unclear") &&
      isAffirmativeReplyToOpenOffer({ lastAgentMessage: lastAgentMessage?.body, message: messageText })
    ) {
      effectiveIntent = intentOverrides.apply("general_question", "open_offer_acceptance");
    }
    const responseIntent: IntentType = commercialPauseDetected ? "farewell" : effectiveIntent;
    await recordDecisionTrace(this.decisionTraceSink, {
      turnId,
      stage: "intent.resolved",
      occurredAt: runtimeNow().toISOString(),
      clinicId,
      conversationId: conversation.id,
      metadata: {
        classifiedIntent: classification.intent,
        normalizedIntent: intent,
        coercedIntent,
        finalIntent: responseIntent,
        classifierOverridden:
          classification.intent !== responseIntent,
        overrideCount: intentOverrides.rules.length,
        overrideRules: intentOverrides.rules.join("|"),
        commercialPauseDetected,
        skipLlm,
      },
    });

    // Abertura enlatada: única resposta que SUBSTITUI o conteúdo em vez de
    // responder a ele. Marcada aqui para a recheca de rajada logo antes do
    // envio — ver o guard "Rajada pós-composição" no fim do handle.
    let replyIsCannedOpener = false;

    if (isConversationOpening && shouldShowInitialMenu(experience, effectiveIntent)) {
      const salutation = getDayGreeting(timezone);
      const nameGreeting = extractFirstName(lead.name) ? `, ${extractFirstName(lead.name)}` : "";
      replyText = `${salutation}${nameGreeting}! ${buildMenuBody(clinic, "first", experience)}`;
      await this.stateMachine.offerMenu(conversation.id);
    } else if (isConversationOpening && shouldSendConciergeStarter(experience, effectiveIntent)) {
      replyText = buildConciergeStarter(clinic, timezone, lead.name, editorial?.receptionistName);
      // Texto puro, sem efeito de estado — pode ser descartado com segurança se
      // o lead falar de novo enquanto compomos. O menu acima NÃO é marcado:
      // offerMenu() já gravou estado e o descarte deixaria um menu órfão.
      replyIsCannedOpener = true;
    } else if (resetRequested) {
      // Zera estado e marca boundary para que a próxima mensagem receba histórico pós-reset
      await this.stateMachine.markResetBoundary(conversation.id);
      if (experience === "menu_first") {
        const salutation = getDayGreeting(timezone);
        const nameGreeting = extractFirstName(lead.name) ? `, ${extractFirstName(lead.name)}` : "";
        replyText = `${salutation}${nameGreeting}! ${buildMenuBody(clinic, "first", experience)}`;
        await this.stateMachine.offerMenu(conversation.id);
      } else {
        replyText = buildConciergeStarter(clinic, timezone, lead.name, editorial?.receptionistName);
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
        const starter = buildConciergeStarter(
          clinic,
          timezone,
          lead.name,
          editorial?.receptionistName,
        );
        replyText = isRepeatedConversationalReply(lastAgentMessage?.body, starter)
          ? buildConversationReentryAcknowledgment(messageText)
          : starter;
      } else {
        replyText = await compose({ type: "acknowledgment" });
      }
    } else if (businessHoursQuestion) {
      const businessHoursAnswer = buildBusinessHoursAnswer(
        clinic.businessHours,
        messageText,
        clinic.outsideHoursExceptionEnabled,
      );
      // W4.3b (caso Paula): duas perguntas de horário no mesmo burst geravam a
      // MESMA resposta determinística duas vezes (o debounce nem sempre funde o
      // burst). Não reenvia se a última resposta do agente foi idêntica há < 2min.
      if (
        lastAgentMessage &&
        lastAgentMessage.body.trim() === businessHoursAnswer.trim() &&
        runtimeNow().getTime() - lastAgentMessage.sentAt.getTime() < 2 * 60 * 1000
      ) {
        // Claim liberado pelo finally do processamento principal.
        return {
          replied: false,
          reason: "duplicate_deterministic_reply_suppressed",
        };
      }
      replyText = businessHoursAnswer;
      forceTextOnlyReply = true;
      // "Vocês atendem aos sábados?" numa clínica que atende → confirma E oferta
      // a agenda real do sábado, em vez de recitar o cadastro e parar. Reusa o
      // mesmo fetch do caminho de agendamento: a disponibilidade sai do
      // calendário, nunca do texto de configuração. Sábado não é caso especial
      // no SlotEngine — o que faltava era a pergunta chegar até ele.
      //
      // Não reoferta com proposta aberta (o lead ainda deve um número) e não
      // atropela a escalação de exceção de horário: lá a resposta é "vou
      // verificar com a equipe", ofertar slots seria contraditório.
      if (
        isSaturdayQuestionForOperatingClinic(messageText, businessHours) &&
        !hasPendingOffer &&
        !requiresTeamCheckForHours(
          messageText,
          clinic.businessHours,
          clinic.outsideHoursExceptionEnabled,
        )
      ) {
        turnTouchedScheduling = true;
        const { slots: saturdaySlots, preferredDayEmpty: saturdayFull } = await this.fetchAndOfferSlots(
          conversation.id,
          clinic,
          calendarGateway,
          timezone,
          businessHours,
          "sabado",
        );
        if (saturdaySlots.length > 0) {
          replyText = buildSaturdayAvailabilityAnswer({ slots: saturdaySlots, dayIsFull: saturdayFull });
        }
      }
      // Somente tenants com opt-in explícito prometem análise de exceção e geram
      // atenção humana. Incidentes de uma clínica não viram política global.
      if (
        requiresTeamCheckForHours(
          messageText,
          clinic.businessHours,
          clinic.outsideHoursExceptionEnabled,
        )
      ) {
        await db
          .update(conversationsTable)
          .set({
            needsAttention: true,
            attentionReason: "Lead pediu horário fora da janela padrão — avaliar exceção",
            updatedAt: runtimeNow(),
          })
          .where(eq(conversationsTable.id, conversation.id));
      }
    } else if (operatorManagedBooking) {
      // W4.3: o operador está conduzindo o agendamento — a IA acena e devolve o
      // controle, sem re-derivar avaliação nem contradizer a oferta manual.
      replyText = "Perfeito! Vou confirmar esse horário com a nossa equipe e já te retorno para fecharmos tudo. 😊";
      forceTextOnlyReply = true;
      const bookingReason = "Operador ofertou horário manualmente — lead respondeu; confirmar agendamento no painel";
      await db
        .update(conversationsTable)
        .set({
          aiPaused: true,
          takeoverExpiresAt: null,
          needsAttention: true,
          attentionReason: bookingReason,
          updatedAt: runtimeNow(),
        })
        .where(eq(conversationsTable.id, conversation.id));
      await this.notifyAttentionNeeded(clinic, channelConfig, phone, lead.name ?? null, bookingReason);
    } else {
      switch (effectiveIntent) {
      // ── Confirmação de slot ──
      case "confirm_slot": {
        if (!hasPendingOffer && pipelineState && !didAgentAskToShowAvailability(lastAgentMessage?.body ?? null)) {
          const pipelineTreatment = clinicTreatments.find(t => t.id === pipelineState.treatmentId) ?? null;
          // J2 (replay B, 19/07): inclui o passo ATUAL na busca — com o pipeline
          // posicionado na apresentação deferida (A3), o "pode sim" classificado
          // como confirm_slot pulava a apresentação e ia direto ao pedido de foto.
          const nextContent = pipelineTreatment?.pipelineSteps
            ? nextUnsentPipelineContentStep(
                pipelineTreatment.pipelineSteps,
                pipelineState.stepIndex,
                allMessagesForContext,
                pipelineMediaTitleById,
              )
            : null;
          if (nextContent) {
            const contentReply = buildPipelineContentReply(nextContent.step);
            replyText = contentReply.replyText;
            composedParts = contentReply.parts;
            composedMediaIds = contentReply.mediaIds;
            forceTextOnlyReply = true;

            const next = nextActivePipelineStep(
              pipelineTreatment!.pipelineSteps!,
              nextContent.index + 1,
              { conversationHistory: allMessagesForContext },
            );
            pendingPipelineAdvance = next
              ? { action: "advance", nextStepIndex: next.index }
              : { action: "exit" };
            break;
          }
        }

        // Precisa ser lido ANTES de qualquer invalidate() abaixo: getOfferedTreatment
        // só retorna enquanto o estado é "slots_offered", e os ramos "no_match" e "data
        // não bate" invalidam a oferta antes de re-buscar. Sem carregar aqui, a reoferta
        // perde a janela de início do tratamento (ex.: lentes 9h/16h) e a duração real,
        // caindo na grade/duração padrão. É o mesmo objeto usado no book/sinal mais abaixo.
        const offeredTreatment = await this.stateMachine.getOfferedTreatment(conversation.id);

        // Lead respondeu com dia/período/hora em vez do número: resolve contra os
        // slots pendentes antes de assumir qualquer opção. Roda ANTES da guarda de
        // data abaixo, que continua sendo a dona do caso "data não bate" (ramo
        // validado por replay nas waves 3/4).
        const pendingChoice = resolvePendingSlotChoice({ slotPreference, pendingSlots, timezone, businessHours });

        if (pendingChoice.kind === "ambiguous") {
          // Mais de uma opção pendente atende ao que o lead pediu — pergunta qual,
          // preservando os números originais da lista. A oferta continua válida.
          const optionLines = pendingChoice.matches.map((m) => `${m.index}. ${m.label}`).join("\n");
          replyText = [
            "Perfeito! Tenho estas opções que encaixam no que você pediu:",
            "",
            optionLines,
            "",
            "Me responde só com o número da opção que preferir. 😊",
          ].join("\n");
          forceTextOnlyReply = true;
          break;
        }

        // Período/hora pedidos não batem com nenhum slot pendente e não há data no
        // pedido — caso que a guarda abaixo não cobre (ela exige preferredDate) e
        // que, sem isto, cairia no fallback da opção 1. Busca horários novos já com
        // a preferência do lead.
        if (pendingChoice.kind === "no_match" && !slotPreference.preferredDate) {
          await this.stateMachine.invalidate(conversation.id);
          turnTouchedScheduling = true;
          const { slots: prefSlots, preferredDayEmpty: prefEmpty } = await this.fetchAndOfferSlots(
            conversation.id, clinic, calendarGateway, timezone, businessHours,
            undefined,
            slotPreference.preferredPeriod ?? undefined,
            slotPreference.preferredTime ?? undefined,
            offeredTreatment?.treatmentName, offeredTreatment?.durationMinutes, voiceEnabled,
          );
          if (prefSlots.length > 0 && !prefEmpty) {
            replyText = await compose({ type: "slots_found", slots: prefSlots, askedForPreference: false });
            forceTextOnlyReply = true;
          } else if (prefSlots.length > 0) {
            replyText = await compose({ type: "no_slots_available", alternativeSlots: prefSlots });
          } else {
            replyText = await compose({ type: "no_slots_available" });
          }
          break;
        }

        // Guarda de segurança: se o lead não escolheu pelo número mas mencionou uma data
        // que não bate com nenhum slot pendente, trata como nova solicitação para essa data.
        if (!slotPreference.slotChoice && slotPreference.preferredDate && pendingSlots) {
          const targetDay = timezone.resolvePreferredDate(slotPreference.preferredDate, runtimeNow(), businessHours);
          if (targetDay) {
            const dateMatchesPending = pendingSlots.some((s) => {
              const p = timezone.toLocalParts(new Date(s.startsAt));
              const t = timezone.toLocalParts(targetDay);
              return p.year === t.year && p.month === t.month && p.day === t.day;
            });
            if (!dateMatchesPending) {
              await this.stateMachine.invalidate(conversation.id);
              turnTouchedScheduling = true;
              const { slots: redirectSlots, preferredDayEmpty: rdEmpty, outsideBookingWindow: rdOutside, outsideBusinessHours: rdNotOpen, preferredPeriodUnavailable: rdPeriod } = await this.fetchAndOfferSlots(
                conversation.id, clinic, calendarGateway, timezone, businessHours,
                slotPreference.preferredDate, slotPreference.preferredPeriod ?? undefined,
                undefined, offeredTreatment?.treatmentName, offeredTreatment?.durationMinutes, voiceEnabled,
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

        const choiceIndex = pendingChoice.kind === "resolved"
          ? pendingChoice.index
          : (slotPreference.slotChoice ?? 1);
        const chosenSlot = pendingSlots
          ? pendingSlots.find((s) => s.index === choiceIndex) ?? pendingSlots[0]
          : null;

        if (!chosenSlot) {
          // Lead escolheu (por número OU expressando dia/hora) mas a oferta expirou (15 min TTL)
          if (slotPreference.slotChoice !== null || slotPreference.preferredTime || slotPreference.preferredDate) {
            turnTouchedScheduling = true;
            const { slots: freshSlots } = await this.fetchAndOfferSlots(
              conversation.id,
              clinic,
              calendarGateway,
              timezone,
              businessHours,
              undefined, undefined, undefined, offeredTreatment?.treatmentName, offeredTreatment?.durationMinutes, voiceEnabled,
            );
            if (freshSlots.length > 0) {
              // Se o horário que o lead pediu segue livre na lista atualizada,
              // aponta a opção em vez de fazê-lo escolher do zero.
              const preferredDay = slotPreference.preferredDate
                ? timezone.resolvePreferredDate(slotPreference.preferredDate, runtimeNow(), businessHours)
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

        // Infere treatmentId e valueCents a partir do tratamento identificado.
        // valueCents é um SNAPSHOT imutável do preço no momento do booking — se uma
        // campanha promocional estiver ativa agora, ela é o valor gravado aqui, e
        // continua correto no histórico mesmo depois que a campanha expirar.
        const matchedTreatmentForBooking = offeredTreatment?.treatmentName
          ? clinicTreatments.find(
              (t) => t.name.toLowerCase() === offeredTreatment.treatmentName!.toLowerCase(),
            ) ?? null
          : null;

        const bookingValueCents = matchedTreatmentForBooking
          ? resolveEffectivePrice(
              matchedTreatmentForBooking,
              (await getActivePriceCampaignsByTreatment(clinicId)).get(matchedTreatmentForBooking.id) ?? null,
            ).priceCents
          : null;

        // ── A7: Fluxo de sinal ──
        // Com sinal habilitado, NÃO agenda direto: faz uma reserva provisória, cobra o
        // sinal (texto determinístico) e aguarda o comprovante. O operador valida e
        // confirma (a IA nunca valida comprovante). O modo observação encerra antes
        // deste ponto; no replay, a reserva ocorre apenas no banco sandbox isolado.
        if (clinic.depositEnabled && clinic.depositAmountCents && clinic.depositPixKey) {
          const startsAt = new Date(chosenSlot.startsAt);
          const endsAt = new Date(chosenSlot.endsAt);
          const ttlHours = clinic.depositTtlHours ?? 24;
          turnTouchedScheduling = true;
          const held = await this.reservationService.reserve(
            clinic.id, lead.id, startsAt, endsAt, ttlHours * 60,
          );
          if (!held) {
            // Slot tomado entre a oferta e a escolha → reoferta.
            turnTouchedScheduling = true;
            const { slots: newSlots } = await this.fetchAndOfferSlots(
              conversation.id, clinic, calendarGateway, timezone, businessHours,
              undefined, undefined, undefined, offeredTreatment?.treatmentName, offeredTreatment?.durationMinutes, voiceEnabled,
            );
            replyText = newSlots.length > 0
              ? await compose({ type: "slot_taken_reoffered", newSlots })
              : await compose({ type: "no_slots_available" });
            forceTextOnlyReply = true;
            break;
          }
          const reservationId = held.id;

          const holdExpiresAt = new Date(runtimeNow().getTime() + ttlHours * 3600_000).toISOString();
          await this.stateMachine.startDepositWait(
            conversation.id,
            {
              slotStartsAt: startsAt.toISOString(),
              slotEndsAt: endsAt.toISOString(),
              slotLabel: chosenSlot.label,
              reservationId,
              treatmentId: matchedTreatmentForBooking?.id ?? null,
              treatmentName: offeredTreatment?.treatmentName,
              valueCents: bookingValueCents,
              depositAmountCents: clinic.depositAmountCents,
              holdExpiresAt,
            },
            ttlHours * 60,
          );
          replyText = buildDepositRequestMessage(
            {
              depositAmountCents: clinic.depositAmountCents,
              depositPixKey: clinic.depositPixKey,
              depositPixKeyType: clinic.depositPixKeyType,
              depositRecipientName: clinic.depositRecipientName,
              depositTtlHours: ttlHours,
              depositNotes: clinic.depositNotes,
            },
            chosenSlot.label,
          );
          forceTextOnlyReply = true;
          break;
        }

        turnTouchedScheduling = true;
        const result = await bookingService.book({
          clinic,
          lead,
          startsAt: new Date(chosenSlot.startsAt),
          endsAt: new Date(chosenSlot.endsAt),
          treatmentName: offeredTreatment?.treatmentName,
          treatmentId: matchedTreatmentForBooking?.id ?? null,
          valueCents: bookingValueCents,
          origin: "ai_conversation",
        });

        if (result.success) {
          // Só agora é seguro cancelar o agendamento anterior (remarcação implícita)
          if (existingAppointment) {
            turnTouchedScheduling = true;
            await bookingService.cancel({ lead, appointment: existingAppointment });
          }
          await this.stateMachine.transition(conversation.id, "idle");
          // #22: confirmação é dado estruturado — data, horário, endereço e as
          // orientações que a clínica cadastrou. Passava pela LLM só no caminho
          // sem sinal, o que dava um formato diferente a cada agendamento e
          // deixava o complemento do endereço fora. Agora os dois caminhos usam o
          // mesmo template. Em voz, segue pela LLM: linha rotulada com emoji não
          // se lê bem em áudio.
          replyText = voiceEnabled
            ? await compose({
                type: "appointment_confirmed",
                slot: chosenSlot,
                clinicName: clinic.name,
                clinicAddress: clinic.address,
              })
            : buildAppointmentConfirmationMessage({
                clinic,
                slotLabel: chosenSlot.label,
                treatmentName: offeredTreatment?.treatmentName ?? null,
              });
        } else if (result.reason === "slot_taken") {
          // Slot foi tomado por outro lead entre a oferta e a confirmação
          turnTouchedScheduling = true;
          const { slots: newSlots } = await this.fetchAndOfferSlots(
            conversation.id,
            clinic,
            calendarGateway,
            timezone,
            businessHours,
            undefined, undefined, undefined, offeredTreatment?.treatmentName, offeredTreatment?.durationMinutes, voiceEnabled,
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
          turnTouchedScheduling = true;
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
          pipelineState?.selectedTreatmentName ??
          pipelineState?.treatmentName ??
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
            turnTouchedScheduling = true;
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

        turnTouchedScheduling = true;
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
          // Lead deu data e hora e sobrou o horário dele, sozinho: pedir "responda
          // apenas com o número" para uma lista de um item faz o atendimento
          // parecer formulário. Confirma direto — o "sim" resolve o único slot
          // pendente pelo caminho normal.
          const singleExactSlot = resolveSingleExactSlot({
            slots: formattedSlots,
            preferredDate: slotPreference.preferredDate ?? null,
            preferredTime: slotPreference.preferredTime ?? null,
            timezone,
            businessHours,
            now: runtimeNow(),
          });
          if (singleExactSlot) {
            replyText = buildSingleExactSlotConfirmation(singleExactSlot.label, SLOT_OFFER_TTL_MINUTES);
          } else {
            replyText = await compose({
              type: "slots_found",
              slots: formattedSlots,
              askedForPreference: false,
              treatmentInferredFromHistory: historyTreatment?.name ?? null,
            });
          }
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
        turnTouchedScheduling = true;
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
          turnTouchedScheduling = true;
          await bookingService.cancel({ lead, appointment: activeAppointment });
        }

        turnTouchedScheduling = true;
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
            updatedAt: runtimeNow(),
          })
          .where(eq(conversationsTable.id, conversation.id));

        replyText = await compose({ type: "patient_arrived", appointmentTime: todayAppointment?.startsAt ?? null });
        await this.notifyAttentionNeeded(clinic, channelConfig, phone, lead.name ?? null, arrivalReason);
        break;
      }

      // ── Precisa de humano (mídia, negociação, falar com dentista, situação especial) ──
      case "needs_human": {
        // Bug garantia jul/2026: se a dúvida de garantia/manutenção casa com uma
        // objeção que a clínica cadastrou, ela decidiu que a IA responde — então
        // responde com a diretiva da objeção em vez de pausar e pedir foto. Sem
        // handoff, sem pausa: é resposta institucional que a clínica já aprovou.
        if (objectionDirectiveContext) {
          replyText = await compose({ type: "general_question", clinicContext: objectionDirectiveContext });
          break;
        }
        const reason =
          maintenanceHandoffReason ??
          classification.handoffReason ??
          "Lead solicitou atendimento humano";
        // #21: relato de dano tem resposta própria e pausa própria. Quando o
        // sistema já sabe que é paciente da casa, quem decide garantia é o
        // operador — pausa. Quando não sabe, a resposta PERGUNTA a origem do
        // trabalho, e pausar deixaria a IA surda à resposta que ela mesma pediu.
        if (existingWorkProblem) {
          replyText = await compose({ type: "existing_work_problem", ...existingWorkProblem });
        } else {
          replyText = await compose({
            type: "handoff_requested",
            handoffReason: reason,
            maintenancePriceLabel: resolveMaintenancePriceLabel(messageText, clinicTreatments),
          });
        }
        const pauseAi = !existingWorkProblem || existingWorkProblem.relationship !== "unknown";
        const appliedBusinessHandoff = await turnSafetyHandoff.applyLaterHandoff(async () => {
          await db
            .update(conversationsTable)
            .set({
              aiPaused: pauseAi,
              takeoverExpiresAt: null, // pausa permanente — operador decide quando retomar
              needsAttention: true,
              attentionReason: reason,
              updatedAt: runtimeNow(),
            })
            .where(eq(conversationsTable.id, conversation.id));
          await this.notifyAttentionNeeded(clinic, channelConfig, phone, lead.name ?? null, reason);
        });
        if (!appliedBusinessHandoff) {
          await db
            .update(conversationsTable)
            .set({
              aiPaused: pauseAi,
              takeoverExpiresAt: null,
              updatedAt: runtimeNow(),
            })
            .where(eq(conversationsTable.id, conversation.id));
        }
        break;
      }

      // ── Urgência clínica ──
      case "clinical_urgency": {
        replyText = await compose({ type: "clinical_urgency" });
        await turnSafetyHandoff.applyLaterHandoff(async () => {
          await db
            .update(conversationsTable)
            .set({ needsAttention: true, attentionReason: "Urgência clínica relatada pelo lead", updatedAt: runtimeNow() })
            .where(eq(conversationsTable.id, conversation.id));
          await this.notifyAttentionNeeded(clinic, channelConfig, phone, lead.name ?? null, "Urgência clínica relatada");
        });
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
        const matchedPriceTreatment =
          resolvePriceTreatmentTarget({
            message: messageText,
            treatments: clinicTreatments,
            identifiedTreatment: priceIdentifiedTreatment,
            activePipelineTreatmentId: pipelineState?.treatmentId ?? null,
            activeSelectedTreatmentId: pipelineState?.selectedTreatmentId ?? null,
          }) ?? undefined;
        if (priceIdentifiedTreatment && !matchedPriceTreatment) {
            maybeLogTreatmentGap(
              clinicId,
              conversation.id,
              lead.name,
              priceIdentifiedTreatment,
              messageText,
            ).catch((e) => console.warn("[TreatmentGap] Falhou ao salvar gap:", e));
        }

        // A4 — Bloqueio determinístico: sem pacote exato, não há cotação.
        // Antes, quantityNote era apenas uma instrução para a LLM; ela podia
        // ignorá-la e repetir preços gerais da política para uma arcada/quantidade
        // diferente. Agora a IA é pausada e a resposta segura não passa pela LLM.
        if (quantityPriceResolution?.kind === "unknown") {
          const attentionReason = `Lead pediu preço de ${quantityPriceResolution.quantity} unidades (fora dos pacotes fechados) — confirmar valor`;
          await maybeLogTreatmentGap(
            clinicId,
            conversation.id,
            lead.name,
            `${quantityPriceResolution.quantity} lentes (quantidade/arcada não-padrão)`,
            messageText,
          ).catch((e) => console.warn("[TreatmentGap] Falhou ao salvar gap:", e));
          await db
            .update(conversationsTable)
            .set({
              aiPaused: true,
              takeoverExpiresAt: null,
              needsAttention: true,
              attentionReason,
              updatedAt: runtimeNow(),
            })
            .where(eq(conversationsTable.id, conversation.id));
          await this.notifyAttentionNeeded(clinic, channelConfig, phone, lead.name ?? null, attentionReason);
          replyText = await compose({
            type: "quantity_price_confirmation_required",
            quantity: quantityPriceResolution.quantity,
            scope: quantityPriceResolution.scope,
          });
          break;
        }

        // A4 — Nota determinística de quantidade exata: a LLM só pode repetir
        // os valores que o resolver já encontrou na tabela fechada.
        let quantityNote: string | null = null;
        if (quantityPriceResolution?.kind === "exact") {
          quantityNote =
            `O lead perguntou o valor de ${quantityPriceResolution.quantity} (ver mensagem). ` +
            `Os valores EXATOS do pacote são: ${quantityPriceResolution.lines.join("; ")}. ` +
            `Responda com estes valores exatos e não cite valores de outras quantidades.`;
        }

        if (
          isEvaluationPriceRequest(messageText) &&
          clinic.depositEnabled &&
          clinic.depositAmountCents
        ) {
          const evaluationTreatment = clinicTreatments.find((treatment) => {
            const searchable = [treatment.name, ...treatment.aliases]
              .map((value) => normalizeFreeText(value))
              .join(" ");
            return /\bavaliacao\b/.test(searchable);
          }) ?? null;
          replyText = buildEvaluationDepositClarification(
            clinic.depositAmountCents,
            evaluationTreatment
              ? {
                  priceCents: evaluationTreatment.priceCents ?? evaluationTreatment.minPriceCents,
                  priceQuotableInChat: evaluationTreatment.priceQuotableInChat,
                }
              : null,
          );
          forceTextOnlyReply = true;
          break;
        }

        const pipelinePriceTreatment = findPipelineTreatmentContextForPriceRequest({
          message: messageText,
          treatments: clinicTreatments,
          identifiedTreatment: priceIdentifiedTreatment,
          activePipelineTreatmentId: pipelineState?.treatmentId ?? null,
          history: allMessagesForContext,
        });
        const selectedPriceTreatment =
          matchedPriceTreatment ?? pipelinePriceTreatment ?? null;
        if (selectedPriceTreatment) {
          const canonicalPriceTreatment = resolvePipelineSourceTreatment(
            selectedPriceTreatment,
            clinicTreatments,
          );
          await recordDecisionTrace(this.decisionTraceSink, {
            turnId,
            stage: "treatment.resolved",
            occurredAt: runtimeNow().toISOString(),
            clinicId,
            conversationId: conversation.id,
            metadata: {
              source: "price_inquiry",
              selectedTreatmentId: selectedPriceTreatment.id,
              selectedTreatmentName: selectedPriceTreatment.name,
              canonicalTreatmentId: canonicalPriceTreatment.id,
              canonicalTreatmentName: canonicalPriceTreatment.name,
              hasPipeline: Boolean(canonicalPriceTreatment.pipelineSteps?.length),
            },
          });
        }
        const pipelinePriceContent = pipelinePriceTreatment?.pipelineSteps
          ? nextActivePipelineStep(pipelinePriceTreatment.pipelineSteps, 0, {
              conversationHistory: allMessagesForContext,
              mediaTitleById: pipelineMediaTitleById,
            })
          : null;

        if (
          pipelinePriceTreatment &&
          pipelinePriceContent?.step.type === "content" &&
          (quantityPriceResolution == null || quantityPriceResolution.kind === "exact") &&
          !oldPriceObjectionDetected
        ) {
          const parts = buildPipelineContentParts(pipelinePriceContent.step.blocks);
          triggerPartsOverride = parts;
          composedParts = parts;
          composedMediaIds = collectMediaIds(parts);
          replyText = parts
            .filter((p): p is { type: "text"; content: string } => p.type === "text")
            .map((p) => p.content)
            .join("\n\n");
          forceTextOnlyReply = true;

          if (!pipelineState) {
            const selectedPriceTreatment =
              matchedPriceTreatment &&
              resolvePipelineSourceTreatment(matchedPriceTreatment, clinicTreatments).id ===
                pipelinePriceTreatment.id
                ? matchedPriceTreatment
                : null;
            await this.stateMachine.startTreatmentPipeline(
              conversation.id,
              pipelinePriceTreatment.id,
              pipelinePriceTreatment.name,
              clinic.staleConversationHours * 60,
              pipelinePriceContent.index,
              selectedPriceTreatment
                ? { id: selectedPriceTreatment.id, name: selectedPriceTreatment.name }
                : null,
            );
          }
          const next = nextActivePipelineStep(
            pipelinePriceTreatment.pipelineSteps!,
            pipelinePriceContent.index + 1,
            { conversationHistory: allMessagesForContext },
          );
          pendingPipelineAdvance = next
            ? { action: "advance", nextStepIndex: next.index }
            : { action: "exit" };

          // Pedido composto real (ex.: valores + "pré-avaliação por aqui"):
          // entrega primeiro os cards de preço e, como o lead já sinalizou
          // prontidão explícita, emenda o bloco declarativo de instruções da foto.
          // O asset/copy continuam pertencendo ao pipeline do tratamento.
          const remotePreEvaluationContent = isRemotePreEvaluationRequest(messageText)
            ? nextUnsentPipelineContentStep(
                pipelinePriceTreatment.pipelineSteps!,
                pipelinePriceContent.index + 1,
                allMessagesForContext,
                pipelineMediaTitleById,
              )
            : null;
          if (
            remotePreEvaluationContent &&
            isPipelinePhotoInstructionContentStep(remotePreEvaluationContent.step)
          ) {
            const withPhotoInstructions = buildAnswerFirstPipelineContent({
              answerText: replyText,
              answerParts: composedParts,
              contentBlocks: remotePreEvaluationContent.step.blocks,
            });
            replyText = withPhotoInstructions.replyText;
            composedParts = withPhotoInstructions.parts;
            composedMediaIds = withPhotoInstructions.mediaIds;
            const afterPhotoInstruction = nextActivePipelineStep(
              pipelinePriceTreatment.pipelineSteps!,
              remotePreEvaluationContent.index + 1,
              { conversationHistory: allMessagesForContext },
            );
            pendingPipelineAdvance = afterPhotoInstruction
              ? { action: "advance", nextStepIndex: afterPhotoInstruction.index }
              : { action: "exit" };
          }
          break;
        }

        if (
          !priceIdentifiedTreatment &&
          !ambiguousTreatmentOverride?.length &&
          !classification.slotPreference.ambiguousTreatmentMatches?.length &&
          !pipelinePriceTreatment &&
          !simplePaymentPolicyQuestion
        ) {
          replyText = await compose({
            type: "clarification_needed",
            question: "Claro. Sobre qual procedimento você quer ver os valores?",
          });
          break;
        }

        replyText = await compose({
          type: "price_inquiry",
          identifiedTreatment: priceIdentifiedTreatment,
          ambiguousTreatmentMatches:
            ambiguousTreatmentOverride ??
            classification.slotPreference.ambiguousTreatmentMatches ??
            null,
          quantityNote,
          referencedPriceCents: referencedPrice?.cents ?? null,
          oldPriceObjection: oldPriceObjectionDetected,
        });

        // O pipeline pode já estar no Q&A quando chega um pedido composto de
        // preço + pré-avaliação remota. Nesse caso a apresentação já foi enviada,
        // então respondemos o preço normalmente e anexamos o próximo bloco de
        // foto ainda não enviado, posicionando o estado para aguardar a mídia.
        if (
          pipelineState &&
          pipelinePriceTreatment?.id === pipelineState.treatmentId &&
          isRemotePreEvaluationRequest(messageText)
        ) {
          const remotePreEvaluationContent = nextUnsentPipelineContentStep(
            pipelinePriceTreatment.pipelineSteps!,
            pipelineState.stepIndex + 1,
            allMessagesForContext,
            pipelineMediaTitleById,
          );
          if (
            remotePreEvaluationContent &&
            isPipelinePhotoInstructionContentStep(remotePreEvaluationContent.step)
          ) {
            const withPhotoInstructions = buildAnswerFirstPipelineContent({
              answerText: replyText,
              answerParts: composedParts,
              contentBlocks: remotePreEvaluationContent.step.blocks,
            });
            replyText = withPhotoInstructions.replyText;
            composedParts = withPhotoInstructions.parts;
            composedMediaIds = withPhotoInstructions.mediaIds;
            const afterPhotoInstruction = nextActivePipelineStep(
              pipelinePriceTreatment.pipelineSteps!,
              remotePreEvaluationContent.index + 1,
              { conversationHistory: allMessagesForContext },
            );
            pendingPipelineAdvance = afterPhotoInstruction
              ? { action: "advance", nextStepIndex: afterPhotoInstruction.index }
              : { action: "exit" };
          }
        }

        // ── Item 1 (reunião 17/07): fechar como o operador faz — depois de cotar
        // um único tratamento (sem ambiguidade, sem escalonamento pendente, sem
        // objeção de preço em curso), já oferta horários reais em vez de só
        // perguntar "posso ver os horários?". Tratamentos com pipeline próprio
        // (ex.: a apresentação de lentes) ficam de fora — o pipeline já conduz
        // até a oferta de horário no seu próprio ritmo, e isFirstMessage fica de
        // fora para não duplicar a saudação que o 2º compose() prependaria.
        // OPT-IN por clínica (offerSlotsAfterPriceEnabled): pedido explícito da
        // Vitalli — outras clínicas concierge (ex.: Ximendes) têm padrões reais
        // de price_inquiry com objeção/terceiro/especificação técnica onde essa
        // antecipação de horário não foi validada. Não generalizar sem opt-in.
        if (
          clinic.offerSlotsAfterPriceEnabled &&
          experience === "concierge" &&
          !isFirstMessage &&
          !pipelineState &&
          matchedPriceTreatment &&
          !resolvePipelineSourceTreatment(matchedPriceTreatment, clinicTreatments).pipelineSteps?.length &&
          (quantityPriceResolution == null || quantityPriceResolution.kind === "exact") &&
          !oldPriceObjectionDetected
        ) {
          const evalTreatment = matchedPriceTreatment.requiresEvaluationFirst
            ? clinicTreatments.find((t) => /avalia[cç][aã]o/i.test(t.name))
            : null;
          const bookingTargetName = evalTreatment?.name ?? matchedPriceTreatment.name;
          const bookingTargetDuration = evalTreatment?.durationMinutes ?? matchedPriceTreatment.durationMinutes;

          turnTouchedScheduling = true;
          const { slots: priceFollowSlots, preferredDayEmpty: priceFollowEmpty } = await this.fetchAndOfferSlots(
            conversation.id, clinic, calendarGateway, timezone, businessHours,
            undefined, undefined, undefined,
            bookingTargetName, bookingTargetDuration, voiceEnabled,
          );

          if (priceFollowSlots.length > 0 && !priceFollowEmpty) {
            // compose() sobrescreve composedParts/composedMediaIds a cada chamada —
            // preserva o que a resposta de preço já anexou (ex.: vídeo do resultado)
            // e concatena com o que a 2ª chamada (só texto) produzir.
            const priceReplyParts = composedParts;
            const priceMediaIds = composedMediaIds;
            // A resposta de preço já composta entra no histórico da 2ª chamada:
            // sem isso o composer respondia a pergunta do lead DE NOVO antes de
            // listar os horários ("Sim, a avaliação é cobrada..." duas vezes).
            const priceAnswerAsHistory: Message[] = [{
              id: `synthetic-price-answer-${conversation.id}`,
              conversationId: conversation.id,
              author: "agent",
              body: replyText,
              sentAt: runtimeNow(),
              externalId: null,
            }];
            const slotsText = evalTreatment
              ? await compose(
                  { type: "evaluation_redirect", treatmentName: matchedPriceTreatment.name, evaluationSlots: priceFollowSlots },
                  { extraHistory: priceAnswerAsHistory },
                )
              : await compose(
                  { type: "slots_found", slots: priceFollowSlots, askedForPreference: false },
                  { extraHistory: priceAnswerAsHistory },
                );
            if (slotsText) {
              replyText = `${replyText}\n\n${slotsText}`;
              composedParts = [...priceReplyParts, ...composedParts];
              composedMediaIds = [...priceMediaIds, ...composedMediaIds];
            }
          }
        }

        break;
      }

      // ── Saudação ──
      // Lead reiniciou a conversa: respeita a experiência configurada.
      case "greeting": {
        if (await offerReadyPipelineSlots()) break;

        if (experience === "menu_first") {
          const salutation = getDayGreeting(timezone);
          const nameGreeting = extractFirstName(lead.name) ? `, ${extractFirstName(lead.name)}` : "";
          replyText = `${salutation}${nameGreeting}! ${buildMenuBody(clinic, "reoffer", experience)}`;
          await this.stateMachine.offerMenu(conversation.id);
        } else {
          const greetingText = buildConciergeStarter(clinic, timezone, lead.name);

          // Se a saudação também menciona um tratamento com pipeline, inicia o
          // pipeline imediatamente e entrega saudação + primeiro step juntos.
          const greetingSelection = !pipelineState
            ? (
                resolveDirectTreatmentMention(messageText, clinicTreatments) ??
                resolvePipelineTreatmentMention(messageText, clinicTreatments)
              )
            : null;
          const greetingTreatment = greetingSelection
            ? resolvePipelineSourceTreatment(greetingSelection, clinicTreatments)
            : null;

          if (greetingTreatment?.pipelineSteps?.length) {
            const firstActive = nextActivePipelineStep(greetingTreatment.pipelineSteps, 0, {
              conversationHistory: allMessagesForContext,
              mediaTitleById: pipelineMediaTitleById,
            });
            if (firstActive) {
              await this.stateMachine.startTreatmentPipeline(
                conversation.id,
                greetingTreatment.id,
                greetingTreatment.name,
                clinic.staleConversationHours * 60,
                firstActive.index,
                greetingSelection
                  ? { id: greetingSelection.id, name: greetingSelection.name }
                  : null,
              );
              if (firstActive.step.type === "content") {
                if (
                  greetingSelection &&
                  shouldDeferTreatmentPipelineEntry({
                    treatment: greetingSelection,
                    treatments: clinicTreatments,
                    isConversationOpening,
                    // Preserva o comportamento anterior quando o campo novo é null:
                    // o ramo greeting sempre apresentava imediatamente.
                    legacyShouldDefer: false,
                  })
                ) {
                  replyText = greetingText;
                  break;
                }
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
                const next = nextActivePipelineStep(greetingTreatment.pipelineSteps!, firstActive.index + 1, {
                  conversationHistory: allMessagesForContext,
                });
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
        // Quando o lead já passou pela foto/pré-avaliação, "não tenho dúvidas"
        // fecha o Q&A e deve conduzir para a avaliação — não para uma resposta
        // passiva de "sem pressa".
        if (!(await offerReadyPipelineSlots())) {
          // Se o menu ainda estiver ativo (TTL), o lead pode selecionar por número
          // normalmente — sem necessidade de reapresentar.
          replyText = await compose({ type: "acknowledgment" });
        }
        break;
      }

      // ── Encerramento de conversa ──
      case "farewell": {
        replyText = await compose({ type: commercialPauseDetected ? "commercial_pause" : "farewell" });
        break;
      }

      // ── Pergunta geral (inclui seleções de menu: procedimentos e localização) ──
      case "general_question": {
        // A6 — Triagem de caso atípico tem precedência: responde com a condução clínica
        // (pedir radiografia/foto, doutor avalia) em vez do fluxo normal de pergunta.
        if (atypicalTriageContext) {
          const attentionReason = `Caso clínico atípico (${atypicalCaseLabel ?? "avaliação necessária"}) — avaliar antes de cotar`;
          await db
            .update(conversationsTable)
            .set({
              aiPaused: true,
              takeoverExpiresAt: null,
              needsAttention: true,
              attentionReason,
              updatedAt: runtimeNow(),
            })
            .where(eq(conversationsTable.id, conversation.id));
          await this.notifyAttentionNeeded(clinic, channelConfig, phone, lead.name ?? null, attentionReason);
          replyText = await compose({
            type: "clinical_evaluation_required",
            reason: atypicalCaseLabel ?? "um caso clínico que precisa de avaliação",
          });
          break;
        }

        // Garantia tem precedência sobre todo o resto do ramo: catálogo, vitrine,
        // preço e resolução de tratamento por alias. A resposta já está decidida —
        // é a da clínica, ou o aviso de que a equipe vai confirmar.
        if (warrantyAnswer) {
          if (warrantyAnswer.kind === "no_policy") {
            const attentionReason = "Pergunta sobre garantia sem política cadastrada — confirmar com a equipe";
            await db
              .update(conversationsTable)
              .set({ needsAttention: true, attentionReason, updatedAt: runtimeNow() })
              .where(eq(conversationsTable.id, conversation.id));
            await this.notifyAttentionNeeded(clinic, channelConfig, phone, lead.name ?? null, attentionReason);
          }
          replyText = await compose({
            type: "general_question",
            clinicContext: warrantyAnswer.clinicContext,
          });
          break;
        }

        let clinicContext: string;
        const directProcedureCatalogRequested = !menuResolution && !procedureSelection && isProcedureCatalogRequest(messageText);
        const directLocationRequested = !menuResolution && !procedureSelection && isLocationRequest(messageText);
        const directSocialRequested = !menuResolution && !procedureSelection && isSocialProfileRequest(messageText);
        const directMediaClarificationRequested = !menuResolution && !procedureSelection && isMediaClarificationRequest(messageText);
        const menuGeneralSubtype = menuResolution?.intent === "general_question" ? menuResolution.subtype : null;

        // J4 — Quantidade pedida no burst atual ("20 lentes" + outra pergunta em
        // seguida): o valor exato do pacote entra deterministicamente na resposta,
        // antes do assunto da mensagem final. Fora do caminho de preço, que já resolve.
        const burstQuantityResolution = isPriceShapedIntent
          ? null
          : (() => {
              const burst = collectCurrentLeadBurstBodies(allMessagesForContext);
              for (let i = burst.length - 1; i >= 0; i--) {
                const resolution = resolveQuantityPriceQuery(burst[i], clinicTreatments);
                if (resolution?.kind === "exact") return resolution;
              }
              return null;
            })();

        // J3 — Pergunta composta "valores e onde fica": o guard de localização não
        // pode engolir a metade comercial. Endereço é dado determinístico; os
        // valores saem pelo conteúdo curado do pipeline no mesmo turno.
        if (directLocationRequested && isPriceRequestText(normalizeFreeText(messageText))) {
          const combinedPriceTreatment = findPipelineTreatmentContextForPriceRequest({
            message: messageText,
            treatments: clinicTreatments,
            identifiedTreatment: classification.slotPreference.identifiedTreatment ?? null,
            activePipelineTreatmentId: pipelineState?.treatmentId ?? null,
            history: allMessagesForContext,
          });
          const combinedPriceContent = combinedPriceTreatment?.pipelineSteps
            ? nextActivePipelineStep(combinedPriceTreatment.pipelineSteps, 0, {
                conversationHistory: allMessagesForContext,
                mediaTitleById: pipelineMediaTitleById,
              })
            : null;
          if (combinedPriceTreatment && combinedPriceContent?.step.type === "content") {
            const addressPart = clinic.address
              ? { type: "text" as const, content: buildAddressAnswer(clinic) }
              : null;
            const contentReply = buildPipelineContentReply(combinedPriceContent.step);
            composedParts = addressPart ? [addressPart, ...contentReply.parts] : contentReply.parts;
            composedMediaIds = contentReply.mediaIds;
            replyText = composedParts
              .filter((p): p is { type: "text"; content: string } => p.type === "text")
              .map((p) => p.content)
              .join("\n\n");
            forceTextOnlyReply = true;
            if (!pipelineState) {
              const combinedSelection = findTreatmentByIdOrName(clinicTreatments, {
                treatmentName: classification.slotPreference.identifiedTreatment ?? null,
              });
              await this.stateMachine.startTreatmentPipeline(
                conversation.id,
                combinedPriceTreatment.id,
                combinedPriceTreatment.name,
                clinic.staleConversationHours * 60,
                combinedPriceContent.index,
                combinedSelection &&
                  resolvePipelineSourceTreatment(combinedSelection, clinicTreatments).id ===
                    combinedPriceTreatment.id
                  ? { id: combinedSelection.id, name: combinedSelection.name }
                  : null,
              );
            }
            const next = nextActivePipelineStep(
              combinedPriceTreatment.pipelineSteps!,
              combinedPriceContent.index + 1,
              { conversationHistory: allMessagesForContext },
            );
            pendingPipelineAdvance = next
              ? { action: "advance", nextStepIndex: next.index }
              : { action: "exit" };
            break;
          }
          // Sem conteúdo curado disponível: contexto combinado obrigatório.
          clinicContext = [
            buildLocationClinicContext(clinic),
            "ATENÇÃO: o lead pediu VALORES na MESMA mensagem. Responda as duas partes — endereço E os valores/condições disponíveis na política comercial. NÃO responda apenas o endereço.",
          ].join("\n");
          replyText = await compose({ type: "general_question", clinicContext });
          break;
        }

        // J6 — Pedido de vitrine ("quero ver o trabalho de vocês"): entrega
        // determinística das mídias de resultado — a LLM não promete, o sistema anexa.
        if (
          !directLocationRequested &&
          !directSocialRequested &&
          !directMediaClarificationRequested &&
          isShowcaseRequestText(messageText)
        ) {
          const showcaseTreatmentId =
            pipelineState?.selectedTreatmentId ??
            pipelineState?.treatmentId ??
            inferTreatmentContextFromHistory({
              message: messageText,
              treatments: clinicTreatments,
              lastAgentMessage: lastAgentMessage?.body ?? null,
            })?.id ??
            null;
          const showcaseMedia = pickShowcaseMedia(editorial?.mediaLibrary ?? [], showcaseTreatmentId);
          if (showcaseMedia.length > 0) {
            // J4×J6: se o burst também pediu quantidade ("20 lentes" + "quero ver
            // o trabalho"), o valor exato abre a resposta antes da vitrine.
            const quantityPrefix = burstQuantityResolution
              ? `Sobre o pacote de ${burstQuantityResolution.quantity}: ${burstQuantityResolution.lines.join(" · ")}.\n\n`
              : "";
            const showcaseIntro = `${quantityPrefix}Claro! Olha alguns resultados reais dos nossos pacientes 👇`;
            composedParts = [
              { type: "text", content: showcaseIntro },
              ...showcaseMedia.map((media) => ({ type: "media" as const, id: media.id })),
            ];
            composedMediaIds = showcaseMedia.map((media) => media.id);
            replyText = showcaseIntro;
            forceTextOnlyReply = true;
            break;
          }
        }

        // ── Pipeline continuação ──
        // Se há pipeline ativo, ele tem prioridade sobre a lógica normal de contexto,
        // exceto quando a mensagem atual é uma pergunta direta sobre a clínica ou
        // sobre uma mídia já enviada. Nesses casos, responder a dúvida do lead vem
        // antes de avançar o próximo bloco do pipeline.
        // Isso garante que durante Q&A a instrução do passo seja usada mesmo quando
        // o lead não menciona o nome do tratamento na mensagem.
        if (
          pipelineState &&
          !procedureSelection
        ) {
          const pipelineTreatment = clinicTreatments.find(t => t.id === pipelineState.treatmentId) ?? null;
          const currentStep = pipelineTreatment?.pipelineSteps?.[pipelineState.stepIndex];

          // A3 — Conteúdo deferido: pipeline foi posicionado no passo de conteúdo no 1º
          // contato (só o opener foi enviado). Agora que o lead respondeu, answer-first:
          // respondemos a dúvida atual e só depois anexamos explicação + mídia.
          if (currentStep?.type === "content" && pipelineTreatment) {
            const next = nextActivePipelineStep(
              pipelineTreatment.pipelineSteps!,
              pipelineState.stepIndex + 1,
              { conversationHistory: allMessagesForContext },
            );
            pendingPipelineAdvance = next
              ? { action: "advance", nextStepIndex: next.index }
              : { action: "exit" };

            if (!hasPipelineContentStepBeenSent(currentStep, allMessagesForContext, pipelineMediaTitleById)) {
              // N1 — Interesse genérico no tratamento: o conteúdo curado É a
              // resposta. Compor explicação por LLM antes duplicava a informação
              // e vazava valores em prosa (caso Nathan, 18/07).
              const genericInterest =
                !directSocialRequested &&
                !directMediaClarificationRequested &&
                !directLocationRequested &&
                isGenericTreatmentInterestMessage(messageText, pipelineTreatment);
              if (genericInterest) {
                const contentReply = buildPipelineContentReply(currentStep);
                replyText = contentReply.replyText;
                composedParts = contentReply.parts;
                composedMediaIds = contentReply.mediaIds;
                break;
              }
              const contentAnswerContext = directSocialRequested
                ? buildSocialProfileClinicContext(
                    extractSocialProfileInfo(editorial?.playbookText, editorial?.commercialPolicy),
                  )
                : directMediaClarificationRequested
                  ? buildMediaClarificationClinicContext()
                  : directLocationRequested
                    ? buildLocationClinicContext(clinic)
                    : buildDeferredPipelineAnswerContext({
                        treatmentName: pipelineTreatment.name,
                        contentBlocks: currentStep.blocks,
                        treatmentDescription: pipelineTreatment.description,
                        commercialPolicy: editorial?.commercialPolicy,
                      });
              const answerText = await compose({ type: "general_question", clinicContext: contentAnswerContext });
              const answerParts = composedParts;
              const answerFirst = buildAnswerFirstPipelineContent({
                answerText,
                answerParts,
                contentBlocks: currentStep.blocks,
              });
              const remotePreEvaluationContent = isRemotePreEvaluationRequest(messageText)
                ? nextUnsentPipelineContentStep(
                    pipelineTreatment.pipelineSteps!,
                    pipelineState.stepIndex + 1,
                    allMessagesForContext,
                    pipelineMediaTitleById,
                  )
                : null;
              if (
                remotePreEvaluationContent &&
                isPipelinePhotoInstructionContentStep(remotePreEvaluationContent.step)
              ) {
                const withPhotoInstructions = buildAnswerFirstPipelineContent({
                  answerText: answerFirst.replyText,
                  answerParts: answerFirst.parts,
                  contentBlocks: remotePreEvaluationContent.step.blocks,
                });
                replyText = withPhotoInstructions.replyText;
                composedParts = withPhotoInstructions.parts;
                composedMediaIds = withPhotoInstructions.mediaIds;
                const afterPhotoInstruction = nextActivePipelineStep(
                  pipelineTreatment.pipelineSteps!,
                  remotePreEvaluationContent.index + 1,
                  { conversationHistory: allMessagesForContext },
                );
                pendingPipelineAdvance = afterPhotoInstruction
                  ? { action: "advance", nextStepIndex: afterPhotoInstruction.index }
                  : { action: "exit" };
              } else {
                replyText = answerFirst.replyText;
                composedParts = answerFirst.parts;
                composedMediaIds = answerFirst.mediaIds;
              }
              break;
            }
          }

          if (
            currentStep?.type === "qa" &&
            pipelineTreatment &&
            !directLocationRequested &&
            !directSocialRequested &&
            !directMediaClarificationRequested
          ) {
            const maxTurns = currentStep.maxTurns
              ?? resolvePipelineQaMaxTurns(clinic.pipelineQaDefaultMaxTurns);
            const nextContent = nextUnsentPipelineContentStep(
              pipelineTreatment.pipelineSteps!,
              pipelineState.stepIndex + 1,
              allMessagesForContext,
              pipelineMediaTitleById,
            );
            const shouldAppendPhotoInstructionContent = nextContent
              ? !pipelineState.photoReceived && isPipelinePhotoInstructionContentStep(nextContent.step)
              : false;
            const optionalPhotoStep = pipelineTreatment.pipelineSteps?.find(
              (step, index): step is Extract<PipelineStep, { type: "photo" }> =>
                !pipelineState.photoReceived &&
                !shouldAppendPhotoInstructionContent &&
                index > pipelineState.stepIndex &&
                step.type === "photo" &&
                !step.required,
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
              "OBJETIVIDADE OBRIGATÓRIA: responda em no máximo 2 frases curtas. Não repita valores já mostrados nos cards, exceto se o lead pedir especificamente para confirmar preço.",
              // J4: valores de pacote por quantidade são do SISTEMA — a linha
              // determinística abre a resposta; a LLM não repete números.
              burstQuantityResolution
                ? "O lead pediu um pacote por quantidade no burst atual. O sistema abrirá a resposta com os valores EXATOS — NÃO cite valores você mesmo; responda apenas o restante da mensagem."
                : null,
              currentStep.instruction ?? null,
              optionalPhotoStep
                ? `CONVITE OPCIONAL: se fizer sentido dentro da dúvida atual ou se o lead demonstrar abertura, convide de forma leve e não obrigatória usando esta mensagem como base: "${optionalPhotoStep.message}". Faça esse convite no máximo uma vez e nunca como exigência para continuar.`
                : null,
              pipelineTreatment.description ? `Descrição do tratamento: ${pipelineTreatment.description}` : null,
              editorial?.commercialPolicy ? `Política comercial: ${editorial.commercialPolicy}` : null,
            ].filter(Boolean).join("\n");
            replyText = await compose({ type: "general_question", clinicContext });
            if (burstQuantityResolution) {
              const quantityLine = `Sobre o pacote de ${burstQuantityResolution.quantity}: ${burstQuantityResolution.lines.join(" · ")}.`;
              const scrubbed = stripPriceProseWhenSystemQuoted(replyText);
              replyText = scrubbed ? `${quantityLine}\n\n${scrubbed}` : quantityLine;
            }
            // Anexo determinístico: se a dúvida casa com palavras-chave do step
            // (ex.: cor/tom → tabela de cores), o sistema anexa a mídia — a LLM
            // já verbalizou a explicação acima. Espelha a montagem dos content
            // steps (part de texto + part de mídia) para a entrega interleaved.
            const keywordMediaId = matchMediaOnKeywords(
              currentStep.mediaOnKeywords,
              normalizeFreeText(messageText),
            );
            if (keywordMediaId) {
              composedParts = [
                { type: "text", content: replyText },
                { type: "media", id: keywordMediaId },
              ];
              composedMediaIds = [keywordMediaId];
            }
            if (
              nextContent &&
              canAppendQaFollowUpContent({
                nextContentIsPhotoInstruction: shouldAppendPhotoInstructionContent,
                keywordMediaMatched: !!keywordMediaId,
                leadMessage: messageText,
              })
            ) {
              const followUpContent = buildPipelineContentReply(nextContent.step);
              const baseParts = composedParts.length > 0
                ? composedParts
                : [{ type: "text" as const, content: replyText }];
              composedParts = [...baseParts, ...followUpContent.parts];
              composedMediaIds = collectMediaIds(composedParts);
              replyText = composedParts
                .filter((p): p is { type: "text"; content: string } => p.type === "text")
                .map((p) => p.content)
                .join("\n\n");
              const next = nextActivePipelineStep(
                pipelineTreatment.pipelineSteps!,
                nextContent.index + 1,
                { conversationHistory: allMessagesForContext },
              );
              pendingPipelineAdvance = next
                ? { action: "advance", nextStepIndex: next.index }
                : { action: "exit" };
            }
            break;
          }

          if (
            currentStep?.type === "photo" &&
            !directLocationRequested &&
            !directSocialRequested &&
            !directMediaClarificationRequested
          ) {
            if (!currentStep.required && pipelineTreatment) {
              // Lead enviou texto em vez de foto (foto é opcional) → avança para disponibilidade
              const next = nextActivePipelineStep(pipelineTreatment.pipelineSteps!, pipelineState.stepIndex + 1);
              if (next) await this.stateMachine.advancePipelineStep(conversation.id, next.index);
              else await this.stateMachine.exitTreatmentPipeline(conversation.id);
              replyText = [
                "Sem problema. A foto ajuda na pré-avaliação, mas podemos seguir pela avaliação presencial.",
                "",
                "Posso te mostrar os horários disponíveis?",
              ].join("\n");
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
          const pipelineTreatment = resolvePipelineSourceTreatment(
            matchedTreatment,
            clinicTreatments,
          );
          await recordDecisionTrace(this.decisionTraceSink, {
            turnId,
            stage: "treatment.resolved",
            occurredAt: runtimeNow().toISOString(),
            clinicId,
            conversationId: conversation.id,
            metadata: {
              source: "informational",
              selectedTreatmentId: matchedTreatment.id,
              selectedTreatmentName: matchedTreatment.name,
              canonicalTreatmentId: pipelineTreatment.id,
              canonicalTreatmentName: pipelineTreatment.name,
              hasPipeline: Boolean(pipelineTreatment.pipelineSteps?.length),
            },
          });
          const selectedTreatment = procedureSelection
            ? findTreatmentByIdOrName(clinicTreatments, {
                treatmentId: procedureSelection.treatmentId,
                treatmentName: procedureSelection.name,
              })
            : null;

          // ── Pipeline start ──
          // Tratamento com pipeline configurado: inicia o pipeline pelo step "content".
          // Se o primeiro step ativo não for content (ex: começa com qa), entrega diretamente.
          const explicitPipelineTrigger = hasExplicitPipelineTreatmentTrigger({
            message: messageText,
            treatments: clinicTreatments,
            lastAgentMessage: lastAgentMessage?.body,
            procedureSelection,
            treatment: matchedTreatment,
          });
          if (pipelineTreatment.pipelineSteps?.length && !pipelineState && explicitPipelineTrigger) {
            const firstActive = nextActivePipelineStep(pipelineTreatment.pipelineSteps, 0, {
              conversationHistory: allMessagesForContext,
              mediaTitleById: pipelineMediaTitleById,
            });
            if (firstActive) {
              // A3 — 1º contato concierge com passo de conteúdo: envia só o opener de
              // qualificação e deixa o pipeline POSICIONADO no passo de conteúdo (sem
              // emiti-lo). A explicação + mídia dispara na continuação, quando o lead
              // responde — espelhando o ritmo da operadora humana (qualifica, depois
              // apresenta). Passos que começam com "qa" não têm mídia e seguem normais.
              if (
                firstActive.step.type === "content" &&
                shouldDeferTreatmentPipelineEntry({
                  treatment: matchedTreatment,
                  treatments: clinicTreatments,
                  isConversationOpening,
                  legacyShouldDefer: deferFirstContactPitch,
                })
              ) {
                await this.stateMachine.startTreatmentPipeline(
                  conversation.id,
                  pipelineTreatment.id,
                  pipelineTreatment.name,
                  clinic.staleConversationHours * 60,
                  firstActive.index,
                  { id: matchedTreatment.id, name: matchedTreatment.name },
                );
                replyText = buildConciergeStarter(clinic, timezone, lead.name, editorial?.receptionistName);
                clinicContext = "";
                break;
              }
              await this.stateMachine.startTreatmentPipeline(
                conversation.id,
                pipelineTreatment.id,
                pipelineTreatment.name,
                clinic.staleConversationHours * 60,
                firstActive.index,
                { id: matchedTreatment.id, name: matchedTreatment.name },
              );
              if (firstActive.step.type === "content") {
                // Blocos crus: a saudação da primeira mensagem é aplicada UMA vez
                // pelo bloco pós-switch (prependPipelineIntroGreeting). Saudar aqui
                // também duplicava a saudação (bug P0.7 no caminho de pipeline).
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
                const next = nextActivePipelineStep(pipelineTreatment.pipelineSteps!, firstActive.index + 1, {
                  conversationHistory: allMessagesForContext,
                });
                pendingPipelineAdvance = next
                  ? { action: "advance", nextStepIndex: next.index }
                  : { action: "exit" };

                const remotePreEvaluationContent = isRemotePreEvaluationRequest(messageText)
                  ? nextUnsentPipelineContentStep(
                      pipelineTreatment.pipelineSteps!,
                      firstActive.index + 1,
                      allMessagesForContext,
                      pipelineMediaTitleById,
                    )
                  : null;
                if (
                  remotePreEvaluationContent &&
                  isPipelinePhotoInstructionContentStep(remotePreEvaluationContent.step)
                ) {
                  const withPhotoInstructions = buildAnswerFirstPipelineContent({
                    answerText: replyText,
                    answerParts: composedParts,
                    contentBlocks: remotePreEvaluationContent.step.blocks,
                  });
                  replyText = withPhotoInstructions.replyText;
                  composedParts = withPhotoInstructions.parts;
                  composedMediaIds = withPhotoInstructions.mediaIds;
                  const afterPhotoInstruction = nextActivePipelineStep(
                    pipelineTreatment.pipelineSteps!,
                    remotePreEvaluationContent.index + 1,
                    { conversationHistory: allMessagesForContext },
                  );
                  pendingPipelineAdvance = afterPhotoInstruction
                    ? { action: "advance", nextStepIndex: afterPhotoInstruction.index }
                    : { action: "exit" };
                }
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
        } else if (
          menuResolution?.intent === "general_question" ||
          directProcedureCatalogRequested ||
          directLocationRequested ||
          directSocialRequested ||
          directMediaClarificationRequested
        ) {
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
              const keywordPipelineTreatment = keywordTreatment
                ? resolvePipelineSourceTreatment(keywordTreatment, clinicTreatments)
                : null;
              if (keywordPipelineTreatment?.pipelineSteps?.length) {
                const firstActive = nextActivePipelineStep(keywordPipelineTreatment.pipelineSteps, 0, {
                  conversationHistory: allMessagesForContext,
                  mediaTitleById: pipelineMediaTitleById,
                });
                if (firstActive) {
                  await this.stateMachine.startTreatmentPipeline(
                    conversation.id,
                    keywordPipelineTreatment.id,
                    keywordPipelineTreatment.name,
                    clinic.staleConversationHours * 60,
                    firstActive.index,
                    keywordTreatment
                      ? { id: keywordTreatment.id, name: keywordTreatment.name }
                      : null,
                  );
                  if (firstActive.step.type === "content") {
                    // Blocos crus: saudação aplicada uma única vez pelo bloco
                    // pós-switch (prependPipelineIntroGreeting), nunca aqui (bug P0.7).
                    const parts = buildPipelineContentParts(firstActive.step.blocks);
                    triggerPartsOverride = parts;
                    composedParts = parts;
                    composedMediaIds = parts.filter((p): p is { type: "media"; id: string } => p.type === "media").map((p) => p.id);
                    replyText = parts.filter((p): p is { type: "text"; content: string } => p.type === "text").map((p) => p.content).join("\n\n");
                    clinicContext = "";
                    const next = nextActivePipelineStep(keywordPipelineTreatment.pipelineSteps!, firstActive.index + 1, {
                      conversationHistory: allMessagesForContext,
                    });
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
          } else if (directSocialRequested) {
            clinicContext = buildSocialProfileClinicContext(
              extractSocialProfileInfo(editorial?.playbookText, editorial?.commercialPolicy),
            );
          } else if (directMediaClarificationRequested) {
            clinicContext = buildMediaClarificationClinicContext();
          } else {
            // W3.2 (caso Irys 19/07): endereço é dado exato — a LLM parafraseava
            // ("Avenida Adolfo Pinheiro, em Santo Amaro", sem número nem sala) e
            // inventava contexto ("nova localização"). Resposta determinística;
            // só cai na LLM quando há contexto de nome/endereço antigo (P0.5).
            if (clinic.address && !previousClinicNameContext) {
              replyText = `${buildAddressAnswer(clinic)}\n\nPosso te ajudar com mais alguma coisa? 😊`;
              break;
            }
            clinicContext = buildLocationClinicContext(clinic);
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
        // P0.5: Se detectou pergunta sobre nome antigo ou mudança de endereço, adiciona ao contexto
        const finalClinicContext = previousClinicNameContext
          ? `${previousClinicNameContext}\n\n${clinicContext}`
          : clinicContext;
        if (!triggerPartsOverride) {
          replyText = await compose({ type: "general_question", clinicContext: finalClinicContext });
          // J4 — o valor exato do pacote pedido no burst abre a resposta,
          // deterministicamente — e a prosa LLM é limpa de números (o sistema
          // é a única fonte de valores).
          if (burstQuantityResolution) {
            const quantityLine = `Sobre o pacote de ${burstQuantityResolution.quantity}: ${burstQuantityResolution.lines.join(" · ")}.`;
            const scrubbed = stripPriceProseWhenSystemQuoted(replyText);
            replyText = scrubbed ? `${quantityLine}\n\n${scrubbed}` : quantityLine;
            composedParts = [
              { type: "text", content: quantityLine },
              ...composedParts
                .map((part) => part.type === "text" ? { ...part, content: stripPriceProseWhenSystemQuoted(part.content) } : part)
                .filter((part) => part.type !== "text" || part.content.length > 0),
            ];
          } else if (isPriceShapedIntent) {
            // W4.2 (caso ST): pergunta de preço que o classificador rotulou
            // general_question ("é esse valor de 2k mesmo?") deve receber os cards
            // curados de valores, não a prosa com números. Emenda os cards (uma
            // vez) após limpar os valores da prosa — sem descartar as demais
            // partes de uma pergunta composta (avaliação, agendamento, endereço).
            const priceCardTreatment = findPipelineTreatmentContextForPriceRequest({
              message: messageText,
              treatments: clinicTreatments,
              identifiedTreatment: classification.slotPreference.identifiedTreatment ?? null,
              activePipelineTreatmentId: pipelineState?.treatmentId ?? null,
              history: allMessagesForContext,
            });
            const priceCardContent = priceCardTreatment?.pipelineSteps
              ? nextActivePipelineStep(priceCardTreatment.pipelineSteps, 0, {
                  conversationHistory: allMessagesForContext,
                  mediaTitleById: pipelineMediaTitleById,
                })
              : null;
            if (
              priceCardTreatment &&
              priceCardContent?.step.type === "content" &&
              !hasPipelineContentStepBeenSent(priceCardContent.step, allMessagesForContext, pipelineMediaTitleById)
            ) {
              const cards = buildPipelineContentReply(priceCardContent.step);
              const scrubbedParts = composedParts
                .map((part) => part.type === "text" ? { ...part, content: stripPriceProseWhenSystemQuoted(part.content) } : part)
                .filter((part) => part.type !== "text" || part.content.length > 0);
              composedParts = [...scrubbedParts, ...cards.parts];
              composedMediaIds = collectMediaIds(composedParts);
              replyText = composedParts
                .filter((p): p is { type: "text"; content: string } => p.type === "text")
                .map((p) => p.content)
                .join("\n\n");
            }
          }
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
      } // End of switch
    } // End of else

    if (isFirstMessage && !shouldSendConciergeStarter(experience, effectiveIntent) && triggerPartsOverride && triggerPartsOverride.length > 0) {
      // Primeira mensagem que disparou um pipeline de conteúdo (pulando o ConciergeStarter):
      // injeta a saudação rica UMA vez, aqui — este é o dono único da saudação nesse caminho.
      const receptionistName = inferReceptionistNameFromGreeting(clinic.greetingMessage);
      const parts = prependPipelineIntroGreeting(triggerPartsOverride, timezone, clinic.name, lead.name, receptionistName);
      composedParts = parts;
      replyText = parts
        .filter((p): p is { type: "text"; content: string } => p.type === "text")
        .map((p) => p.content)
        .join("\n\n");
    }

    if (
      depositTextState?.state === "awaiting_deposit_proof" &&
      !releasedDepositHoldForChange &&
      replyText
    ) {
      replyText = contextualizeReplyWhileAwaitingDeposit(
        replyText,
        depositTextState.payload.slotLabel,
      );
      // A resposta final foi alterada deterministicamente; descarta partes de
      // texto compostas antes para não enviar o CTA antigo junto pela outbox.
      composedParts = composedParts.filter((part) => part.type !== "text");
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
          ...(hitThreshold && !turnSafetyHandoff.hasSafetyHandoff && {
            needsAttention: true,
            attentionReason: "Lead enviou 3 mensagens sem que a IA conseguisse entender",
          }),
          updatedAt: runtimeNow(),
        })
        .where(eq(conversationsTable.id, conversation.id));

      if (hitThreshold) {
        await turnSafetyHandoff.applyLaterHandoff(async () => {
          await this.notifyAttentionNeeded(clinic, channelConfig, phone, lead.name ?? null, "Não conseguiu entender o lead após 3 tentativas");
        });
      }
    } else if (resetsClarity && (conversation.consecutiveUnclearCount ?? 0) > 0) {
      await db
        .update(conversationsTable)
        .set({ consecutiveUnclearCount: 0, updatedAt: runtimeNow() })
        .where(eq(conversationsTable.id, conversation.id));
    }

    // ── 8.5. Atualiza temperatura do lead (nunca rebaixa) ──
    const inferredTemp = temperatureFromIntent(responseIntent);
    const currentTempRank = TEMP_RANK[lead.temperature ?? "cold"];
    if (TEMP_RANK[inferredTemp] > currentTempRank) {
      await this.leadRepo.save({ ...lead, temperature: inferredTemp, updatedAt: runtimeNow() });
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
    const needsMediaResolution = composedParts.some((p) => p.type === "media");
    const deliveryMediaLibrary = needsMediaResolution
      ? await resolveDeliveryMediaLibrary({
          clinicId,
          parts: composedParts,
          editorialMediaLibrary: editorial?.mediaLibrary,
          log: deliveryLog,
        })
      : editorial?.mediaLibrary;
    const outboundParts = hasInterleavedMedia
      ? resolveOutboundParts(composedParts, deliveryMediaLibrary, deliveryLog, activeTreatmentId)
      : [];

    // ── Guard: rajada pós-composição ──
    //
    // Existem três recheca de supersessão antes deste ponto (pós-claim,
    // pós-debounce e pós-classificação), mas nenhuma cobre a chamada do
    // COMPOSER — 3 a 10 segundos em que o lead pode falar de novo. É a última
    // janela aberta, e o sintoma dela é o pior: o lead manda "Olá boa tarde" e
    // logo "Quero saber o endereço de vcs", e recebe a saudação de abertura —
    // que responde à primeira e enterra a segunda.
    //
    // Medido em produção: 123 primeiras respostas saíram com o lead já tendo 2+
    // mensagens sem resposta; 69 (56%) eram abertura.
    //
    // Restrito à abertura enlatada de propósito. Aqui os ramos de resposta já
    // rodaram: descartar uma oferta de horário deixaria slots reservados que o
    // lead nunca viu. O starter concierge é texto puro, sem esse risco — e é
    // exatamente a resposta que não deveria ter saído.
    {
      const latestBeforeSend = await this.conversationRepo.findLatestLeadMessage(conversation.id);
      if (shouldDiscardComposedReply({
        isReplayOfMessage: isReplay,
        replyIsCannedOpener,
        turnTouchedScheduling,
        latestLeadMessageId: latestBeforeSend?.id ?? null,
        incomingMessageId: incomingMessage.id,
      })) {
        console.log(
          `[Orchestrator] Rajada pós-composição: resposta de ${incomingMessage.id} descartada ` +
          `(abertura=${replyIsCannedOpener}, agenda tocada=${turnTouchedScheduling}) — ` +
          `lead falou de novo (${latestBeforeSend?.id}); o turno mais recente responde (conv=${conversation.id})`,
        );
        return { replied: false, reason: "superseded_by_newer_message" };
      }
    }

    // ── 9. Persiste resposta e outbox antes do envio técnico ──
    const agentMessageId = randomUUID();
    const agentSentAt = runtimeNow();
    await this.conversationRepo.appendMessage(
      buildInitialAgentMessage({
        id: agentMessageId,
        conversationId: conversation.id,
        replyText,
        sentAt: agentSentAt,
        intent: responseIntent ?? null,
        hasInterleavedMedia,
        outboundParts,
      }),
    );

    const mediaParts =
      !hasInterleavedMedia && composedMediaIds.length > 0 && deliveryMediaLibrary
        ? resolveOutboundParts(
            composedParts.filter((part) => part.type === "media"),
            deliveryMediaLibrary,
            deliveryLog,
            activeTreatmentId,
          )
        : [];
    const durablePipelineAdvance = await this.bindPipelineAdvanceExpectation(
      conversation.id,
      pendingPipelineAdvance,
    );
    await this.enqueueConversationReply(clinicId, conversation.id, {
      version: 1,
      kind: "conversation_reply",
      turnId,
      to: outboundAddress,
      agentMessageId,
      replyText,
      intent: responseIntent ?? null,
      useVoice: forceTextOnlyReply ? false : resolveVoiceForReply(responseIntent, replyText),
      ttsConfig: ttsConf,
      interleavedParts: hasInterleavedMedia ? outboundParts : [],
      mediaParts,
      leadId: lead.id,
      pipelineAdvance: durablePipelineAdvance,
    }, undefined, plannedResponse);
    if (durablePipelineAdvance) {
      const applied = await this.applyDurablePipelineAdvance(
        conversation.id,
        durablePipelineAdvance,
      );
      await recordDecisionTrace(this.decisionTraceSink, {
        turnId,
        stage: "state.pipeline_committed",
        occurredAt: runtimeNow().toISOString(),
        clinicId,
        conversationId: conversation.id,
        metadata: {
          action: durablePipelineAdvance.action,
          applied,
          expectedTreatmentId: durablePipelineAdvance.expectedTreatmentId ?? null,
          expectedStepIndex: durablePipelineAdvance.expectedStepIndex ?? null,
        },
      });
    }

    // ── 9.4 Push notification — avisa operadores que um lead enviou mensagem ──
    const leadDisplayName = lead.name ?? phone;
    await this.notifyOperators(clinicId, {
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
      // P0.6/P0.7: falha em qualquer ponto do processamento (não só no compose()
      // do ResponseComposer, que já tinha proteção própria) — silencioso para o
      // lead, handoff automático para a equipe via needsAttention + notificação.
      // Antes disto, esse catch enviava "Ops, tive um problema técnico por aqui"
      // diretamente ao lead, contrariando a diretiva explícita do P0.6 (bug real:
      // 3 conversas — Janaina, Romanosax, Luiz — receberam essa mensagem de erro
      // visível pós-deploy, porque este catch de nível superior envolve TODO o
      // processamento da mensagem, não só a chamada ao LLM).
      const errorContext = {
        clinicId,
        conversationId: conversation.id,
        leadId: lead.id,
        errorMessage: err instanceof Error ? err.message : String(err),
        timestamp: runtimeNow().toISOString(),
      };
      console.error("[Orchestrator] Falha no processamento — needs_human silencioso:", errorContext);
      // Captura real: `log.error` é o único canal que encaminha para o Sentry, e
      // já aplica a redação de PII de `scrubEvent`. clinicId e conversationId
      // viram tags pelo LogContext; o corpo da conversa não entra em lugar nenhum.
      buildTurnFailureReport({
        clinicId,
        conversationId: conversation.id,
        leadId: lead.id,
        messageId,
        error: err,
        log: createLogger({
          scope: "Orchestrator",
          correlationId: messageId,
          clinicId,
          conversationId: conversation.id,
        }),
      });

      try {
        await db
          .update(conversationsTable)
          .set({
            needsAttention: true,
            attentionReason: "IA indisponível (erro técnico) — operador intervém",
            updatedAt: runtimeNow(),
          })
          .where(eq(conversationsTable.id, conversation.id));
        await this.notifyAttentionNeeded(clinic, channelConfig, phone, lead.name ?? null, "IA indisponível — erro técnico no processamento");
      } catch (handoffErr) {
        console.error("[Orchestrator] Falha ao registrar handoff de erro:", handoffErr);
      }
      return { replied: false, reason: "technical_error_handoff" };
    }

    } finally {
      await this.turnCoordinator.release(conversation.id);
    }
  }

  async resumeAfterHumanReviewDecision(params: {
    clinicId: string;
    reviewRequestId: string;
    decision: HumanReviewDecision;
  }): Promise<{ replied: boolean; reason?: string }> {
    const turnId = `human-review:${params.reviewRequestId}`;
    if (params.decision !== "approved_direct_booking" && params.decision !== "needs_evaluation") {
      return { replied: false, reason: "decision_does_not_resume_automation" };
    }

    const [clinicRow] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, params.clinicId))
      .limit(1);
    if (!clinicRow) return { replied: false, reason: "clinic_not_found" };

    const [review] = await db
      .select()
      .from(humanReviewRequests)
      .where(eq(humanReviewRequests.id, params.reviewRequestId))
      .limit(1);
    if (!review || review.clinicId !== params.clinicId) {
      return { replied: false, reason: "review_not_found" };
    }

    const [conversation] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, review.conversationId))
      .limit(1);
    const [lead] = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.id, review.leadId))
      .limit(1);
    if (!conversation || !lead) return { replied: false, reason: "conversation_or_lead_not_found" };

    const clinic = buildOrganization(clinicRow);
    const timezone = new ClinicTimezone(clinic.timezone);
    const businessHours = parseBusinessHours(clinic.businessHours);
    const calendarGateway = this.calendarGatewayResolver({
      clinicId: clinic.id,
      calendarMode: clinic.calendarMode,
      googleCalendarId: clinic.googleCalendarId,
      timezone,
      businessHours: clinic.businessHours,
      postAppointmentBufferMinutes: clinic.postAppointmentBufferMinutes,
    });

    const treatments = await this.treatmentRepo.listByClinic(params.clinicId);
    const activePipelineState = await this.stateMachine.getTreatmentPipelineState(
      conversation.id,
    );
    if (!matchesHumanReviewPipelineContext({
      state: activePipelineState,
      pipelineTreatmentId: review.treatmentId,
      targetTreatmentId: review.targetTreatmentId,
    })) {
      await db
        .update(conversationsTable)
        .set({
          aiPaused: true,
          needsAttention: true,
          attentionReason: "Revisão humana não corresponde mais ao pipeline ativo",
          updatedAt: runtimeNow(),
        })
        .where(eq(conversationsTable.id, conversation.id));
      return { replied: false, reason: "human_review_pipeline_context_mismatch" };
    }
    const treatment = params.decision === "approved_direct_booking"
      ? treatments.find((t) => t.id === (review.targetTreatmentId ?? review.treatmentId))
      : treatments.find((t) => /avalia[cç][aã]o/i.test(t.name));

    if (!treatment) {
      await db
        .update(conversationsTable)
        .set({
          aiPaused: true,
          needsAttention: true,
          attentionReason: "Revisão humana decidida, mas tratamento alvo não foi encontrado",
          updatedAt: runtimeNow(),
        })
        .where(eq(conversationsTable.id, conversation.id));
      return { replied: false, reason: "target_treatment_not_found" };
    }

    const { slots } = await this.fetchAndOfferSlots(
      conversation.id,
      clinic,
      calendarGateway,
      timezone,
      businessHours,
      undefined,
      undefined,
      undefined,
      treatment.name,
      treatment.durationMinutes,
      false,
    );

    const now = runtimeNow();
    const leadAddress = resolveWhatsAppChannelAddress({
      phone: lead.phone,
      whatsappLid: lead.whatsappLid,
    }) ?? lead.phone;
    if (!leadAddress) return { replied: false, reason: "lead_without_whatsapp_address" };

    const intro = params.decision === "approved_direct_booking"
      ? "O doutor avaliou suas fotos e sinalizou que podemos seguir para o agendamento do procedimento."
      : "O doutor avaliou suas fotos e sinalizou que o melhor próximo passo é uma avaliação presencial.";
    const replyText = slots.length > 0
      ? [
          intro,
          "",
          "Tenho estes horários disponíveis:",
          ...slots.map((slot) => `${slot.index}. ${slot.label}`),
          "",
          "Responda apenas com o número da opção que prefere. Esses horários ficam disponíveis por 15 minutos aguardando sua resposta.",
        ].join("\n")
      : `${intro}\n\nNo momento não encontrei horários disponíveis. Vou deixar a equipe avisada para te ajudar pelo WhatsApp.`;

    const agentMessageId = randomUUID();
    await this.conversationRepo.appendMessage({
      id: agentMessageId,
      conversationId: conversation.id,
      author: "agent",
      body: replyText,
      sentAt: now,
      externalId: null,
      intent: slots.length > 0 ? "check_availability" : "needs_human",
      deliveryFormat: null,
    });

    await db
      .update(conversationsTable)
      .set({
        aiPaused: slots.length === 0,
        takeoverExpiresAt: null,
        needsAttention: slots.length === 0,
        attentionReason: slots.length === 0 ? "Sem horários após revisão humana" : null,
        aiResumedAt: slots.length > 0 ? now : conversation.aiResumedAt,
        updatedAt: now,
      })
      .where(eq(conversationsTable.id, conversation.id));

    await this.enqueueConversationReply(params.clinicId, conversation.id, {
      version: 1,
      kind: "conversation_reply",
      turnId,
      to: leadAddress,
      agentMessageId,
      replyText,
      intent: slots.length > 0 ? "check_availability" : "needs_human",
      useVoice: false,
      ttsConfig: DEFAULT_TTS_CONFIG,
      interleavedParts: [],
      mediaParts: [],
      leadId: lead.id,
      pipelineAdvance: null,
    }, {
      source: "human_review_decision",
      classifiedIntent: "check_availability",
      finalIntent: slots.length > 0 ? "check_availability" : "needs_human",
      confidence: 1,
      missingStages: ["state.loaded", "intent.classified", "intent.resolved"],
    });

    return { replied: true };
  }

  private async enqueueConversationReply(
    clinicId: string,
    conversationId: string,
    payload: ConversationOutboundPayload,
    deterministicTrace?: ConversationDeterministicTraceCompletion,
    plannedResponse?: PlannedResponse,
  ): Promise<void> {
    if (payload.turnId) {
      const stateBeforeDelivery =
        await this.stateMachine.getCurrentState(conversationId);
      const pipelineTracePayload =
        stateBeforeDelivery?.state === "treatment_pipeline_active"
          ? stateBeforeDelivery.payload as TreatmentPipelinePayload
          : null;
      if (deterministicTrace) {
        await recordDeterministicDecisionTraceCompletion(
          this.decisionTraceSink,
          {
            ...deterministicTrace,
            turnId: payload.turnId,
            clinicId,
            conversationId,
            state: stateBeforeDelivery?.state ?? "none",
          },
        );
      }
      await recordDecisionTrace(this.decisionTraceSink, {
        turnId: payload.turnId,
        stage: "state.before_delivery",
        occurredAt: runtimeNow().toISOString(),
        clinicId,
        conversationId,
        metadata: {
          state: stateBeforeDelivery?.state ?? "none",
          pendingPipelineAdvance: payload.pipelineAdvance?.action ?? "none",
          pipelineTreatmentId: pipelineTracePayload?.treatmentId ?? null,
          selectedTreatmentId:
            pipelineTracePayload?.selectedTreatmentId ??
            pipelineTracePayload?.treatmentId ??
            null,
          pipelineStepIndex: pipelineTracePayload?.stepIndex ?? null,
        },
      });
      await recordDecisionTrace(this.decisionTraceSink, {
        turnId: payload.turnId,
        stage: "outbound.planned",
        occurredAt: runtimeNow().toISOString(),
        clinicId,
        conversationId,
        metadata: {
          agentMessageId: payload.agentMessageId,
          intent: payload.intent,
          useVoice: payload.useVoice,
          interleavedPartCount: payload.interleavedParts.length,
          mediaPartCount: payload.mediaParts.length,
          ...(plannedResponse
            ? { responsePlanVersion: plannedResponse.plan.version }
            : {}),
        },
      });
    }
    const enqueueResult = await enqueueOutboundMessage(
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
    if (payload.turnId) {
      await recordDecisionTrace(this.decisionTraceSink, {
        turnId: payload.turnId,
        stage: "outbound.enqueued",
        occurredAt: runtimeNow().toISOString(),
        clinicId,
        conversationId,
        metadata: {
          outboundMessageId: enqueueResult.outboundMessageId,
          messageWasNew: enqueueResult.messageWasNew,
          jobWasNew: enqueueResult.jobWasNew,
        },
      });
    }
  }

  private async bindPipelineAdvanceExpectation(
    conversationId: string,
    advance: PipelineAdvance | null,
  ): Promise<PipelineAdvance | null> {
    if (!advance) return null;
    const current = await this.stateMachine.getTreatmentPipelineState(conversationId);
    if (!current) return advance;
    return {
      ...advance,
      expectedTreatmentId: current.treatmentId,
      expectedStepIndex: current.stepIndex,
    };
  }

  private async applyDurablePipelineAdvance(
    conversationId: string,
    advance: PipelineAdvance,
  ): Promise<boolean> {
    const expected = {
      treatmentId: advance.expectedTreatmentId,
      stepIndex: advance.expectedStepIndex,
    };
    return advance.action === "advance"
      ? this.stateMachine.advancePipelineStep(
          conversationId,
          advance.nextStepIndex,
          expected,
        )
      : this.stateMachine.exitTreatmentPipeline(conversationId, expected);
  }

  // Snapa para a próxima hora cheia com antecedência mínima de 2h.
  // Evita que o cursor do SlotEngine gere slots em :51 ou :37.
  private slotWindowStart(): Date {
    const minAdvanceMs = 2 * 60 * 60_000;
    const earliest = new Date(runtimeNow().getTime() + minAdvanceMs);
    const hourMs = 60 * 60_000;
    return new Date(Math.ceil(earliest.getTime() / hourMs) * hourMs);
  }

  // ── Helper: busca slots e salva oferta na state machine ──
  // Retorna { slots, preferredDayEmpty, outsideBookingWindow, outsideBusinessHours, preferredPeriodUnavailable } onde:
  //   - outsideBookingWindow=true      → data pedida está além da janela de 14 dias
  //   - outsideBusinessHours=true      → dia pedido é hoje mas o expediente já encerrou
  //   - preferredPeriodUnavailable=true→ lead pediu noite mas a clínica fecha às 18h ou antes
  //   - preferredDayEmpty=true         → dia está na janela mas sem horários; slots são alternativas
  //                                      salvas na state machine se exibidas, para resposta por número funcionar
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

    // A7 — Janelas de início por tratamento (ex.: lentes só 09:00/16:00). Resolvemos
    // pelo nome do tratamento agendado; quando há janelas, a grade horária é ignorada
    // e o injetor de horário exato é suprimido (senão "terça às 15h" ofertaria 15:00
    // para lentes, fora da janela).
    const windowTreatment = treatmentName
      ? await this.treatmentRepo.findByName(clinic.id, treatmentName)
      : null;
    const allowedStartWindows = windowTreatment?.bookingWindows ?? null;
    const hasBookingWindows = (allowedStartWindows?.length ?? 0) > 0;

    let allSlots = await calendarGateway.listAvailableSlots({
      clinicId: clinic.id,
      from,
      to,
      slotDurationMinutes: duration,
      allowedStartWindows,
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

    // Reservas ativas (hold de oferta/sinal de outro lead) também bloqueiam a
    // oferta: um slot que o reserve() vai recusar nunca deve ser exibido — o lead
    // escolheria e receberia o falso "seu horário ficou indisponível" logo depois.
    // Espelha a regra de SlotReservationService.reserve(): qualquer reserva
    // sobreposta pending (não expirada) ou confirmed derruba o candidato.
    const activeReservations = await db
      .select({ startsAt: slotReservations.startsAt, endsAt: slotReservations.endsAt })
      .from(slotReservations)
      .where(
        and(
          eq(slotReservations.clinicId, clinic.id),
          lt(slotReservations.startsAt, to),
          gt(slotReservations.endsAt, from),
          or(
            and(eq(slotReservations.status, "pending"), gt(slotReservations.expiresAt, runtimeNow())),
            eq(slotReservations.status, "confirmed"),
          ),
        ),
      );
    allSlots = rejectSlotsOverlappingReservations(allSlots, activeReservations);

    let filteredToDay = false;
    let preferredDayEmpty = false;
    let targetDayParts: LocalDateParts | null = null;

    if (preferredDate) {
      const now = runtimeNow();
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
          // Se exibirmos alternativas numeradas, elas precisam ficar confirmáveis: o lead
          // naturalmente responde "1", "2" etc. no próximo turno.
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
    if (preferredTime && targetDayParts && !hasBookingWindows) {
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

    const slots = await this.stateMachine.offerSlots(conversationId, best, timezone, treatmentName, duration, clinic.slotOfferTtlMinutes, false);
    return { slots, preferredDayEmpty, outsideBookingWindow: false, outsideBusinessHours: false, preferredPeriodUnavailable: false };
  }

  // Retorna o appointment ativo mais próximo de agora (futuro imediato ou passado recente ≤30min).
  private async findTodayAppointment(
    leadId: string,
    timezone: ClinicTimezone,
  ): Promise<{ startsAt: Date } | null> {
    const now = runtimeNow();
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
        await this.sendAuxiliaryTextMessage(
          receptPhone,
          `⚠️ *${displayName} precisa de você*\n\n${reason}\n\nAcesse o Inbox para responder.`,
          channelConfig,
        );
      } catch (err) {
        console.error("[Orchestrator] Failed to send attention WhatsApp notification:", err);
      }
    }

    // Push notification para todos os operadores com app instalado
    await this.notifyOperators(clinic.id, {
        title: `${displayName} precisa de você`,
        body: reason,
        url: "/app/inbox",
      })
      .catch((err) => console.error("[Orchestrator] Push falhou:", err));
  }

}
