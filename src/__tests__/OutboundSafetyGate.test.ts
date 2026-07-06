import { describe, expect, it } from "vitest";
import {
  evaluateOutboundSafetyGate,
  getOutboundCapWindows,
  type OutboundSafetyClinic,
} from "@/application/channel-safety/outbound-safety-gate";
import type { OutboundMessageCategory } from "@/application/ports/outbound-message-store";

const clinic: OutboundSafetyClinic = {
  id: "clinic-1",
  timezone: "America/Sao_Paulo",
  businessHours: "Seg-Sex 09:00-18:00",
  outboundHourlyCap: 40,
  outboundDailyCap: 200,
};

const businessTime = new Date("2026-07-06T13:00:00.000Z"); // Segunda, 10h em Sao Paulo.
const quietTime = new Date("2026-07-06T22:00:00.000Z"); // Segunda, 19h em Sao Paulo.

function lead(contactConsentRevokedAt: Date | null) {
  return {
    id: "lead-1",
    phone: "5511999999999",
    whatsappLid: null,
    contactConsentRevokedAt,
  };
}

describe("evaluateOutboundSafetyGate", () => {
  it.each<OutboundMessageCategory>(["reply", "reminder", "operational"])(
    "sempre libera categoria %s",
    (category) => {
      const decision = evaluateOutboundSafetyGate({
        category,
        clinic,
        lead: lead(new Date("2026-07-05T12:00:00.000Z")),
        sentLastHour: 999,
        sentToday: 999,
        now: quietTime,
        capJitterMs: 0,
      });

      expect(decision).toEqual({ action: "allow" });
    },
  );

  it.each<OutboundMessageCategory>(["follow_up", "recovery", "campaign"])(
    "bloqueia consentimento revogado em %s",
    (category) => {
      const decision = evaluateOutboundSafetyGate({
        category,
        clinic,
        lead: lead(new Date("2026-07-05T12:00:00.000Z")),
        sentLastHour: 0,
        sentToday: 0,
        now: businessTime,
        capJitterMs: 0,
      });

      expect(decision).toEqual({ action: "cancel", reason: "consent_revoked" });
    },
  );

  it.each<OutboundMessageCategory>(["follow_up", "recovery", "campaign"])(
    "adia %s quando o cap horario estourou",
    (category) => {
      const decision = evaluateOutboundSafetyGate({
        category,
        clinic,
        lead: lead(null),
        sentLastHour: 40,
        sentToday: 40,
        now: businessTime,
        capJitterMs: 5 * 60_000,
      });

      expect(decision).toEqual({
        action: "defer",
        reason: "outbound_hourly_cap_exceeded",
        runAt: new Date("2026-07-06T13:35:00.000Z"),
      });
    },
  );

  it("adia quando o cap diario estourou depois do cap horario passar", () => {
    const decision = evaluateOutboundSafetyGate({
      category: "campaign",
      clinic,
      lead: lead(null),
      sentLastHour: 39,
      sentToday: 200,
      now: businessTime,
      capJitterMs: 0,
    });

    expect(decision).toEqual({
      action: "defer",
      reason: "outbound_daily_cap_exceeded",
      runAt: new Date("2026-07-06T13:30:00.000Z"),
    });
  });

  it.each<OutboundMessageCategory>(["follow_up", "recovery", "campaign"])(
    "adia %s para a proxima abertura em quiet hours",
    (category) => {
      const decision = evaluateOutboundSafetyGate({
        category,
        clinic,
        lead: lead(null),
        sentLastHour: 0,
        sentToday: 0,
        now: quietTime,
        capJitterMs: 0,
      });

      expect(decision).toEqual({
        action: "defer",
        reason: "quiet_hours",
        runAt: new Date("2026-07-07T12:00:00.000Z"),
      });
    },
  );

  it("libera automacao dentro da janela, com consentimento e caps disponiveis", () => {
    const decision = evaluateOutboundSafetyGate({
      category: "follow_up",
      clinic,
      lead: lead(null),
      sentLastHour: 39,
      sentToday: 199,
      now: businessTime,
      capJitterMs: 0,
    });

    expect(decision).toEqual({ action: "allow" });
  });

  it("usa o inicio do dia local para a janela diaria de cap", () => {
    const windows = getOutboundCapWindows({ clinic, now: businessTime });

    expect(windows.hourlySince).toEqual(new Date("2026-07-06T12:00:00.000Z"));
    expect(windows.dailySince).toEqual(new Date("2026-07-06T03:00:00.000Z"));
  });

  // ─── Testes do Modo de Segurança (Fase 1 - Reputation Engine) ────────────────

  it("bloqueia gated categories no modo cooling", () => {
    const coolingClinic: OutboundSafetyClinic = {
      ...clinic,
      channelSafetyMode: "cooling",
    };

    // gated categories (follow_up, recovery, campaign) bloqueadas
    for (const category of ["follow_up", "recovery", "campaign"] as OutboundMessageCategory[]) {
      const decision = evaluateOutboundSafetyGate({
        category,
        clinic: coolingClinic,
        lead: lead(null),
        sentLastHour: 0,
        sentToday: 0,
        now: businessTime,
      });
      expect(decision).toEqual({ action: "cancel", reason: "channel_cooling" });
    }

    // reply e reminder e operational continuam permitidos
    for (const category of ["reply", "reminder", "operational"] as OutboundMessageCategory[]) {
      const decision = evaluateOutboundSafetyGate({
        category,
        clinic: coolingClinic,
        lead: lead(null),
        sentLastHour: 0,
        sentToday: 0,
        now: businessTime,
      });
      expect(decision).toEqual({ action: "allow" });
    }
  });

  it("bloqueia gated categories e reminders no modo frozen", () => {
    const frozenClinic: OutboundSafetyClinic = {
      ...clinic,
      channelSafetyMode: "frozen",
    };

    // gated + reminder bloqueados
    for (const category of ["follow_up", "recovery", "campaign", "reminder"] as OutboundMessageCategory[]) {
      const decision = evaluateOutboundSafetyGate({
        category,
        clinic: frozenClinic,
        lead: lead(null),
        sentLastHour: 0,
        sentToday: 0,
        now: businessTime,
      });
      expect(decision).toEqual({ action: "cancel", reason: "channel_frozen" });
    }

    // reply e operational continuam permitidos
    for (const category of ["reply", "operational"] as OutboundMessageCategory[]) {
      const decision = evaluateOutboundSafetyGate({
        category,
        clinic: frozenClinic,
        lead: lead(null),
        sentLastHour: 0,
        sentToday: 0,
        now: businessTime,
      });
      expect(decision).toEqual({ action: "allow" });
    }
  });

  // ─── Testes de Warmup (Fase 1 - Idade de Pareamento) ─────────────────────────

  describe("Warmup / resolveEffectiveCaps", () => {
    const baseClinic = {
      channelPairedAt: new Date("2026-07-01T12:00:00.000Z"), // Pareado dia 01/07
      outboundHourlyCap: 50,
      outboundDailyCap: 250,
    };

    it("semana 1 (0-7 dias): limita a 10/hora e 40/dia", () => {
      const now = new Date("2026-07-05T12:00:00.000Z"); // 4 dias de idade
      const caps = evaluateOutboundSafetyGate({
        category: "follow_up",
        clinic: { ...clinic, ...baseClinic },
        lead: lead(null),
        sentLastHour: 10, // estoura o cap de warmup de 10
        sentToday: 10,
        now,
        capJitterMs: 0,
      });

      expect(caps).toEqual({
        action: "defer",
        reason: "outbound_hourly_cap_exceeded",
        runAt: new Date("2026-07-05T12:30:00.000Z"),
      });
    });

    it("semana 2 (8-14 dias): limita a 20/hora e 80/dia", () => {
      const now = new Date("2026-07-11T12:00:00.000Z"); // 10 dias de idade
      const caps = evaluateOutboundSafetyGate({
        category: "follow_up",
        clinic: { ...clinic, ...baseClinic },
        lead: lead(null),
        sentLastHour: 15, // abaixo do cap de warmup de 20
        sentToday: 80, // estoura o cap de warmup de 80
        now,
        capJitterMs: 0,
      });

      expect(caps).toEqual({
        action: "defer",
        reason: "outbound_daily_cap_exceeded",
        runAt: new Date("2026-07-11T12:30:00.000Z"),
      });
    });

    it("semana 4+ (22+ dias): usa os caps reais da clínica", () => {
      const now = new Date("2026-07-23T12:00:00.000Z"); // 22 dias de idade (Quinta-feira)
      const caps = evaluateOutboundSafetyGate({
        category: "follow_up",
        clinic: { ...clinic, ...baseClinic },
        lead: lead(null),
        sentLastHour: 35, // abaixo do cap real de 50 (mas acima do de warmup da sem 3)
        sentToday: 180, // abaixo do cap real de 250
        now,
        capJitterMs: 0,
      });

      expect(caps).toEqual({ action: "allow" });
    });
  });
});
