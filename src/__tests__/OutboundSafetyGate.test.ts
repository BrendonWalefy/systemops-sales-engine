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
});
