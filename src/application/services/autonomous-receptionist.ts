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

const slots = [
  { id: "slot-1", label: "terca-feira as 15h" },
  { id: "slot-2", label: "quinta-feira as 16h" },
];

export function decideAutonomousReceptionistReply(messages: Message[]): ReceptionistDecision {
  const lastLeadMessage =
    [...messages].reverse().find((message) => message.author === "lead")?.body ?? "";
  const normalized = normalize(lastLeadMessage);

  if (hasClinicalRisk(normalized)) {
    return {
      stage: "handoff_required",
      action: "handoff_human",
      message:
        "Entendi. Para sua seguranca, vou chamar a equipe da clinica para avaliar seu caso e te responder com prioridade. Voce pode confirmar seu nome completo?",
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
      message: `Perfeito, deixei sua avaliacao pre-agendada para ${offeredSlot.label}. A equipe da clinica vai confirmar os dados finais por aqui. Posso te ajudar com mais alguma informacao?`,
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
        "Tenho duas opcoes para avaliacao: terca-feira as 15h ou quinta-feira as 16h. Qual desses horarios fica melhor para voce?",
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
      stage: "handling_price",
      action: "send_message",
      message:
        "O valor pode variar conforme avaliacao, objetivo e indicacao da doutora. Para te orientar corretamente, o melhor caminho e uma avaliacao. Voce prefere horarios pela manha ou pela tarde?",
      leadTemperature: "warm",
      appointment: {
        status: "none",
        selectedSlot: null,
      },
      handoffRequired: false,
      reason: "Lead perguntou preco; resposta conduz para avaliacao sem inventar valor.",
      followUp: "Se nao responder em 4 horas, enviar follow-up curto retomando a avaliacao.",
    };
  }

  return {
    stage: "collecting_schedule_preference",
    action: "send_message",
    message:
      "Oi, tudo bem? Posso te ajudar por aqui. Voce procura informacoes sobre qual tratamento ou gostaria de agendar uma avaliacao?",
    leadTemperature: "warm",
    appointment: {
      status: "none",
      selectedSlot: null,
    },
    handoffRequired: false,
    reason: "Lead novo sem intencao especifica; agente qualifica interesse.",
    followUp: "Se nao responder em 6 horas, retomar perguntando o tratamento de interesse.",
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

  if (["quinta", "16h", "segundo"].some((term) => text.includes(term))) {
    return slots[1];
  }

  return null;
}

