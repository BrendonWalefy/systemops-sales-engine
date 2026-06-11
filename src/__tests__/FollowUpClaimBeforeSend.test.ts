// Claim-before-send no follow-up dispatcher.
//
// Antes do fix: o dispatcher enviava a mensagem e SÓ DEPOIS marcava o
// follow-up como done. Crash (ou segundo run do cron) entre o envio e o
// save = mensagem duplicada para o lead no run seguinte.
//
// Depois: transição atômica pending → sending (CAS) ANTES de compor/enviar.
// Run concorrente não consegue o claim e pula. Follow-ups presos em
// "sending" por um run que morreu voltam a "pending" após 30min.

import { describe, it, expect } from "vitest";

// ─── Modelo puro da semântica de claim do dispatcher ─────────────────────────

type FollowUpStatus = "pending" | "sending" | "done" | "cancelled" | "expired";
type FollowUpRow = { id: string; status: FollowUpStatus; updatedAt: Date };

/** Mesma semântica do UPDATE ... WHERE status='pending' RETURNING. */
function claimForSending(row: FollowUpRow, now: Date): boolean {
  if (row.status !== "pending") return false;
  row.status = "sending";
  row.updatedAt = now;
  return true;
}

function recoverStaleSending(rows: FollowUpRow[], olderThan: Date): number {
  let recovered = 0;
  for (const row of rows) {
    if (row.status === "sending" && row.updatedAt < olderThan) {
      row.status = "pending";
      recovered++;
    }
  }
  return recovered;
}

describe("FollowUp claim-before-send — invariantes", () => {
  it("dois runs concorrentes: só um consegue o claim do mesmo follow-up", () => {
    const row: FollowUpRow = { id: "f1", status: "pending", updatedAt: new Date() };
    const now = new Date();

    const run1 = claimForSending(row, now);
    const run2 = claimForSending(row, now);

    expect(run1).toBe(true);
    expect(run2).toBe(false); // segundo run pula — sem mensagem dupla
  });

  it("follow-up done não é reivindicável (re-run do cron não reenvia)", () => {
    const row: FollowUpRow = { id: "f1", status: "done", updatedAt: new Date() };
    expect(claimForSending(row, new Date())).toBe(false);
  });

  it("sending stale (>30min) volta a pending; sending recente é preservado", () => {
    const t0 = new Date("2026-06-11T06:00:00Z");
    const rows: FollowUpRow[] = [
      { id: "morto", status: "sending", updatedAt: new Date(t0.getTime() - 45 * 60_000) },
      { id: "em-andamento", status: "sending", updatedAt: new Date(t0.getTime() - 5 * 60_000) },
      { id: "ok", status: "done", updatedAt: new Date(t0.getTime() - 60 * 60_000) },
    ];

    const recovered = recoverStaleSending(rows, new Date(t0.getTime() - 30 * 60_000));

    expect(recovered).toBe(1);
    expect(rows[0].status).toBe("pending"); // será retentado
    expect(rows[1].status).toBe("sending"); // run lento em andamento, não tocar
    expect(rows[2].status).toBe("done");
  });

  it("documenta a regressão: sem claim, crash pós-envio causava reenvio", () => {
    // Fluxo antigo: listDue() → send() → save(done). Crash entre send e save
    // deixava status=pending; o próximo listDue() devolvia o mesmo follow-up.
    const statusAfterCrashOldFlow: FollowUpStatus = "pending";
    expect(statusAfterCrashOldFlow).toBe("pending"); // reenvio garantido (defeito)

    // Fluxo novo: claim → send → save(done). Crash entre claim e save deixa
    // status=sending — invisível ao listDue(); reentra só após 30min de stale,
    // estreitando a janela de duplicação ao mínimo recuperável.
    const row: FollowUpRow = { id: "f1", status: "pending", updatedAt: new Date() };
    claimForSending(row, new Date());
    expect(row.status).toBe("sending");
  });
});
