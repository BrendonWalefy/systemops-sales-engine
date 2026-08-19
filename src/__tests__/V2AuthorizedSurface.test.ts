import { describe, expect, it } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import {
  authorizedStatementsFor,
  authorizedSurfaceFor,
} from "@/conversation-core/composer/authorized-surface";
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

function draftOf(results: ActionResult<typeof SCHEMA>[]) {
  const plan = buildV2AuthorizedResponsePlan(SCHEMA, results);
  const validation = validateDraft(plan, buildDeterministicDraft(plan));
  if (!validation.valid) throw new Error(JSON.stringify(validation.violations));
  return validation.draft;
}

function surfaceOf(results: ActionResult<typeof SCHEMA>[]) {
  return authorizedSurfaceFor(draftOf(results));
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

    expect(surface.values).toEqual(["R$ 290,00"]);
    expect(surface.moneyValues).toEqual(["R$ 290,00"]);
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

    expect(surface.values).toEqual(["quarta às 15h"]);
    expect(surface.moneyValues).toEqual([]);
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

    expect(surface.values).toEqual(["sem número"]);
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

  it("não autoriza pergunta quando o plano só informa um fato", () => {
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

    expect(surface.maxQuestions).toBe(0);
  });

  it("autoriza os dígitos que vivem no nome do assunto, senão ele nunca poderia ser citado", () => {
    const named = { type: "item", id: "b", displayName: "Clareamento 3 sessões" } as const;
    const surface = surfaceOf([{
      type: "quote_ready",
      semanticClass: "information_authorized",
      origin: { capabilityId: "quote" },
      subject: named,
      evidence: [evidence],
      facts: [{
        key: "price_cents",
        value: { kind: "money", amountInMinor: 80000, currency: "BRL" },
        subject: named,
        evidence,
        disclosure: "allowed",
      }],
    }]);

    expect(surface.numbers).toEqual(["3"]);
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

  it("declara o sentido de cada ato, para o texto final não repetir a frase da máquina", () => {
    const statements = authorizedStatementsFor(draftOf([{
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
    }]));

    expect(statements).toEqual([{
      meaning: "inform_fact",
      subject: "Item A",
      values: ["R$ 290,00"],
    }]);
  });

  it("lista cada opção como um valor próprio", () => {
    const statements = authorizedStatementsFor(draftOf([{
      type: "options_ready",
      semanticClass: "options_found",
      origin: { capabilityId: "agenda" },
      subject: item,
      evidence: [evidence],
      facts: [],
      options: [slot("w", "quarta às 15h"), slot("t", "quinta às 9h")],
    }]));

    expect(statements).toEqual([{
      meaning: "offer_options",
      subject: "Item A",
      values: ["quarta às 15h", "quinta às 9h"],
    }]);
  });

  it("declara o convite de abertura sem valor nenhum", () => {
    const statements = authorizedStatementsFor(draftOf([{
      type: "engagement",
      semanticClass: "engagement_invited",
      origin: { capabilityId: "reception" },
      subject: null,
      evidence: [],
      facts: [],
    }]));

    expect(statements).toEqual([{ meaning: "invite_engagement", subject: null, values: [] }]);
  });
});

function slot(id: string, label: string) {
  const subject = { type: "window", id, displayName: label } as const;
  return {
    id,
    subject,
    facts: [{
      key: "slot_label",
      value: { kind: "display_text", value: label },
      subject,
      evidence,
      disclosure: "allowed",
    }],
  } as const;
}
