import type { Capability, CapabilityClaim } from "@/conversation-core/capability/contract";
import type { ActionResult, Decision } from "@/conversation-core/decision";
import type { Understanding } from "@/conversation-core/understanding/schema";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

export type DentalPolicy = {
  priceDisclosureEnabled: boolean;
  humanEscalationRequired: boolean;
};

function claim(capabilityId: string, confidence: number): CapabilityClaim {
  return { capabilityId, confidence, reason: "structured_dental_request" };
}

const noExecution = async (): Promise<ActionResult> => ({
  type: "not_executable_until_cycle_g",
  facts: [],
});

export const dentalCatalogCapability: Capability<DentalRequest, DentalPolicy> = {
  id: "dental-catalog",
  claim: (understanding) => understanding.request === "price-of-service"
    ? claim("dental-catalog", understanding.confidence)
    : null,
  async decide(_claim, context): Promise<Decision> {
    return { kind: "answer", facts: [{ key: "price_disclosure_enabled", value: context.policy.priceDisclosureEnabled }], nextBestStep: null };
  },
  execute: noExecution,
};

const schedulingRequests = new Set<DentalRequest>([
  "service-availability", "book-appointment", "confirm-slot", "confirm-appointment",
]);

export const dentalSchedulingCapability: Capability<DentalRequest, DentalPolicy> = {
  id: "dental-scheduling",
  claim: (understanding) => understanding.request && schedulingRequests.has(understanding.request)
    ? claim("dental-scheduling", understanding.confidence)
    : null,
  async decide(): Promise<Decision> {
    return { kind: "ask", questionId: "cycle-g-scheduling-required" };
  },
  execute: noExecution,
};

export const dentalEscalationCapability: Capability<DentalRequest, DentalPolicy> = {
  id: "dental-escalation",
  claim(understanding: Understanding<DentalRequest>) {
    return understanding.safety.emergency || understanding.safety.requestsHuman
      ? { ...claim("dental-escalation", 1), conflictsWith: ["dental-catalog", "dental-scheduling"] }
      : null;
  },
  async decide(): Promise<Decision> {
    return { kind: "escalate", reason: "structured_safety_signal" };
  },
  execute: noExecution,
};
