import type { DomainPack } from "@/domain-packs/contract";
import {
  createDentalCatalogCapability,
  createDentalEscalationCapability,
  createDentalSchedulingCapability,
  DENTAL_OUTCOME_SCHEMA,
  type DentalClaimPayload,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import type {
  DentalCatalogReadPort,
  DentalSchedulingReadPort,
  DentalSchedulingWritePort,
} from "@/domain-packs/dental/ports";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";


export type {
  DentalClaimPayload,
  DentalOutcomeType,
  DentalPolicy,
} from "@/domain-packs/dental/capabilities";
export type { DentalSchedulingWritePort } from "@/domain-packs/dental/ports";
export { DENTAL_OUTCOME_SCHEMA } from "@/domain-packs/dental/capabilities";
export {
  DENTAL_OUTCOME_PROVENANCE,
  dentalDecisionProvenanceIdentity,
  dentalOutcomeStructuralSummary,
  isDentalExecuteDecisionIdentity,
  isDentalOutcomeStructuralSummary,
  type DentalDecisionProvenanceIdentity,
  type DentalCapabilityId,
  type DentalExecuteAction,
  type DentalExecuteDecisionIdentity,
  type DentalOutcomeStructuralSummary,
} from "@/domain-packs/dental/outcome-provenance";
export type { DentalRequest } from "@/domain-packs/dental/vocabulary";

export function createDentalPack(ports: {
  catalogRead: DentalCatalogReadPort;
  schedulingRead: DentalSchedulingReadPort;
  schedulingWrite: DentalSchedulingWritePort;
}): DomainPack<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload,
  typeof DENTAL_OUTCOME_SCHEMA
> {
  return {
    id: "dental",
    outcomeSchema: DENTAL_OUTCOME_SCHEMA,
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
  schedulingWrite: {
    persistSlotOffer: unavailable,
    bookSlot: unavailable,
    confirmAppointment: unavailable,
  },
});
