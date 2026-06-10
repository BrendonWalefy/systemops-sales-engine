import type { Lead } from "@/domain/entities/lead";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { Channel } from "@/domain/value-objects/channel";
import {
  type WhatsAppContactIdentifiers,
  hasWhatsAppIdentity,
  mergeContactIdentifiers,
} from "@/core/whatsapp/WhatsAppContactIdentity";

export type ResolveWhatsAppLeadInput = {
  clinicId: string;
  identifiers: WhatsAppContactIdentifiers;
  name?: string | null;
  senderPhoto?: string | null;
  channel: Channel;
  now: Date;
  idGenerator: () => string;
};

function enrichLead(
  lead: Lead,
  identifiers: WhatsAppContactIdentifiers,
  name: string | null | undefined,
  senderPhoto: string | null | undefined,
  now: Date,
): Lead {
  const mergedIds = mergeContactIdentifiers(
    { phone: lead.phone, whatsappLid: lead.whatsappLid },
    identifiers,
  );

  return {
    ...lead,
    phone: mergedIds.phone ?? lead.phone,
    whatsappLid: mergedIds.whatsappLid ?? lead.whatsappLid,
    name: name?.trim() ? name.trim() : lead.name,
    profilePicUrl: senderPhoto ?? lead.profilePicUrl,
    updatedAt: now,
  };
}

function needsPersist(before: Lead, after: Lead): boolean {
  return (
    before.phone !== after.phone ||
    before.whatsappLid !== after.whatsappLid ||
    before.name !== after.name ||
    before.profilePicUrl !== after.profilePicUrl
  );
}

export class ResolveWhatsAppLead {
  constructor(private readonly leadRepository: LeadRepository) {}

  async execute(input: ResolveWhatsAppLeadInput): Promise<Lead> {
    if (!hasWhatsAppIdentity(input.identifiers)) {
      throw new Error("ResolveWhatsAppLead requires phone and/or whatsappLid");
    }

    const byPhone = input.identifiers.phone
      ? await this.leadRepository.findByPhone(input.clinicId, input.identifiers.phone)
      : null;

    const byLid = input.identifiers.whatsappLid
      ? await this.leadRepository.findByWhatsAppLid(input.clinicId, input.identifiers.whatsappLid)
      : null;

    // Compat: registros antigos com @lid na coluna phone antes da migração.
    const byLegacyLid =
      input.identifiers.whatsappLid &&
      (!byLid || byLid.id !== byPhone?.id)
        ? await this.leadRepository.findByPhone(input.clinicId, input.identifiers.whatsappLid)
        : null;

    const lidMatch = byLid ?? byLegacyLid;

    if (byPhone && lidMatch && byPhone.id !== lidMatch.id) {
      const merged = await this.leadRepository.mergeDuplicateLeads({
        canonicalLeadId: byPhone.id,
        duplicateLeadId: lidMatch.id,
      });
      const enriched = enrichLead(merged, input.identifiers, input.name, input.senderPhoto, input.now);
      if (needsPersist(merged, enriched)) {
        await this.leadRepository.save(enriched);
      }
      return enriched;
    }

    const existing = byPhone ?? lidMatch;
    if (existing) {
      const enriched = enrichLead(existing, input.identifiers, input.name, input.senderPhoto, input.now);
      if (needsPersist(existing, enriched)) {
        await this.leadRepository.save(enriched);
      }
      return enriched;
    }

    const mergedIds = mergeContactIdentifiers(input.identifiers);
    const candidate: Lead = {
      id: input.idGenerator(),
      clinicId: input.clinicId,
      name: input.name?.trim() ? input.name.trim() : null,
      phone: mergedIds.phone,
      whatsappLid: mergedIds.whatsappLid,
      email: null,
      channel: input.channel,
      campaignId: null,
      treatmentInterest: null,
      profilePicUrl: input.senderPhoto ?? null,
      status: "new",
      temperature: null,
      assignedToUserId: null,
      nextActionAt: null,
      lostReason: null,
      createdAt: input.now,
      updatedAt: input.now,
    };

    await this.leadRepository.save(candidate);

    if (mergedIds.phone) {
      const persisted = await this.leadRepository.findByPhone(input.clinicId, mergedIds.phone);
      if (persisted) return persisted;
    }
    if (mergedIds.whatsappLid) {
      const persisted = await this.leadRepository.findByWhatsAppLid(
        input.clinicId,
        mergedIds.whatsappLid,
      );
      if (persisted) return persisted;
    }

    return candidate;
  }
}
