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
} as const);

const evidence = { source: "read", reference: "snapshot" } as const;
const style = { tone: "neutral", verbosity: "standard", greeting: "omit", emoji: "none" } as const;

function multiIntentPlan(priceSubject: Subject, optionsSubject: Subject) {
  const option = { type: "option", id: "option-1" };
  const results: ActionResult<typeof outcomeSchema>[] = [
    {
      type: "price_ready", semanticClass: "information_authorized", origin: { capabilityId: "catalog" },
      subject: priceSubject, evidence: [evidence],
      facts: [{ key: "amount", value: 120000, subject: priceSubject, evidence, disclosure: "allowed" }],
    },
    {
      type: "options_found", semanticClass: "options_found", origin: { capabilityId: "options" },
      subject: optionsSubject, evidence: [evidence], facts: [],
      options: [{ id: "option-1", subject: option, facts: [{ key: "option_label", value: "15:00", subject: option, evidence, disclosure: "allowed" }] }],
    },
  ];
  return buildV2AuthorizedResponsePlan(outcomeSchema, results);
}

describe("resposta multi-intent V2", () => {
  it.each([
    ["mesmo subject", { type: "resource", id: "a" }, { type: "resource", id: "a" }, true],
    ["subjects distintos", { type: "resource", id: "a" }, { type: "resource", id: "b" }, false],
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
    expect(renderDeterministicResponse({ draft: validation.draft }).text)
      .toBe("Informação: 120000. Tenho estas opções: 15:00.");

    const crossLinked = validateDraft(plan, { acts: [{
      ...optionsAct,
      subjectRef: priceAct.subjectRef,
    }] });
    expect(crossLinked.valid).toBe(sameSubject);
    if (!sameSubject && !crossLinked.valid) {
      expect(crossLinked.violations.map(({ code }) => code)).toContain("subject_mismatch");
    }
  });
});
