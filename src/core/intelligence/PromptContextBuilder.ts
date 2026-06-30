// Única porta de derivação de vocabulário por segmento.
// Transforma campos de configuração do tenant em termos prontos para uso em prompts.
// Nunca derive vocabulário de prompt em outro lugar — sempre passe PromptContext.

import type { Organization } from "@/domain/entities/clinic";
import { resolveSegmentVocab } from "@/application/onboarding/segment-vocab";

export type PromptContext = {
  agentRole: string;          // ex: "recepcionista virtual" | "atendente virtual"
  serviceNoun: string;        // ex: "tratamento" | "pedido"
  bookingNoun: string;        // ex: "consulta" | "entrega"
  contactNoun: string;        // ex: "paciente" | "cliente"
  businessDescriptor: string; // ex: "clínica de odontologia" | "ateliê especializado em uniformes..."
  isClinicSegment: boolean;   // ativa regras específicas de saúde (urgência clínica, paciente chegou)
};

const CLINIC_SEGMENT_PATTERN = /dental|saude|saúde|clinic|medic|estétic|estetica|odonto/i;

export function buildPromptContext(
  clinic: Pick<
    Organization,
    "segment" | "specialty" | "serviceNoun" | "bookingNoun" | "contactNoun" | "agentRole" | "businessDescriptor"
  >,
): PromptContext {
  return {
    agentRole: clinic.agentRole,
    serviceNoun: clinic.serviceNoun,
    bookingNoun: clinic.bookingNoun,
    contactNoun: clinic.contactNoun,
    businessDescriptor: clinic.businessDescriptor ?? resolveSegmentVocab(clinic.segment).businessDescriptor ?? `${resolveSegmentVocab(clinic.segment).businessNoun} de ${clinic.specialty}`,
    isClinicSegment: CLINIC_SEGMENT_PATTERN.test(clinic.segment),
  };
}
