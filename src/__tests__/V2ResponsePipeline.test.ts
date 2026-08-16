import { describe, expect, it } from "vitest";
import type { DraftResponse, ResponseComposerPort } from "@/conversation-core/composer/contract";
import { createResponseLanguageContribution } from "@/conversation-core/composer/language";
import { runV2ResponsePipeline } from "@/conversation-core/composer/response-pipeline";
import { emptyResponsePlanFixture, responsePlanFixture } from "@/__tests__/fixtures/v2-response-plan";

const style = { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" } as const;
const language = createResponseLanguageContribution({
  locale: "pt-BR",
  factTerms: [{ factKey: "amount", label: "Valor", format: "integer" }],
  outcomeTerms: [
    { outcomeType: "quote-ready", label: "cotação", gender: "feminine" },
    { outcomeType: "operation-failed", label: "operação", gender: "feminine" },
  ],
  subjectTerms: [{ subjectType: "item", label: "item" }],
});
const validDraft: DraftResponse = {
  acts: [{ kind: "inform_fact", outcomeRef: "information", factRef: "fact-a", subjectRef: "subject-a" }],
};
const invalidSuccessDraft: DraftResponse = {
  acts: [{ kind: "confirm_effect", outcomeRef: "failed", subjectRef: "subject-a", factRefs: [] }],
};

function composer(draft: DraftResponse): ResponseComposerPort {
  return { compose: async () => draft };
}

describe("pipeline de resposta V2", () => {
  it("renderiza o draft original somente depois da validação", async () => {
    await expect(runV2ResponsePipeline({
      plan: responsePlanFixture, style, language, composer: composer(validDraft),
    })).resolves.toEqual({
      status: "rendered", source: "draft",
      response: { text: "Valor: 1200.", parts: [] },
    });
  });

  it("remove ato inválido antes de renderizar o repair", async () => {
    const mixed = { acts: [...validDraft.acts, ...invalidSuccessDraft.acts] };
    const result = await runV2ResponsePipeline({
      plan: responsePlanFixture, style, language, composer: composer(mixed),
    });

    expect(result).toEqual({
      status: "rendered", source: "repair",
      response: { text: "Valor: 1200.", parts: [] },
    });
  });

  it("usa fallback do mesmo plano quando nenhum ato original sobrevive", async () => {
    const result = await runV2ResponsePipeline({
      plan: responsePlanFixture, style, language, composer: composer(invalidSuccessDraft),
    });

    expect(result).toEqual({
      status: "rendered", source: "fallback",
      response: { text: "Valor: 1200. Não foi possível concluir operação.", parts: [] },
    });
  });

  it("usa fallback do mesmo plano quando o composer falha", async () => {
    const failingComposer: ResponseComposerPort = {
      compose: async () => { throw new Error("composer unavailable"); },
    };

    await expect(runV2ResponsePipeline({
      plan: responsePlanFixture, style, language, composer: failingComposer,
    })).resolves.toEqual(expect.objectContaining({ status: "rendered", source: "fallback" }));
  });

  it("não renderiza quando não existe resposta segura", async () => {
    await expect(runV2ResponsePipeline({
      plan: emptyResponsePlanFixture,
      style,
      language,
      composer: composer({ acts: [{ kind: "communicate_failure", outcomeRef: "missing" }] }),
    })).resolves.toEqual(expect.objectContaining({
      status: "no_safe_response",
      reason: "no_valid_draft",
    }));
  });

  it("falha fechado quando a linguagem não cobre o material validado", async () => {
    const emptyLanguage = createResponseLanguageContribution({
      locale: "pt-BR", factTerms: [], outcomeTerms: [], subjectTerms: [],
    });

    await expect(runV2ResponsePipeline({
      plan: responsePlanFixture, style, language: emptyLanguage, composer: composer(validDraft),
    })).resolves.toEqual(expect.objectContaining({
      status: "no_safe_response",
      reason: "render_failed",
    }));
  });
});
