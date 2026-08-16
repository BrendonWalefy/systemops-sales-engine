import { describe, expect, it } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type { ActionResult, Fact } from "@/conversation-core/decision";

function fact(input: {
  key: string;
  value: string | number | boolean;
  subjectType: string | null;
  subjectId: string | null;
  evidenceRef: string;
  disclosure?: "allowed" | "internal";
}): Fact {
  return {
    key: input.key,
    value: input.value,
    subject: input.subjectType && input.subjectId
      ? { type: input.subjectType, id: input.subjectId }
      : null,
    evidence: { source: "read", reference: input.evidenceRef },
    disclosure: input.disclosure ?? "allowed",
  };
}

describe("plano autorizado V2", () => {
  it("preserva outcomes, subjects, evidence e facts como grafo referencial", () => {
    const results: ActionResult[] = [
      {
        type: "quote_ready",
        semanticClass: "information_authorized",
        origin: { capabilityId: "quote" },
        subject: { type: "item", id: "item-a" },
        evidence: [{ source: "read", reference: "catalog-a" }],
        facts: [fact({ key: "amount", value: 1200, subjectType: "item", subjectId: "item-a", evidenceRef: "catalog-a" })],
      },
      {
        type: "windows_found",
        semanticClass: "options_found",
        origin: { capabilityId: "reservation" },
        subject: { type: "item", id: "item-b" },
        evidence: [{ source: "read", reference: "windows-b" }],
        facts: [],
        options: [{
          id: "window-1",
          subject: { type: "window", id: "window-1" },
          facts: [fact({ key: "window_label", value: "15:00", subjectType: "window", subjectId: "window-1", evidenceRef: "windows-b" })],
        }],
      },
    ];

    const plan = buildV2AuthorizedResponsePlan(results);

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
    const result: ActionResult = {
      type: "catalog_resolved",
      semanticClass: "information_authorized",
      origin: { capabilityId: "catalog" },
      subject: { type: "service", id: "service-1" },
      evidence: [{ source: "read", reference: "catalog:service-1" }],
      facts: [fact({
        key: "match_score", value: 0.94, subjectType: null, subjectId: null,
        evidenceRef: "catalog-match.v1", disclosure: "internal",
      })],
    };

    expect(buildV2AuthorizedResponsePlan([result]).facts[0]).toEqual(expect.objectContaining({
      ref: "fact-0", key: "match_score", disclosure: "internal", subjectRef: null,
    }));
  });

  it("recusa fact divulgável sem subject", () => {
    const result: ActionResult = {
      type: "unsafe",
      semanticClass: "information_authorized",
      origin: { capabilityId: "unsafe" },
      subject: null,
      evidence: [],
      facts: [fact({ key: "amount", value: 1200, subjectType: null, subjectId: null, evidenceRef: "catalog" })],
    };
    expect(() => buildV2AuthorizedResponsePlan([result])).toThrow(/subject/);
  });

  it("recusa options fora de options_found", () => {
    const result = {
      type: "unsafe_options",
      semanticClass: "effect_completed",
      origin: { capabilityId: "unsafe" },
      subject: { type: "operation", id: "operation-1" },
      evidence: [],
      facts: [],
      options: [{ id: "option-1", subject: { type: "option", id: "option-1" }, facts: [] }],
    } as unknown as ActionResult;
    expect(() => buildV2AuthorizedResponsePlan([result])).toThrow(/options_found/);
  });
});
