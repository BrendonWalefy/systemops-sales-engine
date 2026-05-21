import type { LeadTemperature } from "../value-objects/lead-status";

export type SalesAgentStage =
  | "new_lead"
  | "asked_price"
  | "asked_availability"
  | "objection"
  | "ready_to_schedule"
  | "clinical_sensitive"
  | "unresponsive";

export type SalesAgentRecommendation = {
  id: string;
  clinicId: string;
  leadId: string;
  conversationId: string;
  leadTemperature: LeadTemperature;
  stage: SalesAgentStage;
  mainObjection: string | null;
  suggestedReply: string;
  nextAction: string;
  followUp: string | null;
  handoffRequired: boolean;
  riskFlags: string[];
  confidence: number;
  model: string;
  promptVersion: string;
  createdAt: Date;
};

