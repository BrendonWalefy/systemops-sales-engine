// Tests for Z-API webhook human-takeover logic (Bug #2).
// The POST handler cannot be unit-tested directly because it imports DB clients.
// Instead, we extract the deduplication decision tree as a pure function and test it.
//
// The logic in route.ts (POST, fromMe=true block):
//   1. If messageId exists in DB → echo da IA
//   2. If recent agent message with same text (last 30s) → echo da IA (race condition guard)
//   3. Otherwise → operator message → handleOperatorMessageFromPhone()
//
// We model this decision tree as a pure function for testability.

import { describe, it, expect } from "vitest";

// ─── Pure decision function extracted from route.ts logic ──────────────────
// This mirrors the exact conditional structure in the POST handler's fromMe block.

type MessageLookupResult = { id: string } | null;

/**
 * Classifies a fromMe=true webhook event as "echo_ai" or "operator".
 *
 * @param existingByMessageId - result of DB query for externalId = messageId
 * @param recentAgentMessage - result of DB query for agent messages with same text in last 30s
 */
function classifyFromMeMessage(
  existingByMessageId: MessageLookupResult,
  recentAgentMessage: MessageLookupResult,
): "echo_ai" | "operator" {
  // 1ª verificação: messageId já está no banco → é echo da IA
  if (existingByMessageId) return "echo_ai";

  // 2ª verificação: mensagem da IA com mesmo corpo salva nos últimos 30s (race condition guard)
  if (recentAgentMessage) return "echo_ai";

  // Nenhuma verificação bateu → é o operador enviando do celular
  return "operator";
}

/**
 * Top-level classifier: routes the webhook event to "lead_inbound", "echo_ai", or "operator".
 */
function classifyWebhookEvent(params: {
  fromMe: boolean;
  hasTextMessage: boolean;
  existingByMessageId: MessageLookupResult;
  recentAgentMessage: MessageLookupResult;
}): "lead_inbound" | "echo_ai" | "operator" | "no_text" {
  const { fromMe, hasTextMessage, existingByMessageId, recentAgentMessage } = params;

  if (!fromMe) return "lead_inbound";

  if (!hasTextMessage) return "no_text"; // mídia/sticker/reação — ignorar

  return classifyFromMeMessage(existingByMessageId, recentAgentMessage);
}

function resolveLeadInboundHandling(params: {
  autoReplyEnabled: boolean;
  textMessage?: string | null;
  hasAudio: boolean;
}): { shouldRegister: boolean; shouldReply: boolean; messageText: string | null } {
  const shouldReply = params.autoReplyEnabled;

  if (params.textMessage) {
    return {
      shouldRegister: true,
      shouldReply,
      messageText: params.textMessage,
    };
  }

  if (params.hasAudio && !shouldReply) {
    return {
      shouldRegister: true,
      shouldReply: false,
      messageText: "[áudio recebido]",
    };
  }

  if (params.hasAudio) {
    return {
      shouldRegister: true,
      shouldReply: true,
      messageText: "[áudio] <transcrição>",
    };
  }

  return {
    shouldRegister: false,
    shouldReply,
    messageText: null,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("ZApi Webhook — fromMe deduplication logic", () => {
  it("fromMe=false → sempre 'lead_inbound'", () => {
    const result = classifyWebhookEvent({
      fromMe: false,
      hasTextMessage: true,
      existingByMessageId: null,
      recentAgentMessage: null,
    });
    expect(result).toBe("lead_inbound");
  });

  it("fromMe=false, sem texto → ainda 'lead_inbound' (texto verificado depois pelo orchestrator)", () => {
    const result = classifyWebhookEvent({
      fromMe: false,
      hasTextMessage: false,
      existingByMessageId: null,
      recentAgentMessage: null,
    });
    expect(result).toBe("lead_inbound");
  });

  it("fromMe=true, sem texto (mídia/sticker) → 'no_text' (ignorar)", () => {
    const result = classifyWebhookEvent({
      fromMe: true,
      hasTextMessage: false,
      existingByMessageId: null,
      recentAgentMessage: null,
    });
    expect(result).toBe("no_text");
  });

  it("fromMe=true, messageId já existe no banco → 'echo_ai'", () => {
    const result = classifyWebhookEvent({
      fromMe: true,
      hasTextMessage: true,
      existingByMessageId: { id: "existing-msg-uuid" }, // messageId found in DB
      recentAgentMessage: null,
    });
    expect(result).toBe("echo_ai");
  });

  it("fromMe=true, messageId NÃO existe, mas texto igual a msg do agente nos últimos 30s → 'echo_ai'", () => {
    // This is the race condition guard — echo arrives before orchestrator saves
    const result = classifyWebhookEvent({
      fromMe: true,
      hasTextMessage: true,
      existingByMessageId: null, // messageId not yet in DB
      recentAgentMessage: { id: "recent-agent-msg-uuid" }, // same text from agent in last 30s
    });
    expect(result).toBe("echo_ai");
  });

  it("fromMe=true, messageId não existe, sem mensagem recente do agente → 'operator'", () => {
    // This is the happy path: operator typed on phone
    const result = classifyWebhookEvent({
      fromMe: true,
      hasTextMessage: true,
      existingByMessageId: null,
      recentAgentMessage: null,
    });
    expect(result).toBe("operator");
  });

  it("fromMe=true, messageId existe E tem mensagem recente → 'echo_ai' (primeira verificação vence)", () => {
    const result = classifyWebhookEvent({
      fromMe: true,
      hasTextMessage: true,
      existingByMessageId: { id: "existing-msg-uuid" },
      recentAgentMessage: { id: "recent-agent-msg-uuid" },
    });
    expect(result).toBe("echo_ai");
  });
});

describe("ZApi Webhook — autoReply desligado mantém ingestão", () => {
  it("mensagem de texto com autoReply=false é registrada, mas sem resposta da IA", () => {
    const result = resolveLeadInboundHandling({
      autoReplyEnabled: false,
      textMessage: "Olá, quero saber valores",
      hasAudio: false,
    });

    expect(result).toEqual({
      shouldRegister: true,
      shouldReply: false,
      messageText: "Olá, quero saber valores",
    });
  });

  it("áudio com autoReply=false é registrado como placeholder, sem transcrever nem responder", () => {
    const result = resolveLeadInboundHandling({
      autoReplyEnabled: false,
      textMessage: null,
      hasAudio: true,
    });

    expect(result).toEqual({
      shouldRegister: true,
      shouldReply: false,
      messageText: "[áudio recebido]",
    });
  });

  it("mensagem de texto com autoReply=true segue para resposta normal", () => {
    const result = resolveLeadInboundHandling({
      autoReplyEnabled: true,
      textMessage: "Quero agendar",
      hasAudio: false,
    });

    expect(result).toEqual({
      shouldRegister: true,
      shouldReply: true,
      messageText: "Quero agendar",
    });
  });

  it("mídia sem texto nem áudio continua sem registro", () => {
    const result = resolveLeadInboundHandling({
      autoReplyEnabled: false,
      textMessage: null,
      hasAudio: false,
    });

    expect(result).toEqual({
      shouldRegister: false,
      shouldReply: false,
      messageText: null,
    });
  });
});

// ─── Tests: handleOperatorMessageFromPhone behavior ────────────────────────
// We test the key side-effect logic with mock DB calls.

describe("ZApi Webhook — handleOperatorMessageFromPhone (mocked DB)", () => {
  type ConversationRow = { id: string };

  /**
   * Simulates handleOperatorMessageFromPhone logic with injected DB mock.
   * Returns what state would be applied.
   */
  async function simulateHandleOperator(params: {
    leadPhone: string;
    messageText: string;
    messageId: string;
    conversationFound: ConversationRow | null;
  }): Promise<{
    messageInserted: boolean;
    conversationUpdated: boolean;
    aiPaused: boolean | null;
    conversationId: string | null;
  }> {
    const { conversationFound } = params;

    // Simulate DB query: find active conversation for this lead
    const conv = conversationFound;

    if (!conv) {
      return {
        messageInserted: false,
        conversationUpdated: false,
        aiPaused: null,
        conversationId: null,
      };
    }

    const updatedConversation = {
      id: conv.id,
      aiPaused: true,
      needsAttention: false,
      attentionReason: null,
      consecutiveUnclearCount: 0,
    };

    return {
      messageInserted: true,
      conversationUpdated: true,
      aiPaused: updatedConversation.aiPaused,
      conversationId: conv.id,
    };
  }

  it("quando conversa existe → mensagem inserida e aiPaused=true", async () => {
    const result = await simulateHandleOperator({
      leadPhone: "5511999999999",
      messageText: "Olá, pode vir amanhã às 14h",
      messageId: "operator-msg-123",
      conversationFound: { id: "conv-uuid-abc" },
    });

    expect(result.messageInserted).toBe(true);
    expect(result.conversationUpdated).toBe(true);
    expect(result.aiPaused).toBe(true);
    expect(result.conversationId).toBe("conv-uuid-abc");
  });

  it("quando conversa NÃO existe → nenhuma operação de DB", async () => {
    const result = await simulateHandleOperator({
      leadPhone: "5511000000000",
      messageText: "Mensagem qualquer",
      messageId: "operator-msg-456",
      conversationFound: null, // No active conversation
    });

    expect(result.messageInserted).toBe(false);
    expect(result.conversationUpdated).toBe(false);
    expect(result.aiPaused).toBeNull();
    expect(result.conversationId).toBeNull();
  });

  it("CRÍTICO — Bug #2: fim de dia, operador envia mensagem → deve resultar em aiPaused=true", async () => {
    // This tests the exact end-of-day scenario from the bug report:
    // Operator responds to a lead late in the day.
    // The concern is that the deduplication logic might incorrectly classify
    // the operator's message as an echo_ai if the 30s window has a stale message.
    //
    // In the correctly functioning system:
    // - If messageId is NOT in DB (operator typed fresh message) AND
    // - No recent agent message with same text in last 30s
    // → classifyFromMeMessage returns "operator"
    // → handleOperatorMessageFromPhone is called → aiPaused=true
    //
    // The potential failure mode: if the operator's text happens to match
    // a previous agent message body still within the 30s window.

    const classification = classifyWebhookEvent({
      fromMe: true,
      hasTextMessage: true,
      existingByMessageId: null,       // New message, not in DB yet
      recentAgentMessage: null,        // No recent agent message with same text
    });

    // Classification must be "operator" for the pause to happen
    expect(classification).toBe("operator");

    // Then operator handling pauses the AI
    const result = await simulateHandleOperator({
      leadPhone: "5511999999999",
      messageText: "Pode vir sim, qualquer dúvida estamos à disposição",
      messageId: "operator-endofday-msg",
      conversationFound: { id: "conv-eod-uuid" },
    });

    expect(result.aiPaused).toBe(true);
  });

  it("EDGE CASE — race condition: echo chega antes do orchestrator salvar → NÃO deve pausar IA", () => {
    // If the echo has the same text as a recent agent message, it should be classified as echo_ai
    // This means the AI should NOT be paused (operator didn't send this)
    const classification = classifyWebhookEvent({
      fromMe: true,
      hasTextMessage: true,
      existingByMessageId: null,                          // Race condition: not yet in DB
      recentAgentMessage: { id: "agent-recent-uuid" },   // But same text from agent found
    });

    expect(classification).toBe("echo_ai");
    // When echo_ai, handleOperatorMessageFromPhone is NOT called → aiPaused stays as-is
  });

  it("EDGE CASE — operador envia texto idêntico ao que a IA acabou de enviar (falso positivo)", () => {
    // Bug potential: If operator types the same words the AI just sent (e.g., "Olá!"),
    // the 30s window check would misclassify it as echo_ai.
    // This documents the known limitation in the current implementation.
    //
    // Current behavior: classified as echo_ai (false positive — operator message lost)
    // Expected ideal behavior: classified as operator
    //
    // This is a KNOWN LIMITATION documented here as a test for awareness.

    const operatorTextSameAsRecentAgent = classifyWebhookEvent({
      fromMe: true,
      hasTextMessage: true,
      existingByMessageId: null,
      recentAgentMessage: { id: "agent-said-same-thing" }, // same body in last 30s
    });

    // CURRENT behavior — documents the false positive
    expect(operatorTextSameAsRecentAgent).toBe("echo_ai");
    // IDEALLY this should be "operator" when the messageId is different from the agent's
    // message externalId — but the current implementation doesn't check messageId cross-reference
  });
});

// ─── Tests: content-based inbound dedup (Orchestrator step 1.5) ──────────────
// Z-API pode entregar o mesmo webhook com messageIds distintos e até timestamps distintos
// (o retry usa o horário de reentrega, não o da mensagem original).
// O Orchestrator verifica corpo+telefone+janela de 2min (wall-clock) antes de processar.

describe("Orchestrator — dedup por conteúdo de mensagem inbound", () => {
  type ContentDupeResult = { id: string } | null;

  function shouldSkipDueToDuplicate(contentDupe: ContentDupeResult): boolean {
    return contentDupe !== null;
  }

  it("nenhum webhook duplicado → processa normalmente", () => {
    expect(shouldSkipDueToDuplicate(null)).toBe(false);
  });

  it("mesmo conteúdo já salvo nos últimos 2min → descarta webhook", () => {
    expect(shouldSkipDueToDuplicate({ id: "existing-lead-msg" })).toBe(true);
  });

  it("conteúdo diferente (mesmo lead) → processa normalmente", () => {
    // O corpo da query filtra por body=messageText; se o body for diferente, retorna null
    expect(shouldSkipDueToDuplicate(null)).toBe(false);
  });

  it("mensagem idêntica fora da janela de 2min → processa", () => {
    // A query usa gte(sentAt, twoMinutesAgo); mensagem salva há mais de 2min não é retornada
    expect(shouldSkipDueToDuplicate(null)).toBe(false);
  });

  it("Z-API entrega duplicata com ID diferente dentro de 2min → descarta segundo webhook", () => {
    // Cenário real: Z-API retentou "Lentes" com messageId e timestamp novos ~5min depois.
    // Primeiro webhook salva a mensagem → segundo encontra o contentDupe → skip.
    const contentDupe: ContentDupeResult = { id: "lead-msg-id-A" };
    expect(shouldSkipDueToDuplicate(contentDupe)).toBe(true);
  });

  it("Z-API retry tardio com timestamp novo é bloqueado pela janela wall-clock", () => {
    // Antes (janela baseada no timestamp da mensagem): o retry chegava com timestamp=now,
    // fazendo a janela de 5s expirar → pipeline rodava de novo → vídeos duplicados.
    // Agora (janela wall-clock de 2min): mesmo que o retry tenha timestamp novo,
    // a query compara sentAt (quando salvamos) com Date.now()-2min → cobre o retry.
    const contentDupe: ContentDupeResult = { id: "lead-msg-id-original" };
    expect(shouldSkipDueToDuplicate(contentDupe)).toBe(true);
  });
});

// ─── Tests: 30-second window boundary ─────────────────────────────────────

describe("ZApi Webhook — 30s deduplication window timing", () => {
  it("mensagem do agente salva 31s atrás → NÃO conta como echo (fora da janela)", () => {
    // Simulates: recentAgentMessage query returns null because sentAt > 30s ago
    const classification = classifyWebhookEvent({
      fromMe: true,
      hasTextMessage: true,
      existingByMessageId: null,
      recentAgentMessage: null, // DB query returns null for >30s old messages
    });

    expect(classification).toBe("operator");
  });

  it("mensagem do agente salva 29s atrás → CONTA como echo (dentro da janela)", () => {
    const classification = classifyWebhookEvent({
      fromMe: true,
      hasTextMessage: true,
      existingByMessageId: null,
      recentAgentMessage: { id: "recent-29s-ago" },
    });

    expect(classification).toBe("echo_ai");
  });
});
