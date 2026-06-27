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

export const aiProviderEnum = pgEnum("ai_provider", ["openai"]);

export const ttsProviderEnum = pgEnum("tts_provider", ["elevenlabs", "openai_tts"]);

export const aiOperationEnum = pgEnum("ai_operation", [
  "sales_conversation_analysis",
  "conversation_summary",
  "follow_up_suggestion",
  "manual_analysis",
]);

export const whatsappProviderEnum = pgEnum("whatsapp_provider", [
  "meta_cloud_api",
  "z_api",
]);

export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

export const whatsappCategoryEnum = pgEnum("whatsapp_category", [
  "service",
  "utility",
  "marketing",
  "authentication",
  "unknown",
]);

export const clinicPlanEnum = pgEnum("clinic_plan", [
  "essencial",
  "clinica",
  "rede",
  "custom",
]);
export const clinicOperationalStatusEnum = pgEnum("clinic_operational_status", [
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

export const clinics = pgTable("clinics", {
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
  plan: clinicPlanEnum("plan").notNull().default("essencial"),
  operationalStatus: clinicOperationalStatusEnum("operational_status")
    .notNull()
    .default("prospect"),
  monthlyRevenueBrl: integer("monthly_revenue_brl").notNull().default(89700), // centavos
  billingStartedAt: timestamp("billing_started_at", { withTimezone: true }),
  isTest: boolean("is_test").notNull().default(false),
  receptionistPhone: text("receptionist_phone"),
  // Taxa flat por faixa de parcela { n, rate (%), active }. Null = fallback "taxa da maquininha".
  installmentRates:
    jsonb("installment_rates").$type<
      { n: number; rate: number; active: boolean }[]
    >(),
  rateLimitPerHour: integer("rate_limit_per_hour").notNull().default(60),
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
  // Terminologia adaptada por segmento (ex: "tratamento", "serviço", "procedimento")
  serviceNoun: text("service_noun").notNull().default("tratamento"),
  // Segmento do negócio: "dental" | "barbershop" | "hair_salon" | "aesthetics" | "other"
  segment: text("segment").notNull().default("dental"),
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
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    name: text("name").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    description: text("description"),
    commonObjections: jsonb("common_objections")
      .$type<string[]>()
      .notNull()
      .default([]),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicNameIdx: uniqueIndex("treatments_clinic_name_idx").on(
      table.clinicId,
      table.name,
    ),
  }),
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicStatusIdx: index("leads_clinic_status_idx").on(
      table.clinicId,
      table.status,
    ),
    clinicPhoneIdx: uniqueIndex("leads_clinic_phone_idx").on(
      table.clinicId,
      table.phone,
    ),
    clinicWhatsappLidIdx: uniqueIndex("leads_clinic_whatsapp_lid_idx").on(
      table.clinicId,
      table.whatsappLid,
    ),
  }),
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
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
    clinicCategoryIdx: index("conversations_clinic_category_idx").on(
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

export const agentRecommendations = pgTable(
  "agent_recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
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
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
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
    clinicDueAtIdx: index("follow_ups_clinic_due_at_idx").on(
      table.clinicId,
      table.dueAt,
    ),
    leadReasonDueAtIdx: uniqueIndex("follow_ups_lead_reason_due_at_idx").on(
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
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    name: text("name").notNull(),
    specialty: text("specialty"),
    color: text("color").notNull().default("#10B981"),
    workSchedule: jsonb("work_schedule"),
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
    clinicIdx: index("professionals_clinic_idx").on(table.clinicId),
  }),
);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
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
    clinicIdx: index("rooms_clinic_idx").on(table.clinicId),
  }),
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
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
    clinicStartsAtIdx: index("appointments_clinic_starts_at_idx").on(
      table.clinicId,
      table.startsAt,
    ),
    clinicProfessionalIdx: index("appointments_clinic_professional_idx").on(
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
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    professionalId: uuid("professional_id").references(() => professionals.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicStartsAtIdx: index("calendar_blocks_clinic_starts_at_idx").on(
      table.clinicId,
      table.startsAt,
    ),
  }),
);

export const aiUsageCosts = pgTable(
  "ai_usage_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
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
    clinicCreatedAtIdx: index("ai_usage_costs_clinic_created_at_idx").on(
      table.clinicId,
      table.createdAt,
    ),
  }),
);

export const ttsUsageCosts = pgTable(
  "tts_usage_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    provider: ttsProviderEnum("provider").notNull(),
    model: text("model").notNull(),
    characterCount: integer("character_count").notNull(),
    estimatedCostUsdMicros: integer("estimated_cost_usd_micros").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicCreatedAtIdx: index("tts_usage_costs_clinic_created_at_idx").on(
      table.clinicId,
      table.createdAt,
    ),
  }),
);

export const whatsappMessageCosts = pgTable(
  "whatsapp_message_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
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
      "whatsapp_message_costs_clinic_created_at_idx",
    ).on(table.clinicId, table.createdAt),
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
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
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
    clinicIdx: index("push_subscriptions_clinic_idx").on(table.clinicId),
  }),
);

export const playbookVersions = pgTable(
  "playbook_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
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
    // clinics) para que settings e advisor alimentem a MESMA versão ativa.
    notes: text("notes"),
    receptionistName: text("receptionist_name").notNull().default("Marina"),
    objections: jsonb("objections")
      .$type<{ objection: string; response: string }[]>()
      .notNull()
      .default([]),
    mediaLibrary: jsonb("media_library")
      .$type<
        { id: string; title: string; url: string; type: "video" | "image" }[]
      >()
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
    clinicStatusIdx: index("playbook_versions_clinic_status_idx").on(
      table.clinicId,
      table.status,
    ),
  }),
);

// Lock otimista de slots — previne double-booking
export const clinicMetrics = pgTable("clinic_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id")
    .notNull()
    .references(() => clinics.id),
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
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
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
    clinicStartsAtIdx: index("slot_reservations_clinic_starts_at_idx").on(
      table.clinicId,
      table.startsAt,
    ),
    clinicLeadIdx: index("slot_reservations_clinic_lead_idx").on(
      table.clinicId,
      table.leadId,
    ),
    clinicStartsAtUnique: uniqueIndex(
      "slot_reservations_clinic_starts_at_unique",
    ).on(table.clinicId, table.startsAt),
  }),
);

// ── Membros: liga um usuário (por email) a uma clínica ──
// owner enxerga todas; clinic_admin é resolvido para a clínica do seu vínculo.
export const memberRoleEnum = pgEnum("member_role", [
  "owner",
  "clinic_admin",
  "receptionist",
  "professional",
]);

export const clinicMembers = pgTable(
  "clinic_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull().default("clinic_admin"),
    professionalId: uuid("professional_id").references(() => professionals.id),
    passwordHash: text("password_hash"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    emailClinicIdx: uniqueIndex("clinic_members_email_clinic_idx").on(
      table.email,
      table.clinicId,
    ),
    emailIdx: index("clinic_members_email_idx").on(table.email),
  }),
);

// ── Módulos por clínica: feature flags vinculados ao plano de assinatura ──
// Cada linha representa um módulo ativado/desativado para uma clínica.
// O catálogo e as regras de plano vivem em src/application/modules/.
export const clinicModules = pgTable(
  "clinic_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
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
    activeIdx: index("idx_clinic_modules_clinic").on(t.clinicId),
  }),
);

// Registra menções de tratamentos não encontrados no catálogo da clínica.
// Alimenta os insights operacionais no Inbox: "X leads mencionaram Y — cadastrar?"
// Permite ao doutor identificar lacunas no catálogo sem precisar ler cada conversa.
export const treatmentGapReports = pgTable(
  "treatment_gap_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
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
    clinicCreatedIdx: index("treatment_gap_reports_clinic_created_idx").on(
      t.clinicId,
      t.createdAt,
    ),
    convIdx: index("treatment_gap_reports_conv_idx").on(t.conversationId),
  }),
);
