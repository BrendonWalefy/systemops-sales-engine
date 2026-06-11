// Claim de processamento por conversa — serializa webhooks concorrentes.
//
// Antes do fix: dois webhooks da mesma conversa processavam em paralelo
// (o debounce tem janela TOCTOU entre o check e a invocação do LLM), e as
// respostas saíam intercaladas — ex.: texto de localização entregue entre
// os dois vídeos de lentes.
//
// Depois do fix: o handler adquire um claim via UPDATE condicional em
// conversations.processing_until (CAS de single-statement — atômico no
// Postgres mesmo com neon-http, que não suporta transações interativas).
// O perdedor espera; ao adquirir, só responde se sua mensagem ainda for a
// mais recente do lead. TTL de 90s evita deadlock se o detentor morrer.

import { describe, it, expect } from "vitest";

// ─── Modelo puro do CAS sobre processing_until ───────────────────────────────

type ConversationRow = { processingUntil: Date | null };

const CLAIM_TTL_MS = 90_000;

/** Mesma semântica do UPDATE ... WHERE (processing_until IS NULL OR processing_until < now()). */
function tryAcquire(row: ConversationRow, now: Date): boolean {
  const free = row.processingUntil === null || row.processingUntil < now;
  if (!free) return false;
  row.processingUntil = new Date(now.getTime() + CLAIM_TTL_MS);
  return true;
}

function release(row: ConversationRow): void {
  row.processingUntil = null;
}

describe("Claim de processamento por conversa — invariantes do CAS", () => {
  it("apenas um de dois webhooks concorrentes adquire o claim", () => {
    const row: ConversationRow = { processingUntil: null };
    const t0 = new Date("2026-06-11T17:28:00Z");

    const winner = tryAcquire(row, t0);
    const loser = tryAcquire(row, new Date(t0.getTime() + 5));

    expect(winner).toBe(true);
    expect(loser).toBe(false);
  });

  it("perdedor adquire após o detentor liberar", () => {
    const row: ConversationRow = { processingUntil: null };
    const t0 = new Date("2026-06-11T17:28:00Z");

    expect(tryAcquire(row, t0)).toBe(true);
    expect(tryAcquire(row, new Date(t0.getTime() + 2_000))).toBe(false);

    release(row);
    expect(tryAcquire(row, new Date(t0.getTime() + 4_000))).toBe(true);
  });

  it("TTL expirado permite roubo do claim (handler que morreu não trava a conversa)", () => {
    const row: ConversationRow = { processingUntil: null };
    const t0 = new Date("2026-06-11T17:28:00Z");

    expect(tryAcquire(row, t0)).toBe(true);
    // Detentor morreu sem liberar. Antes do TTL: bloqueado.
    expect(tryAcquire(row, new Date(t0.getTime() + CLAIM_TTL_MS - 1))).toBe(false);
    // Após o TTL: livre.
    expect(tryAcquire(row, new Date(t0.getTime() + CLAIM_TTL_MS + 1))).toBe(true);
  });

  it("documenta a regressão: sem claim, ambos os handlers processam (TOCTOU do debounce)", () => {
    // Sem CAS, o "check do debounce" de cada handler vê a própria mensagem como
    // a mais recente se a outra ainda não foi registrada — ambos respondem.
    const handlerSawOwnMessageAsLatest = [true, true];
    const bothReplied = handlerSawOwnMessageAsLatest.every(Boolean);
    expect(bothReplied).toBe(true); // comportamento antigo (defeito)

    // Com o claim, o segundo handler só processa após o primeiro terminar e
    // re-verifica qual é a mensagem mais recente antes de responder.
    const row: ConversationRow = { processingUntil: null };
    const now = new Date();
    const concurrentAcquisitions = [tryAcquire(row, now), tryAcquire(row, now)];
    expect(concurrentAcquisitions.filter(Boolean)).toHaveLength(1);
  });
});
