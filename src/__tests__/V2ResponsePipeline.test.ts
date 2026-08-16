import { describe, expect, expectTypeOf, it } from "vitest";
import type { DraftResponse, ResponseComposerPort } from "@/conversation-core/composer/contract";
import type { OutcomeTypeOf } from "@/conversation-core/decision";
import { runV2ResponsePipeline } from "@/conversation-core/composer/response-pipeline";
import {
  emptyResponsePlanFixture,
  RESPONSE_PLAN_FIXTURE_SCHEMA,
  responsePlanFixture,
} from "@/__tests__/fixtures/v2-response-plan";

type FixtureOutcomeType = OutcomeTypeOf<typeof RESPONSE_PLAN_FIXTURE_SCHEMA>;

const style = { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" } as const;
const validDraft: DraftResponse = {
  acts: [{ kind: "inform_fact", outcomeRef: "outcome-0", factRef: "fact-0", subjectRef: "subject-0" }],
};
const invalidSuccessDraft: DraftResponse = {
  acts: [{ kind: "confirm_effect", outcomeRef: "outcome-1", subjectRef: "subject-0", factRefs: [] }],
};

function composer(draft: DraftResponse): ResponseComposerPort<FixtureOutcomeType> {
  return { compose: async () => draft };
}

describe("pipeline de resposta V2", () => {
  it("renderiza o draft original somente depois da validação", async () => {
    await expect(runV2ResponsePipeline({
      plan: responsePlanFixture, style, composer: composer(validDraft),
    })).resolves.toEqual({
      status: "rendered", source: "draft",
      response: { text: "Informação: 1200.", parts: [] },
    });
  });

  it("remove ato inválido antes de renderizar o repair", async () => {
    const mixed = { acts: [...validDraft.acts, ...invalidSuccessDraft.acts] };
    const result = await runV2ResponsePipeline({
      plan: responsePlanFixture, style, composer: composer(mixed),
    });

    expect(result).toEqual({
      status: "rendered", source: "repair",
      response: { text: "Informação: 1200.", parts: [] },
    });
  });

  it("usa fallback do mesmo plano quando nenhum ato original sobrevive", async () => {
    const result = await runV2ResponsePipeline({
      plan: responsePlanFixture, style, composer: composer(invalidSuccessDraft),
    });

    expect(result).toEqual({
      status: "rendered", source: "fallback",
      response: { text: "Informação: 1200. Não foi possível concluir a ação.", parts: [] },
    });
  });

  it("usa fallback do mesmo plano quando o composer falha", async () => {
    const failingComposer: ResponseComposerPort<FixtureOutcomeType> = {
      compose: async () => { throw new Error("composer unavailable"); },
    };

    await expect(runV2ResponsePipeline({
      plan: responsePlanFixture, style, composer: failingComposer,
    })).resolves.toEqual(expect.objectContaining({ status: "rendered", source: "fallback" }));
  });

  it("não renderiza quando não existe resposta segura", async () => {
    await expect(runV2ResponsePipeline({
      plan: emptyResponsePlanFixture,
      style,
      composer: composer({ acts: [{ kind: "communicate_failure", outcomeRef: "missing" }] }),
    })).resolves.toEqual(expect.objectContaining({
      status: "no_safe_response",
      reason: "no_valid_draft",
    }));
  });

  it("não expõe contribuição lexical na boundary da pipeline", () => {
    expectTypeOf<Parameters<typeof runV2ResponsePipeline>[0]>()
      .not.toHaveProperty("language");
  });

  it("impede o composer de ampliar autoridade mutando o plano recebido", async () => {
    const mutatingComposer: ResponseComposerPort<FixtureOutcomeType> = {
      compose: async ({ plan }) => {
        const mutable = plan as unknown as {
          facts: { ref: string; key: string; value: { kind: "integer"; value: number }; subjectRef: string; evidenceRef: string; disclosure: "allowed" }[];
          outcomes: { ref: string; factRefs: string[] }[];
        };
        mutable.facts.push({
          ref: "fact-injected", key: "discount", value: { kind: "integer", value: 50 },
          subjectRef: "subject-0", evidenceRef: "evidence-a", disclosure: "allowed",
        });
        mutable.outcomes[0]!.factRefs.push("fact-injected");
        return {
          acts: [{
            kind: "inform_fact", outcomeRef: "outcome-0",
            factRef: "fact-injected", subjectRef: "subject-0",
          }],
        };
      },
    };

    const result = await runV2ResponsePipeline({
      plan: responsePlanFixture,
      style,
      composer: mutatingComposer,
    });

    expect(result).toEqual(expect.objectContaining({ status: "rendered", source: "fallback" }));
    if (result.status !== "rendered") throw new Error("expected safe fallback");
    expect(result.response.text).not.toContain("Desconto");
    expect(responsePlanFixture.facts).toHaveLength(2);
  });
});
