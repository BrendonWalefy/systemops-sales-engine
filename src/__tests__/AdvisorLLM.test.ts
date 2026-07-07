/**
 * Testes do guard de API key do helper compartilhado de LLM (ADR-002 item 1)
 * e do guard de resposta truncada (max_tokens/length).
 * Falha cedo com erro acionável em vez de crash críptico ou JSON pela metade.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAdvisorLLM, SETUP_STUDY_MODEL } from "@/infrastructure/llm/advisor-llm";

const anthropicCreate = vi.fn();
const openaiCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: anthropicCreate };
  },
}));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: openaiCreate } };
  },
}));

describe("callAdvisorLLM — guard de API key", () => {
  const original = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (original.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original.anthropic;
    if (original.openai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original.openai;
  });

  it("lança erro claro para modelo claude-* sem ANTHROPIC_API_KEY", async () => {
    await expect(
      callAdvisorLLM("oi", { model: "claude-3-5-sonnet-20240620" }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY ausente/);
  });

  it("lança erro claro para modelo OpenAI sem OPENAI_API_KEY", async () => {
    await expect(
      callAdvisorLLM("oi", { model: "gpt-4o-mini" }),
    ).rejects.toThrow(/OPENAI_API_KEY ausente/);
  });
});

describe("callAdvisorLLM — guard de resposta truncada", () => {
  const original = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.OPENAI_API_KEY = "test-key";
    anthropicCreate.mockReset();
    openaiCreate.mockReset();
  });

  afterEach(() => {
    if (original.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original.anthropic;
    if (original.openai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original.openai;
  });

  it("lança erro quando a Anthropic trunca em max_tokens (JSON pela metade é inútil)", async () => {
    anthropicCreate.mockResolvedValue({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: '{"findings": [' }],
    });
    await expect(
      callAdvisorLLM("oi", { model: "claude-sonnet-5", maxTokens: 100 }),
    ).rejects.toThrow(/truncada em 100 tokens/);
  });

  it("retorna o bloco de texto quando a Anthropic responde completo (com thinking)", async () => {
    anthropicCreate.mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "pensando..." },
        { type: "text", text: '{"findings": []}' },
      ],
    });
    await expect(callAdvisorLLM("oi", { model: "claude-sonnet-5" })).resolves.toBe(
      '{"findings": []}',
    );
  });

  it("lança erro quando a OpenAI trunca com finish_reason=length", async () => {
    openaiCreate.mockResolvedValue({
      choices: [{ finish_reason: "length", message: { content: '{"a":' } }],
    });
    await expect(
      callAdvisorLLM("oi", { model: "gpt-4o-mini", maxTokens: 50 }),
    ).rejects.toThrow(/truncada em 50 tokens/);
  });
});

describe("SETUP_STUDY_MODEL", () => {
  it("usa modelo Claude forte por padrão (ADR-002)", () => {
    // Sem override de env, o default é um modelo claude-* de geração atual.
    if (!process.env.SETUP_STUDY_MODEL) {
      expect(SETUP_STUDY_MODEL).toBe("claude-sonnet-5");
    }
    expect(SETUP_STUDY_MODEL.length).toBeGreaterThan(0);
  });
});
