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
  { id: "slot-1", label: "terca-feira as 15h" },
  { id: "slot-2", label: "quarta-feira as 10h" },
  { id: "slot-3", label: "quinta-feira as 16h" },
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
        `${opening} Entendi sua preocupacao. Para sua seguranca, vou chamar a equipe da clinica para avaliar seu caso e te responder com prioridade. Voce pode me confirmar seu nome completo?`,
      leadTemperature: "hot",
      appointment: {
        status: "none",
        selectedSlot: null,
      },
      handoffRequired: true,
      reason: "Mensagem contem sinal clinico sensivel.",
      followUp: null,
    };
  }

  const offeredSlot = findOfferedSlotSelection(normalized);
  if (offeredSlot) {
    return {
      stage: "appointment_scheduled",
      action: "schedule_appointment",
      message: `${opening} Perfeito, deixei sua avaliacao gratuita pre-agendada para ${offeredSlot.label}. A equipe da clinica vai confirmar os dados finais por aqui. Vai ser uma boa oportunidade para a doutora entender seu caso com calma e te orientar do jeito certo.`,
      leadTemperature: "hot",
      appointment: {
        status: "scheduled",
        selectedSlot: offeredSlot.label,
      },
      handoffRequired: false,
      reason: "Lead escolheu um horario oferecido.",
      followUp: "Enviar lembrete de confirmacao 24h antes da avaliacao.",
    };
  }

  if (asksAvailability(normalized) || indicatesSchedulePreference(normalized)) {
    return {
      stage: "offering_slots",
      action: "offer_slots",
      message:
        `${opening} Que bom que voce quer se organizar. A avaliacao e gratuita e ajuda a doutora a entender seu caso antes de falar qualquer conduta ou valor. Tenho ${formatSlotsForMessage()} disponiveis. Qual fica melhor para voce?`,
      leadTemperature: "hot",
      appointment: {
        status: "offered",
        selectedSlot: null,
      },
      handoffRequired: false,
      reason: "Lead demonstrou intencao de agenda.",
      followUp: "Se nao escolher horario em 2 horas, retomar oferecendo as duas opcoes novamente.",
    };
  }

  if (asksPrice(normalized)) {
    return {
      stage: "offering_slots",
      action: "offer_slots",
      message:
        `${opening} Entendo sua pergunta. O valor pode variar conforme o objetivo e a avaliacao, entao prefiro nao te passar uma informacao rasa ou errada por aqui. A avaliacao e gratuita e ja consigo te encaixar em ${formatSlotsForMessage()}. Qual desses horarios seria melhor para voce?`,
      leadTemperature: "hot",
      appointment: {
        status: "offered",
        selectedSlot: null,
      },
      handoffRequired: false,
      reason: "Lead perguntou preco; agente respondeu e ja ofereceu avaliacao gratuita com horarios.",
      followUp: "Se nao responder em 2 horas, retomar com os horarios disponiveis e reforcar avaliacao gratuita.",
    };
  }

  if (asksGeneralInfo(normalized)) {
    return {
      stage: "offering_slots",
      action: "offer_slots",
      message:
        `${opening} Consigo te orientar sim. Esse tratamento muda bastante de pessoa para pessoa, por isso a avaliacao gratuita e o melhor primeiro passo para entender seu objetivo e indicar o caminho correto. Temos ${formatSlotsForMessage()}. Quer que eu reserve um desses horarios para voce?`,
      leadTemperature: "warm",
      appointment: {
        status: "offered",
        selectedSlot: null,
      },
      handoffRequired: false,
      reason: "Lead pediu informacao geral; agente respondeu e conduziu para avaliacao gratuita.",
      followUp: "Se nao responder em 3 horas, enviar lembrete curto com os horarios disponiveis.",
    };
  }

  return {
    stage: "offering_slots",
    action: "offer_slots",
    message:
      `${opening} Posso te ajudar por aqui. A avaliacao e gratuita e e o melhor caminho para a doutora entender seu caso e indicar o tratamento correto. Tenho ${formatSlotsForMessage()}. Quer que eu reserve um desses horarios?`,
    leadTemperature: "warm",
    appointment: {
      status: "offered",
      selectedSlot: null,
    },
    handoffRequired: false,
    reason: "Lead novo; agente abriu conversa ja oferecendo avaliacao gratuita com horarios.",
    followUp: "Se nao responder em 4 horas, retomar com pergunta objetiva sobre qual horario prefere.",
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
  return ["preco", "valor", "quanto custa", "parcel", "orçamento", "orcamento"].some((term) =>
    text.includes(term),
  );
}

function asksAvailability(text: string): boolean {
  return ["horario", "agenda", "marcar", "consulta", "avaliacao", "disponivel"].some((term) =>
    text.includes(term),
  );
}

function asksGeneralInfo(text: string): boolean {
  return [
    "como funciona",
    "me explica",
    "quero saber",
    "informacao",
    "informações",
    "tratamento",
    "clareamento",
    "implante",
    "aparelho",
    "harmonizacao",
    "harmonização",
    "faceta",
  ].some((term) => text.includes(term));
}

function indicatesSchedulePreference(text: string): boolean {
  return ["manha", "tarde", "noite", "essa semana", "amanha", "segunda", "terca", "quarta"].some(
    (term) => text.includes(term),
  );
}

function hasClinicalRisk(text: string): boolean {
  return ["dor", "inchado", "sangrando", "infeccao", "urgente", "emergencia"].some((term) =>
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
