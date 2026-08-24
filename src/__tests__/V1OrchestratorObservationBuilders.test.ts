import { describe, expect, it, vi } from "vitest";
import {
  buildV1ServiceResolutionObservation,
  buildV1HumanControlGateFact,
  buildV1PendingAppointmentResolutionObservation,
  buildV1SlotSearchObservation,
  buildV1TenantSnapshotObservation,
  buildV1TurnContextObservation,
  recordV1SlotSearchBeforeWrite,
} from "@/core/observability/V1TurnObservationBuilders";
import type { V1TurnObservationEvent } from "@/core/observability/V1TurnObservation";

const treatment = (overrides: Partial<{
  id: string;
  name: string;
  priceCents: number | null;
  minPriceCents: number | null;
  priceQuotableInChat: boolean;
  description: string | null;
}> = {}) => ({
  description: overrides.description ?? null,
  id: overrides.id ?? "treatment-fixed",
  name: overrides.name ?? "Avaliação",
  priceCents: overrides.priceCents === undefined ? 25_000 : overrides.priceCents,
  minPriceCents: overrides.minPriceCents === undefined ? null : overrides.minPriceCents,
  priceQuotableInChat: overrides.priceQuotableInChat ?? true,
});

describe("ConversationOrchestrator V1 observation builders", () => {
  it.each([
    ["TTL expirado", false],
    ["retomada explícita", false],
    ["pausa ativa", true],
  ] as const)("representa o resultado efetivo do gate humanControlled: %s", (_scenario, effectiveHumanControlled) => {
    expect(buildV1HumanControlGateFact("turn-human", effectiveHumanControlled)).toEqual({
      kind: "turn_gate_fact",
      turnId: "turn-human",
      field: "humanControlled",
      value: effectiveHumanControlled,
      source: "v1_human_control",
    });
  });

  it("não fabrica policy e nunca promove minPriceCents para preço exato do catálogo", () => {
    const event = buildV1TenantSnapshotObservation({
      turnId: "turn-tenant",
      configFingerprint: "config:tenant",
      treatments: [
        treatment(),
        treatment({ id: "treatment-from", name: "Lentes", priceCents: null, minPriceCents: 90_000 }),
      ],
    });

    expect(event.policy).toEqual({ status: "unavailable", reason: "not_read_by_v1" });
    expect(event.catalog).toEqual([
      { id: "treatment-fixed", name: "Avaliação", priceCents: 25_000, priceDisclosable: true, description: null },
      { id: "treatment-from", name: "Lentes", priceCents: null, priceDisclosable: false, description: null },
    ]);
    expect(JSON.stringify(event)).not.toContain("requiresEvaluationFirst");
  });

  it("projeta exatamente a janela recente usada pelo classifier e não afirma completed steps", () => {
    const event = buildV1TurnContextObservation({
      turnId: "turn-history",
      phase: "idle",
      pendingStepId: null,
      historyWindowMessages: 4,
      history: [
        { author: "agent", body: "CONFLITO FORA DA JANELA" },
        { author: "lead", body: "antiga" },
        { author: "agent", body: "recente 1" },
        { author: "lead", body: "recente 2" },
        { author: "clinic_user", body: "recente 3" },
        { author: "lead", body: "recente 4" },
      ],
    });

    expect(event.history).toEqual([
      { author: "agent", body: "recente 1" },
      { author: "lead", body: "recente 2" },
      { author: "agent", body: "recente 3" },
      { author: "lead", body: "recente 4" },
    ]);
    expect(event.completedStepIds).toEqual({ status: "unavailable", reason: "not_read_by_v1" });
  });

  it("preserva a resolução V1 fechada para preço sem promover preço mínimo", () => {
    const exact = buildV1ServiceResolutionObservation({
      turnId: "turn-price",
      query: "lentes",
      resolution: {
        kind: "exact",
        treatment: treatment({ id: "lentes", name: "Lentes", priceCents: null, minPriceCents: 90_000 }),
      },
    });
    const ambiguous = buildV1ServiceResolutionObservation({
      turnId: "turn-price",
      query: "lentes",
      resolution: {
        kind: "ambiguous",
        treatments: [treatment({ id: "resina", name: "Lentes de resina" }), treatment({ id: "porcelana", name: "Lentes de porcelana" })],
      },
    });
    const unknown = buildV1ServiceResolutionObservation({
      turnId: "turn-price",
      query: "serviço inexistente",
      resolution: { kind: "unknown" },
    });

    expect(exact.result).toEqual({
      kind: "exact",
      service: { id: "lentes", name: "Lentes", priceCents: null, priceDisclosable: false, description: null },
      evidenceRef: "v1-service:turn-price:lentes",
    });
    expect(ambiguous.result).toEqual({
      kind: "ambiguous",
      candidates: [{ id: "resina", name: "Lentes de resina" }, { id: "porcelana", name: "Lentes de porcelana" }],
      evidenceRef: "v1-service:turn-price:ambiguous",
    });
    expect(unknown.result).toEqual({ kind: "unknown", evidenceRef: "v1-service:turn-price:unknown" });
  });

  it("fecha o read de pending appointment em exact, absent ou query_mismatch", () => {
    expect(buildV1PendingAppointmentResolutionObservation({
      turnId: "turn-pending",
      pendingStepId: "step-pending",
      requestedAppointmentId: "appointment-1",
      appointment: { id: "appointment-1" },
      appointmentLabel: "17/08 às 15h",
    })).toEqual({
      kind: "pending_appointment_resolution",
      turnId: "turn-pending",
      pendingStepId: "step-pending",
      result: {
        kind: "exact",
        appointment: {
          id: "appointment-1",
          label: "17/08 às 15h",
          evidenceRef: "v1-pending-appointment:turn-pending:exact",
        },
      },
    });
    expect(buildV1PendingAppointmentResolutionObservation({
      turnId: "turn-pending",
      pendingStepId: "step-pending",
      requestedAppointmentId: "appointment-1",
      appointment: null,
      appointmentLabel: "17/08 às 15h",
    })).toMatchObject({ result: { kind: "absent" } });
    expect(buildV1PendingAppointmentResolutionObservation({
      turnId: "turn-pending",
      pendingStepId: "step-pending",
      requestedAppointmentId: "appointment-1",
      appointment: { id: "appointment-other" },
      appointmentLabel: "17/08 às 15h",
    })).toMatchObject({ result: { kind: "query_mismatch" } });
  });

  it("normaliza a chave completa da busca com clock do read, horário, duração e janelas", () => {
    const event = buildV1SlotSearchObservation({
      turnId: "turn-slot",
      searchNow: new Date("2026-08-16T12:00:05.000Z"),
      preferredDate: "amanhã",
      preferredPeriod: "afternoon",
      preferredTime: "15:00",
      minimumLeadTimeHours: 2,
      durationMinutes: 90,
      windowStart: new Date("2026-08-16T14:00:00.000Z"),
      windowEnd: new Date("2026-08-30T14:00:00.000Z"),
      allowedStartWindows: [
        { startHour: 16, startMinute: 0, weekdays: [3, 1] },
        { startHour: 9, startMinute: 0 },
      ],
      service: { id: "lentes", name: "Lentes" },
      slots: [{ startsAt: "2026-08-18T18:00:00.000Z", label: "18/08 às 15h" }],
    });

    expect(event.query).toEqual({
      service: "Lentes",
      date: "amanhã",
      period: "afternoon",
      preferredTime: "15:00",
      minimumLeadTimeHours: 2,
      now: "2026-08-16T12:00:05.000Z",
      durationMinutes: 90,
      windowStart: "2026-08-16T14:00:00.000Z",
      windowEnd: "2026-08-30T14:00:00.000Z",
      allowedStartWindows: [
        { startHour: 9, startMinute: 0, weekdays: null },
        { startHour: 16, startMinute: 0, weekdays: [1, 3] },
      ],
    });
    expect(event.slots).toEqual([{
      id: "2026-08-18T18:00:00.000Z",
      label: "18/08 às 15h",
      evidenceRef: "v1-slot:turn-slot:2026-08-18T18:00:00.000Z",
    }]);
  });

  it("registra o resultado do read antes do write e preserva a observação se o write falhar", async () => {
    const order: string[] = [];
    const events: V1TurnObservationEvent[] = [];
    const event = buildV1SlotSearchObservation({
      turnId: "turn-slot",
      searchNow: new Date("2026-08-16T12:00:05.000Z"),
      preferredDate: null,
      preferredPeriod: null,
      preferredTime: null,
      minimumLeadTimeHours: 2,
      durationMinutes: 30,
      windowStart: new Date("2026-08-16T14:00:00.000Z"),
      windowEnd: new Date("2026-08-30T14:00:00.000Z"),
      allowedStartWindows: null,
      service: { id: "avaliacao", name: "Avaliação" },
      slots: [],
    });
    const write = vi.fn(async () => {
      order.push("write");
      throw new Error("offer write failed");
    });

    await expect(recordV1SlotSearchBeforeWrite({
      sink: { record(observed) { order.push("observe"); events.push(observed); } },
      buildEvent: () => event,
      write,
    })).rejects.toThrow("offer write failed");

    expect(order).toEqual(["observe", "write"]);
    expect(events).toEqual([event]);

    const unaffectedWrite = vi.fn(async () => "written");
    await expect(recordV1SlotSearchBeforeWrite({
      sink: { record() { throw new Error("observer failed"); } },
      buildEvent: () => { throw new Error("observation build failed"); },
      write: unaffectedWrite,
    })).resolves.toBe("written");
    expect(unaffectedWrite).toHaveBeenCalledOnce();
  });
});
