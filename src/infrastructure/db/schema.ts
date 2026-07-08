import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { MenuItem } from "@/domain/entities/clinic";
import type { ModuleKey } from "@/application/modules/module-catalog";
import type { CommercialDiagnosticSnapshot } from "@/application/onboarding/commercial-diagnostic";
import type { ProfessionalWorkSchedule } from "@/domain/entities/professional";

export const channelEnum = pgEnum("channel", [
  "whatsapp",
  "instagram",
  "landing_form",
  "google_ads",
  "meta_ads",
  "phone",
  "referral",
  "manual",
]);

export const leadStatusEnum = pgEnum("lead_status", [
  "new",
  "waiting_response",
  "in_conversation",
  "follow_up_due",
  "appointment_scheduled",
  "lost",
  "won",
]);

export const conversationCategoryEnum = pgEnum("conversation_category", [
  "sales",
  "operational",
  "vendor",
  "spam",
  "archived",
]);

export const leadTemperatureEnum = pgEnum("lead_temperature", [
  "cold",
  "warm",
  "hot",
]);

export const messageAuthorEnum = pgEnum("message_author", [
  "lead",
  "clinic_user",
  "agent",
  "system",
]);

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "scheduled",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
]);

export const followUpStatusEnum = pgEnum("follow_up_status", [
  "pending",
  // Claim do dispatcher: marcado antes do envio (claim-before-send) para que
  // um segundo run do cron não reenvie a mesma mensagem. Stale "sending"
  // (> 30min) é recuperado para "pending" no início de cada run.
  "sending",
  "done",
  "cancelled",
  "expired",
]);

export const aiProviderEnum = pgEnum("ai_provider", ["openai", "anthropic"]);

export const ttsProviderEnum = pgEnum("tts_provider", ["elevenlabs", "openai_tts"]);

export const aiOperationEnum = pgEnum("ai_operation", [
  "sales_conversation_analysis",
  "conversation_summary",
  "follow_up_suggestion",
  "manual_analysis",
  "playbook_analysis",
]);

export const whatsappProviderEnum = pgEnum("whatsapp_provider", [
  "meta_cloud_api",
  "z_api",
]);

export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

export const inboundEventProcessingStatusEnum = pgEnum(
  "inbound_event_processing_status",
  ["pending", "processing", "processed", "failed", "ignored"],
);

export const jobQueueEnum = pgEnum("job_queue", [
  "message.process",
  "message.send",
  "followup.dispatch",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "processing",
  "done",
  "failed",
  "dead",
]);

export const outboundMessageDeliveryKindEnum = pgEnum(
  "outbound_message_delivery_kind",
  ["text", "audio", "image", "video", "document"],
);

export const outboundMessageStatusEnum = pgEnum("outbound_message_status", [
  "pending",
  "processing",
  "sent",
  "failed",
  "dead",
  "cancelled",
]);

// Categoria de saída para políticas do Channel Safety Engine (gates no sender).
// reply: resposta a inbound do lead — sempre entregue, nunca bloqueada.
// reminder: aviso de compromisso que o próprio lead marcou — isento de opt-out
//   e de quiet hours (já é agendado para a hora certa).
// follow_up/recovery/campaign: iniciativa da clínica — sujeitas a consentimento,
//   caps de cadência e quiet hours.
// operational: mensagens internas/de sistema — sempre entregues.
export const outboundMessageCategoryEnum = pgEnum("outbound_message_category", [
  "reply",
  "follow_up",
  "reminder",
  "recovery",
  "campaign",
  "operational",
]);

export const whatsappCategoryEnum = pgEnum("whatsapp_category", [
  "service",
  "utility",
  "marketing",
  "authentication",
  "unknown",
]);

export const orgPlanEnum = pgEnum("org_plan", [
  "start",
  "growth",
  "scale",
  "enterprise",
]);
export const orgOperationalStatusEnum = pgEnum("org_operational_status", [
  "prospect",
  "test",
  "active",
  "paused",
  "cancelled",
]);

export const playbookVersionStatusEnum = pgEnum("playbook_version_status", [
  "active",
  "draft",
  "historical",
]);

export const appointmentSourceEnum = pgEnum("appointment_source", [
  "app",
  "gcal_import",
]);

// Fonte de verdade da DISPONIBILIDADE da clínica.
//   "internal"        → banco (appointments + calendar_blocks) é a fonte de verdade
//   "google_calendar" → legado/opt-in: GCal é a fonte de verdade para slots
// Nullable de propósito: quando null, o resolver deriva o modo a partir de
// googleCalendarId. Garante zero mudança para clínicas existentes na migração.
export const calendarModeEnum = pgEnum("calendar_mode", [
  "internal",
  "google_calendar",
]);

// ADR-002: estados do ciclo de vida de um estudo de setup gerado pelo shadow mode.
export const setupStudyStatusEnum = pgEnum("setup_study_status", [
  "draft",     // Gerado e aguardando curadoria do owner
  "sent",      // Enviado para a clínica validar (Fase 2)
  "answered",  // Clínica respondeu (Fase 2)
  "applied",   // Diff aplicado pelo owner (Fase 3)
  "expired",   // Prazo de resposta esgotado sem ação
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Identificador legível e único — usado em URLs e no onboarding.
  slug: text("slug"),
  specialty: text("specialty").notNull(),
  city: text("city"),
  address: text("address"),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  greetingMessage: text("greeting_message"),
  menuItems: jsonb("menu_items").$type<MenuItem[]>(),
  // Diagnóstico comercial capturado no onboarding guiado — entrada bruta +
  // números-chave (ROI, plano, fit). Dado para decisões e análises futuras.
  commercialDiagnostic:
    jsonb("commercial_diagnostic").$type<CommercialDiagnosticSnapshot>(),
  businessHours: text("business_hours"),
  googleCalendarId: text("google_calendar_id"),
  // Fonte de verdade da disponibilidade. Null = derivar de googleCalendarId no resolver.
  calendarMode: calendarModeEnum("calendar_mode"),
  autoReplyEnabled: boolean("auto_reply_enabled").notNull().default(false),
  takeoverTtlHours: integer("takeover_ttl_hours").notNull().default(4),
  postAppointmentBufferMinutes: integer("post_appointment_buffer_minutes")
    .notNull()
    .default(60),
  defaultAppointmentDurationMinutes: integer(
    "default_appointment_duration_minutes",
  )
    .notNull()
    .default(60),
  plan: orgPlanEnum("plan").notNull().default("start"),
  operationalStatus: orgOperationalStatusEnum("operational_status")
    .notNull()
    .default("prospect"),
  monthlyRevenueBrl: integer("monthly_revenue_brl").notNull().default(130000), // centavos
  zapiMonthlyCostBrl: integer("zapi_monthly_cost_brl"), // null = não tem instância própria ou desconhecida
  billingStartedAt: timestamp("billing_started_at", { withTimezone: true }),
  isTest: boolean("is_test").notNull().default(false),
  // Clínica de demonstração/vitrine: mecanismo real do sistema rodando sobre
  // dados fictícios, usada para gravar conteúdo de marketing e demos por
  // segmento. Distinta de isTest (ambiente de testes interno): a demo é
  // exibida como uma clínica "de verdade". Clínicas demo são excluídas dos
  // alertas operacionais e do digest de saúde por email — dados fictícios não
  // geram incidentes reais. Genérico: qualquer clínica demo futura herda isso.
  isDemo: boolean("is_demo").notNull().default(false),
  // Shadow mode: IA classifica, compõe resposta e avança o pipeline normalmente,
  // mas o envio real ao WhatsApp é suprimido — usado para validar comportamento
  // sem afetar o lead (clínicas problemáticas ou pré-onboarding).
  shadowModeEnabled: boolean("shadow_mode_enabled").notNull().default(false),
  receptionistPhone: text("receptionist_phone"),
  // Taxa flat por faixa de parcela { n, rate (%), active }. Null = fallback "taxa da maquininha".
  installmentRates:
    jsonb("installment_rates").$type<
      { n: number; rate: number; active: boolean }[]
    >(),
  rateLimitPerHour: integer("rate_limit_per_hour").notNull().default(60),
  // Caps de saída do Channel Safety Engine (gates no sender worker, PR 2).
  // Distinto de rateLimitPerHour, que limita INBOUND por conversa (anti-flood
  // do lead). Estes limitam OUTBOUND iniciado pela clínica por número/janela;
  // estouro adia o envio (não descarta). Defaults conservadores, a calibrar.
  outboundHourlyCap: integer("outbound_hourly_cap").notNull().default(40),
  outboundDailyCap: integer("outbound_daily_cap").notNull().default(200),
  // Flag do Channel Safety Engine: pausa reengajamento proativo (follow-up e
  // recovery) sem desligar respostas a inbound (autoReplyEnabled). Usado para
  // colocar a Vitalli em modo reply-only nas semanas iniciais sem cirurgia no banco.
  // appointment-reminder NUNCA é pausado por este flag — é aviso de compromisso
  // que o próprio lead marcou; suprimi-lo seria prejuízo ao lead, não proteção.
  automatedReengagementPaused: boolean("automated_reengagement_paused")
    .notNull()
    .default(false),
  unclearThreshold: integer("unclear_threshold").notNull().default(3),
  staleConversationHours: integer("stale_conversation_hours")
    .notNull()
    .default(4),
  slotOfferTtlMinutes: integer("slot_offer_ttl_minutes").notNull().default(15),
  maxSlotsToOffer: integer("max_slots_to_offer").notNull().default(5),
  slotLookaheadDays: integer("slot_lookahead_days").notNull().default(14),
  mediaTakeoverTtlHours: integer("media_takeover_ttl_hours"),
  rapidThrottleMs: integer("rapid_throttle_ms").notNull().default(4000),
  messageDebounceMs: integer("message_debounce_ms"),
  calendarChannelId: text("calendar_channel_id"),
  calendarSyncToken: text("calendar_sync_token"),
  // ── Credenciais de canal POR CLÍNICA (multi-tenant) ──
  // Roteiam tanto a entrada (qual clínica recebeu a mensagem) quanto a saída
  // (por qual número a resposta sai). Produção deve preencher por clínica.
  channelProvider: whatsappProviderEnum("channel_provider"),
  zapiInstanceId: text("zapi_instance_id"),
  zapiToken: text("zapi_token"),
  zapiClientToken: text("zapi_client_token"),
  metaPhoneNumberId: text("meta_phone_number_id"),
  metaAccessToken: text("meta_access_token"),
  // Momento em que a instância Z-API foi conectada com sucesso pela primeira vez
  // via o fluxo de pareamento dentro do nosso portal (P0.5). Nullable: clínicas
  // existentes e as que conectaram pelo painel Z-API têm null.
  // Uso futuro (Fase 1): ancoragem para warmup — número novo entra com caps
  // reduzidos que sobem por semana de idade a partir deste timestamp.
  channelPairedAt: timestamp("channel_paired_at", { withTimezone: true }),
  // Modo operacional de segurança do canal (Reputation Engine - Fase 1):
  // normal | atencao | cooling | frozen
  channelSafetyMode: text("channel_safety_mode").notNull().default("normal"),
  // Terminologia adaptada por segmento (ex: "tratamento", "serviço", "procedimento")
  serviceNoun: text("service_noun").notNull().default("tratamento"),
  // Segmento do negócio: "dental" | "barbershop" | "hair_salon" | "aesthetics" | "atelier" | "other"
  segment: text("segment").notNull().default("dental"),
  // Vocabulário do agente — derivado do segmento, sobrescrevível por tenant
  bookingNoun: text("booking_noun").notNull().default("consulta"),
  contactNoun: text("contact_noun").notNull().default("paciente"),
  agentRole: text("agent_role").notNull().default("recepcionista virtual"),
  businessDescriptor: text("business_descriptor"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const treatments = pgTable(
  "treatments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    description: text("description"),
    requiresEvaluationFirst: boolean("requires_evaluation_first")
      .notNull()
      .default(false),
    triggerTemplate: text("trigger_template"),
    keywordMatchEnabled: boolean("keyword_match_enabled")
      .notNull()
      .default(true),
    aliases: text("aliases").array().notNull().default([]),
    isAesthetic: boolean("is_aesthetic").notNull().default(false),
    pipelineSteps:
      jsonb("pipeline_steps").$type<
        import("@/domain/entities/treatment").PipelineStep[]
      >(),
    priceCents: integer("price_cents"),
    minPriceCents: integer("min_price_cents"),
    maxPriceCents: integer("max_price_cents"),
    // Item 3 (config ownership): o preço é FATO estruturado; a prosa que a IA fala
    // é DERIVADA daqui (ver composePriceSection), nunca redigitada na commercialPolicy.
    // A IA pode cotar este valor por mensagem? Se false, nunca verbaliza número
    // (ex.: "os valores são definidos na avaliação").
    priceQuotableInChat: boolean("price_quotable_in_chat").notNull().default(false),
    // "from" → "a partir de R$ X" (piso). "fixed" → "R$ X" (valor exato).
    priceKind: text("price_kind").$type<"from" | "fixed">().notNull().default("from"),
    // Unidade que qualifica o valor, quando existir ("20 elementos", "por dente",
    // "por sessão"). Sem isto, "R$ 2.500" pode virar cotação enganosa.
    priceUnit: text("price_unit"),
    // O valor é abatido do tratamento se o paciente avançar (típico da avaliação).
    priceDeductible: boolean("price_deductible").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicNameIdx: uniqueIndex("treatments_org_name_idx").on(
      table.clinicId,
      table.name,
    ),
  }),
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name"),
    phone: text("phone"),
    whatsappLid: text("whatsapp_lid"),
    email: text("email"),
    channel: channelEnum("channel").notNull(),
    campaignId: text("campaign_id"),
    treatmentInterest: text("treatment_interest"),
    profilePicUrl: text("profile_pic_url"),
    status: leadStatusEnum("status").notNull().default("new"),
    temperature: leadTemperatureEnum("temperature"),
    assignedToUserId: uuid("assigned_to_user_id"),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    // Opt-out durável (Channel Safety Engine). revoked_at != null = o lead pediu
    // para não receber mais mensagens iniciadas pela clínica. Bloqueia
    // follow_up/recovery/campaign; replies a inbound do próprio lead continuam.
    // Reversão = limpar o campo (não se auto-reseta se o lead voltar a falar).
    contactConsentRevokedAt: timestamp("contact_consent_revoked_at", {
      withTimezone: true,
    }),
    contactConsentSource: text("contact_consent_source"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicStatusIdx: index("leads_org_status_idx").on(
      table.clinicId,
      table.status,
    ),
    clinicPhoneIdx: uniqueIndex("leads_org_phone_idx").on(
      table.clinicId,
      table.phone,
    ),
    clinicWhatsappLidIdx: uniqueIndex("leads_org_whatsapp_lid_idx").on(
      table.clinicId,
      table.whatsappLid,
    ),
  }),
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    channel: channelEnum("channel").notNull(),
    category: conversationCategoryEnum("category").notNull().default("sales"),
    externalThreadId: text("external_thread_id"),
    summary: text("summary"),
    aiPaused: boolean("ai_paused").notNull().default(false),
    takeoverExpiresAt: timestamp("takeover_expires_at", { withTimezone: true }),
    needsAttention: boolean("needs_attention").notNull().default(false),
    attentionReason: text("attention_reason"),
    consecutiveUnclearCount: integer("consecutive_unclear_count")
      .notNull()
      .default(0),
    // Claim de processamento: serializa webhooks concorrentes da mesma conversa.
    // Adquirido via UPDATE condicional (CAS de single-statement — neon-http não
    // suporta transações interativas). NULL ou passado = livre.
    processingUntil: timestamp("processing_until", { withTimezone: true }),
    // Sequência monotônica para preservar a ordem de entregas na outbox.
    nextOutboundSequence: integer("next_outbound_sequence").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    // Marcado quando a IA retoma controle após pausa (TTL expirado ou operador retomou).
    // Usado pelo stuck-conversation-sweep para ignorar mensagens enviadas antes da retomada,
    // evitando falsos positivos de "sem resposta automática" em conversas já tratadas.
    aiResumedAt: timestamp("ai_resumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    leadIdx: uniqueIndex("conversations_lead_idx").on(table.leadId),
    clinicCategoryIdx: index("conversations_org_category_idx").on(
      table.clinicId,
      table.category,
    ),
    externalThreadIdx: index("conversations_external_thread_idx").on(
      table.externalThreadId,
    ),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    author: messageAuthorEnum("author").notNull(),
    body: text("body").notNull(),
    mediaUrl: text("media_url"),
    mediaType: text("media_type").$type<
      "image" | "video" | "audio" | "document"
    >(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    externalId: text("external_id"),
    intent: text("intent"),
    deliveryFormat: text("delivery_format").$type<"text" | "audio">(),
    // Composta em shadow mode: nunca foi enviada de verdade ao WhatsApp do lead.
    simulated: boolean("simulated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    conversationSentAtIdx: index("messages_conversation_sent_at_idx").on(
      table.conversationId,
      table.sentAt,
    ),
    externalIdIdx: uniqueIndex("messages_external_id_idx").on(table.externalId),
  }),
);

export const inboundEvents = pgTable(
  "inbound_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    provider: whatsappProviderEnum("provider").notNull(),
    providerMessageId: text("provider_message_id").notNull(),
    conversationKey: text("conversation_key").notNull(),
    payload: jsonb("payload").notNull(),
    normalizedText: text("normalized_text"),
    mediaType: text("media_type"),
    dedupeKey: text("dedupe_key").notNull(),
    processingStatus: inboundEventProcessingStatusEnum("processing_status")
      .notNull()
      .default("pending"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => ({
    providerMessageUnique: uniqueIndex(
      "inbound_events_provider_message_unique",
    ).on(table.provider, table.providerMessageId),
    clinicReceivedAtIdx: index("inbound_events_org_received_at_idx").on(
      table.clinicId,
      table.receivedAt,
    ),
    processingStatusReceivedAtIdx: index(
      "inbound_events_processing_status_received_at_idx",
    ).on(table.processingStatus, table.receivedAt),
    dedupeKeyIdx: index("inbound_events_dedupe_key_idx").on(table.dedupeKey),
  }),
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queue: jobQueueEnum("queue").notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    payload: jsonb("payload").notNull(),
    dedupeKey: text("dedupe_key"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(10),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    queueStatusRunAtIdx: index("jobs_queue_status_run_at_idx").on(
      table.queue,
      table.status,
      table.runAt,
    ),
    statusRunAtIdx: index("jobs_status_run_at_idx").on(
      table.status,
      table.runAt,
    ),
    queueDedupeKeyIdx: uniqueIndex("jobs_queue_dedupe_key_idx").on(
      table.queue,
      table.dedupeKey,
    ),
  }),
);

export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    channel: channelEnum("channel").notNull(),
    payload: jsonb("payload").notNull(),
    deliveryKind: outboundMessageDeliveryKindEnum("delivery_kind").notNull(),
    // Default "reply" preserva o comportamento do fluxo conversacional atual —
    // toda saída existente é resposta a inbound. Gates diferenciados por
    // categoria entram no PR 2 (Safety Gate no sender worker).
    category: outboundMessageCategoryEnum("category").notNull().default("reply"),
    sequence: integer("sequence").notNull(),
    status: outboundMessageStatusEnum("status").notNull().default("pending"),
    providerMessageId: text("provider_message_id"),
    dedupeKey: text("dedupe_key"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => ({
    conversationCreatedAtIdx: index(
      "outbound_messages_conversation_created_at_idx",
    ).on(table.conversationId, table.createdAt),
    conversationSequenceIdx: uniqueIndex(
      "outbound_messages_conversation_sequence_idx",
    ).on(table.conversationId, table.sequence),
    statusCreatedAtIdx: index("outbound_messages_status_created_at_idx").on(
      table.status,
      table.createdAt,
    ),
    conversationDedupeKeyIdx: uniqueIndex(
      "outbound_messages_conversation_dedupe_key_idx",
    ).on(table.conversationId, table.dedupeKey),
    providerMessageIdIdx: index("outbound_messages_provider_message_id_idx").on(
      table.providerMessageId,
    ),
  }),
);

export const agentRecommendations = pgTable(
  "agent_recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    leadTemperature: leadTemperatureEnum("lead_temperature").notNull(),
    stage: text("stage").notNull(),
    mainObjection: text("main_objection"),
    suggestedReply: text("suggested_reply").notNull(),
    nextAction: text("next_action").notNull(),
    followUp: text("follow_up"),
    handoffRequired: boolean("handoff_required").notNull(),
    riskFlags: jsonb("risk_flags").$type<string[]>().notNull().default([]),
    confidenceScore: integer("confidence_score").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    humanDecision: text("human_decision"),
    finalReply: text("final_reply"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    leadCreatedAtIdx: index("agent_recommendations_lead_created_at_idx").on(
      table.leadId,
      table.createdAt,
    ),
  }),
);

export const followUps = pgTable(
  "follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: followUpStatusEnum("status").notNull().default("pending"),
    reason: text("reason").notNull(),
    suggestedMessage: text("suggested_message"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicDueAtIdx: index("follow_ups_org_due_at_idx").on(
      table.clinicId,
      table.dueAt,
    ),
    leadReasonDueAtIdx: uniqueIndex("follow_ups_org_lead_reason_due_at_idx").on(
      table.clinicId,
      table.leadId,
      table.reason,
      table.dueAt,
    ),
  }),
);

export const professionals = pgTable(
  "professionals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    specialty: text("specialty"),
    color: text("color").notNull().default("#10B981"),
    // Grade semanal do profissional (ver ProfessionalWorkSchedule). null = segue o
    // horário da clínica inteira — SlotEngine.computeAvailableSlots trata a ausência
    // como "sem restrição própria", nunca como "não atende nenhum dia".
    workSchedule: jsonb("work_schedule").$type<ProfessionalWorkSchedule>(),
    googleCalendarId: text("google_calendar_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicIdx: index("professionals_org_idx").on(table.clinicId),
  }),
);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicIdx: index("rooms_org_idx").on(table.clinicId),
  }),
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    professionalId: uuid("professional_id").references(() => professionals.id),
    roomId: uuid("room_id").references(() => rooms.id),
    calendarEventId: text("calendar_event_id"),
    calendarEventUrl: text("calendar_event_url"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: appointmentStatusEnum("status").notNull().default("scheduled"),
    source: appointmentSourceEnum("source").notNull().default("app"),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    treatmentId: uuid("treatment_id").references(() => treatments.id),
    valueCents: integer("value_cents"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicStartsAtIdx: index("appointments_org_starts_at_idx").on(
      table.clinicId,
      table.startsAt,
    ),
    clinicProfessionalIdx: index("appointments_org_professional_idx").on(
      table.clinicId,
      table.professionalId,
    ),
  }),
);

// Bloqueios de horário FIRST-CLASS (almoço, férias, ausência, manutenção).
// Não usam lead falso. No modo google_calendar os bloqueios continuam como
// eventos no GCal (prefixo 🚫); esta tabela é usada no modo interno.
// professionalId null = bloqueio da clínica inteira.
export const calendarBlocks = pgTable(
  "calendar_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    professionalId: uuid("professional_id").references(() => professionals.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicStartsAtIdx: index("calendar_blocks_org_starts_at_idx").on(
      table.clinicId,
      table.startsAt,
    ),
  }),
);

export const aiUsageCosts = pgTable(
  "ai_usage_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    provider: aiProviderEnum("provider").notNull(),
    model: text("model").notNull(),
    operation: aiOperationEnum("operation").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    estimatedCostUsdMicros: integer("estimated_cost_usd_micros").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicCreatedAtIdx: index("ai_usage_costs_org_created_at_idx").on(
      table.clinicId,
      table.createdAt,
    ),
  }),
);

export const ttsUsageCosts = pgTable(
  "tts_usage_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    provider: ttsProviderEnum("provider").notNull(),
    model: text("model").notNull(),
    characterCount: integer("character_count").notNull(),
    estimatedCostUsdMicros: integer("estimated_cost_usd_micros").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicCreatedAtIdx: index("tts_usage_costs_org_created_at_idx").on(
      table.clinicId,
      table.createdAt,
    ),
  }),
);

export const whatsappMessageCosts = pgTable(
  "whatsapp_message_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    provider: whatsappProviderEnum("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    direction: messageDirectionEnum("direction").notNull(),
    category: whatsappCategoryEnum("category").notNull(),
    estimatedCostUsdMicros: integer("estimated_cost_usd_micros").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicCreatedAtIdx: index(
      "whatsapp_message_costs_org_created_at_idx",
    ).on(table.clinicId, table.createdAt),
  }),
);

// Eventos de orçamento da infraestrutura compartilhada. Não pertencem a uma
// clínica específica porque o plano Vercel é custo da plataforma.
export const platformSpendAlerts = pgTable(
  "platform_spend_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").$type<"vercel">().notNull(),
    teamId: text("team_id").notNull(),
    budgetAmountUsd: integer("budget_amount_usd").notNull(),
    currentSpendUsd: integer("current_spend_usd").notNull(),
    thresholdPercent: integer("threshold_percent").$type<50 | 75 | 100>().notNull(),
    eventKey: text("event_key").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    providerReceivedAtIdx: index("platform_spend_alerts_provider_received_at_idx").on(
      table.provider,
      table.receivedAt,
    ),
    eventKeyIdx: uniqueIndex("platform_spend_alerts_event_key_idx").on(table.eventKey),
  }),
);

// Estado explícito de conversa — substitui marcadores de texto em mensagens
export const conversationStates = pgTable(
  "conversation_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    // idle | slots_offered | awaiting_confirmation | booking_pending | menu_offered | procedure_list_offered
    state: text("state").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => ({
    conversationCreatedAtIdx: index(
      "conversation_states_conversation_created_at_idx",
    ).on(table.conversationId, table.createdAt),
  }),
);

// Subscriptions de push notification para operadores da clínica
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userEmail: text("user_email").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    endpointIdx: uniqueIndex("push_subscriptions_endpoint_idx").on(
      table.endpoint,
    ),
    clinicIdx: index("push_subscriptions_org_idx").on(table.clinicId),
  }),
);

export const playbookVersions = pgTable(
  "playbook_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    status: playbookVersionStatusEnum("status").notNull().default("draft"),
    specialty: text("specialty"),
    procedureDescription: text("procedure_description"),
    toneOfVoice: text("tone_of_voice").notNull().default("acolhedor"),
    differentials: jsonb("differentials")
      .$type<string[]>()
      .notNull()
      .default([]),
    commercialPolicy: text("commercial_policy"),
    // Orientação livre editada pela tela de settings. Vive aqui (e não em
    // organizations) para que settings e advisor alimentem a MESMA versão ativa.
    notes: text("notes"),
    receptionistName: text("receptionist_name").notNull().default("Marina"),
    objections: jsonb("objections")
      .$type<{ objection: string; response: string }[]>()
      .notNull()
      .default([]),
    // DEPRECATED (biblioteca de mídia): substituída por media_assets +
    // mediaAssetIds abaixo. Mantida só como fallback de leitura até a Fase 4
    // (contração) da migração — não escrever mais aqui.
    mediaLibrary: jsonb("media_library")
      .$type<
        { id: string; title: string; url: string; type: "video" | "image" }[]
      >()
      .notNull()
      .default([]),
    // Seleção de mídias (da biblioteca clinic-level `media_assets`) que este
    // playbook autoriza a IA a enviar. A biblioteca é a dona do arquivo; o
    // playbook só curadoriza o subconjunto que entra no prompt.
    mediaAssetIds: jsonb("media_asset_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicStatusIdx: index("playbook_versions_org_status_idx").on(
      table.clinicId,
      table.status,
    ),
  }),
);

// Biblioteca de mídia clinic-level (vídeos, fotos; documentos em fase futura).
// treatmentId nullable = mídia geral. Quando setado, é o gate determinístico
// de isolamento entre procedimentos: nem o prompt oferece, nem o envio libera
// mídia de um treatmentId para uma conversa de outro (ver resolveOutboundParts
// em ConversationOrchestrator.ts). NUNCA relaxar esse isolamento via prompt.
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    treatmentId: uuid("treatment_id").references(() => treatments.id),
    title: text("title").notNull(),
    url: text("url").notNull(),
    type: text("type").$type<"video" | "image" | "document">().notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    folder: text("folder"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicIdx: index("media_assets_org_idx").on(table.clinicId),
  }),
);

// Lock otimista de slots — previne double-booking
export const clinicMetrics = pgTable("clinic_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  periodFrom: timestamp("period_from", { withTimezone: true }).notNull(),
  periodTo: timestamp("period_to", { withTimezone: true }).notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const slotReservations = pgTable(
  "slot_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // pending | confirmed | released
    status: text("status").notNull().default("pending"),
    calendarEventId: text("calendar_event_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicStartsAtIdx: index("slot_reservations_org_starts_at_idx").on(
      table.clinicId,
      table.startsAt,
    ),
    clinicLeadIdx: index("slot_reservations_org_lead_idx").on(
      table.clinicId,
      table.leadId,
    ),
    clinicStartsAtUnique: uniqueIndex(
      "slot_reservations_org_starts_at_unique",
    ).on(table.clinicId, table.startsAt),
  }),
);

// ── Membros: liga um usuário (por email) a uma clínica ──
// owner enxerga todas; org_admin é resolvido para a organização do seu vínculo.
export const memberRoleEnum = pgEnum("member_role", [
  "owner",
  "org_admin",
  "receptionist",
  "professional",
]);

export const clinicMembers = pgTable(
  "clinic_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull().default("org_admin"),
    // Nome de exibição amigável usado na saudação do dashboard (ex.: "Dr. Gregorie").
    // Quando preenchido, tem prioridade sobre o profissional vinculado e o e-mail.
    displayName: text("display_name"),
    professionalId: uuid("professional_id").references(() => professionals.id),
    passwordHash: text("password_hash"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    emailClinicIdx: uniqueIndex("org_members_email_org_idx").on(
      table.email,
      table.clinicId,
    ),
    emailIdx: index("org_members_email_idx").on(table.email),
  }),
);

// ── Módulos por clínica: feature flags vinculados ao plano de assinatura ──
// Cada linha representa um módulo ativado/desativado para uma clínica.
// O catálogo e as regras de plano vivem em src/application/modules/.
export const clinicModules = pgTable(
  "clinic_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull().$type<ModuleKey>(),
    isActive: boolean("is_active").notNull().default(true),
    config: jsonb("config"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => ({
    uniq: unique().on(t.clinicId, t.moduleKey),
    activeIdx: index("idx_org_modules_org").on(t.clinicId),
  }),
);

// Armazena insights operacionais gerados por LLM sobre padrões de conversas recentes.
// Gerado diariamente pelo cron /api/cron/conversation-insights; expira em 3 dias.
export const clinicOperationalInsights = pgTable(
  "clinic_operational_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    category: text("category").notNull().default("operational"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    affectedCount: integer("affected_count").notNull().default(1),
    actionData: jsonb("action_data").$type<Record<string, unknown>>(),
    convIds: jsonb("conv_ids").$type<string[]>(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clinicActiveIdx: index("org_operational_insights_org_active_idx").on(
      t.clinicId,
      t.expiresAt,
    ),
  }),
);

// Registra menções de tratamentos não encontrados no catálogo da clínica.
// Alimenta os insights operacionais no Inbox: "X leads mencionaram Y — cadastrar?"
// Permite ao doutor identificar lacunas no catálogo sem precisar ler cada conversa.
export const treatmentGapReports = pgTable(
  "treatment_gap_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    leadName: text("lead_name"),
    mentionedText: text("mentioned_text").notNull(),
    messageSnippet: text("message_snippet").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clinicCreatedIdx: index("treatment_gap_reports_org_created_idx").on(
      t.clinicId,
      t.createdAt,
    ),
    convIdx: index("treatment_gap_reports_conv_idx").on(t.conversationId),
  }),
);

export const channelHealthSnapshots = pgTable(
  "channel_health_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // Formato YYYY-MM-DD
    optOutCount: integer("opt_out_count").notNull().default(0),
    outboundSent: integer("outbound_sent").notNull().default(0),
    outboundCancelled: integer("outbound_cancelled").notNull().default(0),
    outboundDeferred: integer("outbound_deferred").notNull().default(0),
    inboundReceived: integer("inbound_received").notNull().default(0),
    healthScore: integer("health_score").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clinicDateIdx: index("channel_health_snapshots_org_date_idx").on(
      t.clinicId,
      t.date,
    ),
  }),
);

// ADR-002: tabela de estudos de setup gerados a partir do shadow mode.
// Cada estudo é um snapshot de findings extraídos pelo LLM a partir dos
// transcritos anonimizados da clínica. Uma clínica pode ter vários estudos
// mas apenas um é o ativo por vez (status = 'draft').
export const setupStudies = pgTable(
  "setup_studies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: setupStudyStatusEnum("status").notNull().default("draft"),
    // Array de SetupFinding (domínio). Parse defensivo: campos extras são ignorados.
    findings: jsonb("findings")
      .$type<import("@/domain/entities/setup-study").SetupFinding[]>()
      .notNull()
      .default([]),
    // Hash do token de acesso usado na página pública da clínica (Fase 2).
    accessTokenHash: text("access_token_hash"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgStatusIdx: index("setup_studies_org_status_idx").on(
      t.organizationId,
      t.status,
    ),
    orgCreatedAtIdx: index("setup_studies_org_created_at_idx").on(
      t.organizationId,
      t.createdAt,
    ),
  }),
);

export const calendarImportTokens = pgTable(
  "calendar_import_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgTokenIdx: index("calendar_import_tokens_org_idx").on(t.organizationId),
    expiresAtIdx: index("calendar_import_tokens_expires_idx").on(t.expiresAt),
  }),
);
