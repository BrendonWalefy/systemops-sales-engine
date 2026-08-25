export type InboundEventProvider = "meta_cloud_api" | "z_api";
export type StreamGeneration = number;

export type InboundEventProcessingStatus =
  | "pending"
  | "processing"
  | "processed"
  | "failed"
  | "ignored"
  | "identity_conflict"
  | "history_only";

export type StreamAliasInput = Readonly<{
  kind: "phone" | "whatsapp_lid" | "provider_thread";
  providerScope: string;
  normalizedValue: string;
}>;

export type InboundAuthorityTuple = Readonly<{
  streamId: string;
  streamGeneration: StreamGeneration;
  inboundEventId: string;
}>;

export type InboundEvent = {
  id: string;
  clinicId: string;
  provider: InboundEventProvider;
  providerMessageId: string;
  conversationKey: string;
  payload: unknown;
  normalizedText: string | null;
  mediaType: string | null;
  dedupeKey: string;
  processingStatus: InboundEventProcessingStatus;
  receivedAt: Date;
  processedAt: Date | null;
  streamId: string | null;
  streamGeneration: StreamGeneration | null;
  registeredAt: Date | null;
  claimToken: string | null;
  claimTokenDigest: string | null;
  claimJobId: string | null;
  claimedAt: Date | null;
};

export type RegisterInboundAuthorityInput = Readonly<{
  clinicId: string;
  provider: InboundEventProvider;
  providerMessageId: string;
  conversationKey: string;
  aliases: readonly StreamAliasInput[];
  payload: unknown;
  normalizedText: string | null;
  mediaType: string | null;
  dedupeKey: string;
  receivedAt: Date;
}>;

export type RecordInboundEventInput = RegisterInboundAuthorityInput;

export type InboundRegistrationResult =
  | (InboundAuthorityTuple & Readonly<{
      outcome: "registered";
      jobId: string;
      runAt: Date;
      eventWasNew: boolean;
      jobWasNew: boolean;
    }>)
  | Readonly<{
      outcome: "identity_conflict" | "history_only";
      inboundEventId: string;
      jobId: null;
      eventWasNew: boolean;
      jobWasNew: false;
    }>;

export type RecordInboundEventAndEnqueueResult = InboundRegistrationResult;

export type InboundEventStore = {
  recordInboundEventAndEnqueue(
    input: RegisterInboundAuthorityInput,
  ): Promise<InboundRegistrationResult>;
  findInboundEvent(id: string): Promise<InboundEvent | null>;
  markInboundEventProcessing(id: string): Promise<void>;
  markInboundEventPending(id: string): Promise<void>;
  markInboundEventProcessed(id: string, processedAt?: Date): Promise<void>;
  markInboundEventFailed(id: string): Promise<void>;
  markInboundEventIgnored(id: string, processedAt?: Date): Promise<void>;
};
