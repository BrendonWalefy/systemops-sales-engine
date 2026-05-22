import type { Message } from "@/domain/entities/conversation";

export type ReceptionistStage =
  | "new_lead"
  | "handling_price"
  | "collecting_schedule_preference"
  | "offering_slots"
  | "appointment_scheduled"
  | "handoff_required";

export type ReceptionistAction =
  | "send_message"
  | "offer_slots"
  | "schedule_appointment"
  | "handoff_human";

export type ReceptionistDecision = {
  stage: ReceptionistStage;
  action: ReceptionistAction;
  message: string;
  leadTemperature: "cold" | "warm" | "hot";
  appointment: {
    status: "none" | "offered" | "scheduled";
    selectedSlot: string | null;
  };
  handoffRequired: boolean;
  reason: string;
  followUp: string | null;
};

export type ReceptionistContext = {
  leadName: string | null;
  now: Date;
};

const slots = [
  { id: "slot-1", label: "terça-feira às 15h" },
  { id: "slot-2", label: "quarta-feira às 10h" },
  { id: "slot-3", label: "quinta-feira às 16h" },
];

export function decideAutonomousReceptionistReply(
  messages: Message[],
  context: ReceptionistContext = { leadName: null, now: new Date() },
): ReceptionistDecision {
  const lastLeadMessage =
    [...messages].reverse().find((message) => message.author === "lead")?.body ?? "";
  const normalized = normalize(lastLeadMessage);
  const opening = buildOpening(context);

  if (hasClinicalRisk(normalized)) {
    return {
      stage: "handoff_required",
      action: "handoff_human",
      message:
        `${opening} Entendi sua preocupação. Para sua segurança, vou chamar a equipe da clínica para avaliar seu caso e te responder com prioridade. Você pode me confirmar seu nome completo?`,
      leadTemperature: "hot",
      appointment: {
        status: "none",
        selectedSlot: null,
      },
      handoffRequired: true,
      reason: "Mensagem contém sinal clínico sensível.",
      followUp: null,
    };
  }

  const offeredSlot = findOfferedSlotSelection(normalized);
  if (offeredSlot) {
    return {
      stage: "appointment_scheduled",
      action: "schedule_appointment",
      message: `${opening} Perfeito, deixei sua avaliação gratuita pré-agendada para ${offeredSlot.label}. A equipe da clínica vai confirmar os dados finais por aqui. Vai ser uma boa oportunidade para a doutora entender seu caso com calma e te orientar do jeito certo.`,
      leadTemperature: "hot",
      appointment: {
        status: "scheduled",
        selectedSlot: offeredSlot.label,
      },
      handoffRequired: false,
      reason: "Lead escolheu um horário oferecido.",
      followUp: "Enviar lembrete de confirmação 24h antes da avaliação.",
    };
  }

  if (asksAvailability(normalized) || indicatesSchedulePreference(normalized)) {
    return {
      stage: "offering_slots",
      action: "offer_slots",
      message:
        `${opening} Que bom que você quer se organizar. A avaliação é gratuita e ajuda a doutora a entender seu caso antes de falar qualquer conduta ou valor. Tenho ${formatSlotsForMessage()} disponíveis. Qual fica melhor para você?`,
      leadTemperature: "hot",
      appointment: {
        status: "offered",
        selectedSlot: null,
      },
      handoffRequired: false,
      reason: "Lead demonstrou intenção de agenda.",
      followUp: "Se não escolher horário em 2 horas, retomar oferecendo as duas opções novamente.",
    };
  }

  if (asksPrice(normalized)) {
    return {
      stage: "offering_slots",
      action: "offer_slots",
      message:
        `${opening} Entendo sua pergunta. O valor pode variar conforme o objetivo e a avaliação, então prefiro não te passar uma informação rasa ou errada por aqui. A avaliação é gratuita e já consigo te encaixar em ${formatSlotsForMessage()}. Qual desses horários seria melhor para você?`,
      leadTemperature: "hot",
      appointment: {
        status: "offered",
        selectedSlot: null,
      },
      handoffRequired: false,
      reason: "Lead perguntou preço; agente respondeu e já ofereceu avaliação gratuita com horários.",
      followUp: "Se não responder em 2 horas, retomar com os horários disponíveis e reforçar avaliação gratuita.",
    };
  }

  if (asksGeneralInfo(normalized)) {
    return {
      stage: "offering_slots",
      action: "offer_slots",
      message:
        `${opening} Consigo te orientar sim. Esse tratamento muda bastante de pessoa para pessoa, por isso a avaliação gratuita é o melhor primeiro passo para entender seu objetivo e indicar o caminho correto. Temos ${formatSlotsForMessage()}. Quer que eu reserve um desses horários para você?`,
      leadTemperature: "warm",
      appointment: {
        status: "offered",
        selectedSlot: null,
      },
      handoffRequired: false,
      reason: "Lead pediu informação geral; agente respondeu e conduziu para avaliação gratuita.",
      followUp: "Se não responder em 3 horas, enviar lembrete curto com os horários disponíveis.",
    };
  }

  return {
    stage: "offering_slots",
    action: "offer_slots",
    message:
      `${opening} Posso te ajudar por aqui. A avaliação é gratuita e é o melhor caminho para a doutora entender seu caso e indicar o tratamento correto. Tenho ${formatSlotsForMessage()}. Quer que eu reserve um desses horários?`,
    leadTemperature: "warm",
    appointment: {
      status: "offered",
      selectedSlot: null,
    },
    handoffRequired: false,
    reason: "Lead novo; agente abriu conversa já oferecendo avaliação gratuita com horários.",
    followUp: "Se não responder em 4 horas, retomar com pergunta objetiva sobre qual horário prefere.",
  };
}

export function estimateReceptionistUsage(messages: Message[], reply: string) {
  const input = messages.map((message) => message.body).join("\n");

  return {
    inputTokens: Math.max(350, Math.ceil(input.length / 4) + 280),
    outputTokens: Math.max(70, Math.ceil(reply.length / 4)),
  };
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function buildOpening(context: ReceptionistContext): string {
  const name = getFirstName(context.leadName);
  const greeting = getGreeting(context.now);

  return name ? `${greeting}, ${name}!` : `${greeting}!`;
}

function getFirstName(name: string | null): string | null {
  const firstName = name?.trim().split(/\s+/)[0];
  return firstName || null;
}

function getGreeting(date: Date): string {
  const hour = date.getHours();

  if (hour < 12) {
    return "Bom dia";
  }

  if (hour < 18) {
    return "Boa tarde";
  }

  return "Boa noite";
}

function asksPrice(text: string): boolean {
  return ["preço", "preco", "valor", "quanto custa", "parcel", "orçamento", "orcamento"].some((term) =>
    text.includes(term),
  );
}

function asksAvailability(text: string): boolean {
  return ["horário", "horario", "agenda", "marcar", "consulta", "avaliação", "avaliacao", "disponível", "disponivel"].some((term) =>
    text.includes(term),
  );
}

function asksGeneralInfo(text: string): boolean {
  return [
    "como funciona",
    "me explica",
    "quero saber",
    "informação",
    "informacao",
    "informações",
    "tratamento",
    "clareamento",
    "implante",
    "aparelho",
    "harmonização",
    "harmonizacao",
    "faceta",
  ].some((term) => text.includes(term));
}

function indicatesSchedulePreference(text: string): boolean {
  return ["manhã", "manha", "tarde", "noite", "essa semana", "amanhã", "amanha", "segunda", "terça", "terca", "quarta"].some(
    (term) => text.includes(term),
  );
}

function hasClinicalRisk(text: string): boolean {
  return ["dor", "inchado", "sangrando", "infecção", "infeccao", "urgente", "emergência", "emergencia"].some((term) =>
    text.includes(term),
  );
}

function findOfferedSlotSelection(text: string) {
  if (["terca", "terça", "15h", "primeiro"].some((term) => text.includes(term))) {
    return slots[0];
  }

  if (["quarta", "10h", "segundo"].some((term) => text.includes(term))) {
    return slots[1];
  }

  if (["quinta", "16h", "terceiro"].some((term) => text.includes(term))) {
    return slots[2];
  }

  return null;
}

function formatSlotsForMessage(): string {
  return `${slots[0]?.label}, ${slots[1]?.label} ou ${slots[2]?.label}`;
}
