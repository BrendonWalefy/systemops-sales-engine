import type { DomainPack } from "@/domain-packs/contract";
import {
  createDentalCatalogCapability,
  createDentalEscalationCapability,
  createDentalReceptionCapability,
  createDentalSchedulingCapability,
  DENTAL_OUTCOME_SCHEMA,
  type DentalClaimPayload,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import { createDentalExplanationCapability } from "@/domain-packs/dental/explanation-capability";
import { createDentalKnowledgeCapability } from "@/domain-packs/dental/knowledge-capability";
import { createDentalPlaybookKnowledgeCapability } from "@/domain-packs/dental/playbook-knowledge-capability";
import { createDentalCommercialCapability } from "@/domain-packs/dental/commercial-capability";
import { createDentalAppointmentLifecycleCapability } from "@/domain-packs/dental/appointment-lifecycle-capability";
import type {
  DentalAppointmentLifecycleReadPort,
  DentalAppointmentLifecycleWritePort,
  DentalCatalogReadPort,
  DentalCommercialReadPort,
  DentalKnowledgeReadPort,
  DentalPlaybookKnowledgeReadPort,
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
export type {
  DentalBusinessInformationFact,
  DentalBusinessInformationResolution,
  DentalKnowledgeReadPort,
} from "@/domain-packs/dental/ports";
export { createDentalKnowledgeCapability } from "@/domain-packs/dental/knowledge-capability";
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
  knowledgeRead: DentalKnowledgeReadPort;
  playbookKnowledgeRead: DentalPlaybookKnowledgeReadPort;
  catalogRead: DentalCatalogReadPort;
  commercialRead: DentalCommercialReadPort;
  schedulingRead: DentalSchedulingReadPort;
  schedulingWrite: DentalSchedulingWritePort;
  appointmentLifecycleRead?: DentalAppointmentLifecycleReadPort;
  appointmentLifecycleWrite?: DentalAppointmentLifecycleWritePort;
}): DomainPack<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload,
  typeof DENTAL_OUTCOME_SCHEMA
> {
  const appointmentLifecycleRead = ports.appointmentLifecycleRead ?? {
    listActiveAppointments: unavailable,
    resolveActiveAppointment: unavailable,
    listReplacementSlots: unavailable,
  };
  const appointmentLifecycleWrite = ports.appointmentLifecycleWrite ?? {
    persistReplacementOffer: unavailable,
    cancelAppointment: unavailable,
  };
  return {
    id: "dental",
    outcomeSchema: DENTAL_OUTCOME_SCHEMA,
    capabilities: [
      createDentalKnowledgeCapability(ports.knowledgeRead),
      createDentalPlaybookKnowledgeCapability(ports.playbookKnowledgeRead),
      createDentalExplanationCapability(ports.catalogRead),
      createDentalCommercialCapability(ports.commercialRead),
      createDentalCatalogCapability(ports.catalogRead),
      createDentalSchedulingCapability(
        ports.schedulingRead,
        ports.schedulingWrite,
      ),
      createDentalAppointmentLifecycleCapability(
        appointmentLifecycleRead,
        appointmentLifecycleWrite,
      ),
      createDentalEscalationCapability(),
      createDentalReceptionCapability(),
    ],
    journeys: [
      { id: "knowledge", capabilityIds: ["dental-knowledge", "dental-escalation"] },
      { id: "playbook-knowledge", capabilityIds: ["dental-playbook-knowledge", "dental-escalation"] },
      { id: "explanation", capabilityIds: ["dental-explanation", "dental-escalation"] },
      { id: "price", capabilityIds: ["dental-commercial", "dental-escalation"] },
      {
        id: "availability",
        capabilityIds: ["dental-catalog", "dental-escalation"],
      },
      {
        id: "scheduling",
        capabilityIds: [
          "dental-scheduling",
          "dental-appointment-lifecycle",
          "dental-escalation",
        ],
      },
    ],
  };
}

const unavailable = async (): Promise<never> => {
  throw new Error("dental ports must be injected before decision execution");
};

export const dentalPack = createDentalPack({
  knowledgeRead: { resolveBusinessInformation: unavailable },
  playbookKnowledgeRead: {
    resolveDifferentials: unavailable,
    resolveFaq: unavailable,
  },
  catalogRead: { resolveService: unavailable, resolveServices: unavailable },
  commercialRead: {
    resolveService: unavailable,
    resolvePaymentConfiguration: unavailable,
    resolveRegisteredObjection: unavailable,
  },
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
