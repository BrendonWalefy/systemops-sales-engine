import type { ConversationState } from "@/conversation-core/capability/contract";
import type { Understanding } from "@/conversation-core/understanding/schema";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";
import { parseDentalUnderstanding } from "@/domain-packs/dental/understanding";
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
};

export type DentalUnderstandingModel = {
  modelId: string;
  generate(input: DentalUnderstandingModelRequest, options?: Readonly<{ signal?: AbortSignal }>): Promise<unknown>;
};

export class DentalUnderstandingProvider {
  constructor(private readonly model: DentalUnderstandingModel) {}

  async understand(
    input: Omit<DentalUnderstandingModelRequest, "modelId" | "promptVersion" | "schemaVersion" | "systemPrompt">,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<Understanding<DentalRequest>> {
    const request = {
      ...input,
      modelId: this.model.modelId,
      promptVersion: DENTAL_UNDERSTANDING_PROMPT_VERSION,
      schemaVersion: UNDERSTANDING_VERSION,
      systemPrompt: DENTAL_UNDERSTANDING_PROMPT,
    };
    const raw = await (options
      ? this.model.generate(request, options)
      : this.model.generate(request));
    return parseDentalUnderstanding(raw);
  }
}
