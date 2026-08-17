import type { ConversationState } from "@/conversation-core/capability/contract";
import type { Understanding } from "@/conversation-core/understanding/schema";
import type { DentalCatalogEntry, DentalRequest } from "@/domain-packs/dental/vocabulary";
import {
  DentalUnderstandingProvider,
  type LiveDentalUnderstandingModelId,
} from "@/infrastructure/adapters/ai/DentalUnderstandingProvider";
import {
  OpenAIDentalUnderstandingModel,
  type OpenAIClientBoundary,
} from "@/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel";

const LIVE_MODEL_ID = "gpt-4o-mini" satisfies LiveDentalUnderstandingModelId;
const registeredLiveUnderstanding = new WeakSet<LiveDentalUnderstanding>();

export class LiveDentalUnderstanding {
  readonly modelId = LIVE_MODEL_ID;

  private constructor(
    private readonly provider: DentalUnderstandingProvider,
  ) {}

  static create(client: OpenAIClientBoundary): LiveDentalUnderstanding {
    const boundary = new LiveDentalUnderstanding(
      new DentalUnderstandingProvider(
        new OpenAIDentalUnderstandingModel(client, LIVE_MODEL_ID),
      ),
    );
    registeredLiveUnderstanding.add(boundary);
    Object.freeze(boundary);
    return boundary;
  }

  understand(input: {
    leadMessage: string;
    history: readonly { author: "lead" | "agent"; body: string }[];
    state: ConversationState | null;
    catalog: readonly DentalCatalogEntry[];
  }): Promise<Understanding<DentalRequest>> {
    return this.provider.understand(input);
  }
}

export function createLiveDentalUnderstanding(
  client: OpenAIClientBoundary,
): LiveDentalUnderstanding {
  return LiveDentalUnderstanding.create(client);
}

export function assertRegisteredLiveDentalUnderstanding(
  value: LiveDentalUnderstanding,
): void {
  if (!registeredLiveUnderstanding.has(value)) {
    throw new Error("unregistered live dental understanding provider");
  }
}
