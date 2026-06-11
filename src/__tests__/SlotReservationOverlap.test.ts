// Exclusion constraint de overlap em slot_reservations (migration 0024).
//
// Antes: a unique (clinic_id, starts_at) só bloqueava colisão EXATA de início.
// Duas reservas sobrepostas com starts_at diferentes (13:00-14:00 e
// 13:30-14:30) passavam pelo pré-check (TOCTOU) e ambas inseriam.
//
// Depois: EXCLUDE USING gist (clinic_id WITH =, tstzrange(starts_at, ends_at)
// WITH &&) WHERE status IN ('pending','confirmed') faz o próprio INSERT/UPDATE
// falhar para intervalos sobrepostos — o reserve() devolve null (slot_taken).

import { describe, it, expect } from "vitest";

// ─── Modelo puro da semântica da exclusion constraint ───────────────────────

type ReservationRow = {
  clinicId: string;
  startsAt: Date;
  endsAt: Date;
  status: "pending" | "confirmed" | "released";
};

function rangesOverlap(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  // Semântica do operador && de tstzrange com bounds [inclusivo, exclusivo)
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

/** Mesma regra da constraint: rejeita se sobrepõe linha ativa da mesma clínica. */
function tryInsert(table: ReservationRow[], row: ReservationRow): boolean {
  const violates = table.some(
    (r) =>
      r.clinicId === row.clinicId &&
      (r.status === "pending" || r.status === "confirmed") &&
      (row.status === "pending" || row.status === "confirmed") &&
      rangesOverlap(r, row),
  );
  if (violates) return false;
  table.push(row);
  return true;
}

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 5, 12, h, m));

describe("slot_reservations — exclusion constraint de overlap", () => {
  it("regressão: starts_at diferentes mas sobrepostos agora são bloqueados", () => {
    const table: ReservationRow[] = [];
    // Cenário que a unique (clinic_id, starts_at) NÃO pegava:
    expect(tryInsert(table, { clinicId: "c1", startsAt: at(13), endsAt: at(14), status: "pending" })).toBe(true);
    expect(tryInsert(table, { clinicId: "c1", startsAt: at(13, 30), endsAt: at(14, 30), status: "pending" })).toBe(false);
  });

  it("slots adjacentes (14:00 encosta em 14:00) não conflitam", () => {
    const table: ReservationRow[] = [];
    expect(tryInsert(table, { clinicId: "c1", startsAt: at(13), endsAt: at(14), status: "confirmed" })).toBe(true);
    expect(tryInsert(table, { clinicId: "c1", startsAt: at(14), endsAt: at(15), status: "pending" })).toBe(true);
  });

  it("clínicas diferentes não conflitam entre si", () => {
    const table: ReservationRow[] = [];
    expect(tryInsert(table, { clinicId: "c1", startsAt: at(13), endsAt: at(14), status: "pending" })).toBe(true);
    expect(tryInsert(table, { clinicId: "c2", startsAt: at(13), endsAt: at(14), status: "pending" })).toBe(true);
  });

  it("linha released não bloqueia novas reservas (partial index)", () => {
    const table: ReservationRow[] = [
      { clinicId: "c1", startsAt: at(13), endsAt: at(14), status: "released" },
    ];
    expect(tryInsert(table, { clinicId: "c1", startsAt: at(13), endsAt: at(14), status: "pending" })).toBe(true);
  });

  it("duração maior engolindo slot menor é bloqueada (45min vs 90min)", () => {
    const table: ReservationRow[] = [];
    expect(tryInsert(table, { clinicId: "c1", startsAt: at(13, 15), endsAt: at(14), status: "pending" })).toBe(true);
    expect(tryInsert(table, { clinicId: "c1", startsAt: at(13), endsAt: at(14, 30), status: "pending" })).toBe(false);
  });
});
