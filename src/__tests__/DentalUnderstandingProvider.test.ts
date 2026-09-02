import { describe, expect, it, vi } from "vitest";
import { APIUserAbortError } from "openai";
import { DentalUnderstandingProvider } from "@/infrastructure/adapters/ai/DentalUnderstandingProvider";
import { OpenAIDentalUnderstandingModel } from "@/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel";

function validUnderstanding(overrides: Record<string, unknown> = {}) {
  return {
    version: "understanding.v1",
    request: "price-of-service",
    dialogueMove: "new_topic",
    entities: {
      service: "clareamento",
      businessInformationTopic: null,
      date: null,
      period: null,
      time: null,
      professional: null,
      serviceCandidates: null,
      faqQuestion: null,
      quantity: null,
      quantityScope: null,
      objectionQuestion: null,
      ordinal: null,
    },
    signals: {
      purchaseIntent: null,
      priceSensitivity: null,
      sentiment: null,
      objection: null,
    },
    safety: { optOut: false, requestsHuman: false, emergency: false },
    confidence: 0.8,
    ambiguity: null,
    ...overrides,
  };
}

const understandingInput = {
  leadMessage: "qual o valor do clareamento?",
  history: [],
  state: null,
  catalog: [{ id: "svc-1", displayName: "Clareamento", aliases: [] }],
  faqCatalog: ["Preciso de encaminhamento?"],
  objectionCatalog: ["Está caro para mim"],
  professionalCatalog: ["Dra. Marina"],
};

async function captureThrown(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected understanding to reject");
}

describe("provider dental de Understanding", () => {
  it("mantém linguagem no adapter e valida a saída estruturada", async () => {
    const generate = vi.fn().mockResolvedValue(JSON.stringify({
      version: "understanding.v1",
      request: "price-of-service",
      dialogueMove: "new_topic",
      entities: { service: "clareamento", businessInformationTopic: null, date: null, period: null, time: null, professional: null, serviceCandidates: null, faqQuestion: null, quantity: null, quantityScope: null, objectionQuestion: null, ordinal: null },
      signals: { purchaseIntent: null, priceSensitivity: null, sentiment: null, objection: null },
      safety: { optOut: false, requestsHuman: false, emergency: false },
      confidence: 0.8,
      ambiguity: null,
    }));
    const provider = new DentalUnderstandingProvider({
      modelId: "fake-dental-model",
      generate,
    });

    const output = await provider.understand({
      leadMessage: "qual o valor do clareamento?",
      history: [],
      state: null,
      catalog: [{ id: "svc-1", displayName: "Clareamento", aliases: [] }],
      faqCatalog: ["Preciso de encaminhamento?"],
      objectionCatalog: ["Está caro para mim"],
      professionalCatalog: ["Dra. Marina"],
    });

    expect(output.request).toBe("price-of-service");
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      modelId: "fake-dental-model",
      promptVersion: "dental-understanding.v7",
      schemaVersion: "understanding.v1",
      faqCatalog: ["Preciso de encaminhamento?"],
      objectionCatalog: ["Está caro para mim"],
      professionalCatalog: ["Dra. Marina"],
    }));
  });

  it("envia json_schema estrito no boundary específico do provider", async () => {
    const rawOutput = JSON.stringify({
      version: "understanding.v1", request: "book-appointment", dialogueMove: "new_topic",
      entities: { service: null, businessInformationTopic: null, date: null, period: null, time: null, professional: "Dra. Marina", serviceCandidates: null, faqQuestion: null, quantity: null, quantityScope: null, objectionQuestion: null, ordinal: null },
      signals: { purchaseIntent: null, priceSensitivity: null, sentiment: null, objection: null },
      safety: { optOut: false, requestsHuman: false, emergency: false }, confidence: 0.8, ambiguity: null,
    });
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: rawOutput } }] });
    const model = new OpenAIDentalUnderstandingModel({ chat: { completions: { create } } }, "gpt-test");
    const result = await model.generate({
      modelId: "gpt-test", promptVersion: "dental-understanding.v7",
      schemaVersion: "understanding.v1", systemPrompt: "system", leadMessage: "quero marcar",
      history: [], state: null, catalog: [], faqCatalog: ["Aceita convênio?"], objectionCatalog: ["Está caro para mim"], professionalCatalog: ["Dra. Marina"],
    });

    expect(result).toBe(rawOutput);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-test",
      response_format: expect.objectContaining({ type: "json_schema", json_schema: expect.objectContaining({ strict: true }) }),
    }));
    const request = create.mock.calls[0]![0];
    expect(request.response_format.json_schema.schema.properties.entities.additionalProperties).toBe(false);
    expect(request.response_format.json_schema.schema.properties.signals.additionalProperties).toBe(false);
    expect(request.response_format.json_schema.schema.properties.safety.additionalProperties).toBe(false);
    const userInput = JSON.parse(request.messages[1].content);
    expect(userInput.faqCatalog).toEqual(["Aceita convênio?"]);
    expect(userInput.objectionCatalog).toEqual(["Está caro para mim"]);
    expect(userInput.professionalCatalog).toEqual(["Dra. Marina"]);
    expect(userInput).not.toHaveProperty("faqAnswers");
    expect(JSON.stringify(userInput)).not.toContain("Podemos parcelar");
  });

  it("encaminha o AbortSignal ao client OpenAI", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      version: "understanding.v1", request: "book-appointment", dialogueMove: "new_topic",
      entities: { service: null, businessInformationTopic: null, date: null, period: null, time: null, professional: null, serviceCandidates: null, faqQuestion: null, quantity: null, quantityScope: null, objectionQuestion: null, ordinal: null },
      signals: { purchaseIntent: null, priceSensitivity: null, sentiment: null, objection: null },
      safety: { optOut: false, requestsHuman: false, emergency: false }, confidence: 0.8, ambiguity: null,
    }) } }] });
    const controller = new AbortController();
    const model = new OpenAIDentalUnderstandingModel(
      { chat: { completions: { create } } },
      "gpt-test",
    );

    await model.generate({
      modelId: "gpt-test", promptVersion: "dental-understanding.v7",
      schemaVersion: "understanding.v1", systemPrompt: "system", leadMessage: "quero marcar",
      history: [], state: null, catalog: [], faqCatalog: [], objectionCatalog: [], professionalCatalog: [],
    }, { signal: controller.signal });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-test" }),
      { signal: controller.signal },
    );
  });

  it("normaliza o abort tipado do SDK para o reason exato do signal", async () => {
    const create = vi.fn().mockRejectedValue(new APIUserAbortError());
    const reason = new Error("shadow admission deadline reached");
    const controller = new AbortController();
    controller.abort(reason);
    const model = new OpenAIDentalUnderstandingModel(
      { chat: { completions: { create } } },
      "gpt-test",
    );

    const run = model.generate({
      modelId: "gpt-test", promptVersion: "dental-understanding.v7",
      schemaVersion: "understanding.v1", systemPrompt: "system", leadMessage: "quero marcar",
      history: [], state: null, catalog: [], faqCatalog: [], objectionCatalog: [], professionalCatalog: [],
    }, { signal: controller.signal });

    await expect(run).rejects.toBe(reason);
  });

  it("observes missing output before throwing a metadata-only typed rejection", async () => {
    const onContractRejection = vi.fn().mockResolvedValue(undefined);
    const provider = new DentalUnderstandingProvider({
      modelId: "fake-dental-model",
      generate: vi.fn().mockResolvedValue(null),
    });

    const error = await captureThrown(() => provider.understand(
      understandingInput,
      { onContractRejection } as never,
    ));

    expect(onContractRejection).toHaveBeenCalledWith({
      stage: "understanding_structural",
      modelId: "fake-dental-model",
      promptVersion: "dental-understanding.v7",
      contractVersion: "understanding.v1",
      rawOutput: null,
      issues: [{ path: [], code: "missing_output" }],
    });
    expect(error).toMatchObject({
      name: "DentalUnderstandingContractRejectionError",
      stage: "understanding_structural",
      issues: [{ path: [], code: "missing_output" }],
    });
    expect(JSON.stringify(error)).not.toContain("qual o valor");
  });

  it("captures invalid JSON only through the rejection observer", async () => {
    const rawOutput = "{private rejected model output";
    const onContractRejection = vi.fn().mockResolvedValue(undefined);
    const provider = new DentalUnderstandingProvider({
      modelId: "fake-dental-model",
      generate: vi.fn().mockResolvedValue(rawOutput),
    });

    const error = await captureThrown(() => provider.understand(
      understandingInput,
      { onContractRejection } as never,
    ));

    expect(onContractRejection).toHaveBeenCalledWith(expect.objectContaining({
      stage: "understanding_structural",
      rawOutput,
      issues: [{ path: [], code: "invalid_json" }],
    }));
    expect(JSON.stringify(error)).not.toContain(rawOutput);
  });

  it.each([
    ["required", { entities: undefined }, "schema_required"],
    ["type", { confidence: "high" }, "schema_type_mismatch"],
    ["unknown key", { unexpectedPrivateKey: "private" }, "schema_unknown_key"],
    ["enum", { request: "invented-request" }, "schema_enum"],
    ["range", { confidence: 9 }, "schema_range"],
  ] as const)("maps a structural %s issue to the closed rejection vocabulary", async (
    _label,
    overrides,
    expectedCode,
  ) => {
    const rawOutput = JSON.stringify(validUnderstanding(overrides));
    const onContractRejection = vi.fn().mockResolvedValue(undefined);
    const provider = new DentalUnderstandingProvider({
      modelId: "fake-dental-model",
      generate: vi.fn().mockResolvedValue(rawOutput),
    });

    const error = await captureThrown(() => provider.understand(
      understandingInput,
      { onContractRejection } as never,
    ));

    expect(onContractRejection).toHaveBeenCalledWith(expect.objectContaining({
      stage: "understanding_structural",
      rawOutput,
      issues: expect.arrayContaining([expect.objectContaining({ code: expectedCode })]),
    }));
    expect(error).toMatchObject({
      name: "DentalUnderstandingContractRejectionError",
      stage: "understanding_structural",
    });
    expect(JSON.stringify(error)).not.toContain(rawOutput);
  });

  it("never exposes an untrusted unknown-key name in structural issue metadata", async () => {
    const privateUnknownKey = "patient-phone-5511999999999";
    const rawOutput = JSON.stringify(validUnderstanding({
      [privateUnknownKey]: "private",
    }));
    const onContractRejection = vi.fn().mockResolvedValue(undefined);
    const provider = new DentalUnderstandingProvider({
      modelId: "fake-dental-model",
      generate: vi.fn().mockResolvedValue(rawOutput),
    });

    const error = await captureThrown(() => provider.understand(
      understandingInput,
      { onContractRejection } as never,
    ));

    const observed = onContractRejection.mock.calls[0]?.[0];
    expect(observed.issues).toContainEqual({
      path: [],
      code: "schema_unknown_key",
    });
    expect(JSON.stringify(observed.issues)).not.toContain(privateUnknownKey);
    expect(JSON.stringify(error)).not.toContain(privateUnknownKey);
  });

  it("captures a semantic rejection separately from structural parsing", async () => {
    const rawOutput = JSON.stringify(validUnderstanding({
      entities: { ...validUnderstanding().entities, service: null },
    }));
    const onContractRejection = vi.fn().mockResolvedValue(undefined);
    const provider = new DentalUnderstandingProvider({
      modelId: "fake-dental-model",
      generate: vi.fn().mockResolvedValue(rawOutput),
    });

    const error = await captureThrown(() => provider.understand(
      understandingInput,
      { onContractRejection } as never,
    ));

    expect(onContractRejection).toHaveBeenCalledWith(expect.objectContaining({
      stage: "understanding_semantic",
      rawOutput,
      issues: [{
        path: ["entities", "service"],
        code: "service_required_for_request",
      }],
    }));
    expect(error).toMatchObject({
      name: "DentalUnderstandingContractRejectionError",
      stage: "understanding_semantic",
    });
    expect(JSON.stringify(error)).not.toContain(rawOutput);
  });

  it("does not observe provider failures and keeps rejection recording best-effort", async () => {
    const providerFailure = Object.assign(new Error("provider unavailable"), { status: 503 });
    const onProviderFailure = vi.fn();
    const failedProvider = new DentalUnderstandingProvider({
      modelId: "fake-dental-model",
      generate: vi.fn().mockRejectedValue(providerFailure),
    });

    await expect(failedProvider.understand(
      understandingInput,
      { onContractRejection: onProviderFailure } as never,
    )).rejects.toBe(providerFailure);
    expect(onProviderFailure).not.toHaveBeenCalled();

    const rejectedProvider = new DentalUnderstandingProvider({
      modelId: "fake-dental-model",
      generate: vi.fn().mockResolvedValue("not-json"),
    });
    await expect(rejectedProvider.understand(
      understandingInput,
      { onContractRejection: vi.fn().mockRejectedValue(new Error("recorder down")) } as never,
    )).rejects.toMatchObject({
      name: "DentalUnderstandingContractRejectionError",
      stage: "understanding_structural",
    });
  });
});
