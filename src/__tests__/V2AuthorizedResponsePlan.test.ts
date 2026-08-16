import { describe, expect, expectTypeOf, it } from "vitest";
import {
  assertV2AuthorizedResponsePlan,
  buildV2AuthorizedResponsePlan,
  type V2AuthorizedResponsePlan,
} from "@/conversation-core/authorized-response-plan";
import { defineOutcomeSchema } from "@/conversation-core/decision";
import type { ActionResult, Fact } from "@/conversation-core/decision";

const outcomeSchema = defineOutcomeSchema({
  quote_ready: { semanticClass: "information_authorized", subjectRequirement: "required", evidenceRequirement: "required" },
  windows_found: { semanticClass: "options_found", subjectRequirement: "required", evidenceRequirement: "required" },
  catalog_resolved: { semanticClass: "information_authorized", subjectRequirement: "required", evidenceRequirement: "required" },
  unsafe: { semanticClass: "information_authorized", subjectRequirement: "optional", evidenceRequirement: "optional" },
  unsafe_options: { semanticClass: "effect_completed", subjectRequirement: "required", evidenceRequirement: "optional" },
} as const);

function fact(input: {
  key: string;
  value: string | number | boolean;
  subjectType: string | null;
  subjectId: string | null;
  evidenceRef: string;
  disclosure?: "allowed" | "internal";
}): Fact {
  const value: Fact["value"] = typeof input.value === "string"
    ? { kind: "text", value: input.value }
    : typeof input.value === "boolean"
      ? { kind: "boolean", value: input.value }
      : { kind: "integer", value: input.value };
  return {
    key: input.key,
    value,
    subject: input.subjectType && input.subjectId
      ? { type: input.subjectType, id: input.subjectId, displayName: input.subjectId }
      : null,
    evidence: { source: "read", reference: input.evidenceRef },
    disclosure: input.disclosure ?? "allowed",
  };
}

describe("plano autorizado V2", () => {
  it("não permite forjar a fronteira branded por structural typing ou cast", () => {
    expectTypeOf<{
      version: "authorized-response-plan.v2";
      outcomes: readonly [];
      options: readonly [];
      facts: readonly [];
      subjects: readonly [];
      evidence: readonly [];
    }>().not.toMatchTypeOf<V2AuthorizedResponsePlan<string>>();

    const forged = {
      version: "authorized-response-plan.v2",
      outcomes: [], options: [], facts: [], subjects: [], evidence: [],
    } as unknown as V2AuthorizedResponsePlan<string>;
    expect(() => assertV2AuthorizedResponsePlan(forged)).toThrow(/validated plan/i);
  });

  it.each([
    ["versão inválida", {
      version: "authorized-response-plan.v999",
      outcomes: [], options: [], facts: [], subjects: [], evidence: [],
    }],
    ["refs duplicadas", {
      version: "authorized-response-plan.v2",
      outcomes: [], options: [], facts: [],
      subjects: [
        { ref: "subject-0", type: "item", id: "a" },
        { ref: "subject-0", type: "item", id: "b" },
      ],
      evidence: [],
    }],
    ["dangling ref", {
      version: "authorized-response-plan.v2",
      outcomes: [{
        ref: "outcome-0", outcomeType: "quote_ready",
        semanticClass: "information_authorized", origin: { capabilityId: "quote" },
        subjectRef: "missing", evidenceRefs: [], factRefs: [], optionRefs: [],
      }],
      options: [], facts: [], subjects: [], evidence: [],
    }],
  ])("rejeita plano estrutural não validado: %s", (_case, raw) => {
    expect(() => assertV2AuthorizedResponsePlan(
      raw as unknown as V2AuthorizedResponsePlan<string>,
    )).toThrow(/validated plan/i);
  });

  it("preserva outcomes, subjects, evidence e facts como grafo referencial", () => {
    const results: ActionResult<typeof outcomeSchema>[] = [
      {
        type: "quote_ready",
        semanticClass: "information_authorized",
        origin: { capabilityId: "quote" },
        subject: { type: "item", id: "item-a", displayName: "item-a" },
        evidence: [{ source: "read", reference: "catalog-a" }],
        facts: [fact({ key: "amount", value: 1200, subjectType: "item", subjectId: "item-a", evidenceRef: "catalog-a" })],
      },
      {
        type: "windows_found",
        semanticClass: "options_found",
        origin: { capabilityId: "reservation" },
        subject: { type: "item", id: "item-b", displayName: "item-b" },
        evidence: [{ source: "read", reference: "windows-b" }],
        facts: [],
        options: [{
          id: "window-1",
          subject: { type: "window", id: "window-1", displayName: "window-1" },
          facts: [fact({ key: "window_label", value: "15:00", subjectType: "window", subjectId: "window-1", evidenceRef: "windows-b" })],
        }],
      },
    ];

    const plan = buildV2AuthorizedResponsePlan(outcomeSchema, results);

    expect(() => assertV2AuthorizedResponsePlan(plan)).not.toThrow();
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.outcomes)).toBe(true);
    expect(Object.isFrozen(plan.outcomes[0])).toBe(true);

    expect(plan.outcomes).toEqual([
      {
        ref: "outcome-0", outcomeType: "quote_ready", semanticClass: "information_authorized",
        origin: { capabilityId: "quote" }, subjectRef: "subject-0",
        evidenceRefs: ["evidence-0"], factRefs: ["fact-0"], optionRefs: [],
      },
      {
        ref: "outcome-1", outcomeType: "windows_found", semanticClass: "options_found",
        origin: { capabilityId: "reservation" }, subjectRef: "subject-1",
        evidenceRefs: ["evidence-1"], factRefs: [], optionRefs: ["option-0"],
      },
    ]);
    expect(plan.options).toEqual([{
      ref: "option-0", id: "window-1", subjectRef: "subject-2", factRefs: ["fact-1"],
    }]);
    expect(plan.facts.map(({ ref, subjectRef, evidenceRef }) => ({ ref, subjectRef, evidenceRef }))).toEqual([
      { ref: "fact-0", subjectRef: "subject-0", evidenceRef: "evidence-0" },
      { ref: "fact-1", subjectRef: "subject-2", evidenceRef: "evidence-1" },
    ]);
  });

  it("preserva disclosure interno para o validator bloquear a referência", () => {
    const result: ActionResult<typeof outcomeSchema> = {
      type: "catalog_resolved",
      semanticClass: "information_authorized",
      origin: { capabilityId: "catalog" },
      subject: { type: "service", id: "service-1", displayName: "Service 1" },
      evidence: [
        { source: "read", reference: "catalog:service-1" },
        { source: "read", reference: "catalog-match.v1" },
      ],
      facts: [fact({
        key: "match_score", value: 94, subjectType: null, subjectId: null,
        evidenceRef: "catalog-match.v1", disclosure: "internal",
      })],
    };

    expect(buildV2AuthorizedResponsePlan(outcomeSchema, [result]).facts[0]).toEqual(expect.objectContaining({
      ref: "fact-0", key: "match_score", disclosure: "internal", subjectRef: null,
    }));
  });

  it("recusa fact divulgável sem subject", () => {
    const result: ActionResult<typeof outcomeSchema> = {
      type: "unsafe",
      semanticClass: "information_authorized",
      origin: { capabilityId: "unsafe" },
      subject: null,
      evidence: [],
      facts: [fact({ key: "amount", value: 1200, subjectType: null, subjectId: null, evidenceRef: "catalog" })],
    };
    expect(() => buildV2AuthorizedResponsePlan(outcomeSchema, [result])).toThrow(/subject/);
  });

  it("recusa options fora de options_found", () => {
    const result = {
      type: "unsafe_options",
      semanticClass: "effect_completed",
      origin: { capabilityId: "unsafe" },
      subject: { type: "operation", id: "operation-1", displayName: "Operation 1" },
      evidence: [],
      facts: [],
      options: [{ id: "option-1", subject: { type: "option", id: "option-1", displayName: "Option 1" }, facts: [] }],
    } as unknown as ActionResult<typeof outcomeSchema>;
    expect(() => buildV2AuthorizedResponsePlan(outcomeSchema, [result])).toThrow(/options/);
  });

  it("recusa relações incoerentes entre outcome, fact, option, subject e evidence", () => {
    const subjectA = { type: "item", id: "a", displayName: "Item A" } as const;
    const subjectB = { type: "item", id: "b", displayName: "Item B" } as const;
    const evidenceA = { source: "read", reference: "read-a" } as const;
    const evidenceB = { source: "read", reference: "read-b" } as const;

    const crossSubject = {
      type: "quote_ready",
      semanticClass: "information_authorized",
      origin: { capabilityId: "quote" },
      subject: subjectA,
      evidence: [evidenceA],
      facts: [{
        key: "amount", value: { kind: "integer", value: 10 }, subject: subjectB,
        evidence: evidenceA, disclosure: "allowed",
      }],
    } satisfies ActionResult<typeof outcomeSchema>;
    expect(() => buildV2AuthorizedResponsePlan(outcomeSchema, [crossSubject]))
      .toThrow(/outcome\/fact subject mismatch/);

    const crossEvidence = {
      ...crossSubject,
      facts: [{
        key: "amount", value: { kind: "integer", value: 10 }, subject: subjectA,
        evidence: evidenceB, disclosure: "allowed" as const,
      }],
    } satisfies ActionResult<typeof outcomeSchema>;
    expect(() => buildV2AuthorizedResponsePlan(outcomeSchema, [crossEvidence]))
      .toThrow(/outcome\/fact evidence mismatch/);

    const crossOptionSubject = {
      type: "windows_found",
      semanticClass: "options_found",
      origin: { capabilityId: "reservation" },
      subject: subjectA,
      evidence: [evidenceA],
      facts: [],
      options: [{
        id: "window-1",
        subject: subjectA,
        facts: [{
          key: "window", value: { kind: "text", value: "15:00" }, subject: subjectB,
          evidence: evidenceA, disclosure: "allowed",
        }],
      }],
    } satisfies ActionResult<typeof outcomeSchema>;
    expect(() => buildV2AuthorizedResponsePlan(outcomeSchema, [crossOptionSubject]))
      .toThrow(/option\/fact subject mismatch/);
  });

  it("canonicaliza ActionResults uma vez antes de validar e registrar", () => {
    let semanticClassReads = 0;
    const shifting = Object.defineProperty({
      type: "quote_ready",
      origin: { capabilityId: "quote" },
      subject: { type: "item", id: "a", displayName: "Item A" },
      evidence: [{ source: "read", reference: "read-a" }],
      facts: [],
    }, "semanticClass", {
      enumerable: true,
      get() {
        semanticClassReads += 1;
        return semanticClassReads === 1
          ? "information_authorized"
          : "effect_completed";
      },
    }) as unknown as ActionResult<typeof outcomeSchema>;

    const plan = buildV2AuthorizedResponsePlan(outcomeSchema, [shifting]);

    expect(plan.outcomes[0]?.semanticClass).toBe("information_authorized");
    expect(semanticClassReads).toBe(1);
  });

  it("recusa option vazia ou id de option duplicado", () => {
    const subject = { type: "item", id: "a", displayName: "Item A" } as const;
    const optionSubject = { type: "window", id: "w", displayName: "15:00" } as const;
    const evidence = { source: "read", reference: "read-a" } as const;
    const base = {
      type: "windows_found",
      semanticClass: "options_found",
      origin: { capabilityId: "reservation" },
      subject,
      evidence: [evidence],
      facts: [],
    } as const;

    expect(() => buildV2AuthorizedResponsePlan(outcomeSchema, [{
      ...base,
      options: [{ id: "empty", subject: optionSubject, facts: [] }],
    }])).toThrow(/option.*fact/i);

    const optionFact = {
      key: "window",
      value: { kind: "text", value: "15:00" } as const,
      subject: optionSubject,
      evidence,
      disclosure: "allowed" as const,
    };
    expect(() => buildV2AuthorizedResponsePlan(outcomeSchema, [{
      ...base,
      options: [
        { id: "same", subject: optionSubject, facts: [optionFact] },
        { id: "same", subject: optionSubject, facts: [optionFact] },
      ],
    }])).toThrow(/duplicate option id/i);
  });
});
