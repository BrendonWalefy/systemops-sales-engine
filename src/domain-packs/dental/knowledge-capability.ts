import type {
  Capability,
  CapabilityClaim,
} from "@/conversation-core/capability/contract";
import type { ActionResult, Decision, Fact } from "@/conversation-core/decision";
import type { Understanding } from "@/conversation-core/understanding/schema";
import {
  DENTAL_OUTCOME_SCHEMA,
  type DentalClaimPayload,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import type { DentalKnowledgeReadPort } from "@/domain-packs/dental/ports";
import {
  DENTAL_BUSINESS_INFORMATION_TOPICS,
  type DentalBusinessInformationTopic,
  type DentalRequest,
} from "@/domain-packs/dental/vocabulary";

const CAPABILITY_ID = "dental-knowledge";
const MAX_FACT_LENGTH = 240;
const topics: ReadonlySet<string> = new Set(DENTAL_BUSINESS_INFORMATION_TOPICS);

function isTopic(value: unknown): value is DentalBusinessInformationTopic {
  return typeof value === "string" && topics.has(value);
}

function validDisplayValue(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_FACT_LENGTH
    && value === value.trim();
}

function clarification(): Decision {
  return {
    kind: "ask",
    questionId: "business-information-not-registered",
  };
}

export function createDentalKnowledgeCapability(
  knowledge: DentalKnowledgeReadPort,
): Capability<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload,
  typeof DENTAL_OUTCOME_SCHEMA
> {
  return {
    id: CAPABILITY_ID,

    claim(understanding: Understanding<DentalRequest>) {
      if (understanding.request !== "business-information") return null;
      if (understanding.safety.emergency || understanding.safety.requestsHuman) return null;
      const topic = understanding.entities.businessInformationTopic;
      if (!isTopic(topic)) return null;
      return Object.freeze({
        capabilityId: CAPABILITY_ID,
        confidence: understanding.confidence,
        reason: "lead requested institutional information",
        payload: Object.freeze({ kind: "business-information", topic } as const),
      }) as CapabilityClaim<DentalClaimPayload>;
    },

    async decide(claim): Promise<Decision> {
      if (claim.payload.kind !== "business-information") return clarification();
      const resolution = await knowledge.resolveBusinessInformation(claim.payload.topic);
      if (resolution.kind !== "resolved" || resolution.topic !== claim.payload.topic) {
        return clarification();
      }
      if (
        resolution.organization.id.length === 0
        || resolution.organization.displayName.trim().length === 0
        || resolution.evidenceRef.length === 0
        || resolution.facts.length === 0
        || resolution.facts.some((fact) => !validDisplayValue(fact.value))
      ) {
        return clarification();
      }
      const subject = {
        type: "organization",
        id: resolution.organization.id,
        displayName: resolution.organization.displayName,
      };
      const facts: readonly Fact[] = resolution.facts.map((fact) => ({
        key: fact.key,
        value: { kind: "display_text", value: fact.value },
        subject,
        evidence: { source: "read", reference: resolution.evidenceRef },
        disclosure: "allowed",
      }));
      return { kind: "answer", facts, nextBestStep: null };
    },

    async execute(decision): Promise<ActionResult<typeof DENTAL_OUTCOME_SCHEMA>> {
      if (decision.kind === "answer") {
        const [first, ...remaining] = decision.facts;
        if (!first?.subject) {
          throw new Error("business_information_answered requires a subject");
        }
        return {
          type: "business_information_answered",
          semanticClass: "information_authorized",
          origin: { capabilityId: CAPABILITY_ID },
          subject: first.subject,
          evidence: [first.evidence, ...remaining.map((fact) => fact.evidence)],
          facts: decision.facts,
        };
      }
      return {
        type: "clarification_required",
        semanticClass: "clarification_required",
        origin: { capabilityId: CAPABILITY_ID },
        subject: null,
        evidence: [],
        facts: [],
      };
    },
  };
}
