import type {
  SalesAgentGateway,
  SalesAgentInput,
  SalesAgentOutput,
} from "@/application/ports/sales-agent-gateway";

export class MockSalesAgentGateway implements SalesAgentGateway {
  async analyze(input: SalesAgentInput): Promise<SalesAgentOutput> {
    const lastLeadMessage =
      [...input.messages].reverse().find((message) => message.author === "lead")?.body ?? "";
    const normalized = lastLeadMessage.toLowerCase();

    if (hasClinicalRisk(normalized)) {
      return {
        leadTemperature: "hot",
        stage: "clinical_sensitive",
        mainObjection: "duvida_clinica_sensivel",
        suggestedReply:
          "Entendi. Para te orientar com segurança, vou chamar a equipe da clínica para avaliar seu caso e te responder da melhor forma. Você pode me confirmar seu nome completo?",
        nextAction: "handoff_humano",
        followUp: null,
        handoffRequired: true,
        riskFlags: ["clinical_sensitive"],
        confidence: 0.91,
        model: "gpt-4o-mini",
        promptVersion: "mock-v1",
        usage: {
          inputTokens: estimateTokens(input.playbook + lastLeadMessage),
          outputTokens: 95,
        },
      };
    }

    if (asksPrice(normalized)) {
      return {
        leadTemperature: "warm",
        stage: "asked_price",
        mainObjection: "preco",
        suggestedReply:
          "O valor pode variar conforme avaliação e objetivo do tratamento. Para te passar uma orientação correta, o ideal é agendar uma avaliação com a doutora. Você prefere ver horários para esta semana ou para a próxima?",
        nextAction: "tentar_agendamento",
        followUp:
          "Se não responder em 4 horas, enviar lembrete curto reforçando que a avaliação ajuda a indicar o melhor caminho.",
        handoffRequired: false,
        riskFlags: [],
        confidence: 0.86,
        model: "gpt-4o-mini",
        promptVersion: "mock-v1",
        usage: {
          inputTokens: estimateTokens(input.playbook + lastLeadMessage),
          outputTokens: 130,
        },
      };
    }

    if (asksAvailability(normalized)) {
      return {
        leadTemperature: "hot",
        stage: "asked_availability",
        mainObjection: null,
        suggestedReply:
          "Consigo te ajudar com os horários. Temos algumas opções esta semana. Você prefere manhã ou tarde para sua avaliação?",
        nextAction: "consultar_agenda",
        followUp: "Se escolher um período, consultar Google Calendar e oferecer dois horários objetivos.",
        handoffRequired: false,
        riskFlags: [],
        confidence: 0.88,
        model: "gpt-4o-mini",
        promptVersion: "mock-v1",
        usage: {
          inputTokens: estimateTokens(input.playbook + lastLeadMessage),
          outputTokens: 85,
        },
      };
    }

    return {
      leadTemperature: "warm",
      stage: "new_lead",
      mainObjection: null,
      suggestedReply:
        "Oi, tudo bem? Posso te ajudar. Você procura informações sobre qual tratamento ou gostaria de agendar uma avaliação?",
      nextAction: "qualificar_interesse",
      followUp: "Se não responder em 6 horas, retomar com uma pergunta simples sobre o tratamento de interesse.",
      handoffRequired: false,
      riskFlags: [],
      confidence: 0.78,
      model: "gpt-4o-mini",
      promptVersion: "mock-v1",
      usage: {
        inputTokens: estimateTokens(input.playbook + lastLeadMessage),
        outputTokens: 70,
      },
    };
  }
}

function asksPrice(text: string): boolean {
  return ["preco", "preço", "valor", "quanto custa", "parcel"].some((term) =>
    text.includes(term),
  );
}

function asksAvailability(text: string): boolean {
  return ["horario", "horário", "agenda", "marcar", "consulta", "avaliacao", "avaliação"].some(
    (term) => text.includes(term),
  );
}

function hasClinicalRisk(text: string): boolean {
  return ["dor", "inchado", "sangrando", "infeccao", "infecção", "urgente"].some((term) =>
    text.includes(term),
  );
}

function estimateTokens(text: string): number {
  return Math.max(250, Math.ceil(text.length / 4));
}
