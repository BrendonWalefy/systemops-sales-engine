import { DENTAL_REQUESTS } from "@/domain-packs/dental/vocabulary";
import type { DentalUnderstandingModel, DentalUnderstandingModelRequest } from "@/infrastructure/adapters/ai/DentalUnderstandingProvider";

type OpenAIClientBoundary = {
  chat: {
    completions: {
      create(input: unknown): Promise<{ choices: { message: { content: string | null } }[] }>;
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
    entities: { type: "object", additionalProperties: { anyOf: [{ type: "string" }, { type: "number" }, { type: "array", items: { type: "string" } }, { type: "null" }] } },
    signals: { type: "object", additionalProperties: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] } },
    safety: { type: "object", additionalProperties: { type: "boolean" } },
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

  async generate(input: DentalUnderstandingModelRequest): Promise<unknown> {
    const response = await this.client.chat.completions.create({
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
    });
    const content = response.choices[0]?.message.content;
    if (!content) throw new Error("OpenAI returned no dental understanding output");
    return JSON.parse(content);
  }
}
