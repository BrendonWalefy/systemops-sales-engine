import { describe, expect, it } from "vitest";
import type { DraftResponse } from "@/conversation-core/composer/contract";
import { repairDraft } from "@/conversation-core/composer/repair";
import { validateDraft } from "@/conversation-core/composer/validator";
import { responsePlanFixture } from "@/__tests__/fixtures/v2-response-plan";

describe("repair semântico V2", () => {
  it("remove atos inválidos sem criar ou reescrever autoridade", () => {
    const original: DraftResponse = {
      acts: [
        { kind: "inform_fact", outcomeRef: "outcome-0", factRef: "fact-0", subjectRef: "subject-0" },
        { kind: "confirm_effect", outcomeRef: "outcome-1", subjectRef: "subject-0", factRefs: [] },
        { kind: "inform_fact", outcomeRef: "outcome-0", factRef: "missing", subjectRef: "subject-0" },
      ],
    };

    const repaired = repairDraft(responsePlanFixture, original);

    expect(repaired).toEqual({ acts: [original.acts[0]] });
    expect(validateDraft(responsePlanFixture, repaired).valid).toBe(true);
    expect(new Set(repaired.acts.map((act) => act.outcomeRef))).toEqual(new Set(["outcome-0"]));
  });

  it("remove duplicatas sem alterar a ordem dos atos sobreviventes", () => {
    const factAct = { kind: "inform_fact", outcomeRef: "outcome-0", factRef: "fact-0", subjectRef: "subject-0" } as const;
    const failureAct = { kind: "communicate_failure", outcomeRef: "outcome-1" } as const;

    expect(repairDraft(responsePlanFixture, { acts: [factAct, factAct, failureAct] })).toEqual({
      acts: [factAct, failureAct],
    });
  });

  it("copia e congela sobreviventes sem preservar aliases mutáveis", () => {
    const source = {
      kind: "inform_fact",
      outcomeRef: "outcome-0",
      factRef: "fact-0",
      subjectRef: "subject-0",
    } as const;
    const repaired = repairDraft(responsePlanFixture, { acts: [source] });

    Object.assign(source, { factRef: "fabricated" });

    expect(repaired.acts[0]).toEqual({
      kind: "inform_fact",
      outcomeRef: "outcome-0",
      factRef: "fact-0",
      subjectRef: "subject-0",
    });
    expect(Object.isFrozen(repaired)).toBe(true);
    expect(Object.isFrozen(repaired.acts)).toBe(true);
    expect(Object.isFrozen(repaired.acts[0])).toBe(true);
  });
});
