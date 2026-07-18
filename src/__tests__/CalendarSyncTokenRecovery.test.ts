// Semântica de recuperação do sync token do Google Calendar.
//
// Antes: um syncToken invalidado pelo Google (HTTP 410 Gone, ex.: >1 semana
// sem sincronizar) fazia syncCancelledEventIds lançar erro; o webhook engolia
// com 200 e o cron só logava — ninguém resetava o token, e a sincronização
// de cancelamentos morria em silêncio PARA SEMPRE.
//
// Depois: o gateway detecta 410 + token presente e refaz o sync inicial
// (sem token, timeMin 180 dias), devolvendo um token novo — auto-recuperação
// sem intervenção manual.
//
// Segundo contrato coberto aqui: o webhook só avança o syncToken DEPOIS de
// processar cancelamentos e upserts. Avançar antes (comportamento antigo)
// perdia mudanças permanentemente se o processamento falhasse no meio — as
// operações são idempotentes, então reprocessar no próximo sync é seguro.

import { describe, it, expect } from "vitest";

// ─── Modelo do contrato do gateway (410 → retry inicial) ────────────────────

type SyncedEvent = { id: string; startsAt: string; endsAt: string; summary: string };
type SyncResult = { cancelledIds: string[]; events: SyncedEvent[]; nextSyncToken: string };

type FakeGoogle = {
  validTokens: Set<string>;
  // resposta do sync incremental (token válido) e do sync inicial (sem token)
  incremental: SyncResult;
  initial: SyncResult;
};

/** Mesma regra do gateway: 410 com token → refaz como sync inicial. */
function syncCancelledEventIds(google: FakeGoogle, syncToken: string | null): SyncResult {
  if (syncToken) {
    if (!google.validTokens.has(syncToken)) {
      // Google devolveu 410 Gone — auto-recuperação via sync inicial
      return syncCancelledEventIds(google, null);
    }
    return google.incremental;
  }
  return google.initial;
}

describe("Google Calendar — recuperação de syncToken 410 Gone", () => {
  const google: FakeGoogle = {
    validTokens: new Set(["token_valido"]),
    incremental: {
      cancelledIds: ["ev_1"],
      events: [{ id: "ev_2", startsAt: "2026-07-20T12:00:00Z", endsAt: "2026-07-20T13:00:00Z", summary: "Evento editado" }],
      nextSyncToken: "token_novo",
    },
    initial: { cancelledIds: ["ev_1", "ev_antigo"], events: [], nextSyncToken: "token_resync" },
  };

  it("token válido segue o caminho incremental normal", () => {
    const r = syncCancelledEventIds(google, "token_valido");
    expect(r.nextSyncToken).toBe("token_novo");
    expect(r.cancelledIds).toEqual(["ev_1"]);
  });

  it("regressão: token invalidado (410) não lança — refaz sync inicial e devolve token novo", () => {
    const r = syncCancelledEventIds(google, "token_invalidado_pelo_google");
    expect(r.nextSyncToken).toBe("token_resync");
    expect(r.cancelledIds).toContain("ev_1");
  });

  it("sync inicial (token null) continua funcionando como antes", () => {
    const r = syncCancelledEventIds(google, null);
    expect(r.nextSyncToken).toBe("token_resync");
  });
});

// ─── Modelo do contrato do webhook (token avança só após processar) ─────────

type WebhookState = {
  storedToken: string;
  appointments: Map<string, "scheduled" | "cancelled">;
  startsAt: Map<string, string>;
};

/** Mesma ordem do webhook: processa cancelamentos e upserts, só então persiste o token. */
function handleWebhook(
  state: WebhookState,
  sync: SyncResult,
  opts: { failAfterProcessing?: number; failBeforeUpsert?: boolean } = {},
): { ok: boolean } {
  let processed = 0;
  for (const eventId of sync.cancelledIds) {
    if (opts.failAfterProcessing !== undefined && processed >= opts.failAfterProcessing) {
      return { ok: false }; // falha no meio — token NÃO avança
    }
    const status = state.appointments.get(eventId);
    if (!status || status === "cancelled") continue; // idempotente
    state.appointments.set(eventId, "cancelled");
    processed++;
  }
  if (opts.failBeforeUpsert && sync.events.length > 0) return { ok: false };
  for (const event of sync.events) {
    state.appointments.set(event.id, "scheduled");
    state.startsAt.set(event.id, event.startsAt);
  }
  state.storedToken = sync.nextSyncToken;
  return { ok: true };
}

describe("GCal webhook — syncToken só avança após processar mudanças", () => {
  it("caminho feliz: cancela appointments e avança o token", () => {
    const state: WebhookState = {
      storedToken: "t1",
      appointments: new Map([["ev_a", "scheduled"], ["ev_b", "scheduled"]]),
      startsAt: new Map(),
    };
    const r = handleWebhook(state, { cancelledIds: ["ev_a", "ev_b"], events: [], nextSyncToken: "t2" });
    expect(r.ok).toBe(true);
    expect(state.storedToken).toBe("t2");
    expect(state.appointments.get("ev_a")).toBe("cancelled");
  });

  it("regressão: falha no meio do processamento mantém o token antigo (re-entrega no próximo sync)", () => {
    const state: WebhookState = {
      storedToken: "t1",
      appointments: new Map([["ev_a", "scheduled"], ["ev_b", "scheduled"]]),
      startsAt: new Map(),
    };
    const r = handleWebhook(state, { cancelledIds: ["ev_a", "ev_b"], events: [], nextSyncToken: "t2" }, { failAfterProcessing: 1 });
    expect(r.ok).toBe(false);
    expect(state.storedToken).toBe("t1"); // não avançou — ev_b será re-entregue

    // Retry do mesmo sync: idempotente (ev_a já cancelado, ev_b cancela agora)
    const retry = handleWebhook(state, { cancelledIds: ["ev_a", "ev_b"], events: [], nextSyncToken: "t2" });
    expect(retry.ok).toBe(true);
    expect(state.appointments.get("ev_b")).toBe("cancelled");
    expect(state.storedToken).toBe("t2");
  });

  it("regressão: falha antes do upsert mantém token antigo para reprocessar edição do Google", () => {
    const state: WebhookState = {
      storedToken: "t1",
      appointments: new Map([["ev_c", "scheduled"]]),
      startsAt: new Map([["ev_c", "2026-07-20T12:00:00Z"]]),
    };
    const sync = {
      cancelledIds: [],
      events: [{ id: "ev_c", startsAt: "2026-07-21T12:00:00Z", endsAt: "2026-07-21T13:00:00Z", summary: "Evento movido" }],
      nextSyncToken: "t2",
    };

    const failed = handleWebhook(state, sync, { failBeforeUpsert: true });
    expect(failed.ok).toBe(false);
    expect(state.storedToken).toBe("t1");
    expect(state.startsAt.get("ev_c")).toBe("2026-07-20T12:00:00Z");

    const retry = handleWebhook(state, sync);
    expect(retry.ok).toBe(true);
    expect(state.storedToken).toBe("t2");
    expect(state.startsAt.get("ev_c")).toBe("2026-07-21T12:00:00Z");
  });
});
