import type { ConversationState } from "@/conversation-core/capability/contract";
import type { Understanding } from "@/conversation-core/understanding/schema";
import type { ZodIssue } from "zod";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";
import type {
  AiContractRejectionIssue,
  AiContractRejectionStage,
} from "@/application/ports/ai-contract-rejection-recorder";
import { sanitizeAiContractRejectionIssuePath } from "@/application/ports/ai-contract-rejection-recorder";
import {
  dentalUnderstandingStructureSchema,
  validateDentalUnderstandingSemantics,
} from "@/domain-packs/dental/understanding";
import { DENTAL_UNDERSTANDING_PROMPT, DENTAL_UNDERSTANDING_PROMPT_VERSION } from "@/domain-packs/dental/understanding-prompt";
import type { DentalCatalogEntry, DentalRequest } from "@/domain-packs/dental/vocabulary";

export const LIVE_DENTAL_UNDERSTANDING_MODEL_IDS = Object.freeze([
  "gpt-4o-mini",
] as const);

export type LiveDentalUnderstandingModelId =
  (typeof LIVE_DENTAL_UNDERSTANDING_MODEL_IDS)[number];

export function parseLiveDentalUnderstandingModelId(
  value: unknown,
): LiveDentalUnderstandingModelId {
  if (
    typeof value === "string" &&
    (LIVE_DENTAL_UNDERSTANDING_MODEL_IDS as readonly string[]).includes(value)
  ) {
    return value as LiveDentalUnderstandingModelId;
  }
  throw new Error("unsupported live dental understanding model");
}

export type DentalUnderstandingModelRequest = {
  modelId: string;
  promptVersion: typeof DENTAL_UNDERSTANDING_PROMPT_VERSION;
  schemaVersion: typeof UNDERSTANDING_VERSION;
  systemPrompt: string;
  leadMessage: string;
  history: readonly { author: "lead" | "agent"; body: string }[];
  state: ConversationState | null;
  catalog: readonly DentalCatalogEntry[];
  faqCatalog: readonly string[];
};

export type DentalUnderstandingModel = {
  modelId: string;
  generate(
    input: DentalUnderstandingModelRequest,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<string | null>;
};

export type DentalUnderstandingContractRejection = Readonly<{
  stage: Extract<
    AiContractRejectionStage,
    "understanding_structural" | "understanding_semantic"
  >;
  modelId: string;
  promptVersion: typeof DENTAL_UNDERSTANDING_PROMPT_VERSION;
  contractVersion: typeof UNDERSTANDING_VERSION;
  rawOutput: string | null;
  issues: readonly AiContractRejectionIssue[];
}>;

export type DentalUnderstandingContractRejectionObserver = (
  rejection: DentalUnderstandingContractRejection,
) => void | Promise<void>;

export type DentalUnderstandingOptions = Readonly<{
  signal?: AbortSignal;
  onContractRejection?: DentalUnderstandingContractRejectionObserver;
}>;

export class DentalUnderstandingContractRejectionError extends Error {
  readonly stage: DentalUnderstandingContractRejection["stage"];
  readonly issues: readonly AiContractRejectionIssue[];

  constructor(
    stage: DentalUnderstandingContractRejection["stage"],
    issues: readonly AiContractRejectionIssue[],
  ) {
    super("dental understanding contract rejected");
    this.name = "DentalUnderstandingContractRejectionError";
    this.stage = stage;
    this.issues = freezeIssues(issues);
  }
}

function freezeIssues(
  issues: readonly AiContractRejectionIssue[],
): readonly AiContractRejectionIssue[] {
  return Object.freeze(issues.map((issue) => Object.freeze({
    path: sanitizeAiContractRejectionIssuePath(issue.path),
    code: issue.code,
  })));
}

function structuralIssues(
  issues: readonly ZodIssue[],
): readonly AiContractRejectionIssue[] {
  const mapped: AiContractRejectionIssue[] = [];
  for (const issue of issues) {
    const path = issue.path.map(String);
    if (issue.code === "unrecognized_keys") {
      mapped.push({ path, code: "schema_unknown_key" });
      continue;
    }
    if (issue.code === "invalid_type") {
      mapped.push({
        path,
        code: issue.received === "undefined"
          ? "schema_required"
          : "schema_type_mismatch",
      });
      continue;
    }
    if (issue.code === "invalid_enum_value" || issue.code === "invalid_literal") {
      mapped.push({ path, code: "schema_enum" });
      continue;
    }
    if (issue.code === "too_small" || issue.code === "too_big") {
      mapped.push({ path, code: "schema_range" });
      continue;
    }
    mapped.push({ path, code: "schema_type_mismatch" });
  }
  return freezeIssues(mapped);
}

async function observeRejection(
  observer: DentalUnderstandingContractRejectionObserver | undefined,
  rejection: DentalUnderstandingContractRejection,
): Promise<void> {
  if (!observer) return;
  try {
    await observer(Object.freeze({
      ...rejection,
      issues: freezeIssues(rejection.issues),
    }));
  } catch {
    // Evidence capture is observability and cannot alter the safe V2 fallback.
  }
}

async function rejectContract(
  observer: DentalUnderstandingContractRejectionObserver | undefined,
  rejection: DentalUnderstandingContractRejection,
): Promise<never> {
  await observeRejection(observer, rejection);
  throw new DentalUnderstandingContractRejectionError(
    rejection.stage,
    rejection.issues,
  );
}

export class DentalUnderstandingProvider {
  constructor(private readonly model: DentalUnderstandingModel) {}

  async understand(
    input: Omit<DentalUnderstandingModelRequest, "modelId" | "promptVersion" | "schemaVersion" | "systemPrompt">,
    options?: DentalUnderstandingOptions,
  ): Promise<Understanding<DentalRequest>> {
    const request = {
      ...input,
      modelId: this.model.modelId,
      promptVersion: DENTAL_UNDERSTANDING_PROMPT_VERSION,
      schemaVersion: UNDERSTANDING_VERSION,
      systemPrompt: DENTAL_UNDERSTANDING_PROMPT,
    };
    const modelOptions = options?.signal
      ? Object.freeze({ signal: options.signal })
      : undefined;
    const rawOutput = await (modelOptions
      ? this.model.generate(request, modelOptions)
      : this.model.generate(request));
    if (rawOutput === null) {
      return rejectContract(options?.onContractRejection, {
        stage: "understanding_structural",
        modelId: this.model.modelId,
        promptVersion: DENTAL_UNDERSTANDING_PROMPT_VERSION,
        contractVersion: UNDERSTANDING_VERSION,
        rawOutput: null,
        issues: [{ path: [], code: "missing_output" }],
      });
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(rawOutput) as unknown;
    } catch {
      return rejectContract(options?.onContractRejection, {
        stage: "understanding_structural",
        modelId: this.model.modelId,
        promptVersion: DENTAL_UNDERSTANDING_PROMPT_VERSION,
        contractVersion: UNDERSTANDING_VERSION,
        rawOutput,
        issues: [{ path: [], code: "invalid_json" }],
      });
    }
    const structural = dentalUnderstandingStructureSchema.safeParse(decoded);
    if (!structural.success) {
      return rejectContract(options?.onContractRejection, {
        stage: "understanding_structural",
        modelId: this.model.modelId,
        promptVersion: DENTAL_UNDERSTANDING_PROMPT_VERSION,
        contractVersion: UNDERSTANDING_VERSION,
        rawOutput,
        issues: structuralIssues(structural.error.issues),
      });
    }
    const parsed = structural.data as Understanding<DentalRequest>;
    const semantic = validateDentalUnderstandingSemantics(parsed);
    if (!semantic.valid) {
      return rejectContract(options?.onContractRejection, {
        stage: "understanding_semantic",
        modelId: this.model.modelId,
        promptVersion: DENTAL_UNDERSTANDING_PROMPT_VERSION,
        contractVersion: UNDERSTANDING_VERSION,
        rawOutput,
        issues: semantic.issues,
      });
    }
    return parsed;
  }
}
