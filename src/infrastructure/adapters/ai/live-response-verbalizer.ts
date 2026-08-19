import { APIUserAbortError } from "openai";
import type { ResponseVerbalizerPort, VerbalizationRequest } from "@/conversation-core/composer/verbalization";
import type { OpenAIClientBoundary } from "@/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel";
import {
  RESPONSE_VERBALIZATION_PROMPT,
  RESPONSE_VERBALIZATION_PROMPT_VERSION,
} from "@/infrastructure/adapters/ai/response-verbalization-prompt";

export const LIVE_RESPONSE_VERBALIZER_MODEL_IDS = Object.freeze(["gpt-4o-mini"] as const);

export type LiveResponseVerbalizerModelId =
  (typeof LIVE_RESPONSE_VERBALIZER_MODEL_IDS)[number];

const LIVE_MODEL_ID = "gpt-4o-mini" satisfies LiveResponseVerbalizerModelId;
const registered = new WeakSet<LiveResponseVerbalizer>();

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: { text: { type: "string" } },
  required: ["text"],
} as const;

export class LiveResponseVerbalizer implements ResponseVerbalizerPort<string> {
  readonly modelId = LIVE_MODEL_ID;
  readonly promptVersion = RESPONSE_VERBALIZATION_PROMPT_VERSION;

  private constructor(private readonly client: OpenAIClientBoundary) {}

  static create(client: OpenAIClientBoundary): LiveResponseVerbalizer {
    const boundary = new LiveResponseVerbalizer(client);
    registered.add(boundary);
    Object.freeze(boundary);
    return boundary;
  }

  async verbalize(
    request: VerbalizationRequest<string>,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<string> {
    assertRegisteredLiveResponseVerbalizer(this);
    // A frase determinística existe como saída segura, não como rascunho: mandá-la
    // ao modelo faz ele copiar o vocabulário da máquina em vez de dizer o sentido.
    const payload = {
      statements: request.statements.map((statement) => ({
        meaning: statement.meaning,
        subject: statement.subject,
        values: [...statement.values],
      })),
      allowedNumbers: [...request.surface.numbers],
      moneyNumbers: [...request.surface.moneyNumbers],
      allowedCurrency: request.surface.currencyAllowed,
      maxQuestions: request.surface.maxQuestions,
      maxCharacters: request.surface.maxCharacters,
      style: request.style,
      speaker: {
        agentName: request.speaker.agentName,
        organizationName: request.speaker.organizationName,
        specialty: request.speaker.specialty,
        toneOfVoice: request.speaker.toneOfVoice,
        guidelines: [...request.speaker.guidelines],
      },
    };
    const input = {
      model: this.modelId,
      temperature: 0.4,
      messages: [
        { role: "system", content: RESPONSE_VERBALIZATION_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "response_verbalization_v1", strict: true, schema: responseSchema },
      },
    };
    let response: Awaited<ReturnType<OpenAIClientBoundary["chat"]["completions"]["create"]>>;
    try {
      response = await (options?.signal
        ? this.client.chat.completions.create(input, { signal: options.signal })
        : this.client.chat.completions.create(input));
    } catch (error) {
      if (options?.signal?.aborted && error instanceof APIUserAbortError) {
        throw options.signal.reason;
      }
      throw error;
    }
    const content = response.choices[0]?.message.content;
    if (!content) throw new Error("OpenAI returned no verbalization output");
    const parsed: unknown = JSON.parse(content);
    if (
      typeof parsed !== "object" || parsed === null
      || typeof (parsed as { text?: unknown }).text !== "string"
    ) {
      throw new Error("OpenAI returned an unusable verbalization payload");
    }
    return (parsed as { text: string }).text;
  }
}

export function createLiveResponseVerbalizer(
  client: OpenAIClientBoundary,
): LiveResponseVerbalizer {
  return LiveResponseVerbalizer.create(client);
}

export function assertRegisteredLiveResponseVerbalizer(
  value: LiveResponseVerbalizer,
): void {
  if (!registered.has(value)) {
    throw new Error("unregistered live response verbalizer");
  }
}
