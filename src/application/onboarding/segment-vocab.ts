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
    agentRole: "recepcionista virtual",
    businessDescriptor: null,
    businessNoun: "clínica",
  },
  aesthetics: {
    bookingNoun: "consulta",
    contactNoun: "paciente",
    agentRole: "recepcionista virtual",
    businessDescriptor: null,
    businessNoun: "clínica",
  },
  barbershop: {
    bookingNoun: "corte",
    contactNoun: "cliente",
    agentRole: "atendente virtual",
    businessDescriptor: null,
    businessNoun: "barbearia",
  },
  hair_salon: {
    bookingNoun: "horário",
    contactNoun: "cliente",
    agentRole: "atendente virtual",
    businessDescriptor: null,
    businessNoun: "salão",
  },
  atelier: {
    bookingNoun: "entrega",
    contactNoun: "cliente",
    agentRole: "atendente virtual",
    businessDescriptor: "ateliê especializado em uniformes, bordados e peças personalizadas",
    businessNoun: "ateliê",
  },
  cortinas: {
    bookingNoun: "instalação",
    contactNoun: "cliente",
    agentRole: "atendente virtual",
    businessDescriptor: "loja especializada em cortinas e persianas",
    businessNoun: "loja",
  },
};

const DEFAULT_VOCAB: SegmentVocab = {
  bookingNoun: "consulta",
  contactNoun: "paciente",
  agentRole: "recepcionista virtual",
  businessDescriptor: null,
  businessNoun: "empresa",
};

export function resolveSegmentVocab(segment: string): SegmentVocab {
  return SEGMENT_VOCAB[segment] ?? DEFAULT_VOCAB;
}
