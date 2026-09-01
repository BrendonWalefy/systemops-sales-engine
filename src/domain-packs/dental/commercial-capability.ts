import { isSafeAuthorizedDisplayText } from "@/conversation-core/authorized-response-plan";
import type { Capability } from "@/conversation-core/capability/contract";
import type { ActionResult, Decision, Fact, Subject } from "@/conversation-core/decision";
import {
  DENTAL_OUTCOME_SCHEMA,
  serviceChoice,
  serviceChoiceResult,
  type DentalClaimPayload,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import type {
  DentalCommercialQuantityPrice,
  DentalCommercialReadPort,
  DentalCommercialService,
} from "@/domain-packs/dental/ports";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

const CAPABILITY_ID = "dental-commercial";

function serviceSubject(service: DentalCommercialService): Subject {
  return { type: "service", id: service.id, displayName: service.name };
}

function evidence(reference: string) {
  return { source: "read" as const, reference };
}

function moneyFact(
  key: string,
  cents: number,
  subject: Subject,
  evidenceRef: string,
): Fact {
  return {
    key,
    value: { kind: "money", amountInMinor: cents, currency: "BRL" },
    subject,
    evidence: evidence(evidenceRef),
    disclosure: "allowed",
  };
}

function textFact(
  key: string,
  value: string,
  subject: Subject,
  evidenceRef: string,
): Fact {
  return {
    key,
    value: { kind: "display_text", value },
    subject,
    evidence: evidence(evidenceRef),
    disclosure: "allowed",
  };
}

function quantityFact(
  price: DentalCommercialQuantityPrice,
  subject: Subject,
  evidenceRef: string,
): Fact[] {
  const facts: Fact[] = [{
    key: "package_quantity",
    value: { kind: "integer", value: price.quantity },
    subject,
    evidence: evidence(evidenceRef),
    disclosure: "allowed",
  }];
  if (price.scope !== "total") {
    facts.push(textFact(
      "package_scope",
      price.scope === "superior" ? "arcada superior" : "arcada inferior",
      subject,
      evidenceRef,
    ));
  }
  facts.push(moneyFact("price_cents", price.priceCents, subject, evidenceRef));
  return facts;
}

function validCents(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function validQuantityPrices(
  values: readonly DentalCommercialQuantityPrice[],
): boolean {
  if (values.length > 12) return false;
  const identities = new Set<string>();
  for (const value of values) {
    const identity = `${value.quantity}:${value.scope}`;
    if (
      !Number.isSafeInteger(value.quantity)
      || value.quantity <= 0
      || !["total", "superior", "inferior"].includes(value.scope)
      || !validCents(value.priceCents)
      || identities.has(identity)
    ) return false;
    identities.add(identity);
  }
  return true;
}

function formatCampaignEnd(value: Date): string | null {
  if (!Number.isFinite(value.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function basePriceFacts(
  service: DentalCommercialService,
  evidenceRef: string,
): Fact[] | null {
  if (!validCents(service.priceCents)) return null;
  const subject = serviceSubject(service);
  const facts: Fact[] = [moneyFact("price_cents", service.priceCents, subject, evidenceRef)];
  if (service.priceKind === "from") {
    facts.push(textFact("price_qualifier", "a partir de", subject, evidenceRef));
  }
  const hasCampaign = service.campaignName !== null || service.originalPriceCents !== null ||
    service.campaignEndsAt !== null;
  if (hasCampaign) {
    if (
      !validCents(service.originalPriceCents)
      || service.campaignName === null
      || !isSafeAuthorizedDisplayText(service.campaignName)
    ) return null;
    facts.push(moneyFact("original_price_cents", service.originalPriceCents, subject, evidenceRef));
    facts.push(textFact("campaign_name", service.campaignName, subject, evidenceRef));
    if (service.campaignEndsAt !== null) {
      const end = formatCampaignEnd(service.campaignEndsAt);
      if (!end) return null;
      facts.push(textFact("campaign_end_date", end, subject, evidenceRef));
    }
  }
  return facts;
}

function packageDecision(
  service: DentalCommercialService,
  prices: readonly DentalCommercialQuantityPrice[],
  evidenceRef: string,
): Decision {
  const subject = serviceSubject(service);
  return {
    kind: "offer",
    subject,
    options: prices.map((price) => {
      const id = `${service.id}:quantity:${price.quantity}:${price.scope}`;
      const packageSubject: Subject = {
        type: "service_package",
        id,
        displayName: `${service.name} — ${price.quantity}${price.scope === "total" ? "" : ` ${price.scope}`}`,
      };
      return { id, facts: quantityFact(price, packageSubject, evidenceRef) };
    }),
    nextBestStep: null,
  };
}

function commercialResult(decision: Decision): ActionResult<typeof DENTAL_OUTCOME_SCHEMA> {
  if (decision.kind === "answer" && decision.facts[0]?.subject) {
    const uniqueEvidence = [...new Map(
      decision.facts.map(({ evidence }) => [`${evidence.source}:${evidence.reference}`, evidence]),
    ).values()];
    return {
      type: "commercial_answered",
      semanticClass: "information_authorized",
      origin: { capabilityId: CAPABILITY_ID },
      subject: decision.facts[0].subject,
      evidence: uniqueEvidence as [typeof uniqueEvidence[number], ...typeof uniqueEvidence[number][]],
      facts: decision.facts,
    };
  }
  if (decision.kind === "offer" && decision.options.length > 0) {
    const options = decision.options.map((option) => ({
      id: option.id,
      subject: option.facts[0]!.subject!,
      facts: option.facts,
    }));
    return {
      type: "commercial_options_offered",
      semanticClass: "options_found",
      origin: { capabilityId: CAPABILITY_ID },
      subject: null,
      evidence: [options[0]!.facts[0]!.evidence],
      facts: [],
      options: options as [typeof options[number], ...typeof options[number][]],
    };
  }
  if (decision.kind === "escalate") {
    return {
      type: "escalation_required",
      semanticClass: "human_action_required",
      origin: { capabilityId: CAPABILITY_ID },
      subject: null,
      evidence: [],
      facts: [],
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
}

export function createDentalCommercialCapability(
  readPort: DentalCommercialReadPort,
): Capability<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload,
  typeof DENTAL_OUTCOME_SCHEMA
> {
  return {
    id: CAPABILITY_ID,
    claim(understanding) {
      const serviceQuery = understanding.entities.service;
      const hasObjection = typeof understanding.signals.objection === "string"
        && understanding.signals.objection.trim().length > 0;
      if (
        understanding.request !== "price-of-service"
        || typeof serviceQuery !== "string"
        || serviceQuery.trim().length === 0
        || hasObjection
      ) return null;
      const quantity = understanding.entities.quantity;
      const quantityScope = understanding.entities.quantityScope;
      return {
        capabilityId: CAPABILITY_ID,
        confidence: understanding.confidence,
        reason: "structured_commercial_request",
        payload: {
          kind: "commercial",
          request: "price-of-service",
          serviceQuery,
          quantity: typeof quantity === "number" ? quantity : null,
          quantityScope: quantityScope === "total" || quantityScope === "superior" || quantityScope === "inferior"
            ? quantityScope
            : null,
        },
      };
    },
    async decide(claim, capabilityContext): Promise<Decision> {
      if (claim.payload.kind !== "commercial") {
        return { kind: "ask", questionId: "invalid-commercial-claim" };
      }
      const resolution = await readPort.resolveService(claim.payload.serviceQuery);
      if (resolution.kind === "ambiguous") {
        return serviceChoice(resolution.candidates, resolution.evidenceRef);
      }
      if (resolution.kind !== "exact") {
        return { kind: "ask", questionId: "clarify-service" };
      }
      const service = resolution.service;
      const payload = claim.payload;
      if (
        !capabilityContext.policy.priceDisclosureEnabled
        || !service.priceDisclosable
        || !isSafeAuthorizedDisplayText(service.name)
        || !validQuantityPrices(service.quantityPrices)
      ) {
        return capabilityContext.policy.humanEscalationRequired
          ? { kind: "escalate", reason: "price_disclosure_requires_human" }
          : { kind: "ask", questionId: "price-requires-human" };
      }
      if (service.quantityPrices.length > 0) {
        const quantityMatches = payload.quantity === null
          ? []
          : service.quantityPrices.filter(({ quantity }) => quantity === payload.quantity);
        const exact = payload.quantityScope === null
          ? quantityMatches
          : quantityMatches.filter(({ scope }) => scope === payload.quantityScope);
        if (exact.length === 1) {
          return {
            kind: "answer",
            facts: quantityFact(exact[0]!, serviceSubject(service), resolution.evidenceRef),
            nextBestStep: null,
          };
        }
        return packageDecision(service, service.quantityPrices, resolution.evidenceRef);
      }
      if (payload.quantity !== null) {
        return { kind: "ask", questionId: "quantity-price-not-registered" };
      }
      const facts = basePriceFacts(service, resolution.evidenceRef);
      return facts
        ? { kind: "answer", facts, nextBestStep: null }
        : { kind: "ask", questionId: "price-not-registered" };
    },
    async execute(decision) {
      const serviceOptions = decision.kind === "offer" && decision.subject.type === "service_choice"
        ? serviceChoiceResult(CAPABILITY_ID, decision)
        : null;
      return serviceOptions ?? commercialResult(decision);
    },
  };
}
