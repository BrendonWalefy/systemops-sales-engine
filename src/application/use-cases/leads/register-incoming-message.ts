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
  }): Promise<{
    messageInserted: boolean;
    lead: Lead;
    conversation: Conversation;
    message: Message;
  }> {
    const now = this.deps.now();
    const identifiers = buildContactIdentifiersFromWebhook({
      phone: input.message.phone,
      chatLid: input.message.whatsappLid,
    });
    const identityLead = await this.ensureLeadIdentity({
      clinicId: input.clinicId,
      phone: identifiers.phone,
      whatsappLid: identifiers.whatsappLid,
      channel: input.message.channel,
      now,
    });

    const threadId =
      input.message.externalThreadId ??
      resolveWhatsAppThreadId(identifiers) ??
      input.message.externalContactId;

    const existingConversation = await this.deps.conversationRepository.findByLeadId(identityLead.id);
    const candidateConversation: Conversation =
      existingConversation ??
      {
        id: this.deps.idGenerator(),
        clinicId: input.clinicId,
        leadId: identityLead.id,
        channel: input.message.channel,
        category: "sales",
        externalThreadId: threadId,
        summary: null,
        aiPaused: false,
        takeoverExpiresAt: null,
        needsAttention: false,
        attentionReason: null,
        consecutiveUnclearCount: 0,
        lastMessageAt: null,
        createdAt: now,
        updatedAt: now,
      };
    const identityConversation = existingConversation ??
      await this.deps.conversationRepository.ensureConversation(candidateConversation);

    const message: Message = {
      id: this.deps.idGenerator(),
      conversationId: identityConversation.id,
      author: "lead",
      body: input.message.body,
      mediaUrl: input.message.mediaUrl ?? null,
      mediaType: input.message.mediaType ?? null,
      sentAt: input.message.receivedAt,
      externalId: input.message.externalMessageId,
    };

    const messageInserted = await this.deps.conversationRepository.appendMessage(message);
    if (!messageInserted) {
      const persisted = await this.deps.conversationRepository.findMessageByExternalId(
        input.message.externalMessageId,
      );
      return {
        messageInserted: false,
        lead: identityLead,
        conversation: identityConversation,
        message: persisted ?? message,
      };
    }

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
    const updatedLead: Lead = {
      ...resolvedLead,
      status: leadStatus,
      nextActionAt: leadStatus === "in_conversation" ? null : resolvedLead.nextActionAt,
      updatedAt: now,
    };
    await this.deps.leadRepository.save(updatedLead);

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
      (await this.deps.leadRepository.findById(resolvedLead.id)) ?? updatedLead;
    const winnerConversation =
      await this.deps.conversationRepository.findByLeadId(lead.id) ?? identityConversation;
    await this.deps.conversationRepository.saveConversation({
      ...winnerConversation,
      externalThreadId: threadId,
      lastMessageAt: input.message.receivedAt,
      updatedAt: now,
    });
    const conversation =
      await this.deps.conversationRepository.findByLeadId(lead.id) ?? {
        ...winnerConversation,
        externalThreadId: threadId,
        lastMessageAt: input.message.receivedAt,
        updatedAt: now,
      };

    if (input.message.channel === "whatsapp") {
      await this.deps.usageCostTracker.trackWhatsAppCost({
        clinicId: input.clinicId,
        provider: "meta_cloud_api",
        providerMessageId: input.message.externalMessageId,
        direction: "inbound",
        category: "service",
      });
    }

    const persistedMessage =
      await this.deps.conversationRepository.findMessageByExternalId(
        input.message.externalMessageId,
      ) ?? message;
    return {
      messageInserted: true,
      lead,
      conversation,
      message: persistedMessage,
    };
  }

  private async ensureLeadIdentity(input: {
    clinicId: string;
    phone: string | null;
    whatsappLid: string | null;
    channel: IncomingChannelMessage["channel"];
    now: Date;
  }): Promise<Lead> {
    const byPhone = input.phone
      ? await this.deps.leadRepository.findByPhone(input.clinicId, input.phone)
      : null;
    const byLid = input.whatsappLid
      ? await this.deps.leadRepository.findByWhatsAppLid(input.clinicId, input.whatsappLid)
      : null;
    const byLegacyLid = input.whatsappLid && (!byLid || byLid.id !== byPhone?.id)
      ? await this.deps.leadRepository.findByPhone(input.clinicId, input.whatsappLid)
      : null;
    const existing = byPhone ?? byLid ?? byLegacyLid;
    if (existing) return existing;

    return this.deps.leadRepository.ensureWhatsAppIdentity({
      id: this.deps.idGenerator(),
      clinicId: input.clinicId,
      name: null,
      phone: input.phone,
      whatsappLid: input.whatsappLid,
      email: null,
      channel: input.channel,
      campaignId: null,
      treatmentInterest: null,
      profilePicUrl: null,
      status: "new",
      temperature: null,
      assignedToUserId: null,
      nextActionAt: null,
      lostReason: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }
}
