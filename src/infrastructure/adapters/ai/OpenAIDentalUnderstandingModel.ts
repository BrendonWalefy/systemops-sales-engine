import { APIUserAbortError } from "openai";
import { DENTAL_REQUESTS } from "@/domain-packs/dental/vocabulary";
import type { DentalUnderstandingModel, DentalUnderstandingModelRequest } from "@/infrastructure/adapters/ai/DentalUnderstandingProvider";

export type OpenAIClientBoundary = {
  chat: {
    completions: {
      create(
        input: unknown,
        options?: Readonly<{ signal?: AbortSignal }>,
      ): Promise<{ choices: { message: { content: string | null } }[] }>;
    };
  };
};

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", enum: ["understanding.v1"] },
    request: { type: "string", enum: DENTAL_REQUESTS },
    dialogueMove: { type: "string", enum: ["new_topic", "answers_pending", "acknowledges", "repeats", "closes"] },
    entities: {
      type: "object", additionalProperties: false,
      properties: {
        service: { type: ["string", "null"] }, date: { type: ["string", "null"] },
        period: { type: ["string", "null"] }, time: { type: ["string", "null"] },
        serviceCandidates: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
        quantity: { type: ["number", "null"] }, ordinal: { type: ["number", "null"] },
      },
      required: ["service", "date", "period", "time", "serviceCandidates", "quantity", "ordinal"],
    },
    signals: {
      type: "object", additionalProperties: false,
      properties: {
        purchaseIntent: { anyOf: [{ type: "string", enum: ["low", "medium", "high"] }, { type: "null" }] },
        priceSensitivity: { anyOf: [{ type: "string", enum: ["low", "medium", "high"] }, { type: "null" }] },
        sentiment: { anyOf: [{ type: "string", enum: ["negative", "neutral", "positive"] }, { type: "null" }] },
        objection: { type: ["string", "null"] },
      },
      required: ["purchaseIntent", "priceSensitivity", "sentiment", "objection"],
    },
    safety: {
      type: "object", additionalProperties: false,
      properties: { optOut: { type: "boolean" }, requestsHuman: { type: "boolean" }, emergency: { type: "boolean" } },
      required: ["optOut", "requestsHuman", "emergency"],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    ambiguity: { anyOf: [
      { type: "null" },
      { type: "object", additionalProperties: false, properties: { kind: { type: "string" }, candidates: { type: "array", minItems: 2, items: { type: "string" } } }, required: ["kind", "candidates"] },
    ] },
  },
  required: ["version", "request", "dialogueMove", "entities", "signals", "safety", "confidence", "ambiguity"],
} as const;

export class OpenAIDentalUnderstandingModel implements DentalUnderstandingModel {
  constructor(
    private readonly client: OpenAIClientBoundary,
    readonly modelId: string,
  ) {}

  async generate(
    input: DentalUnderstandingModelRequest,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<unknown> {
    const request = {
      model: this.modelId,
      temperature: 0,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: JSON.stringify({
          leadMessage: input.leadMessage,
          history: input.history,
          state: input.state,
          catalog: input.catalog,
        }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "dental_understanding_v1", strict: true, schema: responseSchema },
      },
    };
    let response: Awaited<ReturnType<OpenAIClientBoundary["chat"]["completions"]["create"]>>;
    try {
      response = await (options?.signal
        ? this.client.chat.completions.create(request, { signal: options.signal })
        : this.client.chat.completions.create(request));
    } catch (error) {
      if (options?.signal?.aborted && error instanceof APIUserAbortError) {
        throw options.signal.reason;
      }
      throw error;
    }
    const content = response.choices[0]?.message.content;
    if (!content) throw new Error("OpenAI returned no dental understanding output");
    return JSON.parse(content);
  }
}
