import type {
  Capability,
  CapabilityClaim,
} from "@/conversation-core/capability/contract";
import type { ActionResult, Decision, Fact } from "@/conversation-core/decision";
import type { Understanding } from "@/conversation-core/understanding/schema";
import { isSafeAuthorizedDisplayText } from "@/conversation-core/authorized-response-plan";
import {
  DENTAL_OUTCOME_SCHEMA,
  type DentalClaimPayload,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import type {
  DentalBusinessInformationFact,
  DentalKnowledgeReadPort,
} from "@/domain-packs/dental/ports";
import {
  DENTAL_BUSINESS_INFORMATION_TOPICS,
  type DentalBusinessInformationTopic,
  type DentalRequest,
} from "@/domain-packs/dental/vocabulary";

const CAPABILITY_ID = "dental-knowledge";
const topics: ReadonlySet<string> = new Set(DENTAL_BUSINESS_INFORMATION_TOPICS);
const factKeys: Readonly<Record<DentalBusinessInformationTopic, DentalBusinessInformationFact["key"] | null>> = {
  address: "address",
  "business-hours": "business_hours",
  "location-guidance": "location_guidance",
  parking: "parking_information",
  social: "social_channels",
};
const unavailableText: Readonly<Record<DentalBusinessInformationTopic, string>> = {
  address: "O endereço ainda não está cadastrado para informar.",
  "business-hours": "O horário de atendimento ainda não está cadastrado para informar.",
  "location-guidance": "As orientações de localização ainda não estão cadastradas para informar.",
  parking: "As informações de estacionamento ainda não estão cadastradas para informar.",
  social: "Os canais de redes sociais ainda não estão cadastrados para informar.",
};

function isTopic(value: unknown): value is DentalBusinessInformationTopic {
  return typeof value === "string" && topics.has(value);
}

function validDisplayValue(value: string): boolean {
  return isSafeAuthorizedDisplayText(value);
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
      if (resolution.topic !== claim.payload.topic) {
        return clarification();
      }
      const subject = {
        type: "organization",
        id: resolution.organization.id,
        displayName: resolution.organization.displayName,
      };
      if (
        resolution.organization.id.length === 0
        || resolution.organization.displayName.trim().length === 0
        || resolution.evidenceRef.length === 0
      ) {
        return clarification();
      }
      if (resolution.kind === "missing") {
        return {
          kind: "answer",
          facts: [{
            key: "business_information_unavailable",
            value: { kind: "display_text", value: unavailableText[resolution.topic] },
            subject,
            evidence: { source: "read", reference: resolution.evidenceRef },
            disclosure: "allowed",
          }],
          nextBestStep: null,
        };
      }
      const expectedFactKey = factKeys[resolution.topic];
      if (
        expectedFactKey === null
        || resolution.facts.length !== 1
        || resolution.facts[0]?.key !== expectedFactKey
        || !validDisplayValue(resolution.facts[0].value)
      ) return clarification();
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
          type: first.key === "business_information_unavailable"
            ? "business_information_unavailable"
            : "business_information_answered",
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
