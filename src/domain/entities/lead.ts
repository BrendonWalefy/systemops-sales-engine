import type { Channel } from "../value-objects/channel";
import type { LeadStatus, LeadTemperature } from "../value-objects/lead-status";

export type Lead = {
  id: string;
  clinicId: string;
  name: string | null;
  phone: string | null;
  /** Linked ID (@lid) do WhatsApp quando o número não está disponível no webhook. */
  whatsappLid: string | null;
  email: string | null;
  channel: Channel;
  campaignId: string | null;
  treatmentInterest: string | null;
  profilePicUrl: string | null;
  status: LeadStatus;
  temperature: LeadTemperature | null;
  assignedToUserId: string | null;
  nextActionAt: Date | null;
  lostReason: string | null;
  /** Durable stop-contact state read by both conversation engines. */
  contactConsentRevokedAt?: Date | null;
  contactConsentSource?: string | null;
  createdAt: Date;
  updatedAt: Date;
};
