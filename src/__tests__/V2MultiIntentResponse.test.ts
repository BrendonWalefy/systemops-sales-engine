import { describe, expect, it } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { DeterministicResponseComposer } from "@/conversation-core/composer/deterministic-composer";
import { renderDeterministicResponse } from "@/conversation-core/composer/deterministic-renderer";
import { validateDraft } from "@/conversation-core/composer/validator";
import { defineOutcomeSchema } from "@/conversation-core/decision";
import type { ActionResult, Subject } from "@/conversation-core/decision";

const outcomeSchema = defineOutcomeSchema({
  price_ready: { semanticClass: "information_authorized", subjectRequirement: "required", evidenceRequirement: "required" },
  options_found: { semanticClass: "options_found", subjectRequirement: "required", evidenceRequirement: "required" },
  operation_failed: { semanticClass: "effect_failed", subjectRequirement: "required", evidenceRequirement: "required" },
} as const);

const evidence = { source: "read", reference: "snapshot" } as const;
const style = { tone: "neutral", verbosity: "standard", greeting: "omit", emoji: "none" } as const;

function multiIntentPlan(priceSubject: Subject, optionsSubject: Subject) {
  const option = { type: "option", id: "option-1", displayName: "15:00" };
  const results: ActionResult<typeof outcomeSchema>[] = [
    {
      type: "price_ready", semanticClass: "information_authorized", origin: { capabilityId: "catalog" },
      subject: priceSubject, evidence: [evidence],
      facts: [{ key: "amount", value: { kind: "money", amountInMinor: 120000, currency: "BRL" }, subject: priceSubject, evidence, disclosure: "allowed" }],
    },
    {
      type: "options_found", semanticClass: "options_found", origin: { capabilityId: "options" },
      subject: optionsSubject, evidence: [evidence], facts: [],
      options: [{ id: "option-1", subject: option, facts: [{ key: "option_label", value: { kind: "text", value: "15:00" }, subject: option, evidence, disclosure: "allowed" }] }],
    },
  ];
  return buildV2AuthorizedResponsePlan(outcomeSchema, results);
}

describe("resposta multi-intent V2", () => {
  it.each([
    ["mesmo subject", { type: "service", id: "a", displayName: "Limpeza" }, { type: "service", id: "a", displayName: "Limpeza" }, true],
    ["subjects distintos", { type: "service", id: "a", displayName: "Limpeza" }, { type: "service", id: "b", displayName: "Implante" }, false],
  ] as const)("preserva relações para %s", async (_case, priceSubject, optionsSubject, sameSubject) => {
    const plan = multiIntentPlan(priceSubject, optionsSubject);
    const draft = await new DeterministicResponseComposer().compose({ plan, style });
    const validation = validateDraft(plan, draft);
    if (!validation.valid) throw new Error(JSON.stringify(validation.violations));
    const [priceAct, optionsAct] = validation.draft.acts;
    if (priceAct?.kind !== "inform_fact" || optionsAct?.kind !== "offer_options") {
      throw new Error("expected price and options acts");
    }

    expect(priceAct.subjectRef === optionsAct.subjectRef).toBe(sameSubject);
    const text = renderDeterministicResponse({ draft: validation.draft }).text;
    expect(text).toBe(sameSubject
      ? "Valor: R$ 1.200,00. Tenho estas opções: 15:00."
      : "Para Limpeza, valor: R$ 1.200,00. Para Implante, tenho estas opções: 15:00.");
    expect(text).not.toMatch(/\ba\b|\bb\b/);

    const crossLinked = validateDraft(plan, { acts: [{
      ...optionsAct,
      subjectRef: priceAct.subjectRef,
    }] });
    expect(crossLinked.valid).toBe(sameSubject);
    if (!sameSubject && !crossLinked.valid) {
      expect(crossLinked.violations.map(({ code }) => code)).toContain("subject_mismatch");
    }
  });

  it("distingue no texto falhas pertencentes a subjects diferentes", async () => {
    const subjectA = { type: "service", id: "a", displayName: "Limpeza" } as const;
    const subjectB = { type: "service", id: "b", displayName: "Implante" } as const;
    const plan = buildV2AuthorizedResponsePlan(outcomeSchema, [
      {
        type: "operation_failed", semanticClass: "effect_failed", origin: { capabilityId: "operation-a" },
        subject: subjectA, evidence: [evidence], facts: [],
      },
      {
        type: "operation_failed", semanticClass: "effect_failed", origin: { capabilityId: "operation-b" },
        subject: subjectB, evidence: [evidence], facts: [],
      },
    ]);

    const draft = await new DeterministicResponseComposer().compose({ plan, style });
    const validation = validateDraft(plan, draft);
    if (!validation.valid) throw new Error(JSON.stringify(validation.violations));

    expect(renderDeterministicResponse({ draft: validation.draft }).text).toBe(
      "Para Limpeza, não foi possível concluir a ação. Para Implante, não foi possível concluir a ação.",
    );
  });
});
