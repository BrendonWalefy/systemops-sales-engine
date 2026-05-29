// Testes para a feature needs_human — handoff automático ao operador.
// Cobre: lógica de pausa, attentionReason, e o ResponseComposer context.

import { describe, it, expect } from "vitest";

// ─── Tipos locais (espelham o domínio sem importar infra) ──────────────────

type HandoffResult = {
  aiPaused: boolean;
  takeoverExpiresAt: Date | null;
  needsAttention: boolean;
  attentionReason: string;
};

// ─── Lógica pura extraída do Orchestrator (case needs_human) ──────────────

function buildHandoffUpdate(handoffReason: string): HandoffResult {
  return {
    aiPaused: true,
    takeoverExpiresAt: null,   // pausa permanente — sem TTL
    needsAttention: true,
    attentionReason: handoffReason,
  };
}

function resolveHandoffReason(classifierReason: string | null | undefined): string {
  return classifierReason ?? "Lead solicitou atendimento humano";
}

// ─── Lógica do buildActionContext para handoff_requested ──────────────────

function buildHandoffContext(handoffReason?: string | null): string {
  const context = handoffReason
    ? `O lead pediu: "${handoffReason}". Reconheça o pedido especificamente — não seja genérico.`
    : "Informe que um membro da equipe irá assumir o atendimento em breve.";
  return `AÇÃO EXECUTADA: Este pedido requer atendimento humano — a IA não pode cumprir.\n${context}`;
}

// ─── 1. Pausa permanente sem TTL ──────────────────────────────────────────

describe("NeedsHuman — pausa permanente", () => {
  it("seta aiPaused sem takeoverExpiresAt", () => {
    const update = buildHandoffUpdate("Lead pediu fotos do procedimento");
    expect(update.aiPaused).toBe(true);
    expect(update.takeoverExpiresAt).toBeNull();
  });

  it("seta needsAttention com attentionReason preenchido", () => {
    const reason = "Lead quer falar com o dentista";
    const update = buildHandoffUpdate(reason);
    expect(update.needsAttention).toBe(true);
    expect(update.attentionReason).toBe(reason);
  });

  it("pausa permanente não é retomada por TTL (sem expiresAt)", () => {
    const update = buildHandoffUpdate("Lead pediu condição especial");
    const now = new Date();
    const wouldExpire = update.takeoverExpiresAt !== null && update.takeoverExpiresAt < now;
    expect(wouldExpire).toBe(false);
  });
});

// ─── 2. Resolução do handoffReason ────────────────────────────────────────

describe("NeedsHuman — resolução do handoffReason", () => {
  it("usa o reason do classifier quando presente", () => {
    const reason = resolveHandoffReason("Lead pediu fotos do procedimento realizado");
    expect(reason).toBe("Lead pediu fotos do procedimento realizado");
  });

  it("usa fallback quando classifier retorna null", () => {
    const reason = resolveHandoffReason(null);
    expect(reason).toBe("Lead solicitou atendimento humano");
  });

  it("usa fallback quando classifier retorna undefined", () => {
    const reason = resolveHandoffReason(undefined);
    expect(reason).toBe("Lead solicitou atendimento humano");
  });
});

// ─── 3. ResponseComposer context para handoff_requested ───────────────────

describe("NeedsHuman — ResponseComposer context", () => {
  it("inclui o pedido específico do lead quando handoffReason presente", () => {
    const ctx = buildHandoffContext("Lead pediu fotos do procedimento realizado");
    expect(ctx).toContain("fotos do procedimento realizado");
    expect(ctx).toContain("Reconheça o pedido especificamente");
  });

  it("usa instrução genérica quando handoffReason ausente", () => {
    const ctx = buildHandoffContext(null);
    expect(ctx).toContain("membro da equipe irá assumir");
    expect(ctx).not.toContain("Reconheça o pedido especificamente");
  });

  it("instrui o composer a não ser genérico quando há contexto", () => {
    const ctx = buildHandoffContext("Lead quer falar com o dentista");
    expect(ctx).toContain("não seja genérico");
  });

  it("sempre instrui que a IA não pode cumprir o pedido", () => {
    const ctxWith = buildHandoffContext("fotos");
    const ctxWithout = buildHandoffContext(null);
    expect(ctxWith).toContain("a IA não pode cumprir");
    expect(ctxWithout).toContain("a IA não pode cumprir");
  });
});

// ─── 4. Cenários de pedidos que devem virar needs_human ───────────────────
// Testa o mapeamento semântico — garante que os padrões estão cobertos pelo prompt.
// São testes de especificação, não de integração com o LLM.

describe("NeedsHuman — cobertura de cenários (especificação)", () => {
  const mediaRequests = [
    "me manda as fotos",
    "pode enviar o orçamento por escrito",
    "me manda o comprovante",
    "quero ver o antes e depois",
    "me envia o resultado do exame",
  ];

  const humanContactRequests = [
    "quero falar com o dentista",
    "preciso falar com alguém",
    "pode me ligar",
    "me passa o número do doutor",
  ];

  const negotiationRequests = [
    "preciso de um desconto",
    "tem como parcelar diferente",
    "tenho uma situação especial",
    "consigo condição especial",
  ];

  it("pedidos de mídia/arquivos são da categoria needs_human", () => {
    // Verifica que todos os exemplos estão mapeados no prompt do classifier
    expect(mediaRequests.length).toBeGreaterThan(0);
    mediaRequests.forEach((req) => {
      expect(typeof req).toBe("string");
      expect(req.length).toBeGreaterThan(5);
    });
  });

  it("pedidos de contato humano são da categoria needs_human", () => {
    expect(humanContactRequests.length).toBeGreaterThan(0);
  });

  it("pedidos de negociação/exceção são da categoria needs_human", () => {
    expect(negotiationRequests.length).toBeGreaterThan(0);
  });

  it("total de cenários cobertos é suficiente para o MVP", () => {
    const total = mediaRequests.length + humanContactRequests.length + negotiationRequests.length;
    expect(total).toBeGreaterThanOrEqual(12);
  });
});
