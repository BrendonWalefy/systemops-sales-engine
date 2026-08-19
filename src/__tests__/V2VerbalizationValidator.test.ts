import { describe, expect, it } from "vitest";
import {
  validateVerbalizedText,
  type AuthorizedSurface,
} from "@/conversation-core/composer/verbalization-validator";

function surfaceWith(overrides: Partial<AuthorizedSurface> = {}): AuthorizedSurface {
  return Object.freeze({
    values: Object.freeze(["R$ 290,00"]),
    moneyValues: Object.freeze(["R$ 290,00"]),
    numbers: Object.freeze([]),
    currencyAllowed: true,
    maxQuestions: 0,
    maxCharacters: 600,
    ...overrides,
  });
}

const twoSlots = surfaceWith({
  values: Object.freeze(["Qua 20/08 às 15h30", "Qui 21/08 às 9h"]),
  moneyValues: Object.freeze([]),
  currencyAllowed: false,
  maxQuestions: 1,
});

describe("validador do texto verbalizado", () => {
  it("aceita a prosa que carrega o valor autorizado inteiro", () => {
    const result = validateVerbalizedText({
      text: "As lentes custam R$ 290,00.",
      surface: surfaceWith(),
    });

    expect(result).toEqual({ valid: true, text: "As lentes custam R$ 290,00." });
  });

  it("recusa um valor que o plano não autorizou", () => {
    const result = validateVerbalizedText({
      text: "As lentes custam R$ 2.000,00.",
      surface: surfaceWith(),
    });

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.violations).toContain("unauthorized_number");
  });

  it("recusa a prosa que troca o fato autorizado por outra coisa", () => {
    const result = validateVerbalizedText({
      text: "Consigo te passar esse valor certinho, posso te ligar depois",
      surface: surfaceWith(),
    });

    expect(result).toEqual({
      valid: false,
      violations: ["missing_authorized_value"],
    });
  });

  it("recusa o horário recombinado a partir de dois horários autorizados", () => {
    const result = validateVerbalizedText({
      text: "Consigo Qua 21/08 às 15h, pode ser?",
      surface: twoSlots,
    });

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.violations).toEqual([
      "missing_authorized_value",
      "unauthorized_number",
    ]);
  });

  it("aceita os dois horários autorizados escritos por inteiro", () => {
    const text = "Tenho Qua 20/08 às 15h30 e Qui 21/08 às 9h. Qual fica melhor?";

    expect(validateVerbalizedText({ text, surface: twoSlots })).toEqual({ valid: true, text });
  });

  it("recusa um horário extra ao lado dos autorizados", () => {
    const result = validateVerbalizedText({
      text: "Tenho Qua 20/08 às 15h30, Qui 21/08 às 9h e também 18/08 às 10h.",
      surface: twoSlots,
    });

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.violations).toEqual(["unauthorized_number"]);
  });

  it("aceita número que vem do nome do próprio assunto", () => {
    const text = "O clareamento 3 sessões custa R$ 290,00.";

    expect(validateVerbalizedText({
      text,
      surface: surfaceWith({ numbers: ["3"] }),
    })).toEqual({ valid: true, text });
  });

  it("recusa desconto inventado com o número de um horário autorizado", () => {
    const result = validateVerbalizedText({
      text: "Tenho Qua 20/08 às 15h30 e Qui 21/08 às 9h, com 20% de desconto.",
      surface: twoSlots,
    });

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.violations).toEqual(["unauthorized_number"]);
  });

  it("recusa dinheiro por extenso quando nenhum valor foi autorizado", () => {
    const result = validateVerbalizedText({
      text: "O clareamento sai por trezentos e cinquenta reais.",
      surface: surfaceWith({ values: [], moneyValues: [], currencyAllowed: false }),
    });

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.violations).toContain("unauthorized_currency");
  });

  it("recusa horário por extenso, que nenhum plano ofereceu", () => {
    const result = validateVerbalizedText({
      text: "Atendemos das oito da manhã às seis da tarde.",
      surface: surfaceWith({ values: [], moneyValues: [], currencyAllowed: false }),
    });

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.violations).toContain("unauthorized_number");
  });

  it("aceita palavra comum que também é numeral, quando não fala de tempo nem de dinheiro", () => {
    const text = "Vou te ajudar com isso agora mesmo, um instante.";

    expect(validateVerbalizedText({
      text,
      surface: surfaceWith({ values: [], moneyValues: [], currencyAllowed: false }),
    })).toEqual({ valid: true, text });
  });

  it("recusa duas perguntas no mesmo texto", () => {
    const result = validateVerbalizedText({
      text: "Prefere manhã? Qual seu nome?",
      surface: surfaceWith({ values: [], moneyValues: [], maxQuestions: 1, currencyAllowed: false }),
    });

    expect(result).toEqual({ valid: false, violations: ["too_many_questions"] });
  });

  it("recusa pergunta quando o plano não autorizou nenhuma", () => {
    const result = validateVerbalizedText({
      text: "As lentes custam R$ 290,00. Quer que eu veja um horário?",
      surface: surfaceWith(),
    });

    expect(result).toEqual({ valid: false, violations: ["too_many_questions"] });
  });

  it("recusa texto vazio", () => {
    const result = validateVerbalizedText({
      text: "   ",
      surface: surfaceWith({ values: [], moneyValues: [] }),
    });

    expect(result).toEqual({ valid: false, violations: ["empty_text"] });
  });

  it("recusa texto acima do limite de caracteres", () => {
    const result = validateVerbalizedText({
      text: "a".repeat(41),
      surface: surfaceWith({ values: [], moneyValues: [], maxCharacters: 40 }),
    });

    expect(result).toEqual({ valid: false, violations: ["too_long"] });
  });

  it("recusa link, porque nenhuma mídia é autorizada", () => {
    const result = validateVerbalizedText({
      text: "Veja em https://exemplo.com.br",
      surface: surfaceWith({ values: [], moneyValues: [] }),
    });

    expect(result).toEqual({ valid: false, violations: ["unauthorized_link"] });
  });

  it("recusa promessa em qualquer conjugação", () => {
    for (const text of [
      "Garanto o resultado que você espera.",
      "A gente garante o resultado.",
      "Garantido que você vai amar.",
      "A garantia cobre a troca.",
    ]) {
      const result = validateVerbalizedText({
        text,
        surface: surfaceWith({ values: [], moneyValues: [] }),
      });

      expect(result.valid === false && result.violations).toContain("unauthorized_commitment");
    }
  });

  it("recusa valor não textual sem deixar exceção escapar", () => {
    const result = validateVerbalizedText({
      text: { toString: () => "R$ 290,00" },
      surface: surfaceWith(),
    });

    expect(result).toEqual({ valid: false, violations: ["empty_text"] });
  });
});
