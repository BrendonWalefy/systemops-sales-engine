import { describe, expect, it, vi } from "vitest";
import { DentalUnderstandingProvider } from "@/infrastructure/adapters/ai/DentalUnderstandingProvider";
import { OpenAIDentalUnderstandingModel } from "@/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel";

describe("provider dental de Understanding", () => {
  it("mantém linguagem no adapter e valida a saída estruturada", async () => {
    const generate = vi.fn().mockResolvedValue({
      version: "understanding.v1",
      request: "price-of-service",
      dialogueMove: "new_topic",
      entities: { service: "clareamento" },
      signals: {}, safety: {}, confidence: 0.8, ambiguity: null,
    });
    const provider = new DentalUnderstandingProvider({
      modelId: "fake-dental-model",
      generate,
    });

    const output = await provider.understand({
      leadMessage: "qual o valor do clareamento?",
      history: [],
      state: null,
      catalog: [{ id: "svc-1", displayName: "Clareamento", aliases: [] }],
    });

    expect(output.request).toBe("price-of-service");
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      modelId: "fake-dental-model",
      promptVersion: "dental-understanding.v1",
      schemaVersion: "understanding.v1",
    }));
  });

  it("envia json_schema estrito no boundary específico do provider", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      version: "understanding.v1", request: "book-appointment", dialogueMove: "new_topic",
      entities: {}, signals: {}, safety: {}, confidence: 0.8, ambiguity: null,
    }) } }] });
    const model = new OpenAIDentalUnderstandingModel({ chat: { completions: { create } } }, "gpt-test");
    const result = await model.generate({
      modelId: "gpt-test", promptVersion: "dental-understanding.v1",
      schemaVersion: "understanding.v1", systemPrompt: "system", leadMessage: "quero marcar",
      history: [], state: null, catalog: [],
    });

    expect(result).toEqual(expect.objectContaining({ request: "book-appointment" }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-test",
      response_format: expect.objectContaining({ type: "json_schema", json_schema: expect.objectContaining({ strict: true }) }),
    }));
  });
});
