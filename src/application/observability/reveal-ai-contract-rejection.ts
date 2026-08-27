import type {
  AiContractRejectionStore,
  AiEvidenceAad,
  RevealableAiContractRejection,
} from "@/application/ports/ai-contract-rejection-store";

export type RevealAiContractRejectionInput = Readonly<{
  organizationId: string;
  rejectionId: string;
  ownerSubject: string;
  now: Date;
}>;

export type RevealAiContractRejectionResult =
  | Readonly<{ status: "revealed"; rawOutput: string }>
  | Readonly<{ status: "not_found" }>;

export type RevealAiContractRejectionDependencies = Readonly<{
  store: Pick<
    AiContractRejectionStore,
    "findRevealable" | "recordRevealAudit"
  >;
  open(envelope: string, aad: AiEvidenceAad): string;
}>;

function exactRevealable(
  input: RevealAiContractRejectionInput,
  candidate: RevealableAiContractRejection | null,
): candidate is RevealableAiContractRejection & Readonly<{
  encryptedOutput: string;
}> {
  return candidate !== null
    && candidate.organizationId === input.organizationId
    && candidate.evidenceRef === input.rejectionId
    && candidate.captureStatus === "stored"
    && candidate.encryptedOutput !== null
    && candidate.rawExpiresAt.getTime() > input.now.getTime()
    && candidate.metadataExpiresAt.getTime() > input.now.getTime();
}

export async function revealAiContractRejection(
  input: RevealAiContractRejectionInput,
  dependencies: RevealAiContractRejectionDependencies,
): Promise<RevealAiContractRejectionResult> {
  try {
    const candidate = await dependencies.store.findRevealable(
      input.organizationId,
      input.rejectionId,
    );
    if (!exactRevealable(input, candidate)) return { status: "not_found" };

    const aad: AiEvidenceAad = Object.freeze({
      version: "ai-evidence-aad.v1",
      organizationId: candidate.organizationId,
      rejectionId: candidate.evidenceRef,
      turnId: candidate.turnId,
      stage: candidate.stage,
    });
    const rawOutput = dependencies.open(
      candidate.encryptedOutput,
      aad,
    );
    const audited = await dependencies.store.recordRevealAudit({
      organizationId: input.organizationId,
      rejectionId: input.rejectionId,
      ownerSubject: input.ownerSubject,
      accessedAt: new Date(input.now.getTime()),
    });
    if (!audited) return { status: "not_found" };
    return Object.freeze({ status: "revealed", rawOutput });
  } catch {
    return { status: "not_found" };
  }
}
