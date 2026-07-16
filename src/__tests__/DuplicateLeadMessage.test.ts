import { describe, it, expect } from "vitest";
import { findLeadMessageRepeat } from "@/core/pipeline/ConversationOrchestrator";

// A9 — Reenvio idêntico do lead (duplo clique no anúncio CTWA). Caso real: Diego Almeida
// enviou a mesma abertura de anúncio às 19h05 e de novo às 20h14 (15/07). Sem tratamento
// o pipeline, reprocessar geraria um segundo pitch diferente do primeiro.
const AD_OPENER = "Olá! Quero saber como posso transformar meu sorriso com as lentes  de resina?";

function msg(author: "lead" | "agent", body: string, sentAt: string) {
  return { author, body, sentAt: new Date(sentAt) };
}

describe("findLeadMessageRepeat", () => {
  it("detecta reenvio idêntico dentro de 24h que já recebeu resposta (caso Diego)", () => {
    const history = [
      msg("lead", AD_OPENER, "2026-07-15T22:05:00Z"),
      msg("agent", "Boa tarde, Diego. Tudo bem?", "2026-07-15T22:06:00Z"),
      msg("lead", AD_OPENER, "2026-07-15T23:14:00Z"), // reenvio 1h depois
    ];
    const result = findLeadMessageRepeat({
      currentBody: AD_OPENER,
      history,
      now: new Date("2026-07-15T23:14:05Z").getTime(),
    });
    expect(result).not.toBeNull();
    expect(result?.sentAt.toISOString()).toBe("2026-07-15T22:05:00.000Z");
  });

  it("NÃO dispara se o reenvio anterior ainda não teve resposta do agente", () => {
    const history = [
      msg("lead", AD_OPENER, "2026-07-15T22:05:00Z"),
      msg("lead", AD_OPENER, "2026-07-15T22:05:30Z"),
    ];
    const result = findLeadMessageRepeat({
      currentBody: AD_OPENER,
      history,
      now: new Date("2026-07-15T22:05:35Z").getTime(),
    });
    expect(result).toBeNull();
  });

  it("NÃO dispara fora da janela de 24h", () => {
    const history = [
      msg("lead", AD_OPENER, "2026-07-13T22:05:00Z"),
      msg("agent", "Boa tarde!", "2026-07-13T22:06:00Z"),
      msg("lead", AD_OPENER, "2026-07-15T23:14:00Z"),
    ];
    const result = findLeadMessageRepeat({
      currentBody: AD_OPENER,
      history,
      now: new Date("2026-07-15T23:14:05Z").getTime(),
    });
    expect(result).toBeNull();
  });

  it("NÃO dispara para mensagens curtas (< 20 chars) — evita falso positivo em 'oi', 'sim'", () => {
    const history = [
      msg("lead", "sim", "2026-07-15T22:05:00Z"),
      msg("agent", "Perfeito!", "2026-07-15T22:06:00Z"),
      msg("lead", "sim", "2026-07-15T22:10:00Z"),
    ];
    const result = findLeadMessageRepeat({
      currentBody: "sim",
      history,
      now: new Date("2026-07-15T22:10:05Z").getTime(),
    });
    expect(result).toBeNull();
  });

  it("NÃO dispara quando a mensagem atual é diferente da anterior", () => {
    const history = [
      msg("lead", AD_OPENER, "2026-07-15T22:05:00Z"),
      msg("agent", "Boa tarde!", "2026-07-15T22:06:00Z"),
      msg("lead", "Gostaria de saber o valor de 16 lentes", "2026-07-15T22:10:00Z"),
    ];
    const result = findLeadMessageRepeat({
      currentBody: "Gostaria de saber o valor de 16 lentes",
      history,
      now: new Date("2026-07-15T22:10:05Z").getTime(),
    });
    expect(result).toBeNull();
  });
});
