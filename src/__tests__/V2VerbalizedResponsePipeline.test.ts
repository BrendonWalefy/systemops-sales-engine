import { describe, expect, it, vi } from "vitest";
import type { DraftResponse, ResponseComposerPort } from "@/conversation-core/composer/contract";
import { runV2ResponsePipeline } from "@/conversation-core/composer/response-pipeline";
import type {
  ResponseVerbalizerPort,
  SpeakerProfile,
} from "@/conversation-core/composer/verbalization";
import type { OutcomeTypeOf } from "@/conversation-core/decision";
import {
  emptyResponsePlanFixture,
  RESPONSE_PLAN_FIXTURE_SCHEMA,
  responsePlanFixture,
} from "@/__tests__/fixtures/v2-response-plan";

type FixtureOutcomeType = OutcomeTypeOf<typeof RESPONSE_PLAN_FIXTURE_SCHEMA>;

const style = { tone: "warm", verbosity: "concise", greeting: "omit", emoji: "none" } as const;
const speaker: SpeakerProfile = Object.freeze({
  agentName: "Marina",
  organizationName: "Casa Exemplo",
  specialty: null,
  toneOfVoice: "acolhedor e objetivo",
  guidelines: Object.freeze(["Responder primeiro, perguntar depois."]),
});
const validDraft: DraftResponse = {
  acts: [{ kind: "inform_fact", outcomeRef: "outcome-0", factRef: "fact-0", subjectRef: "subject-0" }],
};
const composer: ResponseComposerPort<FixtureOutcomeType> = { compose: async () => validDraft };

function verbalizer(
  text: unknown,
): ResponseVerbalizerPort & { verbalize: ReturnType<typeof vi.fn> } {
  return { modelId: "model-x", verbalize: vi.fn(async () => text) };
}

describe("verbalização com modelo dentro do pipeline V2", () => {
  it("entrega a prosa do modelo quando ela cabe no plano", async () => {
    const result = await runV2ResponsePipeline({
      plan: responsePlanFixture,
      style,
      composer,
      verbalization: { verbalizer: verbalizer("Fica em 1200, e podemos combinar assim."), speaker },
    });

    expect(result).toMatchObject({
      status: "rendered",
      source: "draft",
      response: { text: "Fica em 1200, e podemos combinar assim." },
      verbalization: { status: "accepted", modelId: "model-x" },
    });
  });

  it("recusa a prosa que inventa preço e entrega o texto determinístico", async () => {
    const result = await runV2ResponsePipeline({
      plan: responsePlanFixture,
      style,
      composer,
      verbalization: { verbalizer: verbalizer("Sai por R$ 2.000,00 hoje."), speaker },
    });

    expect(result).toMatchObject({
      status: "rendered",
      source: "draft",
      response: { text: "Informação: 1200." },
      verbalization: {
        status: "rejected",
        modelId: "model-x",
        violations: ["missing_authorized_value", "unauthorized_number", "unauthorized_currency"],
      },
    });
  });

  it("recusa a prosa que inventa horário", async () => {
    const result = await runV2ResponsePipeline({
      plan: responsePlanFixture,
      style,
      composer,
      verbalization: { verbalizer: verbalizer("Fica em 1200, e consigo quarta às 15h."), speaker },
    });

    expect(result).toMatchObject({
      response: { text: "Informação: 1200." },
      verbalization: { status: "rejected", violations: ["unauthorized_number"] },
    });
  });

  it("recusa a prosa que faz duas perguntas", async () => {
    const result = await runV2ResponsePipeline({
      plan: responsePlanFixture,
      style,
      composer,
      verbalization: { verbalizer: verbalizer("São 1200. Prefere manhã? Qual seu nome?"), speaker },
    });

    expect(result).toMatchObject({
      response: { text: "Informação: 1200." },
      verbalization: { status: "rejected", violations: ["too_many_questions"] },
    });
  });

  it("responde mesmo quando o modelo quebra", async () => {
    const failing: ResponseVerbalizerPort = {
      modelId: "model-x",
      verbalize: async () => { throw new Error("provider down"); },
    };

    const result = await runV2ResponsePipeline({
      plan: responsePlanFixture,
      style,
      composer,
      verbalization: { verbalizer: failing, speaker },
    });

    expect(result).toMatchObject({
      status: "rendered",
      response: { text: "Informação: 1200." },
      verbalization: { status: "failed", modelId: "model-x" },
    });
  });

  it("declara ausência de verbalização quando nenhum modelo foi configurado", async () => {
    const result = await runV2ResponsePipeline({
      plan: responsePlanFixture, style, composer,
    });

    expect(result).toMatchObject({
      status: "rendered",
      response: { text: "Informação: 1200." },
      verbalization: { status: "absent" },
    });
  });

  it("não chama o modelo quando não existe resposta segura", async () => {
    const unused = verbalizer("qualquer coisa");

    const result = await runV2ResponsePipeline({
      plan: emptyResponsePlanFixture,
      style,
      composer: { compose: async () => ({ acts: [] }) },
      verbalization: { verbalizer: unused, speaker },
    });

    expect(result.status).toBe("no_safe_response");
    expect(unused.verbalize).not.toHaveBeenCalled();
  });

  it("entrega ao modelo o texto autorizado e a superfície do plano, nunca o plano cru sozinho", async () => {
    const spy = verbalizer("Fica em 1200, e podemos combinar assim.");

    await runV2ResponsePipeline({
      plan: responsePlanFixture, style, composer, verbalization: { verbalizer: spy, speaker },
    });

    expect(spy.verbalize).toHaveBeenCalledWith(
      expect.objectContaining({
        statements: [{ meaning: "inform_fact", subject: "Item A", values: ["1200"] }],
        surface: expect.objectContaining({ values: ["1200"], currencyAllowed: false }),
        style,
        speaker,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("desiste da verbalização no prazo e responde com o texto autorizado", async () => {
    const stalled: ResponseVerbalizerPort = {
      modelId: "model-x",
      verbalize: () => new Promise(() => {}),
    };

    const result = await runV2ResponsePipeline({
      plan: responsePlanFixture,
      style,
      composer,
      verbalization: { verbalizer: stalled, speaker, timeoutMs: 20 },
    });

    expect(result).toMatchObject({
      status: "rendered",
      response: { text: "Informação: 1200." },
      verbalization: { status: "failed", modelId: "model-x" },
    });
  });

  it("avisa o modelo para parar quando o prazo estoura", async () => {
    let observed: AbortSignal | undefined;
    const stalled: ResponseVerbalizerPort = {
      modelId: "model-x",
      verbalize: (_request, options) => {
        observed = options?.signal;
        return new Promise(() => {});
      },
    };

    await runV2ResponsePipeline({
      plan: responsePlanFixture,
      style,
      composer,
      verbalization: { verbalizer: stalled, speaker, timeoutMs: 20 },
    });
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(observed?.aborted).toBe(true);
  });
});
