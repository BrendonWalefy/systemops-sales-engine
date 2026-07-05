import type {
  OutboundSafetyClinic,
  OutboundSafetyLead,
} from "@/application/channel-safety/outbound-safety-gate";

export type OutboundSafetyContext = {
  clinic: OutboundSafetyClinic;
  lead: OutboundSafetyLead | null;
  conversation: { id: string; leadId: string } | null;
  agentMessage: { id: string; conversationId: string } | null;
};

export type OutboundSafetyContextReader = {
  getContext(input: {
    clinicId: string;
    leadId: string;
    conversationId: string;
    agentMessageId: string;
  }): Promise<OutboundSafetyContext | null>;
};
