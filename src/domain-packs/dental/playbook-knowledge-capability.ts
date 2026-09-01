import { isSafeAuthorizedDisplayText } from "@/conversation-core/authorized-response-plan";
import type { Capability, CapabilityClaim } from "@/conversation-core/capability/contract";
import type { ActionResult, Decision, Fact } from "@/conversation-core/decision";
import type { Understanding } from "@/conversation-core/understanding/schema";
import {
  DENTAL_OUTCOME_SCHEMA,
  type DentalClaimPayload,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import type {
  DentalPlaybookKnowledgeReadPort,
  DentalPlaybookKnowledgeResolution,
} from "@/domain-packs/dental/ports";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

const CAPABILITY_ID = "dental-playbook-knowledge";

function clarification(): Decision {
  return { kind: "ask", questionId: "playbook-knowledge-not-registered" };
}

function expectedKey(
  request: DentalPlaybookKnowledgeResolution["request"],
): "business_differential" | "faq_answer" {
  return request === "business-differentials"
    ? "business_differential"
    : "faq_answer";
}

function validResolution(
  resolution: DentalPlaybookKnowledgeResolution,
): resolution is Extract<DentalPlaybookKnowledgeResolution, { kind: "resolved" }> {
  if (resolution.kind !== "resolved") return false;
  const expected = expectedKey(resolution.request);
  const validCardinality = resolution.request === "business-differentials"
    ? resolution.facts.length > 0 && resolution.facts.length <= 8
    : resolution.facts.length === 1;
  return validCardinality
    && resolution.organization.id.length > 0
    && isSafeAuthorizedDisplayText(resolution.organization.displayName)
    && resolution.facts.every((fact) =>
      fact.key === expected
      && isSafeAuthorizedDisplayText(fact.value)
      && fact.evidenceRef.length > 0
    );
}

export function createDentalPlaybookKnowledgeCapability(
  knowledge: DentalPlaybookKnowledgeReadPort,
): Capability<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload,
  typeof DENTAL_OUTCOME_SCHEMA
> {
  return {
    id: CAPABILITY_ID,

    claim(understanding: Understanding<DentalRequest>) {
      if (understanding.safety.emergency || understanding.safety.requestsHuman) return null;
      if (understanding.request === "business-differentials") {
        return Object.freeze({
          capabilityId: CAPABILITY_ID,
          confidence: understanding.confidence,
          reason: "lead requested registered business differentials",
          payload: Object.freeze({
            kind: "playbook-knowledge",
            request: "business-differentials",
          } as const),
        }) as CapabilityClaim<DentalClaimPayload>;
      }
      if (understanding.request !== "frequently-asked-question") return null;
      const faqQuestion = understanding.entities.faqQuestion;
      if (typeof faqQuestion !== "string" || faqQuestion.trim().length === 0) return null;
      return Object.freeze({
        capabilityId: CAPABILITY_ID,
        confidence: understanding.confidence,
        reason: "lead matched a registered frequently asked question",
        payload: Object.freeze({
          kind: "playbook-knowledge",
          request: "frequently-asked-question",
          faqQuestion,
        } as const),
      }) as CapabilityClaim<DentalClaimPayload>;
    },

    async decide(claim): Promise<Decision> {
      if (claim.payload.kind !== "playbook-knowledge") return clarification();
      const resolution = claim.payload.request === "business-differentials"
        ? await knowledge.resolveDifferentials()
        : await knowledge.resolveFaq(claim.payload.faqQuestion);
      if (
        resolution.request !== claim.payload.request
        || !validResolution(resolution)
      ) return clarification();
      const subject = {
        type: "organization",
        id: resolution.organization.id,
        displayName: resolution.organization.displayName,
      } as const;
      const facts: readonly Fact[] = resolution.facts.map((fact) => ({
        key: fact.key,
        value: { kind: "display_text", value: fact.value },
        subject,
        evidence: { source: "read", reference: fact.evidenceRef },
        disclosure: "allowed",
      }));
      return { kind: "answer", facts, nextBestStep: null };
    },

    async execute(decision): Promise<ActionResult<typeof DENTAL_OUTCOME_SCHEMA>> {
      if (decision.kind !== "answer" || !decision.facts[0]?.subject) {
        return {
          type: "clarification_required",
          semanticClass: "clarification_required",
          origin: { capabilityId: CAPABILITY_ID },
          subject: null,
          evidence: [],
          facts: [],
        };
      }
      const [first, ...remaining] = decision.facts;
      return {
        type: "playbook_knowledge_answered",
        semanticClass: "information_authorized",
        origin: { capabilityId: CAPABILITY_ID },
        subject: first.subject!,
        evidence: [first.evidence, ...remaining.map((fact) => fact.evidence)],
        facts: decision.facts,
      };
    },
  };
}
