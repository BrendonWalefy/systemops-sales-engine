import type { Capability, CapabilityClaim } from "@/conversation-core/capability/contract";
import type { ActionResult, Decision } from "@/conversation-core/decision";
import type { Understanding } from "@/conversation-core/understanding/schema";
import {
  DENTAL_OUTCOME_SCHEMA,
  serviceChoice,
  serviceChoiceResult,
  type DentalClaimPayload,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import type { DentalCatalogReadPort } from "@/domain-packs/dental/ports";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";
import { isSafeAuthorizedDisplayText } from "@/conversation-core/authorized-response-plan";

const CAPABILITY_ID = "dental-explanation";
/** Teto de um fato de texto divulgável no plano autorizado. */
const MAX_DESCRIPTION_LENGTH = 240;

/**
 * Responde "o que é isso?" com o texto que a organização cadastrou, e só com
 * ele. Sem descrição cadastrada não existe explicação autorizada — a capability
 * pergunta em vez de deixar o modelo preencher a lacuna.
 */
export function createDentalExplanationCapability(
  catalog: DentalCatalogReadPort,
): Capability<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload,
  typeof DENTAL_OUTCOME_SCHEMA
> {
  return {
    id: CAPABILITY_ID,

    claim(understanding: Understanding<DentalRequest>) {
      if (
        understanding.request !== "explain-service"
        && understanding.request !== "compare-services"
      ) return null;
      if (understanding.safety.emergency || understanding.safety.requestsHuman) return null;
      if (understanding.request === "compare-services") {
        const candidates = understanding.entities.serviceCandidates;
        if (!Array.isArray(candidates) || candidates.length !== 2) return null;
        const normalized = candidates.map((candidate) =>
          typeof candidate === "string"
            ? candidate.trim().toLocaleLowerCase("pt-BR")
            : ""
        );
        if (normalized.some((candidate) => !candidate) || new Set(normalized).size !== 2) {
          return null;
        }
        const serviceQueries = candidates as unknown as readonly [string, string];
        return Object.freeze({
          capabilityId: CAPABILITY_ID,
          confidence: understanding.confidence,
          reason: "lead asked to compare two services",
          payload: Object.freeze({
            kind: "explanation",
            request: "compare-services",
            serviceQueries,
          } as const),
        }) as CapabilityClaim<DentalClaimPayload>;
      }
      const serviceQuery = understanding.entities.service;
      if (typeof serviceQuery !== "string" || serviceQuery.length === 0) return null;
      return Object.freeze({
        capabilityId: CAPABILITY_ID,
        confidence: understanding.confidence,
        reason: "lead asked what the service is",
        payload: Object.freeze({
          kind: "explanation",
          request: "explain-service",
          serviceQuery,
        } as const),
      }) as CapabilityClaim<DentalClaimPayload>;
    },

    async decide(claim): Promise<Decision> {
      const payload = claim.payload;
      if (payload.kind !== "explanation") {
        return { kind: "ask", questionId: "explanation-which-service" };
      }
      if (payload.request === "compare-services") {
        const resolutions = await catalog.resolveServices(payload.serviceQueries);
        if (resolutions.some((resolution) => resolution.kind !== "exact")) {
          return { kind: "ask", questionId: "comparison-which-services" };
        }
        const exact = resolutions as readonly [
          Extract<(typeof resolutions)[number], { kind: "exact" }>,
          Extract<(typeof resolutions)[number], { kind: "exact" }>,
        ];
        const facts = exact.map((resolution) => {
          const description = resolution.service.description?.trim() ?? "";
          if (
            description.length === 0
            || description.length > MAX_DESCRIPTION_LENGTH
            || !isSafeAuthorizedDisplayText(description)
          ) return null;
          return {
            key: "service_description",
            value: { kind: "display_text" as const, value: description },
            subject: {
              type: "service" as const,
              id: resolution.service.id,
              displayName: resolution.service.name,
            },
            evidence: { source: "read" as const, reference: resolution.evidenceRef },
            disclosure: "allowed" as const,
          };
        });
        if (facts.some((fact) => fact === null)) {
          return { kind: "ask", questionId: "comparison-not-registered" };
        }
        return { kind: "answer", facts: facts as Exclude<(typeof facts)[number], null>[], nextBestStep: null };
      }
      const resolution = await catalog.resolveService(payload.serviceQuery);
      if (resolution.kind === "ambiguous") {
        return serviceChoice(resolution.candidates, resolution.evidenceRef);
      }
      if (resolution.kind !== "exact") {
        return { kind: "ask", questionId: "explanation-which-service" };
      }
      const description = resolution.service.description?.trim() ?? "";
      if (
        description.length === 0
        || description.length > MAX_DESCRIPTION_LENGTH
        || !isSafeAuthorizedDisplayText(description)
      ) {
        return { kind: "ask", questionId: "explanation-not-registered" };
      }
      // Tudo que o execute precisa viaja dentro da própria Decision: ela é
      // clonada entre as duas etapas, então nada sobrevive fora dela.
      return {
        kind: "answer",
        facts: [{
          key: "service_description",
          value: { kind: "display_text", value: description },
          subject: {
            type: "service",
            id: resolution.service.id,
            displayName: resolution.service.name,
          },
          evidence: { source: "read", reference: resolution.evidenceRef },
          disclosure: "allowed",
        }],
        nextBestStep: null,
      };
    },

    async execute(decision): Promise<ActionResult<typeof DENTAL_OUTCOME_SCHEMA>> {
      const choice = serviceChoiceResult(CAPABILITY_ID, decision);
      if (choice) return choice;
      if (decision.kind === "answer") {
        if (decision.facts.length === 2) {
          return {
            type: "services_compared",
            semanticClass: "information_authorized",
            origin: { capabilityId: CAPABILITY_ID },
            subject: null,
            evidence: [
              decision.facts[0]!.evidence,
              ...decision.facts.slice(1).map((fact) => fact.evidence),
            ],
            facts: decision.facts,
          };
        }
        const fact = decision.facts[0];
        if (!fact?.subject) throw new Error("service_explained requires a subject");
        return {
          type: "service_explained",
          semanticClass: "information_authorized",
          origin: { capabilityId: CAPABILITY_ID },
          subject: fact.subject,
          evidence: [fact.evidence],
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
