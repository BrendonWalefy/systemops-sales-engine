import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { UsageCostTracker } from "@/application/ports/usage-cost-tracker";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";
import type { IncomingChannelMessage } from "@/application/ports/channel-adapter";
import type { Conversation, Message } from "@/domain/entities/conversation";
import type { Lead } from "@/domain/entities/lead";
import type { InboundAuthorityTuple } from "@/application/ports/inbound-event-store";
import { ResolveWhatsAppLead } from "@/application/whatsapp/resolve-whatsapp-lead";
import { cancelPendingFollowUps } from "./cancel-pending-follow-ups";
import {
  buildContactIdentifiersFromWebhook,
  resolveWhatsAppThreadId,
  type WhatsAppContactIdentifiers,
} from "@/core/whatsapp/WhatsAppContactIdentity";

export type RegisterIncomingMessageDependencies = {
  leadRepository: LeadRepository;
  conversationRepository: ConversationRepository;
  usageCostTracker: UsageCostTracker;
  followUpRepository?: FollowUpRepository;
  idGenerator: () => string;
  now: () => Date;
};

export type PrepareInboundHistoryInput = Readonly<{
  clinicId: string;
  message: IncomingChannelMessage;
  inboundAuthority?: InboundAuthorityTuple;
}>;

export type PreparedInboundHistory = Readonly<{
  messageInserted: boolean;
  authorityMatchedExisting: boolean;
  claimedEffectsEligible: boolean;
  clinicId: string;
  identifiers: WhatsAppContactIdentifiers;
  threadId: string;
  preparedAt: Date;
  lead: Lead;
  conversation: Conversation;
  message: Message;
}>;

export class RegisterIncomingMessage {
  constructor(private readonly deps: RegisterIncomingMessageDependencies) {}

  async execute(input: PrepareInboundHistoryInput): Promise<{
    messageInserted: boolean;
    lead: Lead;
    conversation: Conversation;
    message: Message;
  }> {
    const prepared = await this.prepareInboundHistory(input);
    const applied = await this.applyClaimedInboundEffects(prepared);
    return {
      messageInserted: applied.messageInserted,
      lead: applied.lead,
      conversation: applied.conversation,
      message: applied.message,
    };
  }

  async prepareInboundHistory(
    input: PrepareInboundHistoryInput,
  ): Promise<PreparedInboundHistory> {
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
    const existingConversation = await this.deps.conversationRepository
      .findByLeadId(identityLead.id);
    const candidateConversation: Conversation = existingConversation ?? {
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
      inboundEventId: input.inboundAuthority?.inboundEventId ?? null,
      streamId: input.inboundAuthority?.streamId ?? null,
      streamGeneration: input.inboundAuthority?.streamGeneration ?? null,
    };
    const messageInserted = await this.deps.conversationRepository.appendMessage(message);
    const persistedMessage =
      await this.deps.conversationRepository.findMessageByExternalId(
        input.message.externalMessageId,
      ) ?? message;
    const authorityMatchedExisting = Boolean(
      !messageInserted &&
      input.inboundAuthority &&
      persistedMessage.inboundEventId === input.inboundAuthority.inboundEventId &&
      persistedMessage.streamId === input.inboundAuthority.streamId &&
      persistedMessage.streamGeneration === input.inboundAuthority.streamGeneration,
    );
    const claimedEffectsEligible = messageInserted || authorityMatchedExisting;
    if (!claimedEffectsEligible) {
      return {
        messageInserted,
        authorityMatchedExisting,
        claimedEffectsEligible,
        clinicId: input.clinicId,
        identifiers,
        threadId,
        preparedAt: now,
        lead: identityLead,
        conversation: identityConversation,
        message: persistedMessage,
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
    const lead = await this.resolvePersistedLead(input.clinicId, identifiers, resolvedLead);
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
    if (messageInserted && input.message.channel === "whatsapp") {
      await this.deps.usageCostTracker.trackWhatsAppCost({
        clinicId: input.clinicId,
        provider: "meta_cloud_api",
        providerMessageId: input.message.externalMessageId,
        direction: "inbound",
        category: "service",
      });
    }
    return {
      messageInserted,
      authorityMatchedExisting,
      claimedEffectsEligible,
      clinicId: input.clinicId,
      identifiers,
      threadId,
      preparedAt: now,
      lead,
      conversation,
      message: persistedMessage,
    };
  }

  async applyClaimedInboundEffects(
    prepared: PreparedInboundHistory,
  ): Promise<PreparedInboundHistory> {
    if (!prepared.claimedEffectsEligible) return prepared;
    const leadStatus =
      prepared.lead.status === "new"
        ? "waiting_response"
        : prepared.lead.status === "follow_up_due" || prepared.lead.status === "lost"
          ? "in_conversation"
          : prepared.lead.status;
    const updatedLead: Lead = {
      ...prepared.lead,
      status: leadStatus,
      nextActionAt: leadStatus === "in_conversation" ? null : prepared.lead.nextActionAt,
      updatedAt: prepared.preparedAt,
    };
    await this.deps.leadRepository.save(updatedLead);
    if (this.deps.followUpRepository) {
      try {
        await cancelPendingFollowUps({
          leadId: updatedLead.id,
          followUpRepository: this.deps.followUpRepository,
          mode: "reengagement",
        });
      } catch (err) {
        console.warn("[RegisterIncomingMessage] Failed to cancel reengagement follow-ups:", err);
      }
    }
    const lead = await this.resolvePersistedLead(
      prepared.clinicId,
      prepared.identifiers,
      updatedLead,
    );
    const conversation =
      await this.deps.conversationRepository.findByLeadId(lead.id) ?? prepared.conversation;
    return { ...prepared, lead, conversation };
  }

  private async resolvePersistedLead(
    clinicId: string,
    identifiers: WhatsAppContactIdentifiers,
    fallback: Lead,
  ): Promise<Lead> {
    return (
      (identifiers.phone
        ? await this.deps.leadRepository.findByPhone(clinicId, identifiers.phone)
        : null) ??
      (identifiers.whatsappLid
        ? await this.deps.leadRepository.findByWhatsAppLid(clinicId, identifiers.whatsappLid)
        : null) ??
      (await this.deps.leadRepository.findById(fallback.id)) ?? fallback
    );
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
