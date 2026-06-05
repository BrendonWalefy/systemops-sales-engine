import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ConversationExperience, MenuItem } from "@/domain/entities/clinic";

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

export const leadTemperatureEnum = pgEnum("lead_temperature", ["cold", "warm", "hot"]);

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
  "done",
  "cancelled",
  "expired",
]);

export const aiProviderEnum = pgEnum("ai_provider", ["openai"]);

export const aiOperationEnum = pgEnum("ai_operation", [
  "sales_conversation_analysis",
  "conversation_summary",
  "follow_up_suggestion",
  "manual_analysis",
]);

export const whatsappProviderEnum = pgEnum("whatsapp_provider", ["meta_cloud_api", "z_api"]);

export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);

export const whatsappCategoryEnum = pgEnum("whatsapp_category", [
  "service",
  "utility",
  "marketing",
  "authentication",
  "unknown",
]);

export const clinicPlanEnum = pgEnum("clinic_plan", ["essencial", "clinica", "rede", "custom"]);

export const playbookVersionStatusEnum = pgEnum("playbook_version_status", [
  "active",
  "draft",
  "historical",
]);

export const appointmentSourceEnum = pgEnum("appointment_source", ["app", "gcal_import"]);

// Fonte de verdade da DISPONIBILIDADE da clínica.
//   "internal"        → banco (appointments + calendar_blocks) é a fonte de verdade
//   "google_calendar" → legado/opt-in: GCal é a fonte de verdade para slots
// Nullable de propósito: quando null, o resolver deriva o modo a partir de
// googleCalendarId. Garante zero mudança para clínicas existentes na migração.
export const calendarModeEnum = pgEnum("calendar_mode", ["internal", "google_calendar"]);

export const clinics = pgTable("clinics", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Identificador legível e único — usado em URLs e no onboarding.
  slug: text("slug"),
  specialty: text("specialty").notNull().default("odontology"),
  city: text("city"),
  address: text("address"),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  conversationExperience: text("conversation_experience")
    .$type<ConversationExperience>()
    .notNull()
    .default("menu_first"),
  greetingMessage: text("greeting_message"),
  menuItems: jsonb("menu_items").$type<MenuItem[]>(),
  businessHours: text("business_hours"),
  googleCalendarId: text("google_calendar_id"),
  // Fonte de verdade da disponibilidade. Null = derivar de googleCalendarId no resolver.
  calendarMode: calendarModeEnum("calendar_mode"),
  autoReplyEnabled: boolean("auto_reply_enabled").notNull().default(false),
  takeoverTtlHours: integer("takeover_ttl_hours").notNull().default(4),
  postAppointmentBufferMinutes: integer("post_appointment_buffer_minutes").notNull().default(60),
  defaultAppointmentDurationMinutes: integer("default_appointment_duration_minutes").notNull().default(60),
  plan: clinicPlanEnum("plan").notNull().default("essencial"),
  monthlyRevenueBrl: integer("monthly_revenue_brl").notNull().default(89700), // centavos
  billingStartedAt: timestamp("billing_started_at", { withTimezone: true }),
  isTest: boolean("is_test").notNull().default(false),
  receptionistPhone: text("receptionist_phone"),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Rotas de QA para reaproveitar uma instância WhatsApp real sem misturar dados
// da clínica dona do canal. sourceClinicId possui as credenciais Z-API; targetClinicId
// recebe leads, conversas, agenda e custos. phone é E.164 só com dígitos.
export const whatsappQaRoutes = pgTable(
  "whatsapp_qa_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceClinicId: uuid("source_clinic_id")
      .notNull()
      .references(() => clinics.id),
    targetClinicId: uuid("target_clinic_id")
      .notNull()
      .references(() => clinics.id),
    phone: text("phone").notNull(),
    label: text("label"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourcePhoneIdx: uniqueIndex("whatsapp_qa_routes_source_phone_idx").on(
      table.sourceClinicId,
      table.phone,
    ),
    targetPhoneIdx: index("whatsapp_qa_routes_target_phone_idx").on(
      table.targetClinicId,
      table.phone,
    ),
  }),
);

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
    commonObjections: jsonb("common_objections").$type<string[]>().notNull().default([]),
    requiresEvaluationFirst: boolean("requires_evaluation_first").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicNameIdx: uniqueIndex("treatments_clinic_name_idx").on(table.clinicId, table.name),
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
    email: text("email"),
    channel: channelEnum("channel").notNull(),
    campaignId: text("campaign_id"),
    treatmentInterest: text("treatment_interest"),
    status: leadStatusEnum("status").notNull().default("new"),
    temperature: leadTemperatureEnum("temperature"),
    assignedToUserId: uuid("assigned_to_user_id"),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicStatusIdx: index("leads_clinic_status_idx").on(table.clinicId, table.status),
    clinicPhoneIdx: index("leads_clinic_phone_idx").on(table.clinicId, table.phone),
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
    externalThreadId: text("external_thread_id"),
    summary: text("summary"),
    aiPaused: boolean("ai_paused").notNull().default(false),
    takeoverExpiresAt: timestamp("takeover_expires_at", { withTimezone: true }),
    needsAttention: boolean("needs_attention").notNull().default(false),
    attentionReason: text("attention_reason"),
    consecutiveUnclearCount: integer("consecutive_unclear_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    leadIdx: index("conversations_lead_idx").on(table.leadId),
    externalThreadIdx: index("conversations_external_thread_idx").on(table.externalThreadId),
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
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    externalId: text("external_id"),
    intent: text("intent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicDueAtIdx: index("follow_ups_clinic_due_at_idx").on(table.clinicId, table.dueAt),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicCreatedAtIdx: index("ai_usage_costs_clinic_created_at_idx").on(
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicCreatedAtIdx: index("whatsapp_message_costs_clinic_created_at_idx").on(
      table.clinicId,
      table.createdAt,
    ),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => ({
    conversationCreatedAtIdx: index("conversation_states_conversation_created_at_idx").on(
      table.conversationId,
      table.createdAt,
    ),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    endpointIdx: uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint),
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
    differentials: jsonb("differentials").$type<string[]>().notNull().default([]),
    commercialPolicy: text("commercial_policy"),
    // Orientação livre editada pela tela de settings. Vive aqui (e não em
    // clinics) para que settings e advisor alimentem a MESMA versão ativa.
    notes: text("notes"),
    objections: jsonb("objections")
      .$type<{ objection: string; response: string }[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicStatusIdx: index("playbook_versions_clinic_status_idx").on(table.clinicId, table.status),
  }),
);

// Lock otimista de slots — previne double-booking
export const clinicMetrics = pgTable("clinic_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id").notNull().references(() => clinics.id),
  periodFrom: timestamp("period_from", { withTimezone: true }).notNull(),
  periodTo: timestamp("period_to", { withTimezone: true }).notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicStartsAtIdx: index("slot_reservations_clinic_starts_at_idx").on(
      table.clinicId,
      table.startsAt,
    ),
    clinicLeadIdx: index("slot_reservations_clinic_lead_idx").on(table.clinicId, table.leadId),
    clinicStartsAtUnique: uniqueIndex("slot_reservations_clinic_starts_at_unique").on(
      table.clinicId,
      table.startsAt,
    ),
  }),
);

// ── Membros: liga um usuário (por email) a uma clínica ──
// owner enxerga todas; clinic_admin é resolvido para a clínica do seu vínculo.
export const memberRoleEnum = pgEnum("member_role", ["owner", "clinic_admin"]);

export const clinicMembers = pgTable(
  "clinic_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull().default("clinic_admin"),
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailClinicIdx: uniqueIndex("clinic_members_email_clinic_idx").on(table.email, table.clinicId),
    emailIdx: index("clinic_members_email_idx").on(table.email),
  }),
);
