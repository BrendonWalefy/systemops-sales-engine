import type { Conversation } from "@/domain/entities/conversation";
import type { Lead } from "@/domain/entities/lead";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { Channel } from "@/domain/value-objects/channel";
import type { WhatsAppContactIdentifiers } from "@/core/whatsapp/WhatsAppContactIdentity";
import { ResolveWhatsAppLead } from "@/application/whatsapp/resolve-whatsapp-lead";

export async function findConversationByWhatsAppContact(params: {
  clinicId: string;
  identifiers: WhatsAppContactIdentifiers;
  senderName?: string | null;
  channel: Channel;
  leadRepository: LeadRepository;
  conversationRepository: ConversationRepository;
  idGenerator: () => string;
  now: Date;
  createLeadIfMissing?: boolean;
}): Promise<{ lead: Lead; conversation: Conversation } | null> {
  const resolver = new ResolveWhatsAppLead(params.leadRepository);

  let lead: Lead | null = null;

  if (params.createLeadIfMissing) {
    lead = await resolver.execute({
      clinicId: params.clinicId,
      identifiers: params.identifiers,
      name: params.senderName,
      channel: params.channel,
      now: params.now,
      idGenerator: params.idGenerator,
    });
  } else {
    const byPhone = params.identifiers.phone
      ? await params.leadRepository.findByPhone(params.clinicId, params.identifiers.phone)
      : null;
    const byLid = params.identifiers.whatsappLid
      ? await params.leadRepository.findByWhatsAppLid(params.clinicId, params.identifiers.whatsappLid)
      : null;
    const byLegacy = params.identifiers.whatsappLid
      ? await params.leadRepository.findByPhone(params.clinicId, params.identifiers.whatsappLid)
      : null;

    if (byPhone && (byLid ?? byLegacy) && byPhone.id !== (byLid ?? byLegacy)!.id) {
      lead = await params.leadRepository.mergeDuplicateLeads({
        canonicalLeadId: byPhone.id,
        duplicateLeadId: (byLid ?? byLegacy)!.id,
      });
    } else {
      lead = byPhone ?? byLid ?? byLegacy;
    }
  }

  if (!lead) return null;

  const conversation = await params.conversationRepository.findByLeadId(lead.id);
  if (!conversation) return null;

  return { lead, conversation };
}
