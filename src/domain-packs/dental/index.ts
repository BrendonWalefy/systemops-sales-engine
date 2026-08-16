import type { DomainPack } from "@/domain-packs/contract";
import {
  createDentalCatalogCapability,
  createDentalEscalationCapability,
  createDentalSchedulingCapability,
  type DentalClaimPayload,
  type DentalOutcomeType,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import type {
  DentalCatalogReadPort,
  DentalSchedulingReadPort,
  DentalSchedulingWritePort,
} from "@/domain-packs/dental/ports";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

export { DENTAL_RESPONSE_LANGUAGE } from "@/domain-packs/dental/response-language";

export type {
  DentalClaimPayload,
  DentalOutcomeType,
  DentalPolicy,
} from "@/domain-packs/dental/capabilities";
export type { DentalRequest } from "@/domain-packs/dental/vocabulary";

export function createDentalPack(ports: {
  catalogRead: DentalCatalogReadPort;
  schedulingRead: DentalSchedulingReadPort;
  schedulingWrite: DentalSchedulingWritePort;
}): DomainPack<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload,
  DentalOutcomeType
> {
  return {
    id: "dental",
    capabilities: [
      createDentalCatalogCapability(ports.catalogRead),
      createDentalSchedulingCapability(
        ports.schedulingRead,
        ports.schedulingWrite,
      ),
      createDentalEscalationCapability(),
    ],
    journeys: [
      { id: "price", capabilityIds: ["dental-catalog", "dental-escalation"] },
      {
        id: "availability",
        capabilityIds: ["dental-catalog", "dental-escalation"],
      },
      {
        id: "scheduling",
        capabilityIds: ["dental-scheduling", "dental-escalation"],
      },
    ],
  };
}

const unavailable = async (): Promise<never> => {
  throw new Error("dental ports must be injected before decision execution");
};

export const dentalPack = createDentalPack({
  catalogRead: { resolveService: unavailable },
  schedulingRead: {
    listSlots: unavailable,
    resolveOfferedSlot: unavailable,
    resolvePendingAppointment: unavailable,
  },
  schedulingWrite: { bookSlot: unavailable, confirmAppointment: unavailable },
});
