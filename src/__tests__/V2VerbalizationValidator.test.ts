import { describe, expect, it } from "vitest";
import {
  validateVerbalizedText,
  type AuthorizedSurface,
} from "@/conversation-core/composer/verbalization-validator";

function surfaceWith(overrides: Partial<AuthorizedSurface> = {}): AuthorizedSurface {
  return Object.freeze({
    numbers: Object.freeze(["290"]),
    moneyNumbers: Object.freeze(["290"]),
    currencyAllowed: true,
    maxQuestions: 1,
    maxCharacters: 600,
    ...overrides,
  });
}

describe("validador do texto verbalizado", () => {
  it("recusa um valor que o plano não autorizou", () => {
    const result = validateVerbalizedText({
      text: "O valor é R$ 2.000,00.",
      surface: surfaceWith(),
    });

    expect(result).toEqual({ valid: false, violations: ["unauthorized_number"] });
  });

  it("aceita o mesmo valor autorizado escrito em prosa", () => {
    const result = validateVerbalizedText({
      text: "Fica R$ 290,00 e podemos combinar o melhor dia.",
      surface: surfaceWith(),
    });

    expect(result).toEqual({
      valid: true,
      text: "Fica R$ 290,00 e podemos combinar o melhor dia.",
    });
  });

  it("recusa um horário que o plano não ofereceu", () => {
    const result = validateVerbalizedText({
      text: "Consigo te encaixar quarta às 14h.",
      surface: surfaceWith({ numbers: ["15"], currencyAllowed: false }),
    });

    expect(result).toEqual({ valid: false, violations: ["unauthorized_number"] });
  });

  it("recusa duas perguntas no mesmo texto", () => {
    const result = validateVerbalizedText({
      text: "Você prefere manhã? Qual seu nome?",
      surface: surfaceWith({ numbers: [] }),
    });

    expect(result).toEqual({ valid: false, violations: ["too_many_questions"] });
  });

  it("recusa moeda quando nenhum valor foi autorizado", () => {
    const result = validateVerbalizedText({
      text: "Sobre investimento, R$ falamos depois.",
      surface: surfaceWith({ numbers: [], currencyAllowed: false }),
    });

    expect(result).toEqual({ valid: false, violations: ["unauthorized_currency"] });
  });

  it("recusa texto vazio", () => {
    const result = validateVerbalizedText({
      text: "   ",
      surface: surfaceWith({ numbers: [] }),
    });

    expect(result).toEqual({ valid: false, violations: ["empty_text"] });
  });

  it("recusa texto acima do limite de caracteres", () => {
    const result = validateVerbalizedText({
      text: "a".repeat(41),
      surface: surfaceWith({ numbers: [], maxCharacters: 40 }),
    });

    expect(result).toEqual({ valid: false, violations: ["too_long"] });
  });

  it("recusa link, porque nenhuma mídia é autorizada", () => {
    const result = validateVerbalizedText({
      text: "Veja em https://exemplo.com.br",
      surface: surfaceWith({ numbers: [] }),
    });

    expect(result).toEqual({ valid: false, violations: ["unauthorized_link"] });
  });

  it("recusa promessa que o sistema não decidiu", () => {
    const result = validateVerbalizedText({
      text: "Garanto o resultado que você espera.",
      surface: surfaceWith({ numbers: [] }),
    });

    expect(result).toEqual({ valid: false, violations: ["unauthorized_commitment"] });
  });

  it("acumula todas as violações do mesmo texto", () => {
    const result = validateVerbalizedText({
      text: "Garanto R$ 90 na terça às 9h? Qual seu nome?",
      surface: surfaceWith({ numbers: [], currencyAllowed: false }),
    });

    expect(result).toEqual({
      valid: false,
      violations: [
        "too_many_questions",
        "unauthorized_number",
        "unauthorized_currency",
        "unauthorized_commitment",
      ],
    });
  });

  it("recusa valor não textual sem deixar exceção escapar", () => {
    const result = validateVerbalizedText({
      text: { toString: () => "R$ 290,00" },
      surface: surfaceWith(),
    });

    expect(result).toEqual({ valid: false, violations: ["empty_text"] });
  });

  it("recusa um valor autorizado escrito sem moeda, que o lead leria como número solto", () => {
    const result = validateVerbalizedText({
      text: "O valor é 290.",
      surface: surfaceWith(),
    });

    expect(result).toEqual({ valid: false, violations: ["money_without_currency"] });
  });

  it("aceita o mesmo valor quando ele vem como dinheiro", () => {
    const result = validateVerbalizedText({
      text: "O valor é R$ 290,00.",
      surface: surfaceWith(),
    });

    expect(result).toEqual({ valid: true, text: "O valor é R$ 290,00." });
  });

  it("não exige moeda para número que não é dinheiro", () => {
    const result = validateVerbalizedText({
      text: "Consigo quarta às 15h.",
      surface: surfaceWith({ numbers: ["15"], moneyNumbers: [], currencyAllowed: false }),
    });

    expect(result).toEqual({ valid: true, text: "Consigo quarta às 15h." });
  });
});
