import type {
  OutboundSafetyClinic,
  OutboundSafetyLead,
} from "@/application/channel-safety/outbound-safety-gate";

export type OutboundSafetyContext = {
  clinic: OutboundSafetyClinic;
  lead: OutboundSafetyLead | null;
  conversation: { id: string; leadId: string; aiPaused?: boolean } | null;
  agentMessage: { id: string; conversationId: string } | null;
  lastMessage?: { author: string; sentAt: Date } | null;
};

export type OutboundSafetyContextReader = {
  getContext(input: {
    clinicId: string;
    leadId: string;
    conversationId: string;
    agentMessageId: string;
  }): Promise<OutboundSafetyContext | null>;
};
