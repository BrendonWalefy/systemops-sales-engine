import type { Lead } from "../entities/lead";

export type LeadRepository = {
  findById(id: string): Promise<Lead | null>;
  findByPhone(clinicId: string, phone: string): Promise<Lead | null>;
  findByWhatsAppLid(clinicId: string, whatsappLid: string): Promise<Lead | null>;
  findInactiveLeads(params: { clinicId: string; lastActivityBefore: Date }): Promise<Lead[]>;
  /** Inserts a missing identity row, without enriching or mutating an existing lead. */
  ensureWhatsAppIdentity(lead: Lead): Promise<Lead>;
  save(lead: Lead): Promise<void>;
  mergeDuplicateLeads(params: { canonicalLeadId: string; duplicateLeadId: string }): Promise<Lead>;
};
