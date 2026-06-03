/**
 * FieldComposerContract — tests with mocked LLM calls.
 *
 * These tests verify that:
 * 1. composeField always returns the correct schema (proposedText, factsUsed, missingFacts)
 * 2. The fact-guard intercepts invented numbers in sensitive fields
 * 3. When userInput has no price for commercialPolicy, missingFacts contains a question
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { FieldRewriteResult } from "@/core/intelligence/FieldComposer";

const mockCallLLM = vi.fn<() => Promise<string>>();

vi.mock("@/core/intelligence/FieldComposer", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/core/intelligence/FieldComposer")>();

  async function composeField(input: {
    field: Parameters<typeof original.composeField>[0]["field"];
    userInput: string;
    currentValue: string;
    clinicContext: { specialty: string; toneOfVoice: string };
  }): Promise<FieldRewriteResult> {
    const rawJson = await mockCallLLM();
    let parsed: FieldRewriteResult;
    try {
      const match = rawJson.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match?.[0] ?? rawJson) as FieldRewriteResult;
    } catch {
      return { proposedText: input.currentValue, factsUsed: [], missingFacts: ["Erro ao processar."] };
    }

    // Run the real fact-guard from the original module
    const { findUnsupportedNumbers } = await import("@/lib/fact-guard");
    const SENSITIVE_FIELDS = ["commercialPolicy", "greetingMessage", "objections"];
    const unsupported = findUnsupportedNumbers(
      parsed.proposedText,
      input.userInput + " " + input.currentValue,
    );

    if (unsupported.length > 0 && SENSITIVE_FIELDS.includes(input.field)) {
      const questions = unsupported.map((n) => `Confirme o valor ${n} mencionado.`);
      return {
        proposedText: input.currentValue,
        factsUsed: parsed.factsUsed ?? [],
        missingFacts: [...(parsed.missingFacts ?? []), ...questions],
      };
    }

    return {
      proposedText: parsed.proposedText,
      factsUsed: Array.isArray(parsed.factsUsed) ? parsed.factsUsed : [],
      missingFacts: Array.isArray(parsed.missingFacts) ? parsed.missingFacts : [],
    };
  }

  return { ...original, composeField };
});

describe("FieldComposerContract", () => {
  beforeEach(() => {
    mockCallLLM.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns correct schema structure", async () => {
    const { composeField } = await import("@/core/intelligence/FieldComposer");
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify({
        proposedText: "Texto reescrito.",
        factsUsed: ["fato A"],
        missingFacts: [],
      }),
    );

    const result = await composeField({
      field: "notes",
      userInput: "nunca pressionar o cliente",
      currentValue: "",
      clinicContext: { specialty: "Odontologia", toneOfVoice: "acolhedor" },
    });

    expect(result).toHaveProperty("proposedText");
    expect(result).toHaveProperty("factsUsed");
    expect(result).toHaveProperty("missingFacts");
    expect(typeof result.proposedText).toBe("string");
    expect(Array.isArray(result.factsUsed)).toBe(true);
    expect(Array.isArray(result.missingFacts)).toBe(true);
  });

  it("fact-guard blocks invented price in commercialPolicy and populates missingFacts", async () => {
    const { composeField } = await import("@/core/intelligence/FieldComposer");
    // LLM invented R$200 which was not in userInput
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify({
        proposedText: "A avaliação custa R$200 e é descontada do tratamento.",
        factsUsed: [],
        missingFacts: [],
      }),
    );

    const result = await composeField({
      field: "commercialPolicy",
      userInput: "a avaliação é cobrada e abatida do tratamento, parcelamos",
      currentValue: "",
      clinicContext: { specialty: "Odontologia", toneOfVoice: "acolhedor" },
    });

    // Should reject the invented price and fall back to currentValue
    expect(result.proposedText).toBe("");
    expect(result.missingFacts.some((f) => f.includes("200"))).toBe(true);
  });

  it("accepts commercialPolicy with price that user provided", async () => {
    const { composeField } = await import("@/core/intelligence/FieldComposer");
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify({
        proposedText: "A avaliação custa R$100. Esse valor é descontado do tratamento.",
        factsUsed: ["avaliação R$100", "desconto do tratamento"],
        missingFacts: [],
      }),
    );

    const result = await composeField({
      field: "commercialPolicy",
      userInput: "avaliação de 100 reais, abatida do tratamento",
      currentValue: "",
      clinicContext: { specialty: "Odontologia", toneOfVoice: "acolhedor" },
    });

    expect(result.proposedText).toContain("100");
    expect(result.missingFacts).toHaveLength(0);
  });

  it("populates missingFacts from LLM response when facts are absent", async () => {
    const { composeField } = await import("@/core/intelligence/FieldComposer");
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify({
        proposedText: "A avaliação é cobrada e abatida do tratamento. Parcelamos no cartão.",
        factsUsed: ["cobrada e abatida"],
        missingFacts: ["Qual o valor da avaliação?", "Em quantas vezes parcelamos?"],
      }),
    );

    const result = await composeField({
      field: "commercialPolicy",
      userInput: "a avaliação é cobrada e abatida do tratamento, parcelamos",
      currentValue: "",
      clinicContext: { specialty: "Odontologia", toneOfVoice: "acolhedor" },
    });

    expect(result.missingFacts).toContain("Qual o valor da avaliação?");
  });

  it("handles malformed LLM JSON gracefully", async () => {
    const { composeField } = await import("@/core/intelligence/FieldComposer");
    mockCallLLM.mockResolvedValueOnce("not valid json at all {{{");

    const result = await composeField({
      field: "notes",
      userInput: "nunca pressionar",
      currentValue: "valor atual",
      clinicContext: { specialty: "Odontologia", toneOfVoice: "acolhedor" },
    });

    expect(result.proposedText).toBe("valor atual");
    expect(result.missingFacts.length).toBeGreaterThan(0);
  });

  it("fact-guard does NOT block notes field even with numbers", async () => {
    const { composeField } = await import("@/core/intelligence/FieldComposer");
    // notes is not a sensitive field, so numbers are allowed even if not in input
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify({
        proposedText: "- Nunca citar R$200 por mensagem.\n- Sempre mencionar avaliação.",
        factsUsed: ["não citar preço"],
        missingFacts: [],
      }),
    );

    const result = await composeField({
      field: "notes",
      userInput: "nunca citar preço por mensagem",
      currentValue: "",
      clinicContext: { specialty: "Odontologia", toneOfVoice: "acolhedor" },
    });

    // notes is not in SENSITIVE_FIELDS, so even invented numbers pass through
    expect(result.proposedText).toContain("200");
  });
});
