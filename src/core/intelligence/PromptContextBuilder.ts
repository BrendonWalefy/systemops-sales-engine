// Única porta de derivação de vocabulário por segmento.
// Transforma campos de configuração do tenant em termos prontos para uso em prompts.
// Nunca derive vocabulário de prompt em outro lugar — sempre passe PromptContext.

import type { Clinic } from "@/domain/entities/clinic";

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
    Clinic,
    "segment" | "specialty" | "serviceNoun" | "bookingNoun" | "contactNoun" | "agentRole" | "businessDescriptor"
  >,
): PromptContext {
  return {
    agentRole: clinic.agentRole,
    serviceNoun: clinic.serviceNoun,
    bookingNoun: clinic.bookingNoun,
    contactNoun: clinic.contactNoun,
    businessDescriptor: clinic.businessDescriptor ?? `clínica de ${clinic.specialty}`,
    isClinicSegment: CLINIC_SEGMENT_PATTERN.test(clinic.segment),
  };
}
