import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { UsageCostTracker } from "@/application/ports/usage-cost-tracker";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";
import type { IncomingChannelMessage } from "@/application/ports/channel-adapter";
import type { Conversation, Message } from "@/domain/entities/conversation";
import type { Lead } from "@/domain/entities/lead";
import { ResolveWhatsAppLead } from "@/application/whatsapp/resolve-whatsapp-lead";
import { cancelPendingFollowUps } from "./cancel-pending-follow-ups";
import {
  buildContactIdentifiersFromWebhook,
  resolveWhatsAppThreadId,
} from "@/core/whatsapp/WhatsAppContactIdentity";

export type RegisterIncomingMessageDependencies = {
  leadRepository: LeadRepository;
  conversationRepository: ConversationRepository;
  usageCostTracker: UsageCostTracker;
  followUpRepository?: FollowUpRepository;
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
    const identifiers = buildContactIdentifiersFromWebhook({
      phone: input.message.phone,
      chatLid: input.message.whatsappLid,
    });

    const resolver = new ResolveWhatsAppLead(this.deps.leadRepository);
    const resolvedLead = await resolver.execute({
      clinicId: input.clinicId,
      identifiers,
      name: input.message.name,
      senderPhoto: input.message.senderPhoto,
      channel: input.message.channel,
      now,
      idGenerator: this.deps.idGenerator,
    });

    const leadStatus =
      resolvedLead.status === "new"
        ? "waiting_response"
        : resolvedLead.status === "follow_up_due" || resolvedLead.status === "lost"
          ? "in_conversation"
          : resolvedLead.status;

    await this.deps.leadRepository.save({
      ...resolvedLead,
      status: leadStatus,
      nextActionAt: leadStatus === "in_conversation" ? null : resolvedLead.nextActionAt,
      updatedAt: now,
    });

    if (this.deps.followUpRepository) {
      try {
        await cancelPendingFollowUps({
          leadId: resolvedLead.id,
          followUpRepository: this.deps.followUpRepository,
          mode: "reengagement",
        });
      } catch (err) {
        console.warn("[RegisterIncomingMessage] Failed to cancel reengagement follow-ups:", err);
      }
    }

    const lead =
      (identifiers.phone
        ? await this.deps.leadRepository.findByPhone(input.clinicId, identifiers.phone)
        : null) ??
      (identifiers.whatsappLid
        ? await this.deps.leadRepository.findByWhatsAppLid(input.clinicId, identifiers.whatsappLid)
        : null) ??
      (await this.deps.leadRepository.findById(resolvedLead.id)) ?? {
        ...resolvedLead,
        status: leadStatus,
        nextActionAt: leadStatus === "in_conversation" ? null : resolvedLead.nextActionAt,
        updatedAt: now,
      };

    const threadId =
      input.message.externalThreadId ??
      resolveWhatsAppThreadId(identifiers) ??
      input.message.externalContactId;

    const existingConversation = await this.deps.conversationRepository.findByLeadId(lead.id);
    const candidateConversation: Conversation =
      existingConversation ??
      {
        id: this.deps.idGenerator(),
        clinicId: input.clinicId,
        leadId: lead.id,
        channel: input.message.channel,
        category: "sales",
        externalThreadId: threadId,
        summary: null,
        aiPaused: false,
        takeoverExpiresAt: null,
        needsAttention: false,
        attentionReason: null,
        consecutiveUnclearCount: 0,
        lastMessageAt: input.message.receivedAt,
        createdAt: now,
        updatedAt: now,
      };

    await this.deps.conversationRepository.saveConversation({
      ...candidateConversation,
      externalThreadId: threadId,
      lastMessageAt: input.message.receivedAt,
      updatedAt: now,
    });

    const conversation = await this.deps.conversationRepository.findByLeadId(lead.id) ?? {
      ...candidateConversation,
      lastMessageAt: input.message.receivedAt,
      updatedAt: now,
    };

    const message: Message = {
      id: this.deps.idGenerator(),
      conversationId: conversation.id,
      author: "lead",
      body: input.message.body,
      mediaUrl: input.message.mediaUrl ?? null,
      mediaType: input.message.mediaType ?? null,
      sentAt: input.message.receivedAt,
      externalId: input.message.externalMessageId,
    };

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
