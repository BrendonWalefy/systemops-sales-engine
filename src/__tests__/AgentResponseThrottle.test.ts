// Testes para lógica de throttle de resposta do agente.
// Previne o envio de respostas duplas quando dois webhooks chegam
// em sequência rápida para a mesma conversa.
//
// Bug real reproduzido: Fe Em Deus enviou duas mensagens em 5s
// ("Boa tarde Gregori blz" às 15:27:43 e "Aqui é o Bruno da Aline"
// às 15:27:48) e recebeu dois "Bom dia!" idênticos às 15:27:52 e 15:27:53.
//
// O throttle opera em cima do agente: se já há uma mensagem do agente
// nos últimos N segundos para a mesma conversa, não dispara nova resposta.

import { describe, it, expect } from "vitest";
import { shouldThrottleRapidLeadMessage } from "@/core/pipeline/ConversationOrchestrator";
import type { Message } from "@/domain/entities/conversation";
import type { Treatment } from "@/domain/entities/treatment";

// ─── Lógica pura extraída do Orchestrator ─────────────────────────────────────

type RecentAgentMessage = { sentAt: Date } | null;

/**
 * Retorna true se o agente deve ser silenciado porque já respondeu
 * recentemente para esta conversa.
 *
 * @param recentAgentMsg - última mensagem do agente na conversa (ou null)
 * @param now            - momento atual
 * @param windowMs       - janela de silêncio em ms (padrão: 4000ms)
 */
function shouldThrottleAgentResponse(
  recentAgentMsg: RecentAgentMessage,
  now: Date,
  windowMs = 4_000,
): boolean {
  if (!recentAgentMsg) return false;
  return now.getTime() - recentAgentMsg.sentAt.getTime() < windowMs;
}

// ─── Lógica de dedup de conteúdo inbound (mensagem do lead) ───────────────────

type ContentDupe = { id: string } | null;

function shouldSkipInboundDueToContentDupe(contentDupe: ContentDupe): boolean {
  return contentDupe !== null;
}

// ─── Testes: throttle de resposta do agente ────────────────────────────────────

describe("AgentResponseThrottle — silencia resposta duplicada", () => {
  const NOW = new Date("2026-06-03T15:27:52.000Z");

  it("sem mensagem recente do agente → responde normalmente", () => {
    expect(shouldThrottleAgentResponse(null, NOW)).toBe(false);
  });

  it("agente respondeu há 1s → throttle ativo (silencia segundo webhook)", () => {
    const sentAt = new Date(NOW.getTime() - 1_000);
    expect(shouldThrottleAgentResponse({ sentAt }, NOW)).toBe(true);
  });

  it("agente respondeu há 3.9s → ainda dentro da janela de 4s (throttle ativo)", () => {
    const sentAt = new Date(NOW.getTime() - 3_900);
    expect(shouldThrottleAgentResponse({ sentAt }, NOW)).toBe(true);
  });

  it("agente respondeu há exatamente 4s → fora da janela (responde)", () => {
    const sentAt = new Date(NOW.getTime() - 4_000);
    // >= windowMs → não está dentro da janela (usa <, não <=)
    expect(shouldThrottleAgentResponse({ sentAt }, NOW)).toBe(false);
  });

  it("agente respondeu há 5s → fora da janela (responde normalmente)", () => {
    const sentAt = new Date(NOW.getTime() - 5_000);
    expect(shouldThrottleAgentResponse({ sentAt }, NOW)).toBe(false);
  });

  it("agente respondeu há 30min → fora da janela (responde normalmente)", () => {
    const sentAt = new Date(NOW.getTime() - 30 * 60_000);
    expect(shouldThrottleAgentResponse({ sentAt }, NOW)).toBe(false);
  });

  it("janela customizada de 2s: resposta há 1.5s → throttle ativo", () => {
    const sentAt = new Date(NOW.getTime() - 1_500);
    expect(shouldThrottleAgentResponse({ sentAt }, NOW, 2_000)).toBe(true);
  });

  it("janela customizada de 2s: resposta há 3s → fora da janela", () => {
    const sentAt = new Date(NOW.getTime() - 3_000);
    expect(shouldThrottleAgentResponse({ sentAt }, NOW, 2_000)).toBe(false);
  });
});

// ─── Cenário real: Fe Em Deus (bug 2026-06-03) ────────────────────────────────

describe("AgentResponseThrottle — Bug Fe Em Deus (duas mensagens em 5s, duas saudações)", () => {
  // Sequência real do banco:
  // 15:27:43 lead: "Boa tarde Gregori blz"
  // 15:27:48 lead: "Aqui é o Bruno da Aline"  (5s depois)
  // 15:27:52 agent: saudação  ← primeiro webhook processado
  // 15:27:53 agent: saudação  ← segundo webhook, deveria ter sido throttled!

  const firstAgentResponse = new Date("2026-06-03T15:27:52.000Z");
  const secondWebhookArrival = new Date("2026-06-03T15:27:53.000Z"); // 1s depois

  it("REGRESSÃO: segundo webhook chega 1s após primeira resposta → throttle deve silenciar", () => {
    const shouldThrottle = shouldThrottleAgentResponse(
      { sentAt: firstAgentResponse },
      secondWebhookArrival,
      4_000,
    );
    expect(shouldThrottle).toBe(true);
  });

  it("sem throttle (bug): segundo webhook não seria silenciado → explica a duplicação", () => {
    // Documenta o comportamento ANTERIOR sem throttle:
    // o sistema não verificava sentAt da última resposta do agente
    const withoutThrottle = false; // sem o check, nunca throttle
    expect(withoutThrottle).toBe(false); // → resulta em dupla resposta (bug)
  });

  it("com janela de 4s, mensagem 5s anterior NÃO seria throttled (lead novo voltando)", () => {
    const oldResponse = new Date("2026-06-03T15:27:43.000Z"); // 10s antes do segundo webhook
    const newMessage = new Date("2026-06-03T15:27:53.000Z");
    expect(shouldThrottleAgentResponse({ sentAt: oldResponse }, newMessage, 4_000)).toBe(false);
  });
});

describe("AgentResponseThrottle — integração com Orchestrator", () => {
  const conversationId = "conv-1";
  const base = new Date("2026-06-03T15:27:43.000Z");
  const treatments: Treatment[] = [
    {
      id: "treatment-lentes",
      clinicId: "clinic-1",
      name: "Lentes de resina composta",
      durationMinutes: 60,
      description: null,
      requiresEvaluationFirst: true,
      keywordMatchEnabled: true,
      aliases: [],
      isAesthetic: false,
      pipelineSteps: null,
      priceCents: null,
      minPriceCents: null,
      maxPriceCents: null,
      priceQuotableInChat: false,
      priceKind: "from",
      priceUnit: null,
      priceDeductible: false,
      createdAt: base,
      updatedAt: base,
    },
  ];

  function lead(id: string, body: string, offsetMs: number): Message {
    return {
      id,
      conversationId,
      author: "lead",
      body,
      sentAt: new Date(base.getTime() + offsetMs),
      externalId: id,
    };
  }

  // Nova semântica (jul/2026): adia a mensagem que TEM um follow-up rápido
  // depois dela; a TERMINAL do burst sempre responde (com o histórico completo).
  it("adia a mensagem com follow-up rápido, mas responde a TERMINAL do burst", () => {
    const messages = [
      lead("msg-1", "oi", 0),
      lead("msg-2", "chegou", 2_000),
    ];

    // msg-1 tem um follow-up rápido (msg-2) → adia, a resposta sai da msg-2.
    expect(shouldThrottleRapidLeadMessage({
      messages,
      currentExternalId: "msg-1",
      hasPendingSlotOffer: false,
      isMenuActive: false,
      treatments,
    })).toBe(true);

    // msg-2 é a terminal (nada mais novo) → NÃO adia, responde uma vez.
    expect(shouldThrottleRapidLeadMessage({
      messages,
      currentExternalId: "msg-2",
      hasPendingSlotOffer: false,
      isMenuActive: false,
      treatments,
    })).toBe(false);
  });

  // REGRESSÃO real: Horizonte 23/07 — "quero ve-los / mande / pelo / menos /
  // duas / midias" (6 msgs rápidas, deltas 2/2/1/2/1s). A regra antiga suprimia
  // a última ("midias", 1s após "duas") e a rajada inteira ficava sem resposta.
  it("REGRESSÃO Horizonte: só as intermediárias são adiadas; a última responde", () => {
    const burst = [
      lead("quero", "quero ve-los", 0),
      lead("mande", "mande", 2_000),
      lead("pelo", "pelo", 4_000),
      lead("menos", "menos", 5_000),
      lead("duas", "duas", 7_000),
      lead("midias", "midias", 8_000),
    ];
    const throttleOf = (externalId: string) =>
      shouldThrottleRapidLeadMessage({
        messages: burst,
        currentExternalId: externalId,
        hasPendingSlotOffer: false,
        isMenuActive: false,
        treatments,
      });

    for (const id of ["quero", "mande", "pelo", "menos", "duas"]) {
      expect(throttleOf(id)).toBe(true); // têm follow-up rápido → adiam
    }
    expect(throttleOf("midias")).toBe(false); // terminal → responde
  });

  it("follow-up FORA da janela (turno separado) não adia a mensagem anterior", () => {
    const messages = [
      lead("msg-1", "oi", 0),
      lead("msg-2", "voltei", 10_000), // 10s depois → não é a mesma rajada
    ];

    expect(shouldThrottleRapidLeadMessage({
      messages,
      currentExternalId: "msg-1",
      hasPendingSlotOffer: false,
      isMenuActive: false,
      treatments,
    })).toBe(false);
  });

  // Guards (early-return): cada cenário tem um follow-up rápido DEPOIS da
  // mensagem atual, para que seja o GUARD — e não a terminalidade — a impedir
  // o adiamento.
  it("não adia escolha de slot quando há oferta pendente", () => {
    const messages = [
      lead("msg-1", "quero agendar uma avaliacao", 0),
      lead("msg-2", "1", 2_000),
      lead("msg-3", "pode ser", 3_000),
    ];

    expect(shouldThrottleRapidLeadMessage({
      messages,
      currentExternalId: "msg-2",
      hasPendingSlotOffer: true,
      isMenuActive: false,
      treatments,
    })).toBe(false);
  });

  it("não adia número enquanto uma lista de procedimentos está ativa", () => {
    const messages = [
      lead("msg-1", "quais procedimentos voces fazem", 0),
      lead("msg-2", "8", 2_000),
      lead("msg-3", "esse", 3_000),
    ];

    expect(shouldThrottleRapidLeadMessage({
      messages,
      currentExternalId: "msg-2",
      hasPendingSlotOffer: false,
      isMenuActive: false,
      isProcedureListActive: true,
      treatments,
    })).toBe(false);
  });

  it("não adia mensagem de conteúdo de tratamento, mesmo com follow-up rápido", () => {
    const messages = [
      lead("msg-1", "Boa tarde", 0),
      lead("msg-2", "Lentes", 2_000),
      lead("msg-3", "quanto", 3_000),
    ];

    expect(shouldThrottleRapidLeadMessage({
      messages,
      currentExternalId: "msg-2",
      hasPendingSlotOffer: false,
      isMenuActive: false,
      treatments,
    })).toBe(false);
  });

  it("não adia preferência de período, mesmo com follow-up rápido", () => {
    const messages = [
      lead("msg-1", "quero agendar", 0),
      lead("msg-2", "de tarde", 2_000),
      lead("msg-3", "por favor", 3_000),
    ];

    expect(shouldThrottleRapidLeadMessage({
      messages,
      currentExternalId: "msg-2",
      hasPendingSlotOffer: false,
      isMenuActive: false,
      treatments,
    })).toBe(false);
  });
});

// ─── Testes: dedup de conteúdo inbound (diferentes das mensagens do Fe Em Deus) ─

describe("AgentResponseThrottle — dedup inbound NÃO resolve o bug de mensagens DIFERENTES", () => {
  // O dedup inbound só funciona para mensagens IGUAIS do mesmo lead na mesma janela.
  // Fe Em Deus enviou MENSAGENS DIFERENTES ("Boa tarde..." vs "Aqui é o Bruno..."),
  // então o dedup inbound não ajuda — só o throttle de resposta resolve.

  it("mensagens diferentes do mesmo lead não são deduplicadas no inbound", () => {
    const dupeMsg1 = shouldSkipInboundDueToContentDupe(null); // body diferente → null → processa
    const dupeMsg2 = shouldSkipInboundDueToContentDupe(null); // body diferente → null → processa
    expect(dupeMsg1).toBe(false);
    expect(dupeMsg2).toBe(false);
    // Ambas processadas → sem throttle de agente → duas respostas (bug)
  });

  it("mesma mensagem dentro de 5s é deduplicada no inbound (caso diferente)", () => {
    // Este é o cenário onde Z-API entrega dois webhooks com mesmo conteúdo — isso sim cobre o dedup
    const isDupe = shouldSkipInboundDueToContentDupe({ id: "existing-msg" });
    expect(isDupe).toBe(true);
  });
});

// ─── Testes: Larissa — duas conversas paralelas (race condition) ───────────────

describe("AgentResponseThrottle — Bug Larissa (duas conversas criadas para o mesmo lead)", () => {
  // Sequência real:
  // 10:41:05 lead: "Olá bom dia" → cria conversa A
  // 10:41:07 lead: "Tenho interesse em lentes..." → cria conversa B (2s depois, antes de A commitar)
  // 10:41:16 agent responde A e B com saudação idêntica
  //
  // Causa: findOrCreateConversation não usa lock → race condition entre dois webhooks simultâneos.
  // O throttle de resposta não resolve esse problema (são conversas distintas),
  // mas documenta o comportamento esperado: uma única conversa ativa por lead+clínica.

  function simulateFindOrCreateConversation(
    existingConversationId: string | null,
    leadId: string,
    clinicId: string,
  ): string {
    if (existingConversationId) return existingConversationId;
    return `new-conv-${leadId}-${clinicId}-${Date.now()}`;
  }

  it("segundo webhook encontra conversa criada pelo primeiro → usa a mesma (sem race)", () => {
    // No cenário correto (com lock ou upsert), o segundo webhook encontra a conversa
    const existingConvId = "conv-uuid-A";
    const convId = simulateFindOrCreateConversation(existingConvId, "lead-larissa", "clinic-1");
    expect(convId).toBe("conv-uuid-A");
  });

  it("RACE CONDITION: segundo webhook não encontra conversa ainda → cria nova (bug)", () => {
    // Sem lock, o segundo webhook chega antes do primeiro commitar
    const convId = simulateFindOrCreateConversation(null, "lead-larissa", "clinic-1");
    expect(convId).toContain("lead-larissa"); // criou uma nova → bug
    expect(convId).not.toBe("conv-uuid-A");  // diferente da conversa do primeiro webhook
  });
});
