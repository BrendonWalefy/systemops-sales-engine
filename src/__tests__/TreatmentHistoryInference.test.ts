import { describe, expect, it } from "vitest";
import { inferTreatmentFromConversationHistory } from "@/core/pipeline/ConversationOrchestrator";
import type { Message } from "@/domain/entities/conversation";
import type { Treatment } from "@/domain/entities/treatment";

function treatment(name: string, overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    clinicId: "clinic-1",
    name,
    durationMinutes: 60,
    description: null,
    requiresEvaluationFirst: false,
    triggerTemplate: null,
    keywordMatchEnabled: true,
    aliases: [],
    isAesthetic: false,
    pipelineSteps: null,
    priceCents: null,
    minPriceCents: null,
    maxPriceCents: null,
    priceQuotableInChat: false,
    priceKind: "from",
    priceUnit: null,
    priceDeductible: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

let seq = 0;
function msg(author: Message["author"], body: string): Message {
  seq += 1;
  return {
    id: `msg-${seq}`,
    conversationId: "conv-1",
    author,
    body,
    sentAt: new Date(2026, 5, 1, 12, 0, seq),
    externalId: null,
  };
}

const treatments = [
  treatment("Avaliação", { keywordMatchEnabled: false }),
  treatment("Tratamento de canal", { aliases: ["canal", "endodontia"] }),
  treatment("Lentes de resina composta", { aliases: ["lentes"] }),
];

describe("inferTreatmentFromConversationHistory", () => {
  it("não usa a palavra genérica 'tratamento' na resposta do próprio bot para inferir 'Tratamento de canal'", () => {
    // Reproduz o bug real: o lead nunca mencionou nenhum tratamento específico
    // (só perguntou sobre custo e depois "qual dia"). A resposta do bot sobre a
    // avaliação contém a palavra solta "tratamento" (comum em frases como
    // "plano de tratamento personalizado"), que não deve virar um match.
    const history: Message[] = [
      msg("lead", "Tem custo a avaliação?"),
      msg(
        "agent",
        "A avaliação tem um investimento de R$100, que é abatido integralmente do tratamento caso você decida avançar. Essa consulta é fundamental, pois inclui análise do sorriso e um plano de tratamento personalizado.",
      ),
      msg("lead", "Qual dia?"),
    ];

    const result = inferTreatmentFromConversationHistory(history, treatments);
    expect(result).toBeNull();
  });

  it("ignora mensagens do próprio bot mesmo quando elas citam um tratamento real do catálogo", () => {
    const history: Message[] = [
      msg("lead", "Oi"),
      msg("agent", "Recomendamos avaliar um tratamento de canal antes de prosseguir."),
      msg("lead", "Qual dia?"),
    ];

    const result = inferTreatmentFromConversationHistory(history, treatments);
    expect(result).toBeNull();
  });

  it("ainda infere corretamente o tratamento quando foi o LEAD quem mencionou", () => {
    const history: Message[] = [
      msg("lead", "Quero saber sobre tratamento de canal"),
      msg("agent", "Claro! O tratamento de canal remove a polpa infectada..."),
      msg("lead", "Quero marcar meu retorno"),
    ];

    const result = inferTreatmentFromConversationHistory(history, treatments);
    expect(result?.name).toBe("Tratamento de canal");
  });

  it("infere lentes a partir de uma menção real do lead, ignorando ruído do bot no meio", () => {
    const history: Message[] = [
      msg("lead", "Gostaria de saber sobre lentes"),
      msg("agent", "Aqui estão os valores do plano de tratamento personalizado."),
      msg("lead", "Quero agendar"),
    ];

    const result = inferTreatmentFromConversationHistory(history, treatments);
    expect(result?.name).toBe("Lentes de resina composta");
  });
});
