import type { Lead } from "../entities/lead";

export type LeadRepository = {
  findById(id: string): Promise<Lead | null>;
  findByPhone(clinicId: string, phone: string): Promise<Lead | null>;
  save(lead: Lead): Promise<void>;
};

