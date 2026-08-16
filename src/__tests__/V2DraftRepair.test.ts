import { describe, expect, it } from "vitest";
import type { DraftResponse } from "@/conversation-core/composer/contract";
import { repairDraft } from "@/conversation-core/composer/repair";
import { validateDraft } from "@/conversation-core/composer/validator";
import { responsePlanFixture } from "@/__tests__/fixtures/v2-response-plan";

describe("repair semântico V2", () => {
  it("remove atos inválidos sem criar ou reescrever autoridade", () => {
    const original: DraftResponse = {
      acts: [
        { kind: "inform_fact", outcomeRef: "information", factRef: "fact-a", subjectRef: "subject-a" },
        { kind: "confirm_effect", outcomeRef: "failed", subjectRef: "subject-a", factRefs: [] },
        { kind: "inform_fact", outcomeRef: "information", factRef: "missing", subjectRef: "subject-a" },
      ],
    };

    const repaired = repairDraft(responsePlanFixture, original);

    expect(repaired).toEqual({ acts: [original.acts[0]] });
    expect(validateDraft(responsePlanFixture, repaired).valid).toBe(true);
    expect(new Set(repaired.acts.map((act) => act.outcomeRef))).toEqual(new Set(["information"]));
  });

  it("remove duplicatas sem alterar a ordem dos atos sobreviventes", () => {
    const factAct = { kind: "inform_fact", outcomeRef: "information", factRef: "fact-a", subjectRef: "subject-a" } as const;
    const failureAct = { kind: "communicate_failure", outcomeRef: "failed" } as const;

    expect(repairDraft(responsePlanFixture, { acts: [factAct, factAct, failureAct] })).toEqual({
      acts: [factAct, failureAct],
    });
  });
});
