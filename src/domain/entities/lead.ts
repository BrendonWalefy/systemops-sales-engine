import type { Channel } from "../value-objects/channel";
import type { LeadStatus, LeadTemperature } from "../value-objects/lead-status";

export type Lead = {
  id: string;
  clinicId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  channel: Channel;
  campaignId: string | null;
  treatmentInterest: string | null;
  status: LeadStatus;
  temperature: LeadTemperature | null;
  assignedToUserId: string | null;
  nextActionAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

