import { describe, expect, it } from "vitest";
import { buildSafeFallback } from "@/conversation-core/composer/fallback";
import { validateDraft } from "@/conversation-core/composer/validator";
import { emptyResponsePlanFixture, responsePlanFixture } from "@/__tests__/fixtures/v2-response-plan";

describe("fallback semântico V2", () => {
  it("usa somente outcomes e facts presentes no plano", () => {
    const fallback = buildSafeFallback(responsePlanFixture);

    expect(fallback).not.toBeNull();
    expect(fallback?.acts).toEqual([
      { kind: "inform_fact", outcomeRef: "information", factRef: "fact-a", subjectRef: "subject-a" },
      { kind: "communicate_failure", outcomeRef: "failed" },
    ]);
    expect(fallback && validateDraft(responsePlanFixture, fallback).valid).toBe(true);
  });

  it("não cria texto sem autoridade renderizável", () => {
    expect(buildSafeFallback(emptyResponsePlanFixture)).toBeNull();
  });
});
