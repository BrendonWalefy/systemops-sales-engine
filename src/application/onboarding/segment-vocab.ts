type SegmentVocab = {
  bookingNoun: string;
  contactNoun: string;
  agentRole: string;
  businessDescriptor: string | null;
};

const SEGMENT_VOCAB: Record<string, SegmentVocab> = {
  atelier: {
    bookingNoun: "entrega",
    contactNoun: "cliente",
    agentRole: "atendente virtual",
    businessDescriptor: "ateliê especializado em uniformes, bordados e peças personalizadas",
  },
  cortinas: {
    bookingNoun: "instalação",
    contactNoun: "cliente",
    agentRole: "atendente virtual",
    businessDescriptor: "loja especializada em cortinas e persianas",
  },
};

const DEFAULT_VOCAB: SegmentVocab = {
  bookingNoun: "consulta",
  contactNoun: "paciente",
  agentRole: "recepcionista virtual",
  businessDescriptor: null,
};

export function resolveSegmentVocab(segment: string): SegmentVocab {
  return SEGMENT_VOCAB[segment] ?? DEFAULT_VOCAB;
}
