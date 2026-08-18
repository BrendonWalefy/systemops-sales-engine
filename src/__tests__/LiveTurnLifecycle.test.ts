import { describe, expect, it } from "vitest";
import { LiveTurnLifecycle } from "@/application/conversation/live-turn-lifecycle";
import { RegisterIncomingMessage } from "@/application/use-cases/leads/register-incoming-message";
import { ConversationTurnCoordinator } from "@/core/pipeline/ConversationTurnCoordinator";
import type { LiveConversationContextReader } from "@/application/ports/live-conversation-context-reader";
import type { ConversationTurnLeaseStore } from "@/application/ports/conversation-turn-lease-store";
import type { UsageCostTracker } from "@/application/ports/usage-cost-tracker";
import type { Conversation, Message } from "@/domain/entities/conversation";
import type { Organization } from "@/domain/entities/clinic";
import type { Lead } from "@/domain/entities/lead";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";
import { DrizzleLiveConversationContextReader } from "@/infrastructure/repositories/drizzle-live-conversation-context-reader";

const NOW = new Date("2026-08-17T15:00:00.000Z");

const organization: Organization = {
  id: "systemops-lab",
  name: "SystemOps Dental Lab",
  specialty: "Odontologia",
  plan: "enterprise",
  segment: "dental",
  city: "São Paulo",
  address: null,
  addressComplement: null,
  mapsUrl: null,
  locationMessage: null,
  timezone: "America/Sao_Paulo",
  greetingMessage: null,
  menuItems: null,
  businessHours: null,
  googleCalendarId: null,
  calendarMode: "internal",
  receptionistPhone: null,
  takeoverTtlHours: 2,
  postAppointmentBufferMinutes: 0,
  defaultAppointmentDurationMinutes: 60,
  installmentRates: null,
  rateLimitPerHour: 20,
  unclearThreshold: 3,
  staleConversationHours: 24,
  conversationRestartHours: 24,
  slotOfferTtlMinutes: 15,
  maxSlotsToOffer: 3,
  slotLookaheadDays: 30,
  offerSlotsAfterPriceEnabled: true,
  outsideHoursExceptionEnabled: false,
  depositEnabled: false,
  depositAmountCents: null,
  depositPixKey: null,
  depositPixKeyType: null,
  depositRecipientName: null,
  depositTtlHours: 24,
  depositNotes: null,
  depositConfirmationNotes: null,
  mediaTakeoverTtlHours: null,
  rapidThrottleMs: 4_000,
  messageDebounceMs: 0,
  aiContextWindowMessages: 20,
  pipelineQaDefaultMaxTurns: 3,
  serviceNoun: "tratamento",
  bookingNoun: "agendamento",
  contactNoun: "paciente",
  agentRole: "especialista",
  businessDescriptor: null,
  businessNoun: "clínica",
  createdAt: NOW,
  updatedAt: NOW,
};

class MemoryLeadRepository implements LeadRepository {
  readonly leads = new Map<string, Lead>();
  saveCalls = 0;

  async findById(id: string): Promise<Lead | null> {
    return this.leads.get(id) ?? null;
  }

  async findByPhone(clinicId: string, phone: string): Promise<Lead | null> {
    return [...this.leads.values()].find(
      (lead) => lead.clinicId === clinicId && lead.phone === phone,
    ) ?? null;
  }

  async findByWhatsAppLid(clinicId: string, whatsappLid: string): Promise<Lead | null> {
    return [...this.leads.values()].find(
      (lead) => lead.clinicId === clinicId && lead.whatsappLid === whatsappLid,
    ) ?? null;
  }

  async findInactiveLeads(): Promise<Lead[]> {
    return [];
  }

  async ensureWhatsAppIdentity(lead: Lead): Promise<Lead> {
    const existing = [...this.leads.values()].find(
      (item) => item.clinicId === lead.clinicId
        && ((lead.phone && item.phone === lead.phone)
          || (lead.whatsappLid && item.whatsappLid === lead.whatsappLid)),
    );
    if (existing) return existing;
    this.leads.set(lead.id, lead);
    return lead;
  }

  async mergeDuplicateLeads(): Promise<Lead> {
    throw new Error("not used");
  }

  async save(lead: Lead): Promise<void> {
    this.saveCalls += 1;
    const existing = await this.findByPhone(lead.clinicId, lead.phone ?? "");
    this.leads.set(existing?.id ?? lead.id, existing ? { ...lead, id: existing.id } : lead);
  }
}

class MemoryConversationRepository implements ConversationRepository {
  readonly conversations = new Map<string, Conversation>();
  readonly messages = new Map<string, Message[]>();
  readonly messagesByExternalId = new Map<string, Message>();
  saveCalls = 0;
  appendCalls = 0;

  async findByLeadId(leadId: string): Promise<Conversation | null> {
    return [...this.conversations.values()].find((item) => item.leadId === leadId) ?? null;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    this.saveCalls += 1;
    const existing = await this.findByLeadId(conversation.leadId);
    this.conversations.set(
      existing?.id ?? conversation.id,
      existing ? { ...conversation, id: existing.id } : conversation,
    );
  }

  async setAiPaused(): Promise<void> {}
  async setTakeover(): Promise<void> {}

  async ensureConversation(conversation: Conversation): Promise<Conversation> {
    const existing = [...this.conversations.values()].find(
      (item) => item.leadId === conversation.leadId,
    );
    if (existing) return existing;
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  async appendMessage(message: Message): Promise<boolean> {
    this.appendCalls += 1;
    if (message.externalId && this.messagesByExternalId.has(message.externalId)) return false;
    if (message.externalId) this.messagesByExternalId.set(message.externalId, message);
    const history = this.messages.get(message.conversationId) ?? [];
    this.messages.set(message.conversationId, [...history, message]);
    return true;
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    return [...(this.messages.get(conversationId) ?? [])];
  }

  async findMessageByExternalId(externalId: string): Promise<Message | null> {
    return this.messagesByExternalId.get(externalId) ?? null;
  }

  async findMessageById(id: string): Promise<Message | null> {
    return [...this.messages.values()].flat().find((message) => message.id === id) ?? null;
  }

  async findRecentLeadMessageByIdentityAndContent(input: {
    clinicId: string;
    phone: string | null;
    whatsappLid: string | null;
    fallbackPhone: string;
    body: string;
    sentAtOrAfter: Date;
  }): Promise<Message | null> {
    const leadsById = new Map([...this.leads.leads.values()].map((lead) => [lead.id, lead]));
    for (const conversation of this.conversations.values()) {
      if (conversation.clinicId !== input.clinicId) continue;
      const lead = leadsById.get(conversation.leadId);
      if (!lead) continue;
      const identityMatches = Boolean(
        (input.phone && lead.phone === input.phone)
        || (input.whatsappLid && (lead.whatsappLid === input.whatsappLid || lead.phone === input.whatsappLid))
        || (!input.phone && !input.whatsappLid && lead.phone === input.fallbackPhone),
      );
      if (!identityMatches) continue;
      const match = (this.messages.get(conversation.id) ?? []).find(
        (message) => message.author === "lead"
          && message.body === input.body
          && message.sentAt >= input.sentAtOrAfter,
      );
      if (match) return match;
    }
    return null;
  }

  constructor(private readonly leads: MemoryLeadRepository) {}
}

class MemoryLeaseStore implements ConversationTurnLeaseStore {
  readonly held = new Set<string>();
  releaseCalls = 0;

  async tryAcquire(input: { conversationId: string }): Promise<boolean> {
    if (this.held.has(input.conversationId)) return false;
    this.held.add(input.conversationId);
    return true;
  }

  async release(conversationId: string): Promise<void> {
    this.releaseCalls += 1;
    this.held.delete(conversationId);
  }
}

function makeHarness() {
  const leads = new MemoryLeadRepository();
  const conversations = new MemoryConversationRepository(leads);
  const leaseStore = new MemoryLeaseStore();
  let whatsappCostCalls = 0;
  let followUpListCalls = 0;
  let followUpCancelCalls = 0;
  const usageCostTracker: UsageCostTracker = {
    async trackAiUsage() {},
    async trackTtsUsage() {},
    async trackWhatsAppCost() {
      whatsappCostCalls += 1;
    },
  };
  const followUpRepository: FollowUpRepository = {
    async save() {},
    async listDue() { return []; },
    async listPendingByLead() {
      followUpListCalls += 1;
      return [{
        id: "follow-up-1",
        clinicId: organization.id,
        leadId: "lead-1",
        dueAt: NOW,
        status: "pending",
        reason: "video_sent:Clareamento",
        suggestedMessage: null,
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }];
    },
    async findPendingByReason() { return null; },
    async cancelPendingByReason() {
      followUpCancelCalls += 1;
      return 1;
    },
    async cancelPendingByLead() { return 0; },
    async claimForSending() { return true; },
    async recoverStaleSending() { return 0; },
  };
  let sequence = 0;
  const contextReader: LiveConversationContextReader = {
    async findOrganization(clinicId) {
      return clinicId === organization.id ? organization : null;
    },
    async resolveEditorialConfig() {
      return null;
    },
  };
  const makeLifecycle = () => new LiveTurnLifecycle({
    registerIncomingMessage: new RegisterIncomingMessage({
      leadRepository: leads,
      conversationRepository: conversations,
      usageCostTracker,
      followUpRepository,
      idGenerator: () => `generated-${++sequence}`,
      now: () => NOW,
    }),
    conversationRepository: conversations,
    contextReader,
    turnCoordinator: new ConversationTurnCoordinator(leaseStore, { maxWaitMs: 0 }),
    stateReader: {
      async getCurrentState(conversationId, createdAtOrBefore) {
        return {
          id: "state-1",
          conversationId,
          state: "menu_offered",
          payload: { asOf: createdAtOrBefore?.toISOString() ?? null },
          supersedesStateId: null,
          createdAt: NOW,
          expiresAt: null,
        };
      },
      async getLastResetBoundary() {
        return new Date("2026-08-17T14:00:00.000Z");
      },
    },
    now: () => NOW,
  });
  const lifecycle = makeLifecycle();
  return {
    lifecycle,
    makeLifecycle,
    leads,
    conversations,
    leaseStore,
    effects: () => ({
      leadSaves: leads.saveCalls,
      conversationSaves: conversations.saveCalls,
      messageAppends: conversations.appendCalls,
      followUpLists: followUpListCalls,
      followUpCancels: followUpCancelCalls,
      whatsappCosts: whatsappCostCalls,
    }),
  };
}

function turn(messageId: string, messageText = `mensagem ${messageId}`) {
  return {
    clinicId: organization.id,
    phone: "5511999999999",
    whatsappLid: null,
    messageText,
    messageId,
    turnId: `turn-${messageId}`,
    senderName: "Ana",
    senderPhoto: null,
    timestamp: NOW,
    replyEnabled: true,
    observationOnly: false,
    automationMode: "live" as const,
  };
}

function ready(result: Awaited<ReturnType<LiveTurnLifecycle["begin"]>>) {
  if (result.outcome !== "ready") throw new Error(`expected ready, got ${result.outcome}`);
  return result.context;
}

describe("LiveTurnLifecycle", () => {
  it("does not expose a source organization row for copied or external domain objects", () => {
    const reader = new DrizzleLiveConversationContextReader();

    expect(() => reader.getOrganizationRow({ ...organization })).toThrow(
      "organization was not produced by this context reader",
    );
  });

  it("returns the same persisted conversation and an explicitly timed history/state snapshot", async () => {
    const { lifecycle, conversations } = makeHarness();
    const first = await lifecycle.begin(turn("message-1"));
    await lifecycle.complete({ context: ready(first), replied: true });

    const second = await lifecycle.begin(turn("message-2"));
    const context = ready(second);
    await conversations.appendMessage({
      id: "arrived-during-debounce",
      conversationId: context.conversationId,
      author: "lead",
      body: "complemento durante debounce",
      sentAt: new Date("2026-08-17T15:00:01.000Z"),
      externalId: "message-3",
    });
    const stateAsOf = new Date("2026-08-17T14:59:59.000Z");
    const snapshot = await lifecycle.loadSnapshot(context, { stateAsOf });

    expect(context.conversationId).toBe(ready(first).conversationId);
    expect(snapshot.history.map((message) => message.externalId)).toEqual([
      "message-1",
      "message-2",
      "message-3",
    ]);
    expect(snapshot.currentState?.payload).toEqual({ asOf: stateAsOf.toISOString() });
    expect(snapshot.lastResetBoundary?.toISOString()).toBe("2026-08-17T14:00:00.000Z");
    await context.releaseLease();
  });

  it("suppresses cross-process duplicate external ids before either engine can run", async () => {
    const single = makeHarness();
    const singleResult = await single.lifecycle.begin(turn("single-id"));
    const winnerEffects = single.effects();
    await ready(singleResult).releaseLease();
    const { lifecycle, makeLifecycle, conversations, leaseStore, effects } = makeHarness();
    const secondProcessLifecycle = makeLifecycle();
    const originalFindByExternalId = conversations.findMessageByExternalId.bind(conversations);
    let initialReads = 0;
    let releaseInitialReads!: () => void;
    const initialReadBarrier = new Promise<void>((resolve) => {
      releaseInitialReads = resolve;
    });
    conversations.findMessageByExternalId = async (externalId) => {
      if (externalId === "same-id" && initialReads < 2) {
        initialReads += 1;
        if (initialReads === 2) releaseInitialReads();
        await initialReadBarrier;
        return null;
      }
      return originalFindByExternalId(externalId);
    };

    const results = await Promise.all([
      lifecycle.begin(turn("same-id")),
      secondProcessLifecycle.begin(turn("same-id")),
    ]);

    expect(results.filter(({ outcome }) => outcome === "ready")).toHaveLength(1);
    expect(results.filter(({ outcome }) => outcome === "duplicate")).toEqual([
      { outcome: "duplicate", reason: "external_id" },
    ]);
    expect(leaseStore.held.size).toBe(1);
    expect(conversations.appendCalls).toBe(2);
    expect(effects()).toEqual({ ...winnerEffects, messageAppends: 2 });
    await ready(results.find(({ outcome }) => outcome === "ready")!).releaseLease();
  });

  it("suppresses recent duplicate content before registering another inbound", async () => {
    const { lifecycle, conversations } = makeHarness();
    const first = await lifecycle.begin(turn("provider-1", "Quero clareamento"));
    await lifecycle.complete({ context: ready(first), replied: false });

    const result = await lifecycle.begin(turn("provider-2", "Quero clareamento"));

    expect(result).toEqual({ outcome: "duplicate", reason: "recent_content" });
    expect([...conversations.messages.values()].flat()).toHaveLength(1);
  });

  it("does not classify a failed insert without a canonical external row as a duplicate", async () => {
    const { lifecycle, conversations, leaseStore, effects } = makeHarness();
    conversations.appendMessage = async () => false;
    let afterRegisterCalls = 0;

    const result = await lifecycle.begin(turn("provider-fk-disappeared"), {
      afterRegister: () => {
        afterRegisterCalls += 1;
      },
    });

    expect(result).toEqual({ outcome: "busy", reason: "conversation_lease" });
    expect(await conversations.findMessageByExternalId("provider-fk-disappeared")).toBeNull();
    expect(afterRegisterCalls).toBe(0);
    expect(leaseStore.held.size).toBe(0);
    expect(effects()).toEqual({
      leadSaves: 0,
      conversationSaves: 0,
      messageAppends: 0,
      followUpLists: 0,
      followUpCancels: 0,
      whatsappCosts: 0,
    });
  });

  it("returns busy when the persisted conversation lease is already held", async () => {
    const { lifecycle } = makeHarness();
    const first = await lifecycle.begin(turn("provider-1"));

    const second = await lifecycle.begin(turn("provider-2"));

    expect(second).toEqual({ outcome: "busy", reason: "conversation_lease" });
    await ready(first).releaseLease();
  });

  it("runs persisted media/profile effects before a busy lease result", async () => {
    const { lifecycle, conversations } = makeHarness();
    const held = await lifecycle.begin(turn("provider-1"));
    const effects: string[] = [];

    const busy = await lifecycle.begin({
      ...turn("provider-audio"),
      mediaUrl: "https://cdn.example/audio.ogg",
      mediaType: "audio",
    }, {
      afterRegister: ({ lead, inboundMessage }) => {
        if (!lead.profilePicUrl) effects.push("profile_lookup");
        if (inboundMessage.mediaType === "audio") effects.push("audio_rehost");
      },
    });

    expect(busy).toEqual({ outcome: "busy", reason: "conversation_lease" });
    expect(effects).toEqual(["profile_lookup", "audio_rehost"]);
    expect(await conversations.findMessageByExternalId("provider-audio")).not.toBeNull();
    await ready(held).releaseLease();
  });

  it("runs V1 tenant configuration before inbound persistence and lease acquisition", async () => {
    const { lifecycle, leads, conversations, leaseStore } = makeHarness();

    await expect(lifecycle.begin(turn("provider-1"), {
      beforeRegister: async () => {
        throw new Error("module config unavailable");
      },
    })).rejects.toThrow("module config unavailable");

    expect(leads.leads.size).toBe(0);
    expect(conversations.conversations.size).toBe(0);
    expect(conversations.messagesByExternalId.size).toBe(0);
    expect(leaseStore.held.size).toBe(0);
  });

  it("makes terminal hooks and direct finally release idempotent", async () => {
    const { lifecycle, leaseStore } = makeHarness();
    const result = await lifecycle.begin(turn("provider-1"));
    const context = ready(result);

    await lifecycle.fail({ context, error: new Error("decision failed") });
    await lifecycle.complete({ context, replied: false, reason: "safe_failure" });
    await context.releaseLease();

    expect(leaseStore.releaseCalls).toBe(1);
    expect(leaseStore.held.size).toBe(0);
  });
});
