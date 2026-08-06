import { DEFAULT_AGENT_ROLE } from "@/domain/entities/clinic";

type SegmentVocab = {
  bookingNoun: string;
  contactNoun: string;
  agentRole: string;
  businessDescriptor: string | null;
  // Nome do tipo de negócio — usado em labels de UI e conteúdo de playbook
  businessNoun: string;
};

const SEGMENT_VOCAB: Record<string, SegmentVocab> = {
  dental: {
    bookingNoun: "consulta",
    contactNoun: "paciente",
    agentRole: DEFAULT_AGENT_ROLE,
    businessDescriptor: null,
    businessNoun: "clínica",
  },
  aesthetics: {
    bookingNoun: "consulta",
    contactNoun: "paciente",
    agentRole: DEFAULT_AGENT_ROLE,
    businessDescriptor: null,
    businessNoun: "clínica",
  },
  barbershop: {
    bookingNoun: "corte",
    contactNoun: "cliente",
    agentRole: DEFAULT_AGENT_ROLE,
    businessDescriptor: null,
    businessNoun: "barbearia",
  },
  hair_salon: {
    bookingNoun: "horário",
    contactNoun: "cliente",
    agentRole: DEFAULT_AGENT_ROLE,
    businessDescriptor: null,
    businessNoun: "salão",
  },
  atelier: {
    bookingNoun: "entrega",
    contactNoun: "cliente",
    agentRole: DEFAULT_AGENT_ROLE,
    businessDescriptor: "ateliê especializado em uniformes, bordados e peças personalizadas",
    businessNoun: "ateliê",
  },
  cortinas: {
    bookingNoun: "instalação",
    contactNoun: "cliente",
    agentRole: DEFAULT_AGENT_ROLE,
    businessDescriptor: "loja especializada em cortinas e persianas",
    businessNoun: "loja",
  },
  retail: {
    bookingNoun: "atendimento",
    contactNoun: "cliente",
    agentRole: DEFAULT_AGENT_ROLE,
    businessDescriptor: "loja de varejo",
    businessNoun: "loja",
  },
  pet_services: {
    bookingNoun: "atendimento",
    contactNoun: "cliente",
    agentRole: DEFAULT_AGENT_ROLE,
    businessDescriptor: "negócio de serviços para pets",
    businessNoun: "pet shop",
  },
  fitness: {
    bookingNoun: "aula",
    contactNoun: "cliente",
    agentRole: DEFAULT_AGENT_ROLE,
    businessDescriptor: "negócio de fitness e bem-estar",
    businessNoun: "studio",
  },
  education: {
    bookingNoun: "aula",
    contactNoun: "aluno",
    agentRole: DEFAULT_AGENT_ROLE,
    businessDescriptor: "negócio de cursos e educação",
    businessNoun: "escola",
  },
  real_estate: {
    bookingNoun: "visita",
    contactNoun: "cliente",
    agentRole: DEFAULT_AGENT_ROLE,
    businessDescriptor: "imobiliária",
    businessNoun: "imobiliária",
  },
  professional_services: {
    bookingNoun: "reunião",
    contactNoun: "cliente",
    agentRole: DEFAULT_AGENT_ROLE,
    businessDescriptor: "empresa de serviços profissionais",
    businessNoun: "empresa",
  },
  automotive: {
    bookingNoun: "serviço",
    contactNoun: "cliente",
    agentRole: DEFAULT_AGENT_ROLE,
    businessDescriptor: "negócio automotivo",
    businessNoun: "auto center",
  },
  events: {
    bookingNoun: "evento",
    contactNoun: "cliente",
    agentRole: DEFAULT_AGENT_ROLE,
    businessDescriptor: "empresa de eventos",
    businessNoun: "empresa",
  },
  restaurant: {
    bookingNoun: "reserva",
    contactNoun: "cliente",
    agentRole: DEFAULT_AGENT_ROLE,
    businessDescriptor: "restaurante ou operação de food service",
    businessNoun: "restaurante",
  },
};

const DEFAULT_VOCAB: SegmentVocab = {
  bookingNoun: "atendimento",
  contactNoun: "cliente",
  agentRole: DEFAULT_AGENT_ROLE,
  businessDescriptor: null,
  businessNoun: "empresa",
};

export function resolveSegmentVocab(segment: string): SegmentVocab {
  return SEGMENT_VOCAB[segment] ?? DEFAULT_VOCAB;
}
