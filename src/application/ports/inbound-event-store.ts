export type InboundEventProvider = "meta_cloud_api" | "z_api";

export type InboundEventProcessingStatus =
  | "pending"
  | "processing"
  | "processed"
  | "failed"
  | "ignored";

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
};

export type RecordInboundEventInput = {
  clinicId: string;
  provider: InboundEventProvider;
  providerMessageId: string;
  conversationKey: string;
  payload: unknown;
  normalizedText?: string | null;
  mediaType?: string | null;
  dedupeKey: string;
  receivedAt?: Date;
};

export type RecordInboundEventResult = {
  event: InboundEvent;
  isNew: boolean;
};

export type InboundEventStore = {
  recordInboundEvent(input: RecordInboundEventInput): Promise<RecordInboundEventResult>;
  findInboundEvent(id: string): Promise<InboundEvent | null>;
  markInboundEventProcessing(id: string): Promise<void>;
  markInboundEventPending(id: string): Promise<void>;
  markInboundEventProcessed(id: string, processedAt?: Date): Promise<void>;
  markInboundEventFailed(id: string): Promise<void>;
  markInboundEventIgnored(id: string, processedAt?: Date): Promise<void>;
};
