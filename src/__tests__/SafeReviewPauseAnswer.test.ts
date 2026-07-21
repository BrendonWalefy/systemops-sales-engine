// Handoff 20/07: com a IA pausada aguardando revisão clínica da foto (trava do
// caso Nataly), o lead que perguntava algo factual e seguro — endereço, horário
// de funcionamento — recebia só o ack curto ("já encaminhei ao Doutor"), sem a
// resposta. buildSafeReviewPauseAnswer devolve essas respostas por template, sem
// reabrir o classificador nem avançar o funil (a trava segue intacta).

import { describe, it, expect } from "vitest";
import {
  buildSafeReviewPauseAnswer,
  isDirectAddressQuestion,
} from "@/core/pipeline/ConversationOrchestrator";

const clinic = {
  address: "Av. Paulista, 1000 — Bela Vista, São Paulo",
  businessHours: "Segunda a sábado, das 8h às 18h",
};

describe("isDirectAddressQuestion", () => {
  it("detecta pedidos explícitos de endereço/localização", () => {
    expect(isDirectAddressQuestion("qual o endereço de vocês?")).toBe(true);
    expect(isDirectAddressQuestion("me manda a localização")).toBe(true);
    expect(isDirectAddressQuestion("onde fica a clínica?")).toBe(true);
    expect(isDirectAddressQuestion("como chego até vocês?")).toBe(true);
  });

  it("NÃO dispara para 'onde' solto e ambíguo durante a pausa", () => {
    // Caso perigoso: sem intenção clara de localização, não pode devolver endereço.
    expect(isDirectAddressQuestion("onde está minha avaliação?")).toBe(false);
    expect(isDirectAddressQuestion("e aí, saiu o resultado?")).toBe(false);
  });
});

describe("buildSafeReviewPauseAnswer", () => {
  it("responde o endereço quando o lead pergunta onde fica", () => {
    const answer = buildSafeReviewPauseAnswer(clinic, "qual o endereço?");
    expect(answer).toContain("Av. Paulista, 1000");
  });

  it("responde o horário de funcionamento", () => {
    const answer = buildSafeReviewPauseAnswer(clinic, "qual o horário de funcionamento de vocês?");
    expect(answer).toContain("horário de atendimento");
    expect(answer).toContain("8h às 18h");
  });

  it("trata 'abrem sábado?' como pergunta institucional (não vira consulta de agenda)", () => {
    const answer = buildSafeReviewPauseAnswer(clinic, "vocês abrem sábado?");
    expect(answer).not.toBeNull();
    expect(answer?.toLowerCase()).toContain("sábado");
  });

  it("retorna null para mensagens que não são perguntas factuais seguras", () => {
    expect(buildSafeReviewPauseAnswer(clinic, "acho que a foto ficou ruim")).toBeNull();
    expect(buildSafeReviewPauseAnswer(clinic, "o doutor já viu?")).toBeNull();
  });

  it("não inventa endereço quando a clínica não tem um cadastrado", () => {
    expect(buildSafeReviewPauseAnswer({ address: null, businessHours: null }, "qual o endereço?")).toBeNull();
  });
});
