/**
 * Testes do guard de API key do helper compartilhado de LLM (ADR-002 item 1).
 * Falha cedo com erro acionável em vez de crash críptico quando a env falta.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callAdvisorLLM, SETUP_STUDY_MODEL } from "@/infrastructure/llm/advisor-llm";

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

describe("SETUP_STUDY_MODEL", () => {
  it("usa modelo Claude forte por padrão (ADR-002)", () => {
    // Sem override de env, o default é um modelo claude-* de geração atual.
    if (!process.env.SETUP_STUDY_MODEL) {
      expect(SETUP_STUDY_MODEL).toBe("claude-3-5-sonnet-20240620");
    }
    expect(SETUP_STUDY_MODEL.length).toBeGreaterThan(0);
  });
});
