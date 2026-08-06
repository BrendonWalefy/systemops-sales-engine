// Lead deu data E hora, sobrou o horário dele sozinho — não pedir "responda
// apenas com o número" para uma lista de um item.
//
// Caso real reconstruído do banco (Vitalli, 18/07, conversa ff8fbb07):
//
//   20:10  agente  "não temos horários no sábado. Posso oferecer:
//                    1. Seg 20/07 às 9h … 5. Ter 28/07 às 16h"
//   21:09  lead    "Dia 28/07 as 16h"          ← escolheu pelo nome, não pelo número
//   21:10  agente  "temos o seguinte horário disponível: 1. Ter 28/07 às 16h.
//                   Por favor, responda apenas com o número da opção."
//   21:11  lead    "1"
//   21:12  agente  "Deixei o horário reservado provisoriamente…"
//
// A oferta das 20:10 já tinha vencido (TTL de 15 min, o lead voltou 59 min
// depois), então a mensagem virou nova busca — que devolveu exatamente um
// horário e mesmo assim pediu um número. Frequência medida: 1 de 19 ofertas
// numéricas do corpus. Ver docs/architecture/current.md.

import { describe, expect, it } from "vitest";
import {
  buildSingleExactSlotConfirmation,
  resolveSingleExactSlot,
} from "@/core/pipeline/ConversationOrchestrator";
import { ClinicTimezone, parseBusinessHours } from "@/core/scheduling/ClinicTimezone";

const timezone = new ClinicTimezone("America/Sao_Paulo");
const businessHours = parseBusinessHours("Seg-Sáb 8h-18h");
// Sábado, 18/07/2026 — o dia da conversa real.
const now = new Date("2026-07-18T21:09:00-03:00");

const slot = (index: number, iso: string, label: string) => ({ index, startsAt: iso, label });
const TER_28_16H = slot(1, "2026-07-28T16:00:00-03:00", "Ter 28/07 às 16h");

describe("resolveSingleExactSlot", () => {
  it("reconhece o caso real: 'Dia 28/07 as 16h' com um único horário casando", () => {
    expect(
      resolveSingleExactSlot({
        slots: [TER_28_16H],
        preferredDate: "28/07",
        preferredTime: "16h",
        timezone,
        businessHours,
        now,
      }),
    ).toEqual({ index: 1, label: "Ter 28/07 às 16h" });
  });

  it("não dispara com mais de um horário na lista — aí a numeração é legítima", () => {
    expect(
      resolveSingleExactSlot({
        slots: [TER_28_16H, slot(2, "2026-07-28T17:00:00-03:00", "Ter 28/07 às 17h")],
        preferredDate: "28/07",
        preferredTime: "16h",
        timezone,
        businessHours,
        now,
      }),
    ).toBeNull();
  });

  it("não dispara sem hora — 'dia 28' deixa o horário em aberto", () => {
    expect(
      resolveSingleExactSlot({
        slots: [TER_28_16H],
        preferredDate: "28/07",
        preferredTime: null,
        timezone,
        businessHours,
        now,
      }),
    ).toBeNull();
  });

  it("não dispara sem data — 'às 16h' não diz o dia", () => {
    expect(
      resolveSingleExactSlot({
        slots: [TER_28_16H],
        preferredDate: null,
        preferredTime: "16h",
        timezone,
        businessHours,
        now,
      }),
    ).toBeNull();
  });

  it("não dispara quando o único horário NÃO é o que o lead pediu", () => {
    // O engine devolveu o mais próximo, não o pedido. Confirmar como se fosse
    // o horário dele seria mentir sobre a agenda.
    expect(
      resolveSingleExactSlot({
        slots: [slot(1, "2026-07-28T09:00:00-03:00", "Ter 28/07 às 9h")],
        preferredDate: "28/07",
        preferredTime: "16h",
        timezone,
        businessHours,
        now,
      }),
    ).toBeNull();
  });

  it("não dispara quando o dia do único horário é outro", () => {
    expect(
      resolveSingleExactSlot({
        slots: [slot(1, "2026-07-29T16:00:00-03:00", "Qua 29/07 às 16h")],
        preferredDate: "28/07",
        preferredTime: "16h",
        timezone,
        businessHours,
        now,
      }),
    ).toBeNull();
  });

  it("aceita a hora com minutos ('15h20') como o lead escreve", () => {
    expect(
      resolveSingleExactSlot({
        slots: [slot(1, "2026-07-23T15:20:00-03:00", "Qui 23/07 às 15h20")],
        preferredDate: "23/07",
        preferredTime: "15h20",
        timezone,
        businessHours,
        now,
      }),
    ).toEqual({ index: 1, label: "Qui 23/07 às 15h20" });
  });

  it("aceita dia da semana como data ('sábado às 8:30')", () => {
    // "pode ser sábado as 8:30" é frase real do corpus.
    expect(
      resolveSingleExactSlot({
        slots: [slot(1, "2026-07-25T08:30:00-03:00", "Sáb 25/07 às 8h30")],
        preferredDate: "sabado",
        preferredTime: "8:30",
        timezone,
        businessHours,
        now,
      }),
    ).toEqual({ index: 1, label: "Sáb 25/07 às 8h30" });
  });
});

describe("buildSingleExactSlotConfirmation", () => {
  it("confirma direto, sem pedir número", () => {
    const answer = buildSingleExactSlotConfirmation("Ter 28/07 às 16h", 15);
    expect(answer).toContain("Ter 28/07 às 16h");
    expect(answer).toContain("Posso confirmar");
    // O que quebrava: uma lista de um item com instrução de responder por número.
    expect(answer).not.toMatch(/responda apenas com o n[uú]mero/i);
    expect(answer).not.toMatch(/^1\.\s/m);
  });

  it("mantém a urgência da reserva, usando o TTL real da oferta", () => {
    // Se o texto e o TTL divergirem, prometemos uma reserva que já expirou.
    expect(buildSingleExactSlotConfirmation("Ter 28/07 às 16h", 15)).toContain("15 minutos");
    expect(buildSingleExactSlotConfirmation("Ter 28/07 às 16h", 30)).toContain("30 minutos");
  });
});
