import { describe, expect, it } from "vitest";
import { findUnsupportedNumbers } from "@/lib/fact-guard";

describe("FactGuard — findUnsupportedNumbers", () => {
  it("detects a price in proposedText that was not in userInput", () => {
    const proposed = "A avaliação custa R$200 e é descontada do tratamento.";
    const userInput = "a avaliação é cobrada e abatida do tratamento";
    const result = findUnsupportedNumbers(proposed, userInput);
    expect(result).toContain("200");
  });

  it("accepts a number that the user explicitly provided", () => {
    const proposed = "A avaliação custa R$100 e é descontada do tratamento.";
    const userInput = "a avaliação custa 100 reais e é abatida";
    const result = findUnsupportedNumbers(proposed, userInput);
    expect(result).not.toContain("100");
  });

  it("accepts installment count provided by user", () => {
    const proposed = "Parcelamos em até 12x sem juros.";
    const userInput = "parcelamos em até 12 vezes";
    const result = findUnsupportedNumbers(proposed, userInput);
    expect(result).not.toContain("12");
  });

  it("detects invented installment count not in user input", () => {
    const proposed = "Parcelamos em até 18x.";
    const userInput = "parcelamos no cartão";
    const result = findUnsupportedNumbers(proposed, userInput);
    expect(result).toContain("18");
  });

  it("handles R$ notation vs plain number", () => {
    const proposed = "Avaliação: R$ 150.";
    const userInput = "avaliação de 150";
    const result = findUnsupportedNumbers(proposed, userInput);
    expect(result).not.toContain("150");
  });

  it("handles comma decimal separator", () => {
    const proposed = "O procedimento custa R$1.500,00.";
    const userInput = "o procedimento custa 1500 reais";
    const result = findUnsupportedNumbers(proposed, userInput);
    expect(result.length).toBe(0);
  });

  it("returns empty array when no numbers in proposedText", () => {
    const proposed = "Atendimento exclusivo com o Dr. Gregory.";
    const userInput = "atendimento personalizado";
    const result = findUnsupportedNumbers(proposed, userInput);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when proposed has no numbers user did not provide", () => {
    const proposed = "Parcelamos em 12x e a avaliação custa R$100.";
    const userInput = "parcelamos em 12 vezes, avaliação de 100 reais";
    const result = findUnsupportedNumbers(proposed, userInput);
    expect(result).toHaveLength(0);
  });

  it("detects multiple unsupported numbers", () => {
    const proposed = "Avaliação R$200, parcelamos em 24x.";
    const userInput = "fazemos avaliação e parcelamos";
    const result = findUnsupportedNumbers(proposed, userInput);
    expect(result).toContain("200");
    expect(result).toContain("24");
  });

  it("ignores numbers that appear only in userInput but not in proposed", () => {
    const proposed = "Atendimento de qualidade.";
    const userInput = "atendimento por R$500";
    const result = findUnsupportedNumbers(proposed, userInput);
    expect(result).toHaveLength(0);
  });
});
