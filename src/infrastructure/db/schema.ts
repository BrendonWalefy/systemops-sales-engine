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

export const clinics = pgTable("clinics", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  specialty: text("specialty").notNull().default("odontology"),
  city: text("city"),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  toneOfVoice: text("tone_of_voice"),
  commercialPolicy: text("commercial_policy"),
  playbook: text("playbook"),
  businessHours: text("business_hours"),
  googleCalendarId: text("google_calendar_id"),
  autoReplyEnabled: boolean("auto_reply_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const treatments = pgTable(
  "treatments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    name: text("name").notNull(),
    description: text("description"),
    commonObjections: jsonb("common_objections").$type<string[]>().notNull().default([]),
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
    calendarEventId: text("calendar_event_id"),
    calendarEventUrl: text("calendar_event_url"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: appointmentStatusEnum("status").notNull().default("scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicStartsAtIdx: index("appointments_clinic_starts_at_idx").on(
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
    // idle | slots_offered | awaiting_confirmation | booking_pending
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

// Lock otimista de slots — previne double-booking
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
