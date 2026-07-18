import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("openai", () => {
  return {
    default: class {
      chat = { completions: { create: createMock } };
    },
  };
});

import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

function composerInput(
  actionResult:
    | { type: "general_question"; clinicContext: string }
    | { type: "commercial_pause" }
    | {
        type: "slots_found";
        slots: Array<{ index: number; startsAt: string; endsAt: string; label: string }>;
        askedForPreference: boolean;
      }
    | { type: "quantity_price_confirmation_required"; quantity: number; scope: "total" | "superior" | "inferior" },
) {
  return {
    actionResult,
    conversationHistory: [],
    clinic: {
      name: "Clínica Teste",
      specialty: "odontologia",
      toneOfVoice: null,
      playbook: null,
      commercialPolicy: null,
    },
    timezone: new ClinicTimezone("America/Sao_Paulo"),
    isFirstMessage: false,
  };
}

beforeEach(() => {
  createMock.mockReset();
});

describe("ResponseComposer — guard contra vazamento de agenda", () => {
  it("não chama a LLM nem reabre a venda quando o lead pede tempo para pesquisar", async () => {
    const composer = new ResponseComposer();
    const result = await composer.compose(
      composerInput({ type: "commercial_pause" }),
    );

    expect(createMock).not.toHaveBeenCalled();
    expect(result.text).toContain("Faça seus levantamentos com calma");
    expect(result.text).not.toMatch(/R\$|\b\d+[.,]\d{2}\b/);
    expect(result.text).not.toMatch(/agend|horári|agenda/i);
    expect(result.model).toBe("deterministic-safety");
  });

  it("não chama a LLM nem expõe valores quando a quantidade/arcada não tem pacote", async () => {
    const composer = new ResponseComposer();
    const result = await composer.compose(
      composerInput({
        type: "quantity_price_confirmation_required",
        quantity: 10,
        scope: "superior",
      }),
    );

    expect(createMock).not.toHaveBeenCalled();
    expect(result.text).toContain("não vou te passar um valor aproximado");
    expect(result.text).not.toMatch(/R\$|\b\d+[.,]\d{2}\b/);
    expect(result.model).toBe("deterministic-safety");
  });

  it("remove linhas com oferta de datas/horários em general_question e preserva o conteúdo informativo", async () => {
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: [
              "A Técnica Simplificada usa resina de alta qualidade e entrega um sorriso harmonioso e natural.",
              "",
              "Quarta 17 de junho às 9h",
              "Sexta 19 de junho às 15h",
            ].join("\n"),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const composer = new ResponseComposer();
    const result = await composer.compose(
      composerInput({
        type: "general_question",
        clinicContext: "Lead perguntou sobre lentes.",
      }),
    );

    expect(result.text).toContain("Técnica Simplificada");
    expect(result.text).not.toContain("Quarta 17 de junho");
    expect(result.text).not.toContain("19 de junho");
    expect(result.text).not.toContain("9h");
    expect(result.text).not.toContain("15h");
  });

  it("bloqueia confirmação falsa de agenda fora de action determinístico", async () => {
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: "Está agendado! Sua avaliação será na quarta-feira, às 9h.",
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const composer = new ResponseComposer();
    await expect(
      composer.compose(
        composerInput({
          type: "general_question",
          clinicContext: "Lead perguntou sobre lentes.",
        }),
      ),
    ).rejects.toThrow("confirmação de agenda vazou");
  });

  it("preserva slots quando a action permite agenda explícita", async () => {
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: "Temos estes horários:\n1. Quarta 17/06 às 9h\n2. Sexta 19/06 às 15h",
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const composer = new ResponseComposer();
    const result = await composer.compose(
      composerInput({
        type: "slots_found",
        askedForPreference: false,
        slots: [
          { index: 1, startsAt: "2026-06-17T12:00:00.000Z", endsAt: "2026-06-17T13:00:00.000Z", label: "Quarta 17/06 às 9h" },
          { index: 2, startsAt: "2026-06-19T18:00:00.000Z", endsAt: "2026-06-19T19:00:00.000Z", label: "Sexta 19/06 às 15h" },
        ],
      }),
    );

    expect(result.text).toContain("1. Quarta 17/06 às 9h");
    expect(result.text).toContain("2. Sexta 19/06 às 15h");
  });
});
