import { describe, expect, expectTypeOf, it } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type { DraftSpeechAct } from "@/conversation-core/composer/contract";
import {
  renderDeterministicResponse,
} from "@/conversation-core/composer/deterministic-renderer";
import { validateDraft, type ValidatedDraftResponse } from "@/conversation-core/composer/validator";
import { defineOutcomeSchema } from "@/conversation-core/decision";
import type { ActionResult, Fact } from "@/conversation-core/decision";

const outcomeSchema = defineOutcomeSchema({
  quote_ready: { semanticClass: "information_authorized", subjectRequirement: "required", evidenceRequirement: "required" },
  windows_found: { semanticClass: "options_found", subjectRequirement: "optional", evidenceRequirement: "required" },
  reservation_completed: { semanticClass: "effect_completed", subjectRequirement: "required", evidenceRequirement: "required" },
  reservation_failed: { semanticClass: "effect_failed", subjectRequirement: "forbidden", evidenceRequirement: "optional" },
  operator_required: { semanticClass: "human_action_required", subjectRequirement: "forbidden", evidenceRequirement: "optional" },
  details_required: { semanticClass: "clarification_required", subjectRequirement: "forbidden", evidenceRequirement: "optional" },
} as const);
const subject = { type: "item", id: "a", displayName: "Item A" } as const;
const optionSubject = { type: "window", id: "w1", displayName: "15:00" } as const;
const evidence = { source: "read", reference: "snapshot" } as const;
const amount = { key: "amount", value: { kind: "money", amountInMinor: 120000, currency: "BRL" }, subject, evidence, disclosure: "allowed" } as const;
const results: ActionResult<typeof outcomeSchema>[] = [
  { type: "quote_ready", semanticClass: "information_authorized", origin: { capabilityId: "quote" }, subject, evidence: [evidence], facts: [amount] },
  { type: "windows_found", semanticClass: "options_found", origin: { capabilityId: "reservation" }, subject: null, evidence: [evidence], facts: [], options: [{ id: "w1", subject: optionSubject, facts: [{ key: "window_label", value: { kind: "text", value: "15:00" }, subject: optionSubject, evidence, disclosure: "allowed" }] }] },
  { type: "reservation_completed", semanticClass: "effect_completed", origin: { capabilityId: "reservation" }, subject, evidence: [evidence], facts: [amount] },
  { type: "reservation_failed", semanticClass: "effect_failed", origin: { capabilityId: "reservation" }, subject: null, evidence: [], facts: [] },
  { type: "operator_required", semanticClass: "human_action_required", origin: { capabilityId: "safety" }, subject: null, evidence: [], facts: [] },
  { type: "details_required", semanticClass: "clarification_required", origin: { capabilityId: "qualification" }, subject: null, evidence: [], facts: [] },
];
const plan = buildV2AuthorizedResponsePlan(outcomeSchema, results);

function render(act: DraftSpeechAct): string {
  const validation = validateDraft(plan, { acts: [act] });
  if (!validation.valid) throw new Error(JSON.stringify(validation.violations));
  return renderDeterministicResponse({ draft: validation.draft }).text;
}

describe("renderer determinístico V2", () => {
  it("não aceita valor primitivo sem tipo semântico", () => {
    expectTypeOf<number>().not.toMatchTypeOf<Fact["value"]>();
    expectTypeOf<string>().not.toMatchTypeOf<Fact["value"]>();
    expectTypeOf<boolean>().not.toMatchTypeOf<Fact["value"]>();
  });

  it("aceita somente draft validado no contrato", () => {
    expectTypeOf<Parameters<typeof renderDeterministicResponse>[0]["draft"]>()
      .toEqualTypeOf<ValidatedDraftResponse>();
    expectTypeOf<Parameters<typeof renderDeterministicResponse>[0]>()
      .not.toHaveProperty("language");
    expectTypeOf<Parameters<typeof renderDeterministicResponse>[0]>()
      .not.toHaveProperty("style");
  });

  it("rejeita marca de ValidatedDraftResponse forjada por cast", () => {
    const forged = {
      acts: [{
        kind: "confirm_effect",
        outcomeRef: "outcome-2",
        subjectRef: "subject-0",
        factRefs: [],
      }],
    } as unknown as ValidatedDraftResponse;

    expect(() => renderDeterministicResponse({ draft: forged }))
      .toThrow(/not validated by the semantic validator/);
  });

  it("verbaliza fact autorizado sem ampliar o valor", () => {
    expect(render({ kind: "inform_fact", outcomeRef: "outcome-0", factRef: "fact-0", subjectRef: "subject-0" }))
      .toBe("Valor: R$ 1.200,00.");
  });

  it("oferece opções sem alegar conclusão", () => {
    const text = render({ kind: "offer_options", outcomeRef: "outcome-1", subjectRef: null, optionRefs: ["option-0"] });
    expect(text).toBe("Tenho estas opções: 15:00.");
    expect(text).not.toMatch(/conclu|confirm/i);
  });

  it("confirma somente effect_completed", () => {
    expect(render({ kind: "confirm_effect", outcomeRef: "outcome-2", subjectRef: "subject-0", factRefs: ["fact-2"] }))
      .toBe("A ação foi concluída. Valor: R$ 1.200,00.");
  });

  it("comunica falha sem texto de sucesso", () => {
    const text = render({ kind: "communicate_failure", outcomeRef: "outcome-3", subjectRef: null });
    expect(text).toBe("Não foi possível concluir a ação.");
    expect(text).not.toMatch(/confirmad|concluíd/i);
  });

  it("informa ação humana necessária sem alegar handoff", () => {
    expect(render({ kind: "inform_required_action", outcomeRef: "outcome-4", subjectRef: null }))
      .toBe("É necessário atendimento humano.");
  });

  it("pede clarificação sem inventar fact", () => {
    expect(render({ kind: "ask_clarification", outcomeRef: "outcome-5", subjectRef: null }))
      .toBe("Pode confirmar os dados?");
  });

  it("renderiza snapshots imutáveis do draft e do plano validados", () => {
    const acts: DraftSpeechAct[] = [
      { kind: "inform_fact", outcomeRef: "outcome-0", factRef: "fact-0", subjectRef: "subject-0" },
    ];
    const validation = validateDraft(plan, { acts });
    if (!validation.valid) throw new Error(JSON.stringify(validation.violations));

    acts.push({
      kind: "confirm_effect",
      outcomeRef: "outcome-2",
      subjectRef: "subject-0",
      factRefs: ["fact-2"],
    });

    expect(renderDeterministicResponse({ draft: validation.draft }).text)
      .toBe("Valor: R$ 1.200,00.");
  });

  it("entrega FinalText em um snapshot imutável", () => {
    const validation = validateDraft(plan, {
      acts: [{ kind: "inform_fact", outcomeRef: "outcome-0", factRef: "fact-0", subjectRef: "subject-0" }],
    });
    if (!validation.valid) throw new Error(JSON.stringify(validation.violations));

    const response = renderDeterministicResponse({ draft: validation.draft });

    expect(Object.isFrozen(response)).toBe(true);
    expect(Object.isFrozen(response.parts)).toBe(true);
    expect(Reflect.set(response, "text", "Desconto garantido.")).toBe(false);
    expect(response.text).toBe("Valor: R$ 1.200,00.");
  });

  it("ignora material lexical hostil mesmo quando chega por cast em runtime", () => {
    const validation = validateDraft(plan, {
      acts: [{ kind: "inform_fact", outcomeRef: "outcome-0", factRef: "fact-0", subjectRef: "subject-0" }],
    });
    if (!validation.valid) throw new Error(JSON.stringify(validation.violations));
    const hostileInput = {
      draft: validation.draft,
      language: {
        factTerms: [{ factKey: "amount", label: "Desconto garantido" }],
      },
      style: { greeting: "include", emoji: "light" },
    } as unknown as Parameters<typeof renderDeterministicResponse>[0];

    const text = renderDeterministicResponse(hostileInput).text;
    expect(text).not.toMatch(/desconto|garantid/i);
    expect(text).toBe("Valor: R$ 1.200,00.");
  });
});
