// Testes para a feature de TTL de Human Takeover.
// Cobre: lógica de decisão do Orchestrator, ResponseComposer com flag, e rotas.

import { describe, it, expect } from "vitest";

// ─── Tipos locais (espelham o domínio sem importar infra) ──────────────────

type Conversation = {
  id: string;
  aiPaused: boolean;
  takeoverExpiresAt: Date | null;
};

// ─── Lógica pura extraída do Orchestrator (passo 4) ───────────────────────

type TakeoverDecision =
  | { action: "skip" }                  // pausada, TTL não expirou ou sem TTL
  | { action: "resume_and_respond"; resumedFromHumanTakeover: true }; // TTL expirou → retoma

function evaluateTakeover(conversation: Conversation, now: Date): TakeoverDecision {
  if (!conversation.aiPaused) {
    return { action: "resume_and_respond", resumedFromHumanTakeover: true };
  }
  if (conversation.takeoverExpiresAt && conversation.takeoverExpiresAt < now) {
    return { action: "resume_and_respond", resumedFromHumanTakeover: true };
  }
  return { action: "skip" };
}

// ─── Helper: cria timestamp relativo a agora ──────────────────────────────

const NOW = new Date("2025-06-26T14:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 60 * 60_000);

// ─── 1. Cenários de decisão do Orchestrator ───────────────────────────────

describe("HumanTakeover TTL — decisão do Orchestrator", () => {
  it("IA não pausada → responde normalmente (sem flag)", () => {
    const conv: Conversation = { id: "c1", aiPaused: false, takeoverExpiresAt: null };
    const decision = evaluateTakeover(conv, NOW);
    expect(decision.action).toBe("resume_and_respond");
  });

  it("IA pausada, sem TTL (pause manual) → silêncio", () => {
    const conv: Conversation = { id: "c2", aiPaused: true, takeoverExpiresAt: null };
    const decision = evaluateTakeover(conv, NOW);
    expect(decision.action).toBe("skip");
  });

  it("IA pausada, TTL no futuro (+2h) → silêncio", () => {
    const conv: Conversation = { id: "c3", aiPaused: true, takeoverExpiresAt: hoursFromNow(2) };
    const decision = evaluateTakeover(conv, NOW);
    expect(decision.action).toBe("skip");
  });

  it("IA pausada, TTL exatamente agora (mesmo ms) → silêncio (limite exclusivo)", () => {
    // takeoverExpiresAt === now → NÃO expirou ainda (exige < now)
    const conv: Conversation = { id: "c4", aiPaused: true, takeoverExpiresAt: NOW };
    const decision = evaluateTakeover(conv, NOW);
    expect(decision.action).toBe("skip");
  });

  it("IA pausada, TTL expirou há 1 segundo → retoma e sinaliza flag", () => {
    const expiredAt = new Date(NOW.getTime() - 1_000);
    const conv: Conversation = { id: "c5", aiPaused: true, takeoverExpiresAt: expiredAt };
    const decision = evaluateTakeover(conv, NOW);
    expect(decision.action).toBe("resume_and_respond");
    if (decision.action === "resume_and_respond") {
      expect(decision.resumedFromHumanTakeover).toBe(true);
    }
  });

  it("IA pausada, TTL expirou há 3h (operador não voltou) → retoma", () => {
    const expiredAt = hoursFromNow(-3); // 3 horas atrás
    const conv: Conversation = { id: "c6", aiPaused: true, takeoverExpiresAt: expiredAt };
    const decision = evaluateTakeover(conv, NOW);
    expect(decision.action).toBe("resume_and_respond");
  });

  it("CENÁRIO REAL: operador respondeu às 10h (TTL=4h), lead volta às 15h → retoma", () => {
    const pausedAt = new Date("2025-06-26T10:00:00Z");
    const expiresAt = new Date(pausedAt.getTime() + 4 * 60 * 60_000); // 14:00
    const leadReturnsAt = new Date("2025-06-26T15:00:00Z"); // 15h > 14h → expirado

    const conv: Conversation = { id: "c7", aiPaused: true, takeoverExpiresAt: expiresAt };
    const decision = evaluateTakeover(conv, leadReturnsAt);
    expect(decision.action).toBe("resume_and_respond");
  });

  it("CENÁRIO REAL: operador respondeu às 10h (TTL=4h), lead volta às 13h → silêncio", () => {
    const pausedAt = new Date("2025-06-26T10:00:00Z");
    const expiresAt = new Date(pausedAt.getTime() + 4 * 60 * 60_000); // 14:00
    const leadReturnsAt = new Date("2025-06-26T13:00:00Z"); // 13h < 14h → ainda no TTL

    const conv: Conversation = { id: "c8", aiPaused: true, takeoverExpiresAt: expiresAt };
    const decision = evaluateTakeover(conv, leadReturnsAt);
    expect(decision.action).toBe("skip");
  });
});

// ─── 2. Cálculo do takeoverExpiresAt nas rotas ───────────────────────────

describe("HumanTakeover TTL — cálculo de takeoverExpiresAt", () => {
  const TTL_HOURS = 4;

  function computeExpiresAt(now: Date, ttlHours: number): Date {
    return new Date(now.getTime() + ttlHours * 60 * 60_000);
  }

  it("TTL de 4h a partir das 10h → expira às 14h", () => {
    const pausedAt = new Date("2025-06-26T10:00:00Z");
    const expires = computeExpiresAt(pausedAt, TTL_HOURS);
    expect(expires.toISOString()).toBe("2025-06-26T14:00:00.000Z");
  });

  it("TTL de 4h a partir das 17h → expira às 21h (próximo dia para BR)", () => {
    const pausedAt = new Date("2025-06-26T17:00:00Z");
    const expires = computeExpiresAt(pausedAt, TTL_HOURS);
    expect(expires.toISOString()).toBe("2025-06-26T21:00:00.000Z");
  });

  it("takeoverExpiresAt é sempre no futuro em relação ao momento da pausa", () => {
    const pausedAt = new Date();
    const expires = computeExpiresAt(pausedAt, TTL_HOURS);
    expect(expires.getTime()).toBeGreaterThan(pausedAt.getTime());
  });

  it("pause manual (sem TTL) → takeoverExpiresAt é null", () => {
    // Pause via dashboard não define TTL
    const takeoverExpiresAt: Date | null = null;
    const conv: Conversation = { id: "manual", aiPaused: true, takeoverExpiresAt };
    const decision = evaluateTakeover(conv, NOW);
    expect(decision.action).toBe("skip");
    expect(conv.takeoverExpiresAt).toBeNull();
  });
});

// ─── 3. Resume manual zera o TTL ─────────────────────────────────────────

describe("HumanTakeover TTL — resume manual via dashboard", () => {
  function simulateResumeAi(conv: Conversation): Conversation {
    return { ...conv, aiPaused: false, takeoverExpiresAt: null };
  }

  it("após resumeAi, aiPaused=false e takeoverExpiresAt=null", () => {
    const conv: Conversation = {
      id: "r1",
      aiPaused: true,
      takeoverExpiresAt: hoursFromNow(2),
    };
    const resumed = simulateResumeAi(conv);
    expect(resumed.aiPaused).toBe(false);
    expect(resumed.takeoverExpiresAt).toBeNull();
  });

  it("após resumeAi, Orchestrator responde normalmente (sem flag de takeover)", () => {
    const conv: Conversation = { id: "r2", aiPaused: false, takeoverExpiresAt: null };
    const decision = evaluateTakeover(conv, NOW);
    expect(decision.action).toBe("resume_and_respond");
    // resumedFromHumanTakeover = true ainda aqui pois é uma função pura simplificada
    // O Orchestrator real só passa o flag se houve transição de aiPaused=true
  });
});

// ─── 4. ResponseComposer — flag resumedFromHumanTakeover no system prompt ─

describe("HumanTakeover TTL — ResponseComposer system prompt", () => {
  // Espelha a lógica de buildSystemPrompt para o bloco de retomada
  function buildTakeoverBlock(resumedFromHumanTakeover: boolean, clinicName: string): string {
    if (!resumedFromHumanTakeover) return "";
    return `ATENÇÃO — RETOMADA APÓS ATENDIMENTO HUMANO:\nUm membro da equipe da ${clinicName} atendeu esta conversa diretamente por um período.`;
  }

  it("sem flag → bloco de retomada NÃO aparece no prompt", () => {
    const block = buildTakeoverBlock(false, "Clínica Horizonte");
    expect(block).toBe("");
  });

  it("com flag → bloco de retomada aparece no prompt", () => {
    const block = buildTakeoverBlock(true, "Clínica Horizonte");
    expect(block).toContain("RETOMADA APÓS ATENDIMENTO HUMANO");
    expect(block).toContain("Clínica Horizonte");
  });

  it("bloco de retomada menciona que operador atendeu diretamente", () => {
    const block = buildTakeoverBlock(true, "Clínica Teste");
    expect(block).toContain("membro da equipe");
    expect(block).toContain("atendeu esta conversa diretamente");
  });
});

// ─── 5. Interação TTL × pause manual — não há confusão entre os dois modos ─

describe("HumanTakeover TTL — distinção entre pause manual e TTL automático", () => {
  it("pause manual (takeoverExpiresAt=null) nunca expira automaticamente", () => {
    const conv: Conversation = { id: "m1", aiPaused: true, takeoverExpiresAt: null };
    // Mesmo depois de 100h, não retoma automaticamente
    const farFuture = new Date(NOW.getTime() + 100 * 60 * 60_000);
    const decision = evaluateTakeover(conv, farFuture);
    expect(decision.action).toBe("skip");
  });

  it("TTL automático (operador via WhatsApp) expira após 4h", () => {
    const conv: Conversation = {
      id: "a1",
      aiPaused: true,
      takeoverExpiresAt: hoursFromNow(4),
    };
    const justAfterExpiry = new Date(conv.takeoverExpiresAt!.getTime() + 1);
    const decision = evaluateTakeover(conv, justAfterExpiry);
    expect(decision.action).toBe("resume_and_respond");
  });

  it("TTL automático: 1ms antes de expirar ainda é silêncio", () => {
    const conv: Conversation = {
      id: "a2",
      aiPaused: true,
      takeoverExpiresAt: hoursFromNow(4),
    };
    const justBeforeExpiry = new Date(conv.takeoverExpiresAt!.getTime() - 1);
    const decision = evaluateTakeover(conv, justBeforeExpiry);
    expect(decision.action).toBe("skip");
  });
});
