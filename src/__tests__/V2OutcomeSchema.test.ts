import { describe, expect, expectTypeOf, it } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type { ResponseComposerPort } from "@/conversation-core/composer/contract";
import { buildDeterministicDraft } from "@/conversation-core/composer/deterministic-composer";
import { authorizedPlanFor, validateDraft } from "@/conversation-core/composer/validator";
import {
  defineOutcomeSchema,
  type ActionResult,
} from "@/conversation-core/decision";
import { DENTAL_OUTCOME_SCHEMA } from "@/domain-packs/dental/capabilities";
import type { DentalOutcomeType } from "@/domain-packs/dental/capabilities";

const origin = { capabilityId: "test" } as const;
const writeEvidence = { source: "write", reference: "write-1" } as const;
const appointment = { type: "appointment", id: "appointment-1", displayName: "Appointment 1" } as const;

const syntheticSchema = defineOutcomeSchema({
  media_available: {
    semanticClass: "information_authorized",
    subjectRequirement: "required",
    evidenceRequirement: "required",
  },
  media_sent: {
    semanticClass: "effect_completed",
    subjectRequirement: "required",
    evidenceRequirement: "write_required",
  },
} as const);

describe("Outcome Schema V2", () => {
  it("valida e registra a mesma canonicalização diante de accessors mutáveis", () => {
    let reads = 0;
    const definition = Object.defineProperty({
      semanticClass: "effect_completed",
      subjectRequirement: "required",
    }, "evidenceRequirement", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? "write_required" : "optional";
      },
    });
    const schema = defineOutcomeSchema({ completed: definition } as unknown as {
      completed: {
        semanticClass: "effect_completed";
        subjectRequirement: "required";
        evidenceRequirement: "write_required";
      };
    });

    expect(schema.completed.evidenceRequirement).toBe("write_required");
    expect(reads).toBe(1);
    expect(() => buildV2AuthorizedResponsePlan(schema, [{
      type: "completed",
      semanticClass: "effect_completed",
      origin,
      subject: appointment,
      evidence: [],
      facts: [],
    }] as unknown as readonly ActionResult<typeof schema>[])).toThrow(/write evidence/i);
  });

  it("deriva combinações compile-time da mesma definição usada em runtime", () => {
    expectTypeOf<Parameters<ResponseComposerPort<DentalOutcomeType>["compose"]>[0]["plan"]["outcomes"][number]["outcomeType"]>()
      .toEqualTypeOf<DentalOutcomeType>();
    expectTypeOf<Parameters<ResponseComposerPort<DentalOutcomeType>["compose"]>[0]["plan"]["outcomes"][number]["outcomeType"]>()
      .not.toEqualTypeOf<string>();
    expectTypeOf<Parameters<typeof buildDeterministicDraft<DentalOutcomeType>>[0]["outcomes"][number]["outcomeType"]>()
      .not.toEqualTypeOf<string>();
    type DentalValidation = ReturnType<typeof validateDraft<DentalOutcomeType>>;
    type DentalValidatedDraft = Extract<DentalValidation, { valid: true }>["draft"];
    expectTypeOf<ReturnType<typeof authorizedPlanFor<DentalOutcomeType>>["outcomes"][number]["outcomeType"]>()
      .toEqualTypeOf<DentalOutcomeType>();
    expectTypeOf<DentalValidatedDraft>()
      .toMatchTypeOf<Parameters<typeof authorizedPlanFor<DentalOutcomeType>>[0]>();
    expectTypeOf<{
      type: "appointment_create_failed";
      semanticClass: "effect_completed";
      origin: typeof origin;
      subject: typeof appointment;
      evidence: readonly [typeof writeEvidence];
      facts: readonly [];
    }>().not.toMatchTypeOf<ActionResult<typeof DENTAL_OUTCOME_SCHEMA>>();

    expectTypeOf<{
      type: "escalation_required";
      semanticClass: "effect_completed";
      origin: typeof origin;
      subject: typeof appointment;
      evidence: readonly [typeof writeEvidence];
      facts: readonly [];
    }>().not.toMatchTypeOf<ActionResult<typeof DENTAL_OUTCOME_SCHEMA>>();

    expectTypeOf<{
      type: "slots_found";
      semanticClass: "effect_completed";
      origin: typeof origin;
      subject: null;
      evidence: readonly [typeof writeEvidence];
      facts: readonly [];
    }>().not.toMatchTypeOf<ActionResult<typeof DENTAL_OUTCOME_SCHEMA>>();

    expectTypeOf<{
      type: "media_available";
      semanticClass: "effect_completed";
      origin: typeof origin;
      subject: { type: "media"; id: "media-1"; displayName: "Media 1" };
      evidence: readonly [typeof writeEvidence];
      facts: readonly [];
    }>().not.toMatchTypeOf<ActionResult<typeof syntheticSchema>>();

    expectTypeOf<{
      type: "appointment_created";
      semanticClass: "effect_completed";
      origin: typeof origin;
      subject: typeof appointment;
      evidence: readonly [];
      facts: readonly [];
    }>().not.toMatchTypeOf<ActionResult<typeof DENTAL_OUTCOME_SCHEMA>>();
  });

  it.each([
    ["failure as completed", {
      type: "appointment_create_failed", semanticClass: "effect_completed",
      origin, subject: appointment, evidence: [writeEvidence], facts: [],
    }],
    ["escalation as completed", {
      type: "escalation_required", semanticClass: "effect_completed",
      origin, subject: appointment, evidence: [writeEvidence], facts: [],
    }],
    ["slots as completed", {
      type: "slots_found", semanticClass: "effect_completed",
      origin, subject: null, evidence: [writeEvidence], facts: [],
    }],
    ["completed without write evidence", {
      type: "appointment_created", semanticClass: "effect_completed",
      origin, subject: appointment, evidence: [], facts: [],
    }],
  ])("rejeita em runtime: %s", (_case, forged) => {
    expect(() => buildV2AuthorizedResponsePlan(
      DENTAL_OUTCOME_SCHEMA,
      [forged] as unknown as readonly ActionResult<typeof DENTAL_OUTCOME_SCHEMA>[],
    )).toThrow(/outcome schema/i);
  });

  it("não deixa disponibilidade de mídia virar efeito concluído", () => {
    const forged = {
      type: "media_available", semanticClass: "effect_completed", origin,
      subject: { type: "media", id: "media-1", displayName: "Media 1" },
      evidence: [writeEvidence], facts: [],
    };
    expect(() => buildV2AuthorizedResponsePlan(
      syntheticSchema,
      [forged] as unknown as readonly ActionResult<typeof syntheticSchema>[],
    )).toThrow(/outcome schema/i);
  });
});
