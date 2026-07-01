export const SEGMENT_KEYS = [
  "dental",
  "aesthetics",
  "barbershop",
  "hair_salon",
  "atelier",
  "cortinas",
  "retail",
  "pet_services",
  "fitness",
  "education",
  "real_estate",
  "professional_services",
  "automotive",
  "events",
  "restaurant",
  "other",
] as const;

export type SegmentKey = (typeof SEGMENT_KEYS)[number];

export type SegmentOption = {
  key: SegmentKey;
  icon: string;
  label: string;
  shortLabel: string;
};

export type SegmentDefaults = {
  serviceNoun: string;
  businessHours: string;
  toneOfVoice: string;
  greetingPlaceholder: string;
  namePlaceholder: string;
  slugPlaceholder: string;
  specialtyDefault: string;
  specialtyPlaceholder: string;
  adminEmailPlaceholder: string;
};

export const SEGMENT_OPTIONS: SegmentOption[] = [
  { key: "dental", icon: "OD", label: "Odontologia", shortLabel: "Odonto" },
  { key: "aesthetics", icon: "ES", label: "Estética e beleza", shortLabel: "Estética" },
  { key: "barbershop", icon: "BB", label: "Barbearia", shortLabel: "Barbearia" },
  { key: "hair_salon", icon: "SL", label: "Salão de beleza", shortLabel: "Salão" },
  { key: "atelier", icon: "AT", label: "Ateliê e personalizados", shortLabel: "Ateliê" },
  { key: "cortinas", icon: "CP", label: "Cortinas e persianas", shortLabel: "Cortinas" },
  { key: "retail", icon: "LJ", label: "Loja e varejo", shortLabel: "Varejo" },
  { key: "pet_services", icon: "PT", label: "Pet services", shortLabel: "Pet" },
  { key: "fitness", icon: "FT", label: "Fitness e bem-estar", shortLabel: "Fitness" },
  { key: "education", icon: "ED", label: "Cursos e educação", shortLabel: "Educação" },
  { key: "real_estate", icon: "IM", label: "Imobiliária", shortLabel: "Imobiliária" },
  { key: "professional_services", icon: "SP", label: "Serviços profissionais", shortLabel: "Serviços" },
  { key: "automotive", icon: "AU", label: "Automotivo", shortLabel: "Auto" },
  { key: "events", icon: "EV", label: "Eventos", shortLabel: "Eventos" },
  { key: "restaurant", icon: "FD", label: "Restaurante e food service", shortLabel: "Food" },
  { key: "other", icon: "OT", label: "Outro segmento", shortLabel: "Outro" },
];

export const SEGMENT_DEFAULTS: Record<SegmentKey, SegmentDefaults> = {
  dental: {
    serviceNoun: "tratamento",
    businessHours: "Seg-Sex 08:00-18:00, Sab 08:00-13:00",
    toneOfVoice: "acolhedor",
    greetingPlaceholder: "Olá! Sou a assistente virtual da clínica. Como posso ajudar?",
    namePlaceholder: "Odonto Prime",
    slugPlaceholder: "odonto-prime",
    specialtyDefault: "odontologia",
    specialtyPlaceholder: "odontologia",
    adminEmailPlaceholder: "dono@odontoprime.com.br",
  },
  aesthetics: {
    serviceNoun: "procedimento",
    businessHours: "Seg-Sex 09:00-19:00, Sab 09:00-15:00",
    toneOfVoice: "acolhedor",
    greetingPlaceholder: "Olá! Sou a assistente do espaço de estética. Como posso te ajudar?",
    namePlaceholder: "Studio Belle",
    slugPlaceholder: "studio-belle",
    specialtyDefault: "estetica",
    specialtyPlaceholder: "estetica, harmonizacao, beleza",
    adminEmailPlaceholder: "admin@studiobelle.com.br",
  },
  barbershop: {
    serviceNoun: "servico",
    businessHours: "Seg-Sab 09:00-20:00",
    toneOfVoice: "descontraido",
    greetingPlaceholder: "E aí! Sou o atendente da barbearia. Quer agendar qual serviço?",
    namePlaceholder: "Barbearia Central",
    slugPlaceholder: "barbearia-central",
    specialtyDefault: "barbearia",
    specialtyPlaceholder: "barbearia",
    adminEmailPlaceholder: "admin@barbeariacentral.com.br",
  },
  hair_salon: {
    serviceNoun: "servico",
    businessHours: "Ter-Sab 09:00-20:00",
    toneOfVoice: "amigavel",
    greetingPlaceholder: "Olá! Sou a assistente do salão. Quando quer agendar seu horário?",
    namePlaceholder: "Salao Lumi",
    slugPlaceholder: "salao-lumi",
    specialtyDefault: "salao de beleza",
    specialtyPlaceholder: "cabelo, maquiagem, manicure",
    adminEmailPlaceholder: "admin@salaolumi.com.br",
  },
  atelier: {
    serviceNoun: "pedido",
    businessHours: "Seg-Sex 08:00-18:00",
    toneOfVoice: "profissional",
    greetingPlaceholder: "Olá! Sou o atendente do ateliê. Como posso ajudar com seu pedido?",
    namePlaceholder: "Atelie Forma",
    slugPlaceholder: "atelie-forma",
    specialtyDefault: "uniformes e personalizados",
    specialtyPlaceholder: "uniformes, bordados, personalizados",
    adminEmailPlaceholder: "admin@atelieforma.com.br",
  },
  cortinas: {
    serviceNoun: "produto",
    businessHours: "Seg-Sex 09:00-18:00, Sab 09:00-13:00",
    toneOfVoice: "consultivo",
    greetingPlaceholder: "Olá! Sou o atendente da loja. Quer ajuda com cortinas ou persianas?",
    namePlaceholder: "Casa das Cortinas",
    slugPlaceholder: "casa-das-cortinas",
    specialtyDefault: "cortinas e persianas",
    specialtyPlaceholder: "cortinas, persianas, decoracao",
    adminEmailPlaceholder: "admin@casadascortinas.com.br",
  },
  retail: {
    serviceNoun: "produto",
    businessHours: "Seg-Sab 09:00-19:00",
    toneOfVoice: "profissional",
    greetingPlaceholder: "Olá! Sou o atendente da loja. Como posso ajudar?",
    namePlaceholder: "Loja Central",
    slugPlaceholder: "loja-central",
    specialtyDefault: "varejo",
    specialtyPlaceholder: "moda, decoracao, eletronicos",
    adminEmailPlaceholder: "admin@lojacentral.com.br",
  },
  pet_services: {
    serviceNoun: "servico",
    businessHours: "Seg-Sab 08:00-18:00",
    toneOfVoice: "acolhedor",
    greetingPlaceholder: "Olá! Sou o atendente do pet. Como posso ajudar você e seu pet?",
    namePlaceholder: "Pet Vila",
    slugPlaceholder: "pet-vila",
    specialtyDefault: "pet services",
    specialtyPlaceholder: "banho e tosa, veterinario, hotel pet",
    adminEmailPlaceholder: "admin@petvila.com.br",
  },
  fitness: {
    serviceNoun: "aula",
    businessHours: "Seg-Sex 06:00-22:00, Sab 08:00-14:00",
    toneOfVoice: "motivador",
    greetingPlaceholder: "Olá! Sou o atendente do studio. Quer ver horários ou planos?",
    namePlaceholder: "Studio Move",
    slugPlaceholder: "studio-move",
    specialtyDefault: "fitness",
    specialtyPlaceholder: "pilates, academia, personal, yoga",
    adminEmailPlaceholder: "admin@studiomove.com.br",
  },
  education: {
    serviceNoun: "curso",
    businessHours: "Seg-Sex 09:00-18:00",
    toneOfVoice: "didatico",
    greetingPlaceholder: "Olá! Sou o atendente da escola. Quer saber sobre qual curso?",
    namePlaceholder: "Escola Avancar",
    slugPlaceholder: "escola-avancar",
    specialtyDefault: "educacao",
    specialtyPlaceholder: "idiomas, reforco, cursos livres",
    adminEmailPlaceholder: "admin@escolaavancar.com.br",
  },
  real_estate: {
    serviceNoun: "imovel",
    businessHours: "Seg-Sex 09:00-18:00, Sab 09:00-13:00",
    toneOfVoice: "consultivo",
    greetingPlaceholder: "Olá! Sou o atendente da imobiliária. Procura comprar, vender ou alugar?",
    namePlaceholder: "Imobiliaria Norte",
    slugPlaceholder: "imobiliaria-norte",
    specialtyDefault: "imobiliaria",
    specialtyPlaceholder: "aluguel, venda, lancamentos",
    adminEmailPlaceholder: "admin@imobiliarianorte.com.br",
  },
  professional_services: {
    serviceNoun: "servico",
    businessHours: "Seg-Sex 09:00-18:00",
    toneOfVoice: "profissional",
    greetingPlaceholder: "Olá! Sou o atendente da empresa. Como posso ajudar?",
    namePlaceholder: "Consultoria Atlas",
    slugPlaceholder: "consultoria-atlas",
    specialtyDefault: "servicos profissionais",
    specialtyPlaceholder: "contabilidade, advocacia, consultoria",
    adminEmailPlaceholder: "admin@atlas.com.br",
  },
  automotive: {
    serviceNoun: "servico",
    businessHours: "Seg-Sex 08:00-18:00, Sab 08:00-12:00",
    toneOfVoice: "objetivo",
    greetingPlaceholder: "Olá! Sou o atendente da oficina. Qual serviço você precisa?",
    namePlaceholder: "Auto Center Prime",
    slugPlaceholder: "auto-center-prime",
    specialtyDefault: "automotivo",
    specialtyPlaceholder: "oficina, estetica automotiva, auto center",
    adminEmailPlaceholder: "admin@autocenterprime.com.br",
  },
  events: {
    serviceNoun: "evento",
    businessHours: "Seg-Sex 09:00-18:00",
    toneOfVoice: "consultivo",
    greetingPlaceholder: "Olá! Sou o atendente de eventos. Quer falar sobre qual data ou formato?",
    namePlaceholder: "Eventos Aurora",
    slugPlaceholder: "eventos-aurora",
    specialtyDefault: "eventos",
    specialtyPlaceholder: "buffet, cerimonial, espaco de eventos",
    adminEmailPlaceholder: "admin@eventosaurora.com.br",
  },
  restaurant: {
    serviceNoun: "reserva",
    businessHours: "Ter-Dom 11:00-23:00",
    toneOfVoice: "amigavel",
    greetingPlaceholder: "Olá! Sou o atendente do restaurante. Quer fazer uma reserva ou tirar uma dúvida?",
    namePlaceholder: "Bistro Aurora",
    slugPlaceholder: "bistro-aurora",
    specialtyDefault: "restaurante",
    specialtyPlaceholder: "restaurante, delivery, cafeteria",
    adminEmailPlaceholder: "admin@bistroaurora.com.br",
  },
  other: {
    serviceNoun: "servico",
    businessHours: "",
    toneOfVoice: "profissional",
    greetingPlaceholder: "Olá! Como posso ajudar?",
    namePlaceholder: "Empresa Exemplo",
    slugPlaceholder: "empresa-exemplo",
    specialtyDefault: "servicos",
    specialtyPlaceholder: "descreva o segmento",
    adminEmailPlaceholder: "admin@empresa.com.br",
  },
};

export function resolveSegmentDefaults(segment: string): SegmentDefaults {
  return SEGMENT_DEFAULTS[(SEGMENT_KEYS as readonly string[]).includes(segment) ? (segment as SegmentKey) : "other"];
}

export function resolveSegmentLabel(segment: string): string {
  return SEGMENT_OPTIONS.find((option) => option.key === segment)?.label ?? "Outro segmento";
}
