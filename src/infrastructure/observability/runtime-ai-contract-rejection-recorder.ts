import { createHash, randomUUID } from "node:crypto";
import type {
  AiContractRejectionCaptureResult,
  AiContractRejectionRecorder,
  CaptureAiContractRejectionInput,
} from "@/application/ports/ai-contract-rejection-recorder";
import { sanitizeAiContractRejectionIssuePath } from "@/application/ports/ai-contract-rejection-recorder";
import type {
  AiContractRejectionWriter,
  AiEvidenceAad,
  PersistedAiContractRejectionCaptureStatus,
} from "@/application/ports/ai-contract-rejection-store";
import {
  sealAiEvidence,
} from "@/infrastructure/crypto/ai-evidence-vault";

export const AI_EVIDENCE_MAX_RAW_BYTES = 65_536;
export const AI_EVIDENCE_RAW_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const AI_EVIDENCE_METADATA_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

type RuntimeAiContractRejectionRecorderDependencies = Readonly<{
  store: AiContractRejectionWriter;
  generateId?: () => string;
  seal?: (rawOutput: string, aad: AiEvidenceAad) => string;
}>;

export class RuntimeAiContractRejectionRecorder
implements AiContractRejectionRecorder {
  private readonly generateId: () => string;
  private readonly seal: (rawOutput: string, aad: AiEvidenceAad) => string;

  constructor(
    private readonly dependencies: RuntimeAiContractRejectionRecorderDependencies,
  ) {
    this.generateId = dependencies.generateId ?? randomUUID;
    this.seal = dependencies.seal ?? ((rawOutput, aad) =>
      sealAiEvidence(rawOutput, aad));
  }

  async capture(
    input: CaptureAiContractRejectionInput,
  ): Promise<AiContractRejectionCaptureResult> {
    const rejectionId = this.generateId();
    const rawBytes = input.rawOutput === null
      ? Buffer.alloc(0)
      : Buffer.from(input.rawOutput, "utf8");
    const outputSha256 = createHash("sha256").update(rawBytes).digest("hex");
    const aad: AiEvidenceAad = {
      version: "ai-evidence-aad.v1",
      organizationId: input.organizationId,
      rejectionId,
      turnId: input.turnId,
      stage: input.stage,
    };

    let captureStatus: PersistedAiContractRejectionCaptureStatus;
    let encryptedOutput: string | null = null;
    if (input.rawOutput === null) {
      captureStatus = "no_raw_output";
    } else if (rawBytes.byteLength > AI_EVIDENCE_MAX_RAW_BYTES) {
      captureStatus = "oversized";
    } else {
      try {
        encryptedOutput = this.seal(input.rawOutput, aad);
        captureStatus = "stored";
      } catch {
        captureStatus = "encryption_unavailable";
      }
    }

    try {
      const persisted = await this.dependencies.store.insert({
        rejectionId,
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        inboundEventId: input.inboundEventId,
        turnId: input.turnId,
        stage: input.stage,
        modelId: input.modelId,
        promptVersion: input.promptVersion,
        contractVersion: input.contractVersion,
        attempt: input.attempt,
        issues: Object.freeze(input.issues.map((issue) => Object.freeze({
          path: sanitizeAiContractRejectionIssuePath(issue.path),
          code: issue.code,
        }))),
        outputSha256,
        outputBytes: rawBytes.byteLength,
        captureStatus,
        encryptedOutput,
        rawExpiresAt: new Date(
          input.occurredAt.getTime() + AI_EVIDENCE_RAW_RETENTION_MS,
        ),
        metadataExpiresAt: new Date(
          input.occurredAt.getTime() + AI_EVIDENCE_METADATA_RETENTION_MS,
        ),
        occurredAt: new Date(input.occurredAt.getTime()),
        aad,
      });
      return {
        status: persisted.created ? captureStatus : "deduplicated",
        evidenceRef: persisted.evidenceRef,
      };
    } catch {
      return { status: "persistence_failed" };
    }
  }
}
