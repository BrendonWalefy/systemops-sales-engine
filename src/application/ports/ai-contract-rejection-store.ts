import type {
  AiContractRejectionIssue,
  AiContractRejectionStage,
} from "@/application/ports/ai-contract-rejection-recorder";

export type AiEvidenceAad = Readonly<{
  version: "ai-evidence-aad.v1";
  organizationId: string;
  rejectionId: string;
  turnId: string;
  stage: AiContractRejectionStage;
}>;

export type PersistedAiContractRejectionCaptureStatus =
  | "stored"
  | "oversized"
  | "no_raw_output"
  | "encryption_unavailable";

export type AiContractRejectionPersistenceInput = Readonly<{
  rejectionId: string;
  organizationId: string;
  conversationId: string;
  inboundEventId: string;
  turnId: string;
  stage: AiContractRejectionStage;
  modelId: string;
  promptVersion: string;
  contractVersion: string;
  attempt: number;
  issues: readonly AiContractRejectionIssue[];
  outputSha256: string;
  outputBytes: number;
  captureStatus: PersistedAiContractRejectionCaptureStatus;
  encryptedOutput: string | null;
  rawExpiresAt: Date;
  metadataExpiresAt: Date;
  occurredAt: Date;
  aad: AiEvidenceAad;
}>;

export type AiContractRejectionSummary = Readonly<{
  evidenceRef: string;
  turnId: string;
  stage: AiContractRejectionStage;
  modelId: string;
  promptVersion: string;
  contractVersion: string;
  attempt: number;
  issues: readonly AiContractRejectionIssue[];
  outputBytes: number;
  captureStatus: PersistedAiContractRejectionCaptureStatus | "expired";
  rawAvailable: boolean;
  rawExpiresAt: Date;
  metadataExpiresAt: Date;
  createdAt: Date;
}>;

export type RevealableAiContractRejection = AiContractRejectionSummary & Readonly<{
  organizationId: string;
  inboundEventId: string;
  encryptedOutput: string | null;
}>;

export type RecordAiContractRejectionRevealAuditInput = Readonly<{
  organizationId: string;
  rejectionId: string;
  ownerSubject: string;
  accessedAt: Date;
}>;

export interface AiContractRejectionWriter {
  insert(
    input: AiContractRejectionPersistenceInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<Readonly<{
    created: boolean;
    evidenceRef: string;
  }>>;
}

export interface AiContractRejectionStore extends AiContractRejectionWriter {
  listByConversation(
    organizationId: string,
    conversationId: string,
    limit?: number,
  ): Promise<readonly AiContractRejectionSummary[]>;
  findRevealable(
    organizationId: string,
    rejectionId: string,
  ): Promise<RevealableAiContractRejection | null>;
  recordRevealAudit(
    input: RecordAiContractRejectionRevealAuditInput,
  ): Promise<boolean>;
  expireRaw(now: Date, limit?: number): Promise<number>;
  deleteExpiredMetadata(now: Date, limit?: number): Promise<number>;
}
