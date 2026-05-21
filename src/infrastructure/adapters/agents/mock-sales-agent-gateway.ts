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
          "Entendi. Para te orientar com seguranca, vou chamar a equipe da clinica para avaliar seu caso e te responder da melhor forma. Voce pode me confirmar seu nome completo?",
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
          "O valor pode variar conforme avaliacao e objetivo do tratamento. Para te passar uma orientacao correta, o ideal e agendar uma avaliacao com a doutora. Voce prefere ver horarios para esta semana ou para a proxima?",
        nextAction: "tentar_agendamento",
        followUp:
          "Se nao responder em 4 horas, enviar lembrete curto reforcando que a avaliacao ajuda a indicar o melhor caminho.",
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
          "Consigo te ajudar com os horarios. Temos algumas opcoes esta semana. Voce prefere manha ou tarde para sua avaliacao?",
        nextAction: "consultar_agenda",
        followUp: "Se escolher um periodo, consultar Google Calendar e oferecer dois horarios objetivos.",
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
        "Oi, tudo bem? Posso te ajudar. Voce procura informacoes sobre qual tratamento ou gostaria de agendar uma avaliacao?",
      nextAction: "qualificar_interesse",
      followUp: "Se nao responder em 6 horas, retomar com uma pergunta simples sobre o tratamento de interesse.",
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

