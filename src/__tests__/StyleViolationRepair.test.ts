// Violação de estilo não pode custar a resposta.
//
// Replay do corpus real (13/08): 23 de 51 turnos violaram o plano, e TODAS as
// violações foram de estilo — 23 `response_too_long`, 1 `too_many_questions`,
// zero de fato não autorizado nas três clínicas. Cada uma dessas resultou em
// descarte da resposta e escalação para humano.
//
// O lead perguntava "qual a diferença de uma para outra" ou "gostaria de saber
// valor das lentes" e recebia "Vou chamar nossa equipe" — um texto de 98
// caracteres substituindo uma resposta correta de 300.
//
// Se o validator só reclamou de tamanho, todo fato dentro do texto já passou
// pelas travas de preço, horário, mídia e garantia. Cortar no fim de uma frase
// preserva um prefixo igualmente autorizado.

import { describe, expect, it } from "vitest";
import type { AuthorizedResponsePlan } from "@/core/conversation/response-plan";
import { repairStyleViolations } from "@/core/conversation/repair-style-violations";
import type { ComposedResponse } from "@/core/intelligence/ResponseComposer";

const plano = (overrides: Partial<AuthorizedResponsePlan> = {}): AuthorizedResponsePlan => ({
  version: "response-plan.v1",
  action: "general_question",
  allowedPriceCents: [],
  allowedScheduleFacts: [],
  allowedMediaIds: [],
  allowedServices: [],
  maxQuestions: 1,
  maxCharacters: 280,
  expectedState: "none",
  ...overrides,
});

const resposta = (text: string): ComposedResponse => ({
  parts: [{ type: "text", content: text }],
  text,
  mediaIds: [],
  model: "gpt-test",
  promptVersion: "v1",
  inputTokens: 0,
  outputTokens: 0,
});

const LONGA =
  "A lente de contato dental é uma lâmina finíssima de porcelana aplicada sobre o dente. " +
  "Ela corrige cor, formato e pequenos desalinhamentos sem desgaste agressivo. " +
  "Já a faceta em resina é feita direto no consultório, em sessão única, e custa menos. " +
  "A porcelana dura mais e não mancha com café. " +
  "A resina precisa de manutenção mais frequente, mas permite ajuste rápido.";

describe("repairStyleViolations", () => {
  it("corta a resposta longa em vez de descartá-la", () => {
    const reparada = repairStyleViolations({
      response: resposta(LONGA),
      plan: plano(),
      violations: ["response_too_long"],
    });

    expect(reparada).not.toBeNull();
    expect(reparada!.text.length).toBeLessThanOrEqual(280);
    // O que sobra tem que ser conteúdo, não um pedido de espera.
    expect(reparada!.text).toContain("lente de contato dental");
  });

  it("corta no fim de uma frase, não no meio de uma palavra", () => {
    const reparada = repairStyleViolations({
      response: resposta(LONGA),
      plan: plano(),
      violations: ["response_too_long"],
    });

    expect(reparada!.text.trim()).toMatch(/[.!?]$/);
  });

  it("recusa reparo quando há violação de fato, não de estilo", () => {
    // Preço não autorizado é problema de segurança: cortar texto não conserta,
    // e entregar um prefixo poderia manter o valor inventado.
    expect(repairStyleViolations({
      response: resposta(LONGA),
      plan: plano(),
      violations: ["response_too_long", "unauthorized_price"],
    })).toBeNull();
  });

  it("recusa reparo quando o corte não resolve a violação", () => {
    // Uma frase única maior que o limite não tem onde cortar.
    const semFrase = "a".repeat(400);
    expect(repairStyleViolations({
      response: resposta(semFrase),
      plan: plano(),
      violations: ["response_too_long"],
    })).toBeNull();
  });

  it("não repara resposta vazia", () => {
    expect(repairStyleViolations({
      response: resposta(""),
      plan: plano(),
      violations: ["empty_response"],
    })).toBeNull();
  });

  // O corte é de texto. Mídia autorizada não é texto, e sumir com ela é
  // regressão factual: o lead pediu "me mostra os vídeos", o pipeline liberou
  // os arquivos, e o reparo entregaria só a legenda cortada.
  it("preserva as mídias autorizadas ao cortar o texto", () => {
    const comVideo: ComposedResponse = {
      parts: [
        { type: "text", content: LONGA },
        { type: "media", id: "vid-1" },
      ],
      text: LONGA,
      mediaIds: ["vid-1"],
      model: "gpt-test",
      promptVersion: "v1",
      inputTokens: 0,
      outputTokens: 0,
    };

    const reparada = repairStyleViolations({
      response: comVideo,
      plan: plano({ allowedMediaIds: ["vid-1"] }),
      violations: ["response_too_long"],
    });

    expect(reparada).not.toBeNull();
    expect(reparada!.mediaIds).toEqual(["vid-1"]);
    expect(reparada!.parts.filter((p) => p.type === "media")).toHaveLength(1);
  });

  // Um `mediaIds` que não corresponde às parts entregues descreve um envio que
  // não vai acontecer, e o consumidor a jusante decide por essa lista.
  it("mantém mediaIds coerente com as parts entregues", () => {
    const reparada = repairStyleViolations({
      response: resposta(LONGA),
      plan: plano(),
      violations: ["response_too_long"],
    });

    expect(reparada!.mediaIds).toEqual([]);
    expect(reparada!.parts.filter((p) => p.type === "media")).toHaveLength(0);
  });
});

// ── Integração no planner ──────────────────────────────────────────────────
// O reparo só vale se o planner parar de escalar. Sem isto, a função acima é
// código morto.

import { ConversationResponsePlanner } from "@/core/conversation/ConversationResponsePlanner";

const composerQueDevolve = (text: string) => ({
  compose: async () => resposta(text),
});

describe("ConversationResponsePlanner — violação de estilo", () => {
  const planInput = {
    commercialPolicy: null,
    installmentTable: null,
    allowedMediaIds: [] as string[],
    expectedState: null,
    maxCharacters: 280,
  };

  it("entrega a resposta cortada e NÃO escala para humano", async () => {
    const planner = new ConversationResponsePlanner(composerQueDevolve(LONGA));

    const planejado = await planner.execute({
      composerInput: { actionResult: { type: "general_question" } } as never,
      planInput,
    });

    expect(planejado.requiresHandoff).toBe(false);
    expect(planejado.source).toBe("composer_repaired");
    expect(planejado.response.text).toContain("lente de contato dental");
    expect(planejado.response.text.length).toBeLessThanOrEqual(280);
  });

  it("continua escalando quando o corte não resolve", async () => {
    const planner = new ConversationResponsePlanner(composerQueDevolve("a".repeat(400)));

    const planejado = await planner.execute({
      composerInput: { actionResult: { type: "general_question" } } as never,
      planInput,
    });

    expect(planejado.requiresHandoff).toBe(true);
    expect(planejado.source).toBe("deterministic_fallback");
  });
});
