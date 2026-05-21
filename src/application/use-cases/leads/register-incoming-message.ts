import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { UsageCostTracker } from "@/application/ports/usage-cost-tracker";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { IncomingChannelMessage } from "@/application/ports/channel-adapter";
import type { Conversation, Message } from "@/domain/entities/conversation";
import type { Lead } from "@/domain/entities/lead";

export type RegisterIncomingMessageDependencies = {
  leadRepository: LeadRepository;
  conversationRepository: ConversationRepository;
  usageCostTracker: UsageCostTracker;
  idGenerator: () => string;
  now: () => Date;
};

export class RegisterIncomingMessage {
  constructor(private readonly deps: RegisterIncomingMessageDependencies) {}

  async execute(input: {
    clinicId: string;
    message: IncomingChannelMessage;
  }): Promise<{ lead: Lead; conversation: Conversation; message: Message }> {
    const now = this.deps.now();
    const existingLead = input.message.phone
      ? await this.deps.leadRepository.findByPhone(input.clinicId, input.message.phone)
      : null;

    const lead: Lead =
      existingLead ??
      {
        id: this.deps.idGenerator(),
        clinicId: input.clinicId,
        name: input.message.name,
        phone: input.message.phone,
        email: input.message.email,
        channel: input.message.channel,
        campaignId: input.message.campaignId,
        treatmentInterest: null,
        status: "new",
        temperature: null,
        assignedToUserId: null,
        nextActionAt: null,
        createdAt: now,
        updatedAt: now,
      };

    const existingConversation = await this.deps.conversationRepository.findByLeadId(lead.id);
    const conversation: Conversation =
      existingConversation ??
      {
        id: this.deps.idGenerator(),
        clinicId: input.clinicId,
        leadId: lead.id,
        channel: input.message.channel,
        externalThreadId: input.message.externalThreadId,
        summary: null,
        lastMessageAt: input.message.receivedAt,
        createdAt: now,
        updatedAt: now,
      };

    const message: Message = {
      id: this.deps.idGenerator(),
      conversationId: conversation.id,
      author: "lead",
      body: input.message.body,
      sentAt: input.message.receivedAt,
      externalId: input.message.externalMessageId,
    };

    await this.deps.leadRepository.save({
      ...lead,
      status: lead.status === "new" ? "waiting_response" : lead.status,
      updatedAt: now,
    });
    await this.deps.conversationRepository.saveConversation({
      ...conversation,
      lastMessageAt: input.message.receivedAt,
      updatedAt: now,
    });
    await this.deps.conversationRepository.appendMessage(message);
    if (input.message.channel === "whatsapp") {
      await this.deps.usageCostTracker.trackWhatsAppCost({
        clinicId: input.clinicId,
        provider: "meta_cloud_api",
        providerMessageId: input.message.externalMessageId,
        direction: "inbound",
        category: "service",
      });
    }

    return { lead, conversation, message };
  }
}
