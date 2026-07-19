// Wave 4 — defeitos de contexto/preço das conversas reais de 19/07 (doc 06):
// W4.3 — IA respeita a oferta/avanço do operador (caso Paula)
import { describe, expect, it } from "vitest";
import { lastSlotOfferWasByOperator } from "@/core/pipeline/ConversationOrchestrator";

describe("W4.3 — lastSlotOfferWasByOperator (caso Paula)", () => {
  it("oferta concreta de horário feita pelo operador é reconhecida", () => {
    const history = [
      { author: "lead" as const, body: "Podemos marcar para o dia 08/08 por favor?" },
      { author: "agent" as const, body: "Só consigo ver horários com até 7 dias de antecedência." },
      { author: "clinic_user" as const, body: "Olha só, vagou um horário Sab. 01/08 as 16:00 para o procedimento de lentes, oque acha?" },
      { author: "lead" as const, body: "Ok, podemos marcar para o dia 01/08 então" },
    ];
    expect(lastSlotOfferWasByOperator(history)).toBe(true);
  });

  it("quando a IA fez a última oferta concreta, NÃO é gerido pelo operador", () => {
    const history = [
      { author: "clinic_user" as const, body: "vagou um horário Sab 01/08 as 16h" },
      { author: "agent" as const, body: "Temos o seguinte horário: 1. Seg 20/07 às 9h. Responda com o número." },
      { author: "lead" as const, body: "1" },
    ];
    expect(lastSlotOfferWasByOperator(history)).toBe(false);
  });

  it("mensagem do operador sem horário concreto não conta como oferta", () => {
    const history = [
      { author: "clinic_user" as const, body: "Nosso protocolo já é direcionado para realizar o procedimento" },
      { author: "lead" as const, body: "Ok" },
    ];
    expect(lastSlotOfferWasByOperator(history)).toBe(false);
  });

  it("sem nenhuma oferta de horário no histórico retorna false", () => {
    const history = [
      { author: "lead" as const, body: "Quero saber os valores" },
      { author: "agent" as const, body: "Nós trabalhamos com duas técnicas..." },
    ];
    expect(lastSlotOfferWasByOperator(history)).toBe(false);
  });

  it("reconhece variações de hora (16h, 16:00, 9 horas)", () => {
    expect(lastSlotOfferWasByOperator([{ author: "clinic_user", body: "tenho horário quinta às 9 horas" }])).toBe(true);
    expect(lastSlotOfferWasByOperator([{ author: "clinic_user", body: "vaga sábado 16:00 para o procedimento" }])).toBe(true);
    expect(lastSlotOfferWasByOperator([{ author: "clinic_user", body: "disponível dia 01/08 às 16h" }])).toBe(true);
  });
});
