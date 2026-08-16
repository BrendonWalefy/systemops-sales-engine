import { describe, expect, it } from "vitest";
import type { DraftResponse, ResponseComposerPort } from "@/conversation-core/composer/contract";
import { runV2ResponsePipeline } from "@/conversation-core/composer/response-pipeline";
import type { ValidatedDraftResponse } from "@/conversation-core/composer/validator";
import { emptyResponsePlanFixture, responsePlanFixture } from "@/__tests__/fixtures/v2-response-plan";

const style = { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" } as const;
const validDraft: DraftResponse = {
  acts: [{ kind: "inform_fact", outcomeRef: "information", factRef: "fact-a", subjectRef: "subject-a" }],
};
const invalidSuccessDraft: DraftResponse = {
  acts: [{ kind: "confirm_effect", outcomeRef: "failed", subjectRef: "subject-a", factRefs: [] }],
};

function composer(draft: DraftResponse): ResponseComposerPort {
  return { compose: async () => draft };
}

function render(draft: ValidatedDraftResponse) {
  return { text: draft.acts.map(({ kind }) => kind).join(","), parts: [] };
}

describe("pipeline de resposta V2", () => {
  it("renderiza o draft original somente depois da validação", async () => {
    await expect(runV2ResponsePipeline({
      plan: responsePlanFixture, style, composer: composer(validDraft), render,
    })).resolves.toEqual({
      status: "rendered", source: "draft",
      response: { text: "inform_fact", parts: [] },
    });
  });

  it("remove ato inválido antes de renderizar o repair", async () => {
    const mixed = { acts: [...validDraft.acts, ...invalidSuccessDraft.acts] };
    const result = await runV2ResponsePipeline({
      plan: responsePlanFixture, style, composer: composer(mixed), render,
    });

    expect(result).toEqual({
      status: "rendered", source: "repair",
      response: { text: "inform_fact", parts: [] },
    });
  });

  it("usa fallback do mesmo plano quando nenhum ato original sobrevive", async () => {
    const result = await runV2ResponsePipeline({
      plan: responsePlanFixture, style, composer: composer(invalidSuccessDraft), render,
    });

    expect(result).toEqual({
      status: "rendered", source: "fallback",
      response: { text: "inform_fact,communicate_failure", parts: [] },
    });
  });

  it("usa fallback do mesmo plano quando o composer falha", async () => {
    const failingComposer: ResponseComposerPort = {
      compose: async () => { throw new Error("composer unavailable"); },
    };

    await expect(runV2ResponsePipeline({
      plan: responsePlanFixture, style, composer: failingComposer, render,
    })).resolves.toEqual(expect.objectContaining({ status: "rendered", source: "fallback" }));
  });

  it("não chama renderer quando não existe resposta segura", async () => {
    let rendered = false;
    const result = await runV2ResponsePipeline({
      plan: emptyResponsePlanFixture,
      style,
      composer: composer({ acts: [{ kind: "communicate_failure", outcomeRef: "missing" }] }),
      render: (draft) => {
        rendered = true;
        return render(draft);
      },
    });

    expect(result.status).toBe("no_safe_response");
    expect(rendered).toBe(false);
  });
});
