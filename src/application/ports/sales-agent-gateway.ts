import type { Clinic } from "@/domain/entities/clinic";
import type { Conversation, Message } from "@/domain/entities/conversation";
import type { Lead } from "@/domain/entities/lead";

export type AvailableSlot = {
  startsAt: Date;
  endsAt: Date;
};

export type SalesAgentInput = {
  clinic: Clinic;
  lead: Lead;
  conversation: Conversation;
  messages: Message[];
  playbook: string;
  availableSlots?: AvailableSlot[];
};

export type SalesAgentOutput = {
  leadTemperature: "cold" | "warm" | "hot";
  stage:
    | "new_lead"
    | "asked_price"
    | "asked_availability"
    | "objection"
    | "ready_to_schedule"
    | "clinical_sensitive"
    | "unresponsive";
  mainObjection: string | null;
  suggestedReply: string;
  offeredSlotIndices: number[];
  nextAction: string;
  followUp: string | null;
  handoffRequired: boolean;
  riskFlags: string[];
  confidence: number;
  model: string;
  promptVersion: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  } | null;
};

export type SalesAgentGateway = {
  analyze(input: SalesAgentInput): Promise<SalesAgentOutput>;
};
