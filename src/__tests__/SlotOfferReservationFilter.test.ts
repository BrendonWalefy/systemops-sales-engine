// Replay com leads reais da Vitalli (18/07): a oferta exibia horários que já
// tinham reserva ativa (hold de sinal de outro lead). O lead escolhia, o
// reserve() batia no hold e saía o falso "seu horário ficou indisponível" —
// justamente no momento de maior intenção da conversa.
//
// Invariante desta suíte: slot que SlotReservationService.reserve() recusaria
// nunca deve chegar à oferta. A detecção de overlap aqui é a mesma do reserve()
// (r.startsAt < slot.endsAt && r.endsAt > slot.startsAt) — se uma das duas
// mudar sem a outra, o falso "indisponível" volta.

import { describe, it, expect } from "vitest";
import { rejectSlotsOverlappingReservations } from "@/core/pipeline/ConversationOrchestrator";

const slot = (startISO: string, minutes: number) => ({
  startsAt: new Date(startISO),
  endsAt: new Date(new Date(startISO).getTime() + minutes * 60_000),
});

describe("rejectSlotsOverlappingReservations", () => {
  it("mantém todos os slots quando não há reserva ativa", () => {
    const slots = [slot("2026-07-20T12:00:00Z", 60), slot("2026-07-20T13:00:00Z", 60)];
    expect(rejectSlotsOverlappingReservations(slots, [])).toEqual(slots);
  });

  it("descarta o slot idêntico à reserva", () => {
    const taken = slot("2026-07-20T12:00:00Z", 60);
    const free = slot("2026-07-20T14:00:00Z", 60);
    const result = rejectSlotsOverlappingReservations([taken, free], [taken]);
    expect(result).toEqual([free]);
  });

  it("descarta slot de duração diferente que se sobrepõe parcialmente", () => {
    // Reserva 12h-13h vs slot 12h30-13h30: o reserve() recusaria, a oferta também.
    const slots = [slot("2026-07-20T12:30:00Z", 60)];
    const reservations = [slot("2026-07-20T12:00:00Z", 60)];
    expect(rejectSlotsOverlappingReservations(slots, reservations)).toEqual([]);
  });

  it("descarta slot que engloba inteiramente uma reserva menor", () => {
    // Slot de 4h (20 Lentes) com uma reserva de 30min no meio.
    const slots = [slot("2026-07-20T12:00:00Z", 240)];
    const reservations = [slot("2026-07-20T14:00:00Z", 30)];
    expect(rejectSlotsOverlappingReservations(slots, reservations)).toEqual([]);
  });

  it("mantém slots que apenas encostam nas bordas da reserva", () => {
    // Reserva 12h-13h: o slot que termina 12h e o que começa 13h são válidos.
    // Overlap é estritamente exclusivo nas pontas — igual ao reserve().
    const antes = slot("2026-07-20T11:00:00Z", 60);
    const depois = slot("2026-07-20T13:00:00Z", 60);
    const reservations = [slot("2026-07-20T12:00:00Z", 60)];
    expect(rejectSlotsOverlappingReservations([antes, depois], reservations)).toEqual([antes, depois]);
  });

  it("aplica todas as reservas, não só a primeira", () => {
    const manha = slot("2026-07-20T12:00:00Z", 60);
    const tarde = slot("2026-07-20T17:00:00Z", 60);
    const livre = slot("2026-07-20T19:00:00Z", 60);
    const reservations = [
      slot("2026-07-20T12:00:00Z", 60),
      slot("2026-07-20T17:00:00Z", 60),
    ];
    const result = rejectSlotsOverlappingReservations([manha, tarde, livre], reservations);
    expect(result).toEqual([livre]);
  });

  it("preserva a ordem original dos slots sobreviventes", () => {
    const a = slot("2026-07-20T12:00:00Z", 60);
    const b = slot("2026-07-20T13:00:00Z", 60);
    const c = slot("2026-07-20T14:00:00Z", 60);
    const result = rejectSlotsOverlappingReservations([a, b, c], [b]);
    expect(result).toEqual([a, c]);
  });
});
