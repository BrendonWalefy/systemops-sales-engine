import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
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
import type { PostAppointmentRule } from "@/domain/entities/post-appointment-rule";
import type { DecisionTraceRecord } from "@/core/observability/DecisionTrace";
import { sql } from "drizzle-orm";

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
  "lead_outcome_classification",
  "reactivation_draft",
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

// Quem de fato produziu o agendamento. `source` não responde isso: "app" é
// gravado por 4 caminhos distintos (IA, operador pelo inbox, operador pela
// agenda, fluxo de sinal), o que torna impossível medir a conversão da IA.
// Nullable de propósito: linhas anteriores a esta coluna ficam null =
// "origem desconhecida (histórico)" — não devem ser contadas como conversão
// de nenhum caminho. Ver docs/architecture/current.md.
export const appointmentOriginEnum = pgEnum("appointment_origin", [
  "ai_conversation",
  "operator_inbox",
  "operator_agenda",
  "deposit_flow",
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

// Revisão de Conversas (feature catalogada em docs/features.md): estados do
// ciclo de vida de uma rodada de curadoria de trechos do shadow mode enviada
// ao responsável da clínica. Enum próprio — não reutiliza setupStudyStatusEnum
// (não existe "applied" aqui; a aplicação do feedback é manual no playbook).
export const conversationReviewStatusEnum = pgEnum("conversation_review_status", [
  "draft",     // Owner está curando os trechos
  "sent",      // Enviada para o cliente responder
  "answered",  // Cliente concluiu a revisão
  "expired",   // Prazo de resposta esgotado sem ação
]);

export const humanReviewStatusEnum = pgEnum("human_review_status", [
  "pending",
  "decided",
  "expired",
  "cancelled",
]);

export const humanReviewDecisionEnum = pgEnum("human_review_decision", [
  "approved_direct_booking",
  "needs_evaluation",
  "manual_reply",
  "not_eligible",
]);

export const humanReviewDecisionSourceEnum = pgEnum("human_review_decision_source", [
  "whatsapp",
  "panel",
]);

// Motor de Reativação (ADR-009). Motivo pelo qual o lead não fechou — enum
// fechado porque texto livre não segmenta ("achou caro", "preço alto" e "valor"
// virariam três segmentos distintos). A evidência textual mora em coluna
// separada, não aqui.
export const leadOutcomeReasonEnum = pgEnum("lead_outcome_reason", [
  "price",
  "schedule",
  "location",
  "fear",
  "third_party_decision",
  "competitor",
  "treatment_mismatch",
  "no_response",
  "already_treated",
  "other",
]);

// Quem classificou. "human" é soberano: uma correção do operador nunca é
// sobrescrita por reclassificação automática (ver drizzle-lead-outcome-repository).
export const leadOutcomeSourceEnum = pgEnum("lead_outcome_source", [
  "llm",
  "human",
  "system",
]);

// O que estava na mesa quando a pessoa parou de responder (ADR-009).
// Complementa o motivo: em produção 82 de 94 leads vieram como "no_response" —
// correto, mas sem poder de segmentação. Este campo é DETERMINÍSTICO, calculado
// do histórico em src/core/intelligence/silence-stage.ts, não perguntado ao LLM.
export const silenceStageEnum = pgEnum("silence_stage", [
  "after_quote",
  "price_unanswered",
  "after_slots",
  "awaiting_clinic",
  "early",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Identificador legível e único — usado em URLs e no onboarding.
  slug: text("slug"),
  specialty: text("specialty").notNull(),
  city: text("city"),
  address: text("address"),
  // Prédio, torre, sala, andar. Campo próprio porque espremer isso no `address`
  // some na leitura: a Vitalli tem "Sala 124" no meio de "Av. Adolfo Pinheiro,
  // 1.029, Sala 124 - Santo Amaro", enquanto o template do operador separa em
  // linha ("Helbor Offices Torre Sul, Sala 124, Andar 12"). Item #22 do plano.
  addressComplement: text("address_complement"),
  // Link do Google Maps. O WhatsApp renderiza o link com pré-visualização e foto
  // do prédio — é o que o operador manda à mão hoje, enquanto a IA manda texto
  // puro. Item #23. Sem campo, a IA não pode inventar uma URL.
  mapsUrl: text("maps_url"),
  // Bloco de localização escrito pela clínica, do jeito dela. OPCIONAL: sem ele, o
  // sistema compõe a resposta a partir de address/complemento/mapsUrl, como sempre.
  //
  // É texto livre de propósito. Estruturar isto seria chumbar o formato de UMA
  // clínica: a Vitalli fica num prédio comercial e cita torre, sala, andar, endereço
  // alternativo do estacionamento e estações de metrô; a próxima vai querer ponto de
  // referência ou "toque o interfone". O sistema nunca calcula nada com esses fatos —
  // só imprime. Estrutura só se paga quando há conta a fazer (preço, garantia).
  locationMessage: text("location_message"),
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
  // TTL do pipeline de tratamento (usado como minutos: valor * 60). NÃO usar como
  // gatilho de reinício de conversa — ver conversationRestartHours abaixo.
  staleConversationHours: integer("stale_conversation_hours")
    .notNull()
    .default(4),
  // Gap de inatividade a partir do qual o lead volta a ser tratado como primeiro
  // contato (recebe a saudação de abertura em vez de continuidade).
  //
  // Separado de staleConversationHours de propósito: o mesmo campo governava as
  // duas coisas, e subir a janela de reinício arrastava junto o TTL do pipeline,
  // que porteia 6 pontos de decisão do orquestrador.
  //
  // Default 24h medido em produção: o gap p90 entre mensagens consecutivas do
  // mesmo lead é de 17h. Com o limite antigo (4h/6h), 17,2% das respostas de lead
  // disparavam "conversa nova" e recebiam a saudação de abertura no meio do
  // atendimento. Em 24h isso cai para 5,9%.
  // Ver docs/architecture/current.md.
  conversationRestartHours: integer("conversation_restart_hours")
    .notNull()
    .default(24),
  slotOfferTtlMinutes: integer("slot_offer_ttl_minutes").notNull().default(15),
  maxSlotsToOffer: integer("max_slots_to_offer").notNull().default(5),
  slotLookaheadDays: integer("slot_lookahead_days").notNull().default(14),
  // Fecha o funil como o operador faz: depois de cotar preço de um único
  // tratamento (sem ambiguidade/escalonamento/objeção em curso), oferta
  // horários reais direto em vez de só perguntar "posso ver os horários?".
  // Opt-in por clínica (não basta modo concierge) — pedido explícito da
  // Vitalli em 17/07/2026; outras clínicas (ex.: Ximendes) têm padrões de
  // conversa (objeção, compra para terceiro, especificação técnica) onde
  // essa antecipação não foi validada. Ver ConversationOrchestrator.ts
  // case "price_inquiry".
  offerSlotsAfterPriceEnabled: boolean("offer_slots_after_price_enabled")
    .notNull()
    .default(false),
  // Política operacional por tenant. Incidentes de uma clínica não podem virar
  // promessa global de atendimento fora do expediente.
  outsideHoursExceptionEnabled: boolean("outside_hours_exception_enabled")
    .notNull()
    .default(false),
  // Espelha o resumo diário do staff (agenda de amanhã + pendentes de
  // confirmação) no WhatsApp pessoal do responsável (receptionist_phone),
  // além do push. Diferente dos avisos event-driven que já usam
  // receptionist_phone (foto/comprovante/atenção), este é proativo e
  // recorrente — por isso é opt-in por clínica: uma clínica que configurou
  // receptionist_phone para receber encaminhamentos não necessariamente quer
  // uma mensagem toda noite. Pedido da Vitalli em 17/07/2026. Ver
  // appointment-reminder-staff/route.ts.
  staffDigestWhatsAppEnabled: boolean("staff_digest_whatsapp_enabled")
    .notNull()
    .default(false),
  // Régua de pós-atendimento: mensagens agendadas disparadas X horas após o fim
  // da consulta (cuidados, pedido de feedback). Config por clínica — vazio/null =
  // nada dispara. Percorrida pelo cron post-appointment-followup. Ver
  // PostAppointmentRule.
  postAppointmentRules: jsonb("post_appointment_rules").$type<PostAppointmentRule[]>(),
  // ── Fluxo de sinal (depósito via Pix para garantir o horário) ──
  // Quando habilitado, ao escolher um slot a IA envia um pedido de sinal determinístico
  // (Pix), faz uma reserva provisória e aguarda o comprovante; o OPERADOR valida o
  // comprovante e confirma (a IA nunca valida comprovante). Ver DepositTemplates.
  depositEnabled: boolean("deposit_enabled").notNull().default(false),
  depositAmountCents: integer("deposit_amount_cents"),
  depositPixKey: text("deposit_pix_key"),
  depositPixKeyType: text("deposit_pix_key_type").$type<
    "cnpj" | "cpf" | "email" | "phone" | "random"
  >(),
  depositRecipientName: text("deposit_recipient_name"),
  depositTtlHours: integer("deposit_ttl_hours").notNull().default(24),
  depositNotes: text("deposit_notes"),
  depositConfirmationNotes: text("deposit_confirmation_notes"),
  mediaTakeoverTtlHours: integer("media_takeover_ttl_hours"),
  rapidThrottleMs: integer("rapid_throttle_ms").notNull().default(4000),
  messageDebounceMs: integer("message_debounce_ms"),
  // Uma única janela efetiva alimenta classificador e compositor. Nullable para
  // preservar o default seguro do código e permitir calibração isolada por tenant.
  aiContextWindowMessages: integer("ai_context_window_messages"),
  // Fallback por clínica para etapas Q&A sem maxTurns próprio no pipeline.
  pipelineQaDefaultMaxTurns: integer("pipeline_qa_default_max_turns"),
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
  // App Secret usado para autenticar x-hub-signature-256 no webhook inbound.
  // Segredo criptografado pelo credential vault, assim como o access token.
  metaAppSecret: text("meta_app_secret"),
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
}, (table) => [
  uniqueIndex("organizations_zapi_instance_unique")
    .on(table.zapiInstanceId)
    .where(sql`${table.zapiInstanceId} is not null and btrim(${table.zapiInstanceId}) <> ''`),
  uniqueIndex("organizations_meta_phone_number_unique")
    .on(table.metaPhoneNumberId)
    .where(sql`${table.metaPhoneNumberId} is not null and btrim(${table.metaPhoneNumberId}) <> ''`),
]);

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
    // @deprecated Inerte desde 2026-07-27. Mantido fisicamente por uma janela
    // expand-contract para rollback de instâncias antigas; nenhum runtime lê.
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
    // Permite que uma variante comercial (ex.: "Lente Estratificada") use a
    // jornada canônica de outro tratamento sem duplicar pipelineSteps. A
    // resolução valida mesma clínica e faz fallback seguro se o id ficar órfão.
    pipelineSourceTreatmentId: uuid("pipeline_source_treatment_id"),
    // null preserva o comportamento legado. "immediate" entrega o primeiro
    // content step no mesmo turno; "qualify_then_present" abre com qualificação
    // e mantém o conteúdo posicionado para a próxima resposta do lead.
    pipelineEntryBehavior: text("pipeline_entry_behavior").$type<
      import("@/domain/entities/treatment").PipelineEntryBehavior
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
    // Preço por quantidade fechada (pacotes cujo valor não é proporcional à quantidade,
    // ex.: lentes 10=R$1.500, 20=R$1.800). Null = sem pacotes. Ver composePriceSection.
    quantityPrices:
      jsonb("quantity_prices").$type<
        import("@/domain/entities/treatment").TreatmentQuantityPrice[]
      >(),
    // Janelas de início permitidas para agendar (ex.: lentes só 09:00 e 16:00). Null =
    // grade horária padrão do businessHours. Ver SlotEngine.computeAvailableSlots.
    bookingWindows:
      jsonb("booking_windows").$type<
        import("@/domain/entities/treatment").TreatmentBookingWindow[]
      >(),
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

export const priceCampaigns = pgTable(
  "price_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    treatmentId: uuid("treatment_id")
      .notNull()
      .references(() => treatments.id),
    name: text("name").notNull(),
    priceCents: integer("price_cents"),
    minPriceCents: integer("min_price_cents"),
    maxPriceCents: integer("max_price_cents"),
    // "from" → "a partir de R$ X". "fixed" → "R$ X". Mesma semântica de treatments.priceKind.
    priceKind: text("price_kind").$type<"from" | "fixed">().notNull().default("from"),
    // Janela de validade (opcional). null em ambos = sem expiração automática,
    // controlado só por isActive.
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    // Chave-mestra de ativação — a clínica liga/desliga a campanha independente
    // da janela de datas.
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicTreatmentIdx: index("price_campaigns_org_treatment_idx").on(
      table.clinicId,
      table.treatmentId,
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
    // Cobre a leitura do inbox: filtro por clínica, ordenado por última
    // mensagem. `id` desempata mensagens simultâneas para o cursor keyset
    // da Task 3 — a ordem das colunas aqui é o contrato dela.
    clinicLastMessageIdx: index("conversations_org_last_message_idx").on(
      table.clinicId,
      table.lastMessageAt.desc(),
      table.id.desc(),
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
    // Dead letters resolvidas permanecem consultáveis, mas deixam de degradar
    // a saúde da fila. Reprocessar limpa estes campos e cria uma nova tentativa.
    deadLetterDisposition: text("dead_letter_disposition").$type<
      "acknowledged" | "discarded"
    >(),
    deadLetterResolvedAt: timestamp("dead_letter_resolved_at", {
      withTimezone: true,
    }),
    deadLetterResolvedBy: text("dead_letter_resolved_by"),
    deadLetterResolutionReason: text("dead_letter_resolution_reason"),
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

// Auditoria imutável de cada decisão humana sobre um job morto. A tabela de
// jobs guarda o estado atual; esta tabela preserva todo o histórico.
export const jobDeadLetterActions = pgTable(
  "job_dead_letter_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    action: text("action")
      .$type<"acknowledge" | "discard" | "reprocess">()
      .notNull(),
    actorEmail: text("actor_email").notNull(),
    reason: text("reason").notNull(),
    allowedLateDelivery: boolean("allowed_late_delivery").notNull().default(false),
    jobAttempts: integer("job_attempts").notNull(),
    jobLastError: text("job_last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    jobCreatedAtIdx: index("job_dead_letter_actions_job_created_at_idx").on(
      table.jobId,
      table.createdAt,
    ),
  }),
);

// Trilha operacional sanitizada por turno. Um único row agrega os eventos para
// evitar uma escrita de banco a cada decisão do orquestrador. Nunca armazena
// mensagem, prompt, resposta, telefone, nome ou URL; o sink aplica allowlist.
export const decisionTraces = pgTable(
  "decision_traces",
  {
    turnId: text("turn_id").primaryKey(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(
      () => conversations.id,
      { onDelete: "cascade" },
    ),
    events: jsonb("events").$type<DecisionTraceRecord[]>().notNull(),
    firstOccurredAt: timestamp("first_occurred_at", { withTimezone: true })
      .notNull(),
    lastOccurredAt: timestamp("last_occurred_at", { withTimezone: true })
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicUpdatedAtIdx: index("decision_traces_org_updated_at_idx").on(
      table.clinicId,
      table.updatedAt,
    ),
    conversationUpdatedAtIdx: index(
      "decision_traces_conversation_updated_at_idx",
    ).on(table.conversationId, table.updatedAt),
    expiresAtIdx: index("decision_traces_expires_at_idx").on(table.expiresAt),
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
    origin: appointmentOriginEnum("origin"),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    treatmentId: uuid("treatment_id").references(() => treatments.id),
    valueCents: integer("value_cents"),
    description: text("description"),
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
    // CAS aditivo: uma revisão de estado pode ser consumida no máximo uma vez.
    // Nullable preserva estados legados e transições ainda não revisionadas.
    supersedesStateId: uuid("supersedes_state_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => ({
    conversationCreatedAtIdx: index(
      "conversation_states_conversation_created_at_idx",
    ).on(table.conversationId, table.createdAt),
    supersedesStateIdIdx: uniqueIndex(
      "conversation_states_supersedes_state_id_idx",
    ).on(table.supersedesStateId),
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
    // @deprecated Inerte desde 2026-07-27; treatments.description é o dono.
    // Remover fisicamente somente após a janela expand-contract do release.
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
    // Política de garantia estruturada. Antes vivia (quando vivia) dentro do texto
    // livre de uma objeção — a Vitalli tinha, a Ximendes não, e ninguém percebeu a
    // falta porque não existia campo para ficar vazio. `null` = não cadastrado (a IA
    // diz que confirma com a equipe); `offersWarranty: false` = a clínica decidiu que
    // não dá garantia, o que também é uma resposta que ela autorizou.
    // Faixas porque a política real tem mais de um prazo: a Vitalli dá 2 anos para
    // descolamento e 30 dias para pigmentação/quebra por descuido.
    warrantyPolicy: jsonb("warranty_policy").$type<{
      offersWarranty: boolean;
      tiers: { periodMonths: number; covers: string }[];
      conditions: string | null;
    }>(),
    // @deprecated Inerte desde 2026-07-27; media_assets + mediaAssetIds são os
    // únicos donos. Mantido por uma janela expand-contract para rollback seguro.
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
    oneActivePerClinicIdx: uniqueIndex("playbook_versions_one_active_per_org_idx")
      .on(table.clinicId)
      .where(sql`${table.status} = 'active'`),
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

// Revisão humana operacional em tempo real: quando um lead envia mídia que
// exige avaliação do responsável, criamos um caso curto ("Caso 27"). A decisão
// é auditável e pode retomar a automação com agenda direta, sem inferir texto
// livre do doutor.
export const humanReviewRequests = pgTable(
  "human_review_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    sourceMessageId: uuid("source_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    treatmentId: uuid("treatment_id").references(() => treatments.id),
    targetTreatmentId: uuid("target_treatment_id").references(() => treatments.id),
    reviewCode: integer("review_code").notNull(),
    status: humanReviewStatusEnum("status").notNull().default("pending"),
    decision: humanReviewDecisionEnum("decision"),
    decisionSource: humanReviewDecisionSourceEnum("decision_source"),
    reviewerPhone: text("reviewer_phone"),
    reviewNotes: text("review_notes"),
    sourceMediaType: text("source_media_type").$type<"image" | "video" | "document">(),
    sourceMediaUrl: text("source_media_url"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clinicStatusIdx: index("human_review_requests_org_status_idx").on(
      table.clinicId,
      table.status,
    ),
    conversationIdx: index("human_review_requests_conversation_idx").on(
      table.conversationId,
    ),
    pendingCodeUniqueIdx: uniqueIndex("human_review_requests_pending_code_idx")
      .on(table.clinicId, table.reviewCode)
      .where(sql`${table.status} = 'pending'`),
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
// Encurtador dos links que saem nas mensagens. O WhatsApp sempre mostra a URL por
// escrito, e a do Maps tem 180 caracteres — cinco linhas embaixo do card. O slug é
// derivado da própria URL (hash), então a criação é idempotente: o mesmo endereço
// enviado 137 vezes gera uma linha, não 137.
export const shortLinks = pgTable("short_links", {
  slug: text("slug").primaryKey(),
  targetUrl: text("target_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Cache de pré-visualização de link. A prévia é buscada UMA vez por URL e reusada
// em todos os envios seguintes — o link do endereço da Vitalli saiu 137 vezes com
// a mesma URL, então buscar a cada envio seria 137 idas ao Google para o mesmo
// resultado. `ok=false` guarda a falha por menos tempo, para não martelar um site
// fora do ar nem tentar de novo a cada mensagem.
export const linkPreviews = pgTable("link_previews", {
  url: text("url").primaryKey(),
  title: text("title"),
  description: text("description"),
  imageUrl: text("image_url"),
  ok: boolean("ok").notNull().default(true),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

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

// Revisão de Conversas (feature catalogada em docs/features.md): rodadas de
// curadoria de trechos reais do shadow mode enviadas ao responsável da
// clínica para feedback (👍 Ficou bom / ✏️ Eu ajustaria) antes do go-live.
// Snapshot congelado: os trechos (jsonb) são cópias imutáveis das mensagens
// no momento da curadoria — a página pública nunca faz live-query a
// `messages`, então editar/apagar a conversa de origem não afeta uma rodada
// já enviada (Apêndice G do plano).
export const conversationReviews = pgTable(
  "conversation_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: conversationReviewStatusEnum("status").notNull().default("draft"),
    title: text("title").notNull(),
    // Array de ConversationExcerpt (domínio). Parse defensivo: campos extras são ignorados.
    excerpts: jsonb("excerpts")
      .$type<import("@/domain/entities/conversation-review").ConversationExcerpt[]>()
      .notNull()
      .default([]),
    // Comentário geral opcional do cliente ao concluir a revisão.
    overallComment: text("overall_comment"),
    // Hash do token de acesso usado na página pública `/conversas/[token]` (PR 2).
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
    orgStatusIdx: index("conversation_reviews_org_status_idx").on(
      t.organizationId,
      t.status,
    ),
    orgCreatedAtIdx: index("conversation_reviews_org_created_at_idx").on(
      t.organizationId,
      t.createdAt,
    ),
  }),
);

// Motor de Reativação (ADR-009), Fase 2.
// draft: sendo montada. reviewing: rascunhos gerados, aguardando a clínica.
// approved: liberada por um humano — sem isso nada é enfileirado.
// running/paused/done/cancelled: ciclo de disparo.
export const reactivationCampaignStatusEnum = pgEnum(
  "reactivation_campaign_status",
  ["draft", "reviewing", "approved", "running", "paused", "done", "cancelled"],
);

// pending: rascunho gerado, ninguém olhou. approved/rejected: decisão humana.
// queued: entrou na outbox. sent: entregue. skipped: excluído no disparo por
// segurança (agendou no meio do caminho, opt-out). replied/converted: resultado.
export const reactivationTargetStatusEnum = pgEnum(
  "reactivation_target_status",
  [
    "pending",
    "approved",
    "rejected",
    "queued",
    "sent",
    "skipped",
    "failed",
    "replied",
    "converted",
  ],
);

// ai_per_lead: uma mensagem por pessoa, escrita com o contexto da conversa dela.
// template: mesmo texto para todos, com variáveis.
export const reactivationMessageModeEnum = pgEnum("reactivation_message_mode", [
  "ai_per_lead",
  "template",
]);

// Motor de Reativação (ADR-009), Fase 1. Por que cada lead não fechou, com o
// trecho da conversa que sustenta a conclusão — a evidência é o que torna a
// classificação auditável pela clínica, e foi pedido explícito do cliente
// ("verificar o porquê não fechou — ler um trecho da conversa").
//
// Um outcome corrente por lead (índice único). O histórico não é objetivo aqui:
// o que interessa é o motivo vigente para segmentar campanhas.
export const leadOutcomes = pgTable(
  "lead_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    reason: leadOutcomeReasonEnum("reason").notNull(),
    // Trecho literal da conversa que justifica o motivo. Copiado, não referenciado:
    // apagar a mensagem de origem não pode invalidar a evidência já apresentada.
    evidenceExcerpt: text("evidence_excerpt"),
    evidenceMessageId: uuid("evidence_message_id"),
    // 0-100. Abaixo do limiar a UI mostra como "sugestão" e pede confirmação.
    confidence: integer("confidence").notNull().default(0),
    source: leadOutcomeSourceEnum("source").notNull().default("llm"),
    // Modelo que produziu a classificação — permite comparar qualidade entre
    // modelos sem reclassificar tudo às cegas.
    model: text("model"),
    // Última mensagem da conversa vista nesta classificação. Se não mudou, não
    // há o que reclassificar — é o corte que impede gastar LLM à toa todo dia.
    // Estágio do silêncio — ver silenceStageEnum. Nullable porque registros
    // classificados antes deste campo existir só ganham valor no backfill.
    silenceStage: silenceStageEnum("silence_stage"),
    lastSeenMessageId: uuid("last_seen_message_id"),
    classifiedAt: timestamp("classified_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clinicLeadIdx: uniqueIndex("lead_outcomes_org_lead_idx").on(
      t.clinicId,
      t.leadId,
    ),
    // Índice da consulta que a audiência faz: "leads desta clínica cujo motivo
    // é X" (ver audience-resolver na Fase 2).
    clinicReasonIdx: index("lead_outcomes_org_reason_idx").on(
      t.clinicId,
      t.reason,
    ),
  }),
);

// Motor de Reativação (ADR-009), Fase 2 — a campanha.
//
// Liga audiência (segment) + oferta (price_campaigns, que já existia) + prazo.
// A oferta NÃO é reinventada aqui: a clínica já cadastra campanha de preço por
// tratamento em settings/tratamentos, e a IA já usa isso para cotar.
export const reactivationCampaigns = pgTable(
  "reactivation_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // AudienceSegment (application/reactivation/audience-segment.ts). Congelado
    // no momento da criação: os alvos são materializados a partir dele, e o
    // preview que a clínica aprovou precisa ser o que de fato sai.
    segment: jsonb("segment").notNull(),
    // Oferta opcional. Sem ela a campanha é só reengajamento.
    priceCampaignId: uuid("price_campaign_id").references(() => priceCampaigns.id, {
      onDelete: "set null",
    }),
    // "fechar no máximo até sexta" — a urgência é real, não inventada pela IA.
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    status: reactivationCampaignStatusEnum("status").notNull().default("draft"),
    messageMode: reactivationMessageModeEnum("message_mode")
      .notNull()
      .default("ai_per_lead"),
    templateText: text("template_text"),
    // Ramp da própria campanha, ALÉM dos caps da clínica no Safety Gate.
    // Dois freios independentes: um protege o número, outro protege a campanha.
    dailySendCap: integer("daily_send_cap").notNull().default(30),
    // Modo ensaio: quando preenchido, tudo é entregue na conversa deste lead de
    // teste em vez dos leads reais. Aponta para um lead porque o sender valida
    // que o destino bate com o lead da conversa (automationDestinationMatchesLead).
    testLeadId: uuid("test_lead_id").references(() => leads.id, {
      onDelete: "set null",
    }),
    // Email de quem criou/aprovou: é o que a sessão carrega (ver SessionPayload),
    // e o mesmo padrão de clinic_modules.updatedBy. Um uuid aqui seria uma coluna
    // que nunca teríamos como preencher.
    createdByEmail: text("created_by_email"),
    // Enquanto for null, nada é enfileirado. Aprovação humana é obrigatória.
    approvedByEmail: text("approved_by_email"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    lastDispatchAt: timestamp("last_dispatch_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clinicStatusIdx: index("reactivation_campaigns_org_status_idx").on(
      t.clinicId,
      t.status,
    ),
    clinicCreatedAtIdx: index("reactivation_campaigns_org_created_at_idx").on(
      t.clinicId,
      t.createdAt,
    ),
  }),
);

// Um alvo por lead na campanha. Materializado na criação — a audiência é
// congelada ali. As exclusões de SEGURANÇA (opt-out, agendou no meio do
// caminho) são reavaliadas no disparo; a lista de quem entrou, não.
export const reactivationCampaignTargets = pgTable(
  "reactivation_campaign_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => reactivationCampaigns.id, { onDelete: "cascade" }),
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    status: reactivationTargetStatusEnum("status").notNull().default("pending"),
    // Escrito pela IA. Nunca enviado sem passar por revisão humana.
    draftMessage: text("draft_message"),
    // Preenchido quando o operador reescreve. Vence o rascunho no envio.
    editedMessage: text("edited_message"),
    rejectionReason: text("rejection_reason"),
    skipReason: text("skip_reason"),
    outboundMessageId: uuid("outbound_message_id"),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    // Métricas de resultado (Fase 4): o lead respondeu? virou agendamento?
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    convertedAppointmentId: uuid("converted_appointment_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Um lead não entra duas vezes na mesma campanha.
    campaignLeadIdx: uniqueIndex("reactivation_targets_campaign_lead_idx").on(
      t.campaignId,
      t.leadId,
    ),
    campaignStatusIdx: index("reactivation_targets_campaign_status_idx").on(
      t.campaignId,
      t.status,
    ),
    // Índice do cap de vida: "quantas campanhas este lead já recebeu".
    clinicLeadIdx: index("reactivation_targets_org_lead_idx").on(
      t.clinicId,
      t.leadId,
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

// Read model de invalidação: uma linha por (clínica, recurso). Substitui as
// quatro agregações que o poll da inbox rodava a cada 5s por aba. A versão é
// monotônica e só indica "mudou"; ela nunca carrega conteúdo de conversa.
export const clinicReadVersions = pgTable(
  "clinic_read_versions",
  {
    clinicId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    version: bigint("version", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.clinicId, table.resource] }),
  }),
);
