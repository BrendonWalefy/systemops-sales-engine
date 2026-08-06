// Quantidade que continua a pergunta de preço anterior.
//
// Rajada comum: o lead manda "qual o valor pra tirar?" e, logo depois, "tenho 13
// lentes". Isolada, a segunda mensagem parece comentário genérico — o classificador
// lê como acknowledgment/general_question e a cotação se perde.
//
// Medido em produção (Aurora + Horizonte): 3 de 6 continuações de quantidade após
// pergunta de preço caíam fora de price_inquiry. As frases abaixo são reais.
// Ver docs/architecture/current.md.

import { describe, expect, it } from "vitest";
import { isQuantityFollowupToPriceQuestion } from "@/core/pipeline/ConversationOrchestrator";

const msg = (id: string, author: string, body: string) => ({ id, author, body });

describe("isQuantityFollowupToPriceQuestion", () => {
  it("reconhece o caso real 'Tem 13 lentes' após pergunta de preço", () => {
    expect(
      isQuantityFollowupToPriceQuestion({
        message: "Tem 13 lentes",
        incomingMessageId: "m2",
        history: [
          msg("m1", "lead", "Qual valor vcs cobram pra tira a q estou"),
          msg("m2", "lead", "Tem 13 lentes"),
        ],
      }),
    ).toBe(true);
  });

  it("reconhece o caso real 'Das 20 lente' após 'Valor'", () => {
    expect(
      isQuantityFollowupToPriceQuestion({
        message: "Das 20 lente",
        incomingMessageId: "m2",
        history: [msg("m1", "lead", "Valor"), msg("m2", "lead", "Das 20 lente")],
      }),
    ).toBe(true);
  });

  it("ignora quantidade quando a mensagem anterior NÃO era de preço", () => {
    expect(
      isQuantityFollowupToPriceQuestion({
        message: "Tem 13 lentes",
        incomingMessageId: "m2",
        history: [
          msg("m1", "lead", "Qual o endereço da clínica?"),
          msg("m2", "lead", "Tem 13 lentes"),
        ],
      }),
    ).toBe(false);
  });

  it("ignora mensagem sem quantidade", () => {
    expect(
      isQuantityFollowupToPriceQuestion({
        message: "pode sim",
        incomingMessageId: "m2",
        history: [msg("m1", "lead", "qual o valor?"), msg("m2", "lead", "pode sim")],
      }),
    ).toBe(false);
  });

  it("não considera a própria mensagem como anterior", () => {
    // Sem outra mensagem do lead no histórico não há contexto de preço a herdar.
    expect(
      isQuantityFollowupToPriceQuestion({
        message: "20 lentes",
        incomingMessageId: "m1",
        history: [msg("m1", "lead", "20 lentes")],
      }),
    ).toBe(false);
  });

  it("olha a última mensagem do LEAD, ignorando a fala do agente no meio", () => {
    expect(
      isQuantityFollowupToPriceQuestion({
        message: "no caso seria 20 dentes",
        incomingMessageId: "m3",
        history: [
          msg("m1", "lead", "Gostaria de saber os valores das lentes"),
          msg("m2", "agent", "Deixa eu te mostrar as opções 👇"),
          msg("m3", "lead", "no caso seria 20 dentes"),
        ],
      }),
    ).toBe(true);
  });
});
