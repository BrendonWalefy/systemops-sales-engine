import type { V2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";

export const responsePlanFixture: V2AuthorizedResponsePlan = {
  version: "authorized-response-plan.v2",
  subjects: [{ ref: "subject-a", type: "item", id: "a" }],
  evidence: [{ ref: "evidence-0", source: "read", reference: "snapshot" }],
  facts: [
    { ref: "fact-a", key: "amount", value: 1200, subjectRef: "subject-a", evidenceRef: "evidence-0", disclosure: "allowed" },
    { ref: "fact-internal", key: "score", value: 0.8, subjectRef: null, evidenceRef: "evidence-0", disclosure: "internal" },
  ],
  options: [],
  outcomes: [
    { ref: "information", outcomeType: "quote-ready", semanticClass: "information_authorized", origin: { capabilityId: "quote" }, subjectRef: "subject-a", evidenceRefs: ["evidence-0"], factRefs: ["fact-a", "fact-internal"], optionRefs: [] },
    { ref: "failed", outcomeType: "operation-failed", semanticClass: "effect_failed", origin: { capabilityId: "operation" }, subjectRef: null, evidenceRefs: ["evidence-0"], factRefs: [], optionRefs: [] },
  ],
};

export const emptyResponsePlanFixture: V2AuthorizedResponsePlan = {
  version: "authorized-response-plan.v2",
  subjects: [],
  evidence: [],
  facts: [],
  options: [],
  outcomes: [],
};
