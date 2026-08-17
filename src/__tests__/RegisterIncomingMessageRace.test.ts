import { describe, expect, it, vi } from "vitest";
import { RegisterIncomingMessage } from "@/application/use-cases/leads/register-incoming-message";
import type { IncomingChannelMessage } from "@/application/ports/channel-adapter";
import type { UsageCostTracker } from "@/application/ports/usage-cost-tracker";
import type { Conversation, Message } from "@/domain/entities/conversation";
import type { Lead } from "@/domain/entities/lead";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";

class TwoPartyBarrier {
  private waiting = 0;
  private release!: () => void;
  private readonly promise = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  async wait(): Promise<void> {
    this.waiting += 1;
    if (this.waiting >= 2) this.release();
    await this.promise;
  }
}

class RacyLeadRepository implements LeadRepository {
  readonly leads = new Map<string, Lead>();
  private readonly phoneIndex = new Map<string, string>();
  private initialMisses = 0;

  constructor(private readonly initialReadBarrier: TwoPartyBarrier) {}

  async findById(id: string): Promise<Lead | null> {
    return this.leads.get(id) ?? null;
  }

  async findByPhone(clinicId: string, phone: string): Promise<Lead | null> {
    const key = `${clinicId}:${phone}`;
    const existingId = this.phoneIndex.get(key);
    if (existingId) return this.leads.get(existingId) ?? null;

    if (this.initialMisses < 2) {
      this.initialMisses += 1;
      await this.initialReadBarrier.wait();
      return null;
    }

    return null;
  }

  async findByWhatsAppLid(clinicId: string, whatsappLid: string): Promise<Lead | null> {
    return (
      Array.from(this.leads.values()).find(
        (lead) => lead.clinicId === clinicId && lead.whatsappLid === whatsappLid,
      ) ?? null
    );
  }

  async findInactiveLeads(): Promise<Lead[]> {
    return [];
  }

  async ensureWhatsAppIdentity(lead: Lead): Promise<Lead> {
    await this.save(lead);
    return (lead.phone ? await this.findByPhone(lead.clinicId, lead.phone) : null) ?? lead;
  }

  async mergeDuplicateLeads(params: {
    canonicalLeadId: string;
    duplicateLeadId: string;
  }): Promise<Lead> {
    const canonical = this.leads.get(params.canonicalLeadId);
    const duplicate = this.leads.get(params.duplicateLeadId);
    if (!canonical || !duplicate) throw new Error("missing lead");
    const merged = {
      ...canonical,
      whatsappLid: canonical.whatsappLid ?? duplicate.whatsappLid,
      phone: canonical.phone ?? duplicate.phone,
    };
    this.leads.set(canonical.id, merged);
    this.leads.delete(duplicate.id);
    return merged;
  }

  async save(lead: Lead): Promise<void> {
    const key = lead.phone ? `${lead.clinicId}:${lead.phone}` : null;
    const existingId = key ? this.phoneIndex.get(key) : null;

    if (existingId) {
      const existing = this.leads.get(existingId);
      this.leads.set(existingId, { ...existing, ...lead, id: existingId } as Lead);
      return;
    }

    this.leads.set(lead.id, lead);
    if (key) this.phoneIndex.set(key, lead.id);
  }
}

class RacyConversationRepository implements ConversationRepository {
  readonly conversations = new Map<string, Conversation>();
  readonly messages = new Map<string, Message[]>();
  private readonly leadIndex = new Map<string, string>();
  private initialMisses = 0;

  constructor(private readonly initialReadBarrier: TwoPartyBarrier) {}

  async findByLeadId(leadId: string): Promise<Conversation | null> {
    const existingId = this.leadIndex.get(leadId);
    if (existingId) return this.conversations.get(existingId) ?? null;

    if (this.initialMisses < 2) {
      this.initialMisses += 1;
      await this.initialReadBarrier.wait();
      return null;
    }

    return null;
  }

  async findMessageByExternalId(externalId: string): Promise<Message | null> {
    return [...this.messages.values()].flat().find(
      (message) => message.externalId === externalId,
    ) ?? null;
  }

  async findMessageById(id: string): Promise<Message | null> {
    return [...this.messages.values()].flat().find((message) => message.id === id) ?? null;
  }

  async findRecentLeadMessageByIdentityAndContent(): Promise<Message | null> {
    return null;
  }

  async ensureConversation(conversation: Conversation): Promise<Conversation> {
    await this.saveConversation(conversation);
    return await this.findByLeadId(conversation.leadId) ?? conversation;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const existingId = this.leadIndex.get(conversation.leadId);

    if (existingId) {
      const existing = this.conversations.get(existingId);
      this.conversations.set(existingId, { ...existing, ...conversation, id: existingId } as Conversation);
      return;
    }

    this.conversations.set(conversation.id, conversation);
    this.leadIndex.set(conversation.leadId, conversation.id);
  }

  async setAiPaused(): Promise<void> {}

  async setTakeover(): Promise<void> {}

  async appendMessage(message: Message): Promise<boolean> {
    if (message.externalId && [...this.messages.values()].flat().some(
      (stored) => stored.externalId === message.externalId,
    )) return false;
    const messages = this.messages.get(message.conversationId) ?? [];
    this.messages.set(message.conversationId, [...messages, message]);
    return true;
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    return this.messages.get(conversationId) ?? [];
  }
}

class SimpleLeadRepository implements LeadRepository {
  readonly leads = new Map<string, Lead>();

  async findById(id: string): Promise<Lead | null> {
    return this.leads.get(id) ?? null;
  }

  async findByPhone(clinicId: string, phone: string): Promise<Lead | null> {
    return (
      Array.from(this.leads.values()).find(
        (lead) => lead.clinicId === clinicId && lead.phone === phone,
      ) ?? null
    );
  }

  async findByWhatsAppLid(clinicId: string, whatsappLid: string): Promise<Lead | null> {
    return (
      Array.from(this.leads.values()).find(
        (lead) => lead.clinicId === clinicId && lead.whatsappLid === whatsappLid,
      ) ?? null
    );
  }

  async findInactiveLeads(): Promise<Lead[]> {
    return [];
  }

  async ensureWhatsAppIdentity(lead: Lead): Promise<Lead> {
    const existing = Array.from(this.leads.values()).find(
      (item) => item.clinicId === lead.clinicId
        && ((lead.phone && item.phone === lead.phone)
          || (lead.whatsappLid && item.whatsappLid === lead.whatsappLid)),
    );
    if (existing) return existing;
    this.leads.set(lead.id, lead);
    return lead;
  }

  async mergeDuplicateLeads(params: {
    canonicalLeadId: string;
    duplicateLeadId: string;
  }): Promise<Lead> {
    void params;
    throw new Error("not implemented");
  }

  async save(lead: Lead): Promise<void> {
    this.leads.set(lead.id, lead);
  }
}

class SimpleConversationRepository implements ConversationRepository {
  readonly conversations = new Map<string, Conversation>();
  readonly messages = new Map<string, Message[]>();

  async findByLeadId(leadId: string): Promise<Conversation | null> {
    return (
      Array.from(this.conversations.values()).find(
        (conversation) => conversation.leadId === leadId,
      ) ?? null
    );
  }

  async findMessageByExternalId(externalId: string): Promise<Message | null> {
    return [...this.messages.values()].flat().find(
      (message) => message.externalId === externalId,
    ) ?? null;
  }

  async findMessageById(id: string): Promise<Message | null> {
    return [...this.messages.values()].flat().find((message) => message.id === id) ?? null;
  }

  async findRecentLeadMessageByIdentityAndContent(): Promise<Message | null> {
    return null;
  }

  async ensureConversation(conversation: Conversation): Promise<Conversation> {
    const existing = Array.from(this.conversations.values()).find(
      (item) => item.leadId === conversation.leadId,
    );
    if (existing) return existing;
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    this.conversations.set(conversation.id, conversation);
  }

  async setAiPaused(): Promise<void> {}

  async setTakeover(): Promise<void> {}

  async appendMessage(message: Message): Promise<boolean> {
    if (message.externalId && [...this.messages.values()].flat().some(
      (stored) => stored.externalId === message.externalId,
    )) return false;
    const messages = this.messages.get(message.conversationId) ?? [];
    this.messages.set(message.conversationId, [...messages, message]);
    return true;
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    return this.messages.get(conversationId) ?? [];
  }
}

const usageCostTracker: UsageCostTracker = {
  async trackAiUsage() {},
  async trackTtsUsage() {},
  async trackWhatsAppCost() {},
};

function makeFollowUpRepository(): FollowUpRepository {
  return {
    save: async () => {},
    listDue: async () => [],
    listPendingByLead: async () => [],
    findPendingByReason: async () => null,
    cancelPendingByReason: async () => 0,
    cancelPendingByLead: async () => 0,
    claimForSending: async () => true,
    recoverStaleSending: async () => 0,
  };
}

function makeMessage(body: string, externalMessageId: string, receivedAt: Date): IncomingChannelMessage {
  return {
    channel: "whatsapp",
    externalContactId: "5511986905114",
    externalMessageId,
    externalThreadId: "5511986905114",
    body,
    phone: "5511986905114",
    whatsappLid: null,
    name: "Larissa Sales",
    email: null,
    receivedAt,
    campaignId: null,
  };
}

describe("RegisterIncomingMessage — corrida de primeiro contato", () => {
  it("uses the durable external-id insert winner as the only registration side-effect owner", async () => {
    const leadRepository = new SimpleLeadRepository();
    const conversationRepository = new SimpleConversationRepository();
    const existingLead: Lead = {
      id: "lead-existing",
      clinicId: "ximendes",
      name: "Larissa Sales",
      phone: "5511986905114",
      whatsappLid: null,
      email: null,
      channel: "whatsapp",
      campaignId: null,
      treatmentInterest: null,
      profilePicUrl: null,
      status: "new",
      temperature: null,
      assignedToUserId: null,
      nextActionAt: null,
      lostReason: null,
      createdAt: new Date("2026-06-01T12:00:00.000Z"),
      updatedAt: new Date("2026-06-01T12:00:00.000Z"),
    };
    const existingConversation: Conversation = {
      id: "conversation-existing",
      clinicId: "ximendes",
      leadId: existingLead.id,
      channel: "whatsapp",
      category: "sales",
      externalThreadId: "5511986905114",
      summary: null,
      aiPaused: false,
      takeoverExpiresAt: null,
      needsAttention: false,
      attentionReason: null,
      consecutiveUnclearCount: 0,
      lastMessageAt: null,
      createdAt: new Date("2026-06-01T12:00:00.000Z"),
      updatedAt: new Date("2026-06-01T12:00:00.000Z"),
    };
    leadRepository.leads.set(existingLead.id, existingLead);
    conversationRepository.conversations.set(existingConversation.id, existingConversation);

    const leadSave = vi.spyOn(leadRepository, "save");
    const conversationSave = vi.spyOn(conversationRepository, "saveConversation");
    const appendMessage = vi
      .spyOn(conversationRepository, "appendMessage")
      .mockImplementation(async (message) => {
        const existing = [...conversationRepository.messages.values()].flat().some(
          (stored) => stored.externalId === message.externalId,
        );
        if (existing) return false;
        const history = conversationRepository.messages.get(message.conversationId) ?? [];
        conversationRepository.messages.set(message.conversationId, [...history, message]);
        return true;
      });
    const followUpRepository = makeFollowUpRepository();
    const followUpList = vi.spyOn(followUpRepository, "listPendingByLead");
    const trackWhatsAppCost = vi.fn(async () => {});
    const trackedUsageCost: UsageCostTracker = {
      async trackAiUsage() {},
      async trackTtsUsage() {},
      trackWhatsAppCost,
    };
    let firstSequence = 0;
    let secondSequence = 0;
    const firstProcess = new RegisterIncomingMessage({
      leadRepository,
      conversationRepository,
      usageCostTracker: trackedUsageCost,
      followUpRepository,
      idGenerator: () => `process-a-${++firstSequence}`,
      now: () => new Date("2026-06-12T12:00:00.000Z"),
    });
    const secondProcess = new RegisterIncomingMessage({
      leadRepository,
      conversationRepository,
      usageCostTracker: trackedUsageCost,
      followUpRepository,
      idGenerator: () => `process-b-${++secondSequence}`,
      now: () => new Date("2026-06-12T12:00:00.000Z"),
    });
    const incoming = makeMessage(
      "Quero clareamento",
      "provider-cross-process-duplicate",
      new Date("2026-06-12T11:59:30.000Z"),
    );

    await Promise.all([
      firstProcess.execute({ clinicId: "ximendes", message: incoming }),
      secondProcess.execute({ clinicId: "ximendes", message: incoming }),
    ]);

    expect(appendMessage).toHaveBeenCalledTimes(2);
    expect([...conversationRepository.messages.values()].flat()).toHaveLength(1);
    expect(leadSave).toHaveBeenCalledTimes(1);
    expect(conversationSave).toHaveBeenCalledTimes(1);
    expect(followUpList).toHaveBeenCalledTimes(1);
    expect(trackWhatsAppCost).toHaveBeenCalledTimes(1);
  });

  it("converges a first-contact same-id race before any loser post-gate mutation", async () => {
    const leadRepository = new SimpleLeadRepository();
    const conversationRepository = new SimpleConversationRepository();
    const leadSave = vi.spyOn(leadRepository, "save");
    const conversationSave = vi.spyOn(conversationRepository, "saveConversation");
    const followUpRepository = makeFollowUpRepository();
    const followUpList = vi.spyOn(followUpRepository, "listPendingByLead");
    const trackWhatsAppCost = vi.fn(async () => {});
    const trackedUsageCost: UsageCostTracker = {
      async trackAiUsage() {},
      async trackTtsUsage() {},
      trackWhatsAppCost,
    };
    let sequenceA = 0;
    let sequenceB = 0;
    const makeProcess = (prefix: string, nextId: () => number) =>
      new RegisterIncomingMessage({
        leadRepository,
        conversationRepository,
        usageCostTracker: trackedUsageCost,
        followUpRepository,
        idGenerator: () => `${prefix}-${nextId()}`,
        now: () => new Date("2026-06-12T12:00:00.000Z"),
      });
    const firstProcess = makeProcess("process-a", () => ++sequenceA);
    const secondProcess = makeProcess("process-b", () => ++sequenceB);
    const incoming = makeMessage(
      "Primeiro contato",
      "provider-first-contact-duplicate",
      new Date("2026-06-12T11:59:30.000Z"),
    );

    const results = await Promise.all([
      firstProcess.execute({ clinicId: "ximendes", message: incoming }),
      secondProcess.execute({ clinicId: "ximendes", message: incoming }),
    ]);

    expect(results.filter(({ messageInserted }) => messageInserted)).toHaveLength(1);
    expect(leadRepository.leads.size).toBe(1);
    expect(conversationRepository.conversations.size).toBe(1);
    expect([...conversationRepository.messages.values()].flat()).toHaveLength(1);
    expect(leadSave).toHaveBeenCalledTimes(2);
    expect(conversationSave).toHaveBeenCalledTimes(1);
    expect(followUpList).toHaveBeenCalledTimes(1);
    expect(trackWhatsAppCost).toHaveBeenCalledTimes(1);
  });

  it("merges split phone and lid identities only after winning the message insert", async () => {
    const leadRepository = new SimpleLeadRepository();
    const conversationRepository = new SimpleConversationRepository();
    const baseLead: Omit<Lead, "id" | "phone" | "whatsappLid"> = {
      clinicId: "ximendes",
      name: "Larissa Sales",
      email: null,
      channel: "whatsapp",
      campaignId: null,
      treatmentInterest: null,
      profilePicUrl: null,
      status: "new",
      temperature: null,
      assignedToUserId: null,
      nextActionAt: null,
      lostReason: null,
      createdAt: new Date("2026-06-01T12:00:00.000Z"),
      updatedAt: new Date("2026-06-01T12:00:00.000Z"),
    };
    const phoneLead: Lead = {
      ...baseLead,
      id: "lead-phone",
      phone: "5511986905114",
      whatsappLid: null,
    };
    const lidLead: Lead = {
      ...baseLead,
      id: "lead-lid",
      phone: null,
      whatsappLid: "123456789@lid",
    };
    leadRepository.leads.set(phoneLead.id, phoneLead);
    leadRepository.leads.set(lidLead.id, lidLead);
    conversationRepository.conversations.set("conversation-phone", {
      id: "conversation-phone",
      clinicId: "ximendes",
      leadId: phoneLead.id,
      channel: "whatsapp",
      category: "sales",
      externalThreadId: "5511986905114",
      summary: null,
      aiPaused: false,
      takeoverExpiresAt: null,
      needsAttention: false,
      attentionReason: null,
      consecutiveUnclearCount: 0,
      lastMessageAt: null,
      createdAt: baseLead.createdAt,
      updatedAt: baseLead.updatedAt,
    });
    const mergeDuplicateLeads = vi
      .spyOn(leadRepository, "mergeDuplicateLeads")
      .mockImplementation(async ({ canonicalLeadId, duplicateLeadId }) => {
        const canonical = leadRepository.leads.get(canonicalLeadId)!;
        const duplicate = leadRepository.leads.get(duplicateLeadId)!;
        const merged = {
          ...canonical,
          phone: canonical.phone ?? duplicate.phone,
          whatsappLid: canonical.whatsappLid ?? duplicate.whatsappLid,
        };
        leadRepository.leads.set(canonicalLeadId, merged);
        leadRepository.leads.delete(duplicateLeadId);
        return merged;
      });
    const trackWhatsAppCost = vi.fn(async () => {});
    const trackedUsageCost: UsageCostTracker = {
      async trackAiUsage() {},
      async trackTtsUsage() {},
      trackWhatsAppCost,
    };
    let sequence = 0;
    const makeProcess = () => new RegisterIncomingMessage({
      leadRepository,
      conversationRepository,
      usageCostTracker: trackedUsageCost,
      idGenerator: () => `generated-${++sequence}`,
      now: () => new Date("2026-06-12T12:00:00.000Z"),
    });
    const incoming = {
      ...makeMessage(
        "Contato com duas identidades",
        "provider-split-identity-duplicate",
        new Date("2026-06-12T11:59:30.000Z"),
      ),
      whatsappLid: "123456789@lid",
    };

    const results = await Promise.all([
      makeProcess().execute({ clinicId: "ximendes", message: incoming }),
      makeProcess().execute({ clinicId: "ximendes", message: incoming }),
    ]);

    expect(results.filter(({ messageInserted }) => messageInserted)).toHaveLength(1);
    expect(mergeDuplicateLeads).toHaveBeenCalledTimes(1);
    expect(trackWhatsAppCost).toHaveBeenCalledTimes(1);
  });

  it("converge duas mensagens simultâneas para um único lead e uma única conversa", async () => {
    const leadRepository = new RacyLeadRepository(new TwoPartyBarrier());
    const conversationRepository = new RacyConversationRepository(new TwoPartyBarrier());
    const ids = [
      "lead-a",
      "message-a",
      "lead-b",
      "message-b",
      "conversation-a",
      "conversation-b",
    ];
    const useCase = new RegisterIncomingMessage({
      leadRepository,
      conversationRepository,
      usageCostTracker,
      idGenerator: () => ids.shift() ?? crypto.randomUUID(),
      now: () => new Date("2026-06-04T10:41:12.000Z"),
    });

    const [first, second] = await Promise.all([
      useCase.execute({
        clinicId: "ximendes",
        message: makeMessage("Olá bom dia", "zapi-larissa-1", new Date("2026-06-04T10:41:05.000Z")),
      }),
      useCase.execute({
        clinicId: "ximendes",
        message: makeMessage("Tenho interesse em lentes", "zapi-larissa-2", new Date("2026-06-04T10:41:07.000Z")),
      }),
    ]);

    expect(leadRepository.leads.size).toBe(1);
    expect(conversationRepository.conversations.size).toBe(1);
    expect(first.lead.id).toBe(second.lead.id);
    expect(first.conversation.id).toBe(second.conversation.id);

    const [conversation] = Array.from(conversationRepository.conversations.values());
    expect(conversation.leadId).toBe(first.lead.id);
    expect(conversationRepository.messages.get(conversation.id)).toHaveLength(2);
  });

  it("cancela follow-ups pendentes quando o lead reengaja por inbound", async () => {
    const leadRepository = new SimpleLeadRepository();
    const conversationRepository = new SimpleConversationRepository();
    const followUpRepository = makeFollowUpRepository();
    const listPendingByLead = vi.fn(async () => [
      {
        id: "fu-video",
        clinicId: "ximendes",
        leadId: "pending-lead-id",
        dueAt: new Date("2026-06-11T18:00:00.000Z"),
        status: "pending" as const,
        reason: "video_sent:Lentes",
        suggestedMessage: null,
        completedAt: null,
        createdAt: new Date("2026-06-11T12:00:00.000Z"),
        updatedAt: new Date("2026-06-11T12:00:00.000Z"),
      },
      {
        id: "fu-routine",
        clinicId: "ximendes",
        leadId: "pending-lead-id",
        dueAt: new Date("2026-12-11T18:00:00.000Z"),
        status: "pending" as const,
        reason: "Retorno de rotina",
        suggestedMessage: null,
        completedAt: null,
        createdAt: new Date("2026-06-11T12:00:00.000Z"),
        updatedAt: new Date("2026-06-11T12:00:00.000Z"),
      },
    ]);
    const cancelPendingByReason = vi.fn(async () => 1);
    followUpRepository.listPendingByLead = listPendingByLead;
    followUpRepository.cancelPendingByReason = cancelPendingByReason;

    const useCase = new RegisterIncomingMessage({
      leadRepository,
      conversationRepository,
      usageCostTracker,
      followUpRepository,
      idGenerator: () => crypto.randomUUID(),
      now: () => new Date("2026-06-11T12:00:00.000Z"),
    });

    const result = await useCase.execute({
      clinicId: "ximendes",
      message: makeMessage("Oi, vi o vídeo e quero agendar", "zapi-reengage-1", new Date("2026-06-11T11:59:00.000Z")),
    });

    expect(listPendingByLead).toHaveBeenCalledWith({ leadId: result.lead.id });
    expect(cancelPendingByReason).toHaveBeenCalledWith({
      leadId: result.lead.id,
      reason: "video_sent:Lentes",
    });
    expect(cancelPendingByReason).not.toHaveBeenCalledWith({
      leadId: result.lead.id,
      reason: "Retorno de rotina",
    });
  });

  it("falha ao cancelar follow-up nao interrompe o registro da mensagem inbound", async () => {
    const leadRepository = new SimpleLeadRepository();
    const conversationRepository = new SimpleConversationRepository();
    const followUpRepository = makeFollowUpRepository();
    followUpRepository.listPendingByLead = vi.fn(async () => {
      throw new Error("follow-up db unavailable");
    });

    const useCase = new RegisterIncomingMessage({
      leadRepository,
      conversationRepository,
      usageCostTracker,
      followUpRepository,
      idGenerator: () => crypto.randomUUID(),
      now: () => new Date("2026-06-11T12:00:00.000Z"),
    });

    const result = await useCase.execute({
      clinicId: "ximendes",
      message: makeMessage("Oi, quero falar com vocês", "zapi-inbound-2", new Date("2026-06-11T11:59:30.000Z")),
    });

    expect(result.message.author).toBe("lead");
    expect(conversationRepository.messages.get(result.conversation.id)).toHaveLength(1);
  });

  it("reabre lead em recuperação para in_conversation quando ele volta a responder", async () => {
    const leadRepository = new SimpleLeadRepository();
    const conversationRepository = new SimpleConversationRepository();
    const existingLead: Lead = {
      id: "lead-recovery",
      clinicId: "ximendes",
      name: "Larissa Sales",
      phone: "5511986905114",
      whatsappLid: null,
      email: null,
      channel: "whatsapp",
      campaignId: null,
      treatmentInterest: "Lentes",
      profilePicUrl: null,
      status: "follow_up_due",
      temperature: "hot",
      assignedToUserId: null,
      nextActionAt: new Date("2026-06-13T10:00:00.000Z"),
      lostReason: null,
      createdAt: new Date("2026-06-01T12:00:00.000Z"),
      updatedAt: new Date("2026-06-11T12:00:00.000Z"),
    };

    leadRepository.leads.set(existingLead.id, existingLead);

    const useCase = new RegisterIncomingMessage({
      leadRepository,
      conversationRepository,
      usageCostTracker,
      idGenerator: () => crypto.randomUUID(),
      now: () => new Date("2026-06-12T12:00:00.000Z"),
    });

    const result = await useCase.execute({
      clinicId: "ximendes",
      message: makeMessage("Quero remarcar", "zapi-recovery-1", new Date("2026-06-12T11:59:30.000Z")),
    });

    expect(result.lead.status).toBe("in_conversation");
    expect(result.lead.nextActionAt).toBeNull();
  });
});
