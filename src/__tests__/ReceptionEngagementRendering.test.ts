import { describe, expect, it } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { buildDeterministicDraft } from "@/conversation-core/composer/deterministic-composer";
import { renderDeterministicResponse } from "@/conversation-core/composer/deterministic-renderer";
import { validateDraft } from "@/conversation-core/composer/validator";
import { DENTAL_OUTCOME_SCHEMA } from "@/domain-packs/dental/capabilities";

/**
 * O caminho inteiro, do ActionResult ao texto: plano autorizado, rascunho
 * determinístico, validator e renderer. É onde "oi" vira resposta — ou não vira
 * nada, que foi o comportamento observado em produção.
 */
function renderOutcome(type: "reception_answered" | "clarification_required"): string {
  const plan = buildV2AuthorizedResponsePlan(DENTAL_OUTCOME_SCHEMA, [{
    type,
    semanticClass: type === "reception_answered" ? "engagement_invited" : "clarification_required",
    origin: { capabilityId: "dental-reception" },
    subject: null,
    evidence: [],
    facts: [],
  }] as never);
  const result = validateDraft(plan, buildDeterministicDraft(plan));
  if (!result.valid) throw new Error(`draft rejeitado: ${JSON.stringify(result.violations)}`);
  return renderDeterministicResponse({ draft: result.draft }).text;
}

describe("reception engagement rendering", () => {
  it("welcomes an opener instead of demanding data confirmation", () => {
    expect(renderOutcome("reception_answered")).toBe("Como posso ajudar?");
  });

  it("keeps the data-confirmation wording for a real clarification", () => {
    expect(renderOutcome("clarification_required")).toBe("Pode confirmar os dados?");
  });

  it("produces a non-empty reply for both, which is what silence broke", () => {
    for (const type of ["reception_answered", "clarification_required"] as const) {
      expect(renderOutcome(type).length).toBeGreaterThan(0);
    }
  });
});
