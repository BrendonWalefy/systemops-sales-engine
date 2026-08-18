import { describe, expect, it } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type { DraftResponse } from "@/conversation-core/composer/contract";
import { validateDraft } from "@/conversation-core/composer/validator";
import { defineOutcomeSchema } from "@/conversation-core/decision";
import type { ActionResult } from "@/conversation-core/decision";

const outcomeSchema = defineOutcomeSchema({
  price_ready: { semanticClass: "information_authorized", subjectRequirement: "required", evidenceRequirement: "required" },
  other_information: { semanticClass: "information_authorized", subjectRequirement: "required", evidenceRequirement: "required" },
  options_found: { semanticClass: "options_found", subjectRequirement: "required", evidenceRequirement: "required" },
  effect_completed: { semanticClass: "effect_completed", subjectRequirement: "required", evidenceRequirement: "write_required" },
  effect_failed: { semanticClass: "effect_failed", subjectRequirement: "optional", evidenceRequirement: "optional" },
  operator_required: { semanticClass: "human_action_required", subjectRequirement: "forbidden", evidenceRequirement: "optional" },
  media_available: { semanticClass: "information_authorized", subjectRequirement: "required", evidenceRequirement: "required" },
} as const);

const readEvidence = { source: "read", reference: "snapshot" } as const;
const writeEvidence = { source: "write", reference: "effect" } as const;
const serviceA = { type: "resource", id: "a", displayName: "Resource A" };
const serviceB = { type: "resource", id: "b", displayName: "Resource B" };
const option = { type: "option", id: "option-1", displayName: "15:00" };
const effect = { type: "effect", id: "effect-1", displayName: "Effect 1" };
const media = { type: "media", id: "media-1", displayName: "Media 1" };

const results: ActionResult<typeof outcomeSchema>[] = [
  {
    type: "price_ready", semanticClass: "information_authorized", origin: { capabilityId: "catalog" },
    subject: serviceA, evidence: [readEvidence],
    facts: [{ key: "amount", value: { kind: "integer", value: 1200 }, subject: serviceA, evidence: readEvidence, disclosure: "allowed" }],
  },
  {
    type: "other_information", semanticClass: "information_authorized", origin: { capabilityId: "catalog" },
    subject: serviceB, evidence: [readEvidence],
    facts: [{ key: "available", value: { kind: "boolean", value: true }, subject: serviceB, evidence: readEvidence, disclosure: "allowed" }],
  },
  {
    type: "options_found", semanticClass: "options_found", origin: { capabilityId: "options" },
    subject: serviceA, evidence: [readEvidence], facts: [],
    options: [{ id: "option-1", subject: option, facts: [{ key: "option_label", value: { kind: "display_text", value: "15:00" }, subject: option, evidence: readEvidence, disclosure: "allowed" }] }],
  },
  {
    type: "effect_completed", semanticClass: "effect_completed", origin: { capabilityId: "effect" },
    subject: effect, evidence: [writeEvidence], facts: [],
  },
  {
    type: "effect_failed", semanticClass: "effect_failed", origin: { capabilityId: "effect" },
    subject: null, evidence: [writeEvidence], facts: [],
  },
  {
    type: "operator_required", semanticClass: "human_action_required", origin: { capabilityId: "safety" },
    subject: null, evidence: [], facts: [],
  },
  {
    type: "media_available", semanticClass: "information_authorized", origin: { capabilityId: "media" },
    subject: media, evidence: [readEvidence],
    facts: [{ key: "media_available", value: { kind: "boolean", value: true }, subject: media, evidence: readEvidence, disclosure: "allowed" }],
  },
];

const plan = buildV2AuthorizedResponsePlan(outcomeSchema, results);
const outcome = (type: string) => plan.outcomes.find(({ outcomeType }) => outcomeType === type)!;
const subjectRef = (id: string) => plan.subjects.find((subject) => subject.id === id)!.ref;
const factRef = (key: string) => plan.facts.find((fact) => fact.key === key)!.ref;

function violationCodes(draft: DraftResponse): string[] {
  const result = validateDraft(plan, draft);
  return result.valid ? [] : result.violations.map(({ code }) => code);
}

describe("regressões semânticas V2", () => {
  it("recusa draft vazio e oferta sem opções", () => {
    expect(violationCodes({ acts: [] })).toContain("empty_draft");
    expect(violationCodes({ acts: [{
      kind: "offer_options",
      outcomeRef: outcome("options_found").ref,
      subjectRef: subjectRef("a"),
      optionRefs: [],
    }] })).toContain("empty_reference_set");
  });

  it("não transforma options_found em effect_completed", () => {
    expect(violationCodes({ acts: [{
      kind: "confirm_effect", outcomeRef: outcome("options_found").ref,
      subjectRef: subjectRef("a"), factRefs: [],
    }] })).toContain("incompatible_speech_act");
  });

  it("não transforma effect_failed em sucesso", () => {
    expect(violationCodes({ acts: [{
      kind: "confirm_effect", outcomeRef: outcome("effect_failed").ref,
      subjectRef: subjectRef("effect-1"), factRefs: [],
    }] })).toContain("incompatible_speech_act");
  });

  it("não transforma human_action_required em handoff concluído", () => {
    expect(violationCodes({ acts: [{
      kind: "confirm_effect", outcomeRef: outcome("operator_required").ref,
      subjectRef: subjectRef("effect-1"), factRefs: [],
    }] })).toContain("incompatible_speech_act");
  });

  it("não transforma mídia disponível em mídia enviada", () => {
    expect(violationCodes({ acts: [{
      kind: "confirm_effect", outcomeRef: outcome("media_available").ref,
      subjectRef: subjectRef("media-1"), factRefs: [factRef("media_available")],
    }] })).toContain("incompatible_speech_act");
  });

  it("não transforma ausência ou UNKNOWN em FALSE", () => {
    expect(violationCodes({ acts: [{
      kind: "inform_fact", outcomeRef: outcome("other_information").ref,
      factRef: "fact-does-not-exist", subjectRef: subjectRef("b"),
    }] })).toContain("unknown_fact_ref");
  });

  it("não troca preço entre subjects ou outcomes", () => {
    const codes = violationCodes({ acts: [{
      kind: "inform_fact", outcomeRef: outcome("other_information").ref,
      factRef: factRef("amount"), subjectRef: subjectRef("b"),
    }] });
    expect(codes).toContain("fact_outcome_mismatch");
    expect(codes).toContain("subject_mismatch");
  });

  it.each(["discount", "guarantee", "clinical_outcome", "invented_option"])(
    "recusa fact não autorizado: %s",
    (unauthorizedRef) => {
      expect(violationCodes({ acts: [{
        kind: "inform_fact", outcomeRef: outcome("price_ready").ref,
        factRef: unauthorizedRef, subjectRef: subjectRef("a"),
      }] })).toContain("unknown_fact_ref");
    },
  );
});
