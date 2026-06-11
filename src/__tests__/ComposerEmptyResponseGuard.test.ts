// Guards contra resposta vazia silenciosa.
//
// Antes do fix: flake da OpenAI (choices[0] null, timeout) fazia compose()
// devolver text="" sem erro; o Orchestrator salvava e "enviava" mensagem
// vazia — a Z-API rejeita e o lead fica sem resposta, sem nenhum alerta.
//
// Depois: compose() tenta 2x e lança erro se continuar vazio; o Orchestrator
// também lança se nenhum branch montou replyText e não há mídia — ambos os
// caminhos caem no fallback determinístico já existente do catch principal.

import { describe, it, expect, vi, beforeEach } from "vitest";

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

function composerInput() {
  return {
    actionResult: { type: "greeting" } as const,
    conversationHistory: [],
    clinic: {
      name: "Clínica Teste",
      specialty: "odontologia",
      toneOfVoice: null,
      playbook: null,
      commercialPolicy: null,
    },
    timezone: new ClinicTimezone("America/Sao_Paulo"),
    isFirstMessage: true,
  };
}

beforeEach(() => {
  createMock.mockReset();
});

describe("ResponseComposer — retry e erro em resposta vazia", () => {
  it("retorna normalmente quando a primeira tentativa tem conteúdo", async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: "Olá! Como posso ajudar?" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const composer = new ResponseComposer();
    const result = await composer.compose(composerInput());

    expect(result.text).toBe("Olá! Como posso ajudar?");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("faz retry quando choices[0] vem nulo e a segunda tentativa salva", async () => {
    createMock
      .mockResolvedValueOnce({ choices: [], usage: null })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Resposta da segunda tentativa" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

    const composer = new ResponseComposer();
    const result = await composer.compose(composerInput());

    expect(result.text).toBe("Resposta da segunda tentativa");
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("faz retry quando a API lança erro (timeout) e a segunda tentativa salva", async () => {
    createMock
      .mockRejectedValueOnce(new Error("Request timed out"))
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Recuperado" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

    const composer = new ResponseComposer();
    const result = await composer.compose(composerInput());

    expect(result.text).toBe("Recuperado");
  });

  it("lança erro após 2 tentativas vazias — nunca devolve text vazio", async () => {
    createMock.mockResolvedValue({ choices: [], usage: null });

    const composer = new ResponseComposer();
    await expect(composer.compose(composerInput())).rejects.toThrow();
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("lança o erro original após 2 falhas de API", async () => {
    createMock.mockRejectedValue(new Error("ECONNRESET"));

    const composer = new ResponseComposer();
    await expect(composer.compose(composerInput())).rejects.toThrow("ECONNRESET");
  });
});

describe("Orchestrator — guard de replyText vazio (modelo do invariante)", () => {
  // Mesmo predicado usado no Orchestrator antes de salvar/enviar.
  function shouldBlockEmptyReply(replyText: string, parts: { type: "text" | "media" }[]): boolean {
    return !replyText.trim() && !parts.some((p) => p.type === "media");
  }

  it("bloqueia resposta vazia sem mídia", () => {
    expect(shouldBlockEmptyReply("", [])).toBe(true);
    expect(shouldBlockEmptyReply("   ", [{ type: "text" }])).toBe(true);
  });

  it("permite resposta só de mídia (texto vazio é legítimo)", () => {
    expect(shouldBlockEmptyReply("", [{ type: "media" }])).toBe(false);
  });

  it("permite resposta normal", () => {
    expect(shouldBlockEmptyReply("Olá!", [{ type: "text" }])).toBe(false);
  });
});
