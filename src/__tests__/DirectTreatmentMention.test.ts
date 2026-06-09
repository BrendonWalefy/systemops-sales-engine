import { describe, expect, it } from "vitest";
import { resolveDirectTreatmentMention } from "@/core/pipeline/ConversationOrchestrator";
import type { Treatment } from "@/domain/entities/treatment";

function treatment(name: string): Treatment {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    clinicId: "clinic-1",
    name,
    durationMinutes: 60,
    description: null,
    commonObjections: [],
    requiresEvaluationFirst: false,
    triggerTemplate: null,
    keywordMatchEnabled: true,
    aliases: [],
    isAesthetic: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

const treatments = [
  treatment("Avaliação odontológica"),
  treatment("Lentes de resina composta"),
  treatment("Clareamento dental"),
];

describe("resolveDirectTreatmentMention", () => {
  it("trata palavra isolada de tratamento como menção informativa direta", () => {
    const result = resolveDirectTreatmentMention("Lentes", treatments);
    expect(result?.name).toBe("Lentes de resina composta");
  });

  it("trata pergunta curta sobre opções de um tratamento como menção informativa", () => {
    const result = resolveDirectTreatmentMention("Tem quais opcoes de lentes?", treatments);
    expect(result?.name).toBe("Lentes de resina composta");
  });

  it("não intercepta pedido explícito de agendamento", () => {
    const result = resolveDirectTreatmentMention("quero agendar uma avaliacao", treatments);
    expect(result).toBeNull();
  });

  it("não intercepta pergunta de preço para o classificador preservar price_inquiry", () => {
    const result = resolveDirectTreatmentMention("qual o valor das lentes?", treatments);
    expect(result).toBeNull();
  });

  it("não intercepta resposta ao agente quando ele acabou de perguntar o procedimento", () => {
    const result = resolveDirectTreatmentMention(
      "Avaliação",
      treatments,
      "Qual procedimento você gostaria de realizar?",
    );
    expect(result).toBeNull();
  });

  it("ignora seleções numéricas de menu ou lista", () => {
    expect(resolveDirectTreatmentMention("8", treatments)).toBeNull();
  });
});
