import type {
  InboundAuthorityTuple,
  StreamGeneration,
} from "@/application/ports/inbound-event-store";

export type BindStreamToConversationInput = InboundAuthorityTuple & Readonly<{
  clinicId: string;
  conversationId: string;
  now: Date;
}>;

export type BindStreamToConversationResult = Readonly<{
  authoritativeStreamId: string;
  retainedEventStreamId: string;
  retiredCurrentStream: boolean;
  conversationStreamOrder: StreamGeneration;
}>;

export type RepairInboundAuthorityJobInput = Readonly<{
  inboundEventId: string;
  now: Date;
  olderThan: Date;
}>;

export type RepairInboundAuthorityJobResult = Readonly<{
  outcome: "created" | "rebound" | "ineligible";
  jobId: string | null;
}>;

export interface WhatsAppStreamAuthority {
  bindStreamToConversation(
    input: BindStreamToConversationInput,
  ): Promise<BindStreamToConversationResult>;
  repairInboundAuthorityJob(
    input: RepairInboundAuthorityJobInput,
  ): Promise<RepairInboundAuthorityJobResult>;
}
