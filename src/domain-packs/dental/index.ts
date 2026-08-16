import type { DomainPack } from "@/domain-packs/contract";
import { dentalCatalogCapability, dentalEscalationCapability, dentalSchedulingCapability, type DentalPolicy } from "@/domain-packs/dental/capabilities";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

export type { DentalPolicy } from "@/domain-packs/dental/capabilities";
export type { DentalRequest } from "@/domain-packs/dental/vocabulary";

export const dentalPack: DomainPack<DentalRequest, DentalPolicy> = {
  id: "dental",
  capabilities: [dentalCatalogCapability, dentalSchedulingCapability, dentalEscalationCapability],
  journeys: [
    { id: "price", capabilityIds: ["dental-catalog", "dental-escalation"] },
    { id: "availability", capabilityIds: ["dental-scheduling", "dental-escalation"] },
    { id: "scheduling", capabilityIds: ["dental-scheduling", "dental-escalation"] },
  ],
};
