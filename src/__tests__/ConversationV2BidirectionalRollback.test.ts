import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveTurnLifecycle } from "@/application/conversation/live-turn-lifecycle";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";
import { ProcessMessageJobHandler } from "@/application/jobs/process-message-job";
import { SendMessageJobHandler } from "@/application/jobs/send-message-job";
import type {
  ConversationHandleInput,
  ConversationHandleResult,
  ConversationHandler,
} from "@/application/ports/conversation-handler";
import type { OutboundMessage, OutboundMessageStore } from "@/application/ports/outbound-message-store";
import type { InboundEvent, InboundEventStore } from "@/application/ports/inbound-event-store";
import type { JobRecord } from "@/application/ports/job-queue";
import { RegisterIncomingMessage } from "@/application/use-cases/leads/register-incoming-message";
import {
  TenantEngineRouter,
} from "@/application/conversation-v2/tenant-engine-router";
import type { ConversationStateRow } from "@/core/conversation/ConversationStateMachine";
import { InMemoryDecisionTraceSink } from "@/core/observability/DecisionTrace";
import { ConversationTurnCoordinator } from "@/core/pipeline/ConversationTurnCoordinator";
import { BookingService } from "@/core/scheduling/BookingService";
import type { Appointment, CalendarSlot } from "@/domain/entities/calendar-slot";
import type { Organization } from "@/domain/entities/clinic";
import type { Conversation, Message } from "@/domain/entities/conversation";
import type { Lead } from "@/domain/entities/lead";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { SlotReservation } from "@/core/scheduling/SlotReservationService";
import type { ConversationEnginePolicy } from "@/application/conversation-v2/engine-selection";
import type { InternalLabEligibilityReader } from "@/application/ports/internal-lab-eligibility-reader";
import type { ClinicAutomationPolicyReader } from "@/application/ports/clinic-automation-policy-reader";
import { createConversationV2Runtime } from "@/infrastructure/conversation-v2/create-conversation-v2-runtime";
import { V2LiveConversationHandler } from "@/application/conversation-v2/v2-live-conversation-handler";
import { createLiveDentalUnderstanding } from "@/infrastructure/adapters/ai/live-dental-understanding";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";
import type { Treatment } from "@/domain/entities/treatment";
import {
  createRegisteredInternalLabDeploymentSmokeApproval,
  INTERNAL_LAB_TEST_BINDINGS,
} from "./helpers/internal-lab-approval-fixture";

const now = new Date("2026-08-17T15:00:00.000Z");
const slotStart = new Date("2026-08-18T18:00:00.000Z");
const slotEnd = new Date("2026-08-18T19:00:00.000Z");
let consoleLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => { consoleLog = vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { consoleLog.mockRestore(); });

const clinic = {
  id: INTERNAL_LAB_TEST_BINDINGS.expectedClinicId,
  name: "SystemOps Dental Lab",
  timezone: "America/Sao_Paulo",
  calendarMode: "internal",
  aiContextWindowMessages: 8,
  slotOfferTtlMinutes: 15,
  maxSlotsToOffer: 3,
  slotLookaheadDays: 14,
  postAppointmentBufferMinutes: 0,
} as Organization;

class MemoryLeadRepository implements LeadRepository {
  readonly records = new Map<string, Lead>();

  async findById(id: string): Promise<Lead | null> { return this.records.get(id) ?? null; }
  async findByPhone(clinicId: string, phone: string): Promise<Lead | null> {
    return [...this.records.values()].find((lead) =>
      lead.clinicId === clinicId && lead.phone === phone) ?? null;
  }
  async findByWhatsAppLid(): Promise<Lead | null> { return null; }
  async findInactiveLeads(): Promise<Lead[]> { return []; }
  async ensureWhatsAppIdentity(input: Lead): Promise<Lead> {
    const existing = await this.findByPhone(input.clinicId, input.phone ?? "");
    if (existing) return existing;
    this.records.set(input.id, input);
    return input;
  }
  async mergeDuplicateLeads(): Promise<Lead> { throw new Error("not used"); }
  async save(input: Lead): Promise<void> {
    const existing = await this.findByPhone(input.clinicId, input.phone ?? "");
    this.records.set(existing?.id ?? input.id, existing ? { ...input, id: existing.id } : input);
  }
}

class MemoryConversationRepository implements ConversationRepository {
  readonly conversations = new Map<string, Conversation>();
  readonly messages = new Map<string, Message[]>();
  readonly messagesByExternalId = new Map<string, Message>();
  readonly messagesById = new Map<string, Message>();

  constructor(private readonly leads: MemoryLeadRepository) {}

  async findByLeadId(leadId: string): Promise<Conversation | null> {
    return [...this.conversations.values()].find((item) => item.leadId === leadId) ?? null;
  }
  async saveConversation(input: Conversation): Promise<void> {
    const existing = await this.findByLeadId(input.leadId);
    this.conversations.set(existing?.id ?? input.id, existing ? { ...input, id: existing.id } : input);
  }
  async setAiPaused(): Promise<void> {}
  async setTakeover(): Promise<void> {}
  async ensureConversation(input: Conversation): Promise<Conversation> {
    const existing = await this.findByLeadId(input.leadId);
    if (existing) return existing;
    this.conversations.set(input.id, input);
    return input;
  }
  async appendMessage(input: Message): Promise<boolean> {
    if (this.messagesById.has(input.id)) return false;
    if (input.externalId && this.messagesByExternalId.has(input.externalId)) return false;
    this.messagesById.set(input.id, input);
    if (input.externalId) this.messagesByExternalId.set(input.externalId, input);
    this.messages.set(input.conversationId, [...(this.messages.get(input.conversationId) ?? []), input]);
    return true;
  }
  async listMessages(conversationId: string): Promise<Message[]> {
    return [...(this.messages.get(conversationId) ?? [])];
  }
  async findMessageByExternalId(externalId: string): Promise<Message | null> {
    return this.messagesByExternalId.get(externalId) ?? null;
  }
  async findMessageById(id: string): Promise<Message | null> {
    return this.messagesById.get(id) ?? null;
  }
  async findRecentLeadMessageByIdentityAndContent(input: {
    clinicId: string;
    phone: string | null;
    body: string;
    sentAtOrAfter: Date;
  }): Promise<Message | null> {
    for (const conversation of this.conversations.values()) {
      if (conversation.clinicId !== input.clinicId) continue;
      const lead = this.leads.records.get(conversation.leadId);
      if (!lead || lead.phone !== input.phone) continue;
      const duplicate = (this.messages.get(conversation.id) ?? []).find((message) =>
        message.author === "lead" && message.body === input.body && message.sentAt >= input.sentAtOrAfter);
      if (duplicate) return duplicate;
    }
    return null;
  }
}

class MemoryState {
  private readonly current = new Map<string, ConversationStateRow>();

  async getCurrentState(conversationId: string): Promise<ConversationStateRow | null> {
    return this.current.get(conversationId) ?? null;
  }
  async getLastResetBoundary(): Promise<null> { return null; }
  offer(conversationId: string): void {
    this.current.set(conversationId, {
      id: "slot-offer-state-1",
      conversationId,
      state: "slots_offered",
      payload: {
        treatmentId: "treatment-1",
        treatmentName: "Clareamento",
        durationMinutes: 60,
        expiresAt: "2026-08-17T16:00:00.000Z",
        slots: [{ index: 1, startsAt: slotStart.toISOString(), endsAt: slotEnd.toISOString(), label: "amanhã às 15h" }],
      },
      supersedesStateId: null,
      createdAt: now,
      expiresAt: new Date("2026-08-17T16:00:00.000Z"),
    });
  }
  async offerSlotsForTurn(
    stateId: string,
    conversationId: string,
    slots: Array<{ startsAt: Date; endsAt: Date }>,
  ) {
    const formatted = slots.map((slot, index) => ({
      index: index + 1,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      label: "amanhã às 15h",
    }));
    this.current.set(conversationId, {
      id: stateId,
      conversationId,
      state: "slots_offered",
      payload: {
        treatmentId: "treatment-1",
        treatmentName: "Clareamento",
        durationMinutes: 60,
        expiresAt: "2026-08-17T16:00:00.000Z",
        slots: formatted,
      },
      supersedesStateId: null,
      createdAt: now,
      expiresAt: new Date("2026-08-17T16:00:00.000Z"),
    });
    return formatted;
  }
  async invalidateIfCurrent(conversationId: string, stateId: string): Promise<boolean> {
    const existing = this.current.get(conversationId);
    if (existing?.id !== stateId) return false;
    this.current.set(conversationId, {
      id: `idle-after-${stateId}`,
      conversationId,
      state: "idle",
      payload: null,
      supersedesStateId: stateId,
      createdAt: now,
      expiresAt: null,
    });
    return true;
  }
  markBooked(conversationId: string, appointmentId: string): void {
    this.current.set(conversationId, {
      id: "appointment-state-1",
      conversationId,
      state: "awaiting_appointment_confirmation",
      payload: { appointmentId, appointmentLabel: "amanhã às 15h" },
      supersedesStateId: "slot-offer-state-1",
      createdAt: new Date("2026-08-17T15:01:00.000Z"),
      expiresAt: null,
    });
  }
}

class MemoryOutbox implements OutboundMessageStore {
  readonly rows: OutboundMessage[] = [];
  private readonly byDedupe = new Map<string, OutboundMessage>();

  async createOutboundMessageAndEnqueue(input: Parameters<NonNullable<OutboundMessageStore["createOutboundMessageAndEnqueue"]>>[0]) {
    const dedupe = `${input.conversationId}:${input.dedupeKey}`;
    const existing = this.byDedupe.get(dedupe);
    if (existing) return { outboundMessageId: existing.id, messageWasNew: false, jobWasNew: false };
    const message: OutboundMessage = {
      id: `outbound-${this.rows.length + 1}`,
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      channel: input.channel,
      payload: input.payload,
      deliveryKind: input.deliveryKind,
      category: input.category ?? "reply",
      sequence: this.rows.filter((row) => row.conversationId === input.conversationId).length,
      status: "pending",
      providerMessageId: null,
      dedupeKey: input.dedupeKey ?? null,
      attempts: 0,
      lastError: null,
      createdAt: now,
      sentAt: null,
    };
    this.rows.push(message);
    this.byDedupe.set(dedupe, message);
    return { outboundMessageId: message.id, messageWasNew: true, jobWasNew: true };
  }
  async createOutboundMessage(input: Parameters<OutboundMessageStore["createOutboundMessage"]>[0]) {
    const result = await this.createOutboundMessageAndEnqueue(input);
    return { message: this.rows.find(({ id }) => id === result.outboundMessageId)!, isNew: result.messageWasNew };
  }
  async findOutboundMessage(id: string) { return this.rows.find((row) => row.id === id) ?? null; }
  async findConversationReplyByTurnId(input: { clinicId: string; turnId: string }) {
    return this.rows.find((row) => {
      const payload = row.payload as Record<string, unknown>;
      return row.clinicId === input.clinicId
        && row.category === "reply"
        && payload.turnId === input.turnId;
    }) ?? null;
  }
  async hasEarlierActiveMessage() { return false; }
  async markOutboundProcessing(id: string) {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row || row.status !== "pending") return false;
    row.status = "processing";
    row.attempts += 1;
    return true;
  }
  async markOutboundPending(id: string, error: string) {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row || row.status !== "processing") return;
    row.status = "pending";
    row.lastError = error;
  }
  async markOutboundDelivered(input: { id: string; providerMessageId: string | null; sentAt?: Date }) {
    const row = this.rows.find((candidate) => candidate.id === input.id);
    if (!row) return;
    row.status = "sent";
    row.providerMessageId = input.providerMessageId;
    row.sentAt = input.sentAt ?? now;
    row.lastError = null;
  }
  async markOutboundFailed(id: string, error: string) {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row) { row.status = "failed"; row.lastError = error; }
  }
  async markOutboundDead(id: string, error: string) {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row) { row.status = "dead"; row.lastError = error; }
  }
  async markOutboundCancelled(id: string, error: string) {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row) { row.status = "cancelled"; row.lastError = error; }
  }
  async countSentSince() { return 0; }
}

class MemoryInboundEvents implements InboundEventStore {
  readonly rows = new Map<string, InboundEvent>();

  add(input: ConversationHandleInput, eventId = input.turnId ?? input.messageId): void {
    this.rows.set(eventId, {
      id: eventId,
      clinicId: input.clinicId,
      provider: "z_api",
      providerMessageId: input.messageId,
      conversationKey: input.phone,
      payload: {
        phone: input.phone,
        instanceId: "systemops-lab-instance",
        messageId: input.messageId,
        text: { message: input.messageText },
        chatName: "Lead Lab",
        senderName: "Lead Lab",
        isGroupMsg: false,
        isStatusReply: false,
        fromMe: false,
      },
      normalizedText: input.messageText,
      mediaType: null,
      dedupeKey: `z-api:systemops-lab-instance:${input.messageId}`,
      processingStatus: "pending",
      receivedAt: input.timestamp,
      processedAt: null,
    });
  }
  async recordInboundEvent(): Promise<never> { throw new Error("not used"); }
  async findInboundEvent(id: string) { return this.rows.get(id) ?? null; }
  async markInboundEventProcessing(id: string) { const row = this.rows.get(id); if (row) row.processingStatus = "processing"; }
  async markInboundEventPending(id: string) { const row = this.rows.get(id); if (row) row.processingStatus = "pending"; }
  async markInboundEventProcessed(id: string, processedAt = now) {
    const row = this.rows.get(id); if (row) { row.processingStatus = "processed"; row.processedAt = processedAt; }
  }
  async markInboundEventFailed(id: string) { const row = this.rows.get(id); if (row) row.processingStatus = "failed"; }
  async markInboundEventIgnored(id: string, processedAt = now) {
    const row = this.rows.get(id); if (row) { row.processingStatus = "ignored"; row.processedAt = processedAt; }
  }
}

class MemoryAppointments {
  readonly rows: Appointment[] = [];

  async save(input: Appointment): Promise<void> { this.rows.push(input); }
  async findByPeriod(clinicId: string, startsAt: Date, endsAt: Date): Promise<Appointment[]> {
    return this.rows.filter((row) => row.clinicId === clinicId
      && row.startsAt < endsAt && row.endsAt > startsAt);
  }
  async findByIdForClinicAndLead(clinicId: string, leadId: string, id: string) {
    return this.rows.find((row) => row.id === id && row.clinicId === clinicId && row.leadId === leadId) ?? null;
  }
  async confirmScheduledForClinicAndLead(clinicId: string, leadId: string, id: string, updatedAt: Date) {
    const row = await this.findByIdForClinicAndLead(clinicId, leadId, id);
    if (!row || row.status !== "scheduled") return null;
    row.status = "confirmed";
    row.updatedAt = updatedAt;
    return row;
  }
}

class MemoryReservations {
  private readonly occupied = new Set<string>();

  async releaseExpired(): Promise<void> {}
  async reserve(clinicId: string, leadId: string, startsAt: Date, endsAt: Date): Promise<SlotReservation | null> {
    const key = `${clinicId}:${startsAt.toISOString()}:${endsAt.toISOString()}`;
    if (this.occupied.has(key)) return null;
    this.occupied.add(key);
    return { id: "reservation-1", clinicId, leadId, startsAt, endsAt, status: "pending", calendarEventId: null, expiresAt: new Date("2026-08-17T15:15:00.000Z") };
  }
  async confirm(): Promise<void> {}
  async release(): Promise<void> {}
  async releaseBySlot(): Promise<void> {}
}

class MutablePolicyReader {
  policy: ConversationEnginePolicy = { clinicId: clinic.id, engine: "v2_internal", isTest: true };
  async getConversationEnginePolicy(): Promise<ConversationEnginePolicy> { return this.policy; }
}

class JourneyHandler implements ConversationHandler {
  constructor(
    private readonly engine: "v1" | "v2",
    private readonly lifecycle: LiveTurnLifecycle,
    private readonly state: MemoryState,
    private readonly booking: BookingService,
    private readonly outbox: MemoryOutbox,
    private readonly conversations: MemoryConversationRepository,
  ) {}

  async handle(input: ConversationHandleInput): Promise<ConversationHandleResult> {
    const begun = await this.lifecycle.begin(input);
    if (begun.outcome !== "ready") return { replied: false, reason: begun.outcome };
    const { context } = begun;
    try {
      const snapshot = await this.lifecycle.loadSnapshot(context);
      if (input.messageText.includes("clareamento")) {
        this.state.offer(context.conversationId);
      } else if (input.messageText.includes("15")) {
        const result = await this.booking.book({
          clinic: context.clinic,
          lead: context.lead,
          startsAt: slotStart,
          endsAt: slotEnd,
          treatmentName: "Clareamento",
          origin: "ai_conversation",
        });
        if (result.success) this.state.markBooked(context.conversationId, result.appointment.id);
      } else if (input.messageText.includes("confirm")) {
        const appointmentId = (snapshot.currentState?.payload as { appointmentId?: string } | null)?.appointmentId;
        if (appointmentId) await this.booking.confirmAppointment({ clinic: context.clinic, lead: context.lead, appointmentId });
      }
      const agentMessageId = `agent-${context.turnId}`;
      const replyText = this.engine === "v1" ? "Posso confirmar o horário?" : "Resposta V2";
      await this.conversations.appendMessage({
        id: agentMessageId,
        conversationId: context.conversationId,
        author: "agent",
        body: replyText,
        mediaUrl: null,
        mediaType: null,
        sentAt: now,
        externalId: null,
        intent: "confirm_slot",
        deliveryFormat: null,
      });
      await enqueueOutboundMessage({
        clinicId: context.clinicId,
        conversationId: context.conversationId,
        channel: "whatsapp",
        deliveryKind: "text",
        category: "reply",
        dedupeKey: `conversation-reply:${context.turnId}`,
        payload: {
          version: 1,
          kind: "conversation_reply",
          turnId: context.turnId,
          to: context.outboundAddress,
          agentMessageId,
          replyText,
          intent: "confirm_slot",
          useVoice: false,
          ttsConfig: { provider: "nova", speed: 0.92 },
          interleavedParts: [],
          mediaParts: [],
          leadId: context.leadId,
          pipelineAdvance: null,
        },
      }, { outboundMessageStore: this.outbox, jobQueue: {} as never });
      await this.lifecycle.complete({ context, replied: true });
      return { replied: true, reason: this.engine };
    } catch (error) {
      await this.lifecycle.fail({ context, error });
      throw error;
    }
  }
}

const treatment = {
  id: "treatment-1",
  clinicId: clinic.id,
  name: "Clareamento",
  aliases: ["clareamento dental"],
  durationMinutes: 60,
  priceCents: 80_000,
  minPriceCents: null,
  maxPriceCents: null,
  priceQuotableInChat: true,
  priceKind: "fixed",
  priceUnit: null,
  priceDeductible: false,
  description: null,
  requiresEvaluationFirst: false,
  keywordMatchEnabled: true,
  isAesthetic: true,
  pipelineSteps: null,
  createdAt: now,
  updatedAt: now,
} as Treatment;

function createHarness(options: { approvalPresent?: boolean } = {}) {
  const approval = createRegisteredInternalLabDeploymentSmokeApproval();
  const leads = new MemoryLeadRepository();
  const conversations = new MemoryConversationRepository(leads);
  const state = new MemoryState();
  const held = new Set<string>();
  let id = 0;
  const lifecycle = new LiveTurnLifecycle({
    registerIncomingMessage: new RegisterIncomingMessage({
      leadRepository: leads,
      conversationRepository: conversations,
      usageCostTracker: { async trackAiUsage() {}, async trackTtsUsage() {}, async trackWhatsAppCost() {} },
      followUpRepository: {
        async save() {}, async listDue() { return []; }, async listPendingByLead() { return []; },
        async findPendingByReason() { return null; }, async cancelPendingByReason() { return 0; },
        async cancelPendingByLead() { return 0; }, async claimForSending() { return false; },
        async recoverStaleSending() { return 0; },
      },
      idGenerator: () => `generated-${++id}`,
      now: () => now,
    }),
    conversationRepository: conversations,
    contextReader: {
      async findOrganization(clinicId) { return clinicId === clinic.id ? clinic : null; },
      async resolveEditorialConfig() { return null; },
    },
    turnCoordinator: new ConversationTurnCoordinator({
      async tryAcquire({ conversationId }) {
        if (held.has(conversationId)) return false;
        held.add(conversationId);
        return true;
      },
      async release(conversationId) { held.delete(conversationId); },
    }, { maxWaitMs: 0 }),
    stateReader: state,
    now: () => now,
  });
  const appointments = new MemoryAppointments();
  const booking = new BookingService({
    async listAvailableSlots(): Promise<CalendarSlot[]> { return []; },
    async createAppointment({ clinicId, leadId, startsAt, endsAt }) {
      return {
        id: `appointment-${appointments.rows.length + 1}`, clinicId, leadId,
        professionalId: null, roomId: null, description: null, calendarEventId: null,
        calendarEventUrl: null, startsAt, endsAt, status: "scheduled", source: "app",
        origin: null, reminderSentAt: null, treatmentId: null, valueCents: null,
        createdAt: now, updatedAt: now,
      };
    },
    async cancelAppointment() {}, async listBlockEvents() { return []; },
    async createBlockEvent() { throw new Error("not used"); }, async deleteBlockEvent() {},
    async updateBlockEvent() { throw new Error("not used"); }, async isSlotFree() { return true; },
    async updateCalendarEvent() {},
  }, appointments as never, leads, new MemoryReservations());
  const outbox = new MemoryOutbox();
  const policy = new MutablePolicyReader();
  const trace = new InMemoryDecisionTraceSink();
  const understanding = createLiveDentalUnderstanding({
    chat: { completions: { create: async (request) => {
      const body = JSON.stringify(request);
      const result = body.includes("Pode confirmar")
        ? {
            version: UNDERSTANDING_VERSION,
            request: "confirm-appointment" as const,
            dialogueMove: "answers_pending" as const,
            entities: {}, signals: {}, safety: {}, confidence: 1, ambiguity: null,
          }
        : {
            version: UNDERSTANDING_VERSION,
            request: "book-appointment" as const,
            dialogueMove: "new_topic" as const,
            entities: { service: "clareamento", date: "amanhã", period: "afternoon" },
            signals: {}, safety: {}, confidence: 1, ambiguity: null,
          };
      return { choices: [{ message: { content: JSON.stringify(result) } }] };
    } } },
  });
  const v2Handler = new V2LiveConversationHandler({
    lifecycle,
    understanding,
    dental: {
      treatments: { async listByClinic(clinicId) { return clinicId === clinic.id ? [treatment] : []; } },
      calendar: { async listAvailableSlots() { return [{
        id: "slot-1", clinicId: clinic.id, professionalId: null,
        startsAt: slotStart, endsAt: slotEnd, source: "manual" as const,
      }]; } },
      state,
      appointments: appointments as never,
      reservations: { async findActiveByPeriod() { return []; } },
      booking,
    },
    resolveTurnConfiguration: () => ({
      gateInput: { automationEnabled: true, duplicate: false, humanControlled: false, optedOut: false },
      policy: {
        priceDisclosureEnabled: true,
        humanEscalationRequired: false,
        schedulingMinimumLeadTimeHours: 2,
        schedulingRequiresEvaluationFirst: false,
      },
      style: { tone: "warm", verbosity: "concise", greeting: "omit", emoji: "none" },
      speaker: {
        agentName: null,
        organizationName: clinic.name,
        specialty: null,
        toneOfVoice: null,
        guidelines: [],
      },
      useVoice: false,
      ttsConfig: { provider: "nova", speed: 0.92 },
      deliveryBinding: {
        schemaVersion: "conversation-v2.internal-lab-delivery-binding.v1",
        tenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
        channelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
        configDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
      },
    }),
    outbound: { outboundMessageStore: outbox, jobQueue: {} as never },
    decisionTraceSink: trace,
    async persistStopContact() {},
    now: () => now,
  });
  const readerCalls = { automation: 0, eligibility: 0 };
  const runtimeBindings = {
    tenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
    channelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
    configDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
  };
  const eligibilityReader: InternalLabEligibilityReader & ClinicAutomationPolicyReader = {
    async getAutomationMode() {
      readerCalls.automation += 1;
      return "disabled";
    },
    async getInternalLabEligibilityFacts() {
      readerCalls.eligibility += 1;
      return {
      clinicId: clinic.id, isTest: true, isDemo: false, operationalStatus: "test" as const,
      autoReplyEnabled: true, shadowModeEnabled: false,
      };
    },
  };
  const runtime = createConversationV2Runtime({
    env: { ...process.env, OPENAI_API_KEY: "task-7-test-key" },
    v1Handler: new JourneyHandler("v1", lifecycle, state, booking, outbox, conversations),
    v2Handler,
    policyReader: policy,
    eligibilityReader,
    runtimeBindingsReader: {
      async resolve() { return Object.freeze({ ...runtimeBindings }); },
      async resolveDeliverySnapshot() { return Object.freeze({
        bindings: Object.freeze({ ...runtimeBindings }),
        channelConfig: Object.freeze({
          provider: "z_api" as const,
          zapi: Object.freeze({ instanceId: "lab-instance", token: "test-token" }),
          meta: null,
        }),
      }); },
    },
    decisionTraceSink: trace,
    authorizationBindings: {
      approval: options.approvalPresent === false ? null : approval.approval,
      runtimeIdentity: approval.runtimeIdentity,
      expectedClinicId: clinic.id,
      expectedTenantDigest: INTERNAL_LAB_TEST_BINDINGS.tenantDigest,
      expectedChannelDigest: INTERNAL_LAB_TEST_BINDINGS.channelDigest,
      expectedConfigDigest: INTERNAL_LAB_TEST_BINDINGS.configDigest,
      now: () => new Date(INTERNAL_LAB_TEST_BINDINGS.now),
    },
  });
  expect(runtime.conversationHandler).toBeInstanceOf(TenantEngineRouter);
  const inboundEvents = new MemoryInboundEvents();
  const processHandler = new ProcessMessageJobHandler({
    inboundEventStore: inboundEvents,
    automationPolicy: runtime.automationPolicy,
    conversationHandler: runtime.conversationHandler,
    transcribeAudio: async () => { throw new Error("not used"); },
    decisionTraceSink: trace,
  });
  const processTurn = async (input: ConversationHandleInput, eventId = input.turnId ?? input.messageId) => {
    if (!inboundEvents.rows.has(eventId)) inboundEvents.add(input, eventId);
    const job: JobRecord = {
      id: `job-${eventId}`,
      queue: "message.process",
      status: "processing",
      payload: { inboundEventId: eventId },
      dedupeKey: `inbound-event:${eventId}`,
      attempts: 1,
      maxAttempts: 10,
      runAt: input.timestamp,
      lockedAt: input.timestamp,
      lockedBy: "task-7-worker",
      lastError: null,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    };
    return processHandler.processJob(job);
  };
  return {
    appointments, conversations, inboundEvents, outbox, policy, processTurn,
    readerCalls, runtimeBindings, router: runtime.conversationHandler, runtime, state, trace,
  };
}

function turn(messageId: string, messageText: string, minute: number): ConversationHandleInput {
  return {
    clinicId: clinic.id,
    phone: "5511999999999",
    messageText,
    messageId,
    turnId: `turn-${messageId}`,
    timestamp: new Date(now.getTime() + minute * 60_000),
    automationMode: "live",
  };
}

describe("Conversation V2 bidirectional rollback", () => {
  it.each(["tenantDigest", "channelDigest", "configDigest"] as const)(
    "keeps the process worker disabled when the approved %s drifts",
    async (field) => {
    const harness = createHarness();
      harness.runtimeBindings[field] = `hmac:${"b".repeat(64)}`;

      await expect(harness.runtime.automationPolicy.getAutomationMode(clinic.id))
        .resolves.toBe("disabled");
    },
  );

  it("keeps the process worker disabled when Internal Lab approval is absent", async () => {
    const harness = createHarness({ approvalPresent: false });

    await expect(harness.runtime.automationPolicy.getAutomationMode(clinic.id))
      .resolves.toBe("disabled");
  });

  it("preserves one conversation, state, ordered outbox, dedupe, and one booking across V2 -> V1 -> V2", async () => {
    const harness = createHarness();
    const first = turn("1", "Quanto custa o clareamento e tem horário amanhã?", 0);
    const second = turn("2", "Pode marcar às 15?", 1);
    const third = turn("3", "Pode confirmar", 2);

    await expect(harness.processTurn(first)).resolves.toEqual({
      outcome: "processed", inboundEventId: "turn-1",
    });
    const conversationId = [...harness.conversations.conversations.keys()][0]!;
    expect((await harness.state.getCurrentState(conversationId))?.state).toBe("slots_offered");
    harness.policy.policy = { clinicId: clinic.id, engine: "v1", isTest: true };
    await expect(harness.processTurn(second)).resolves.toEqual({
      outcome: "processed", inboundEventId: "turn-2",
    });
    expect((await harness.state.getCurrentState(conversationId))?.state)
      .toBe("awaiting_appointment_confirmation");
    harness.policy.policy = { clinicId: clinic.id, engine: "v2_internal", isTest: true };
    await expect(harness.processTurn(third)).resolves.toEqual({
      outcome: "processed", inboundEventId: "turn-3",
    });

    const conversationIds = [...harness.conversations.conversations.keys()];
    expect(conversationIds).toHaveLength(1);
    expect(harness.appointments.rows).toHaveLength(1);
    expect(harness.appointments.rows[0]?.status).toBe("confirmed");
    expect(harness.outbox.rows.map(({ conversationId }) => conversationId)).toEqual([
      conversationIds[0], conversationIds[0], conversationIds[0],
    ]);
    expect(harness.outbox.rows.map(({ sequence }) => sequence)).toEqual([0, 1, 2]);
    expect((await harness.state.getCurrentState(conversationIds[0]!))?.state).toBe("idle");
    expect(harness.trace.getEvents().filter(({ stage }) => stage === "engine.selected")
      .map(({ metadata }) => metadata?.route)).toEqual(["v2", "v1", "v2"]);
    expect(harness.readerCalls).toEqual({ automation: 3, eligibility: 5 });

    await expect(harness.processTurn(second)).resolves.toEqual({
      outcome: "ignored", inboundEventId: "turn-2",
    });
    await expect(harness.processTurn(second, "turn-2-replay")).resolves.toEqual({
      outcome: "processed", inboundEventId: "turn-2-replay",
    });
    expect(harness.appointments.rows).toHaveLength(1);
    expect(harness.outbox.rows.map(({ sequence }) => sequence)).toEqual([0, 1, 2]);

    await expect(enqueueOutboundMessage({
      clinicId: clinic.id,
      conversationId,
      channel: "whatsapp",
      deliveryKind: "text",
      category: "reply",
      dedupeKey: "conversation-reply:turn-3",
      payload: { turnId: "turn-3", engine: "v2", recomposed: true },
    }, { outboundMessageStore: harness.outbox, jobQueue: {} as never })).resolves.toEqual({
      outboundMessageId: "outbound-3",
      messageWasNew: false,
      jobWasNew: false,
    });
    expect(harness.outbox.rows.map(({ sequence }) => sequence)).toEqual([0, 1, 2]);
    expect(harness.outbox.rows[2]?.payload).toMatchObject({ turnId: "turn-3" });
    expect(harness.outbox.rows[2]?.payload).not.toMatchObject({ recomposed: true });

    let deliveryAttempts = 0;
    const sender = new SendMessageJobHandler({
      outboundMessageStore: harness.outbox,
      conversationRepository: harness.conversations,
      conversationStateReader: harness.state,
      internalLabDeliveryGuard: harness.runtime.internalLabDeliveryGuard,
      decisionTraceSink: harness.trace,
      now: () => now,
      delivery: async () => {
        deliveryAttempts += 1;
        if (deliveryAttempts === 1) throw new Error("provider timeout");
        return "provider-message-v1-turn-2";
      },
    });
    await expect(sender.processJob({
      id: "send-job-turn-2-attempt-1",
      payload: { outboundMessageId: "outbound-2", turnId: "turn-2" },
    })).rejects.toThrow("provider timeout");
    await harness.outbox.markOutboundPending("outbound-2", "provider timeout");
    await expect(sender.processJob({
      id: "send-job-turn-2-attempt-2",
      payload: { outboundMessageId: "outbound-2", turnId: "turn-2" },
    })).resolves.toBe("sent");
    await expect(sender.processJob({
      id: "send-job-turn-2-terminal-replay",
      payload: { outboundMessageId: "outbound-2", turnId: "turn-2" },
    })).resolves.toBe("ignored");
    expect(deliveryAttempts).toBe(2);
    expect(harness.outbox.rows[1]).toMatchObject({
      id: "outbound-2",
      status: "sent",
      attempts: 2,
      providerMessageId: "provider-message-v1-turn-2",
    });
    expect((await harness.conversations.listMessages(conversationId))
      .filter(({ id }) => id === "agent-turn-2")).toHaveLength(1);
  });
});
