import type { VerbalizationViolationCode } from "@/conversation-core/composer/verbalization-validator";

export const AI_CONTRACT_REJECTION_STAGES = Object.freeze([
  "understanding_structural",
  "understanding_semantic",
  "response_verbalization",
] as const);

export type AiContractRejectionStage =
  (typeof AI_CONTRACT_REJECTION_STAGES)[number];

export type AiContractRejectionIssueCode =
  | "invalid_json"
  | "missing_output"
  | "schema_type_mismatch"
  | "schema_required"
  | "schema_unknown_key"
  | "schema_enum"
  | "schema_range"
  | "service_required_for_request"
  | VerbalizationViolationCode;

export type AiContractRejectionIssue = Readonly<{
  path: readonly string[];
  code: AiContractRejectionIssueCode;
}>;

const AI_CONTRACT_REJECTION_SAFE_PATH_SEGMENTS = new Set([
  "version",
  "request",
  "dialogueMove",
  "entities",
  "service",
  "date",
  "period",
  "time",
  "serviceCandidates",
  "quantity",
  "ordinal",
  "signals",
  "purchaseIntent",
  "priceSensitivity",
  "sentiment",
  "objection",
  "safety",
  "optOut",
  "requestsHuman",
  "emergency",
  "confidence",
  "ambiguity",
  "kind",
  "candidates",
]);

export function sanitizeAiContractRejectionIssuePath(
  path: readonly string[],
): readonly string[] {
  const sanitized: string[] = [];
  for (const segment of path) {
    if (!AI_CONTRACT_REJECTION_SAFE_PATH_SEGMENTS.has(segment)) break;
    sanitized.push(segment);
  }
  return Object.freeze(sanitized);
}

export type CaptureAiContractRejectionInput = Readonly<{
  organizationId: string;
  conversationId: string;
  inboundEventId: string;
  turnId: string;
  stage: AiContractRejectionStage;
  modelId: string;
  promptVersion: string;
  contractVersion: string;
  attempt: number;
  rawOutput: string | null;
  issues: readonly AiContractRejectionIssue[];
  occurredAt: Date;
}>;

export type AiContractRejectionCaptureResult = Readonly<{
  status:
    | "stored"
    | "deduplicated"
    | "oversized"
    | "no_raw_output"
    | "encryption_unavailable"
    | "persistence_failed";
  evidenceRef?: string;
}>;

export interface AiContractRejectionRecorder {
  capture(
    input: CaptureAiContractRejectionInput,
  ): Promise<AiContractRejectionCaptureResult>;
}

export async function captureAiContractRejectionBestEffort(
  recorder: AiContractRejectionRecorder | undefined,
  input: CaptureAiContractRejectionInput,
): Promise<AiContractRejectionCaptureResult> {
  if (!recorder) return { status: "persistence_failed" };
  try {
    return await recorder.capture(input);
  } catch {
    return { status: "persistence_failed" };
  }
}
