import { APIUserAbortError } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { dentalUnderstandingStructureSchema } from "@/domain-packs/dental/understanding";
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

export class OpenAIDentalUnderstandingModel implements DentalUnderstandingModel {
  constructor(
    private readonly client: OpenAIClientBoundary,
    readonly modelId: string,
  ) {}

  async generate(
    input: DentalUnderstandingModelRequest,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<string | null> {
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
          faqCatalog: input.faqCatalog,
          objectionCatalog: input.objectionCatalog,
        }) },
      ],
      response_format: zodResponseFormat(
        dentalUnderstandingStructureSchema,
        "dental_understanding_v1",
      ),
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
    return response.choices[0]?.message.content ?? null;
  }
}
