import { describe, expect, it } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { authorizedSurfaceFor } from "@/conversation-core/composer/authorized-surface";
import { buildDeterministicDraft } from "@/conversation-core/composer/deterministic-composer";
import { validateDraft } from "@/conversation-core/composer/validator";
import { defineOutcomeSchema, type ActionResult } from "@/conversation-core/decision";

const SCHEMA = defineOutcomeSchema({
  quote_ready: {
    semanticClass: "information_authorized",
    subjectRequirement: "required",
    evidenceRequirement: "required",
  },
  options_ready: {
    semanticClass: "options_found",
    subjectRequirement: "required",
    evidenceRequirement: "required",
  },
  engagement: {
    semanticClass: "engagement_invited",
    subjectRequirement: "forbidden",
    evidenceRequirement: "optional",
  },
} as const);

const item = { type: "item", id: "a", displayName: "Item A" } as const;
const window = { type: "window", id: "w", displayName: "quarta às 15h" } as const;
const evidence = { source: "read", reference: "snapshot" } as const;

function surfaceOf(results: ActionResult<typeof SCHEMA>[]) {
  const plan = buildV2AuthorizedResponsePlan(SCHEMA, results);
  const validation = validateDraft(plan, buildDeterministicDraft(plan));
  if (!validation.valid) throw new Error(JSON.stringify(validation.violations));
  return authorizedSurfaceFor(validation.draft);
}

describe("superfície autorizada de um plano", () => {
  it("autoriza o valor monetário como o lead o lê", () => {
    const surface = surfaceOf([{
      type: "quote_ready",
      semanticClass: "information_authorized",
      origin: { capabilityId: "quote" },
      subject: item,
      evidence: [evidence],
      facts: [{
        key: "price_cents",
        value: { kind: "money", amountInMinor: 29000, currency: "BRL" },
        subject: item,
        evidence,
        disclosure: "allowed",
      }],
    }]);

    expect(surface.numbers).toEqual(["290"]);
    expect(surface.currencyAllowed).toBe(true);
  });

  it("autoriza os números que aparecem dentro de um rótulo de opção", () => {
    const surface = surfaceOf([{
      type: "options_ready",
      semanticClass: "options_found",
      origin: { capabilityId: "agenda" },
      subject: item,
      evidence: [evidence],
      facts: [],
      options: [{
        id: "w",
        subject: window,
        facts: [{
          key: "slot_label",
          value: { kind: "display_text", value: "quarta às 15h" },
          subject: window,
          evidence,
          disclosure: "allowed",
        }],
      }],
    }]);

    expect(surface.numbers).toEqual(["15"]);
    expect(surface.currencyAllowed).toBe(false);
  });

  it("não autoriza número de fato interno, que o lead nunca deveria ler", () => {
    const surface = surfaceOf([{
      type: "quote_ready",
      semanticClass: "information_authorized",
      origin: { capabilityId: "quote" },
      subject: item,
      evidence: [evidence],
      facts: [
        {
          key: "label",
          value: { kind: "display_text", value: "sem número" },
          subject: item,
          evidence,
          disclosure: "allowed",
        },
        {
          key: "score",
          value: { kind: "integer", value: 42 },
          subject: null,
          evidence,
          disclosure: "internal",
        },
      ],
    }]);

    expect(surface.numbers).toEqual([]);
  });

  it("autoriza no máximo uma pergunta", () => {
    const surface = surfaceOf([{
      type: "engagement",
      semanticClass: "engagement_invited",
      origin: { capabilityId: "reception" },
      subject: null,
      evidence: [],
      facts: [],
    }]);

    expect(surface.maxQuestions).toBe(1);
  });

  it("dá mais espaço a um plano com mais atos do que a uma abertura", () => {
    const opener = surfaceOf([{
      type: "engagement",
      semanticClass: "engagement_invited",
      origin: { capabilityId: "reception" },
      subject: null,
      evidence: [],
      facts: [],
    }]);
    const richer = surfaceOf([
      {
        type: "quote_ready",
        semanticClass: "information_authorized",
        origin: { capabilityId: "quote" },
        subject: item,
        evidence: [evidence],
        facts: [{
          key: "price_cents",
          value: { kind: "money", amountInMinor: 29000, currency: "BRL" },
          subject: item,
          evidence,
          disclosure: "allowed",
        }],
      },
      {
        type: "engagement",
        semanticClass: "engagement_invited",
        origin: { capabilityId: "reception" },
        subject: null,
        evidence: [],
        facts: [],
      },
    ]);

    expect(richer.maxCharacters).toBeGreaterThan(opener.maxCharacters);
    expect(opener.maxCharacters).toBeGreaterThan(120);
  });
});
