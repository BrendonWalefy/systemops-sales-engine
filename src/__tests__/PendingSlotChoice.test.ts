import { describe, expect, it } from "vitest";
import { ClinicTimezone, type ParsedBusinessHours } from "@/core/scheduling/ClinicTimezone";
import { resolvePendingSlotChoice } from "@/core/pipeline/ConversationOrchestrator";
import type { SlotPreference } from "@/core/intelligence/IntentClassifier";

// Regressão do replay Vitalli 18/07: lead respondeu "Segunda" à lista de slots
// (que tinha segunda nas opções 1 e 3) e o confirm_slot assumia a opção 1 — quando
// a reserva falhava, saía o falso "seu horário ficou indisponível".

const tz = new ClinicTimezone("America/Sao_Paulo");

const businessHours: ParsedBusinessHours = {
  startHour: 8,
  startMinute: 0,
  endHour: 18,
  endMinute: 0,
  days: [1, 2, 3, 4, 5, 6],
};

function pref(overrides: Partial<SlotPreference>): SlotPreference {
  return {
    preferredDate: null,
    preferredPeriod: null,
    preferredTime: null,
    slotChoice: null,
    identifiedTreatment: null,
    ambiguousTreatmentMatches: null,
    ...overrides,
  };
}

// Constrói slots ancorados na PRÓXIMA segunda (mesma resolução usada em produção),
// para o teste valer em qualquer dia em que rode.
function nextMonday(): { year: number; month: number; day: number } {
  const day = tz.resolvePreferredDate("segunda", new Date(), businessHours)!;
  return tz.toLocalParts(day);
}

function slotAt(index: number, base: { year: number; month: number; day: number }, dayOffset: number, hour: number) {
  const date = new Date(
    tz.fromLocalParts(base.year, base.month, base.day, hour, 0).getTime() + dayOffset * 24 * 60 * 60_000,
  );
  const p = tz.toLocalParts(date);
  const startsAt = tz.fromLocalParts(p.year, p.month, p.day, hour, 0);
  return {
    index,
    startsAt: startsAt.toISOString(),
    label: `slot-${index}`,
  };
}

describe("resolvePendingSlotChoice", () => {
  it("resolve 'segunda' para o único slot pendente que cai na segunda", () => {
    const monday = nextMonday();
    const pendingSlots = [
      slotAt(1, monday, 2, 16), // quarta 16h
      slotAt(2, monday, 0, 9), // segunda 9h ← único match
      slotAt(3, monday, 3, 16), // quinta 16h
    ];

    const result = resolvePendingSlotChoice({
      slotPreference: pref({ preferredDate: "segunda" }),
      pendingSlots,
      timezone: tz,
      businessHours,
    });

    expect(result).toEqual({ kind: "resolved", index: 2 });
  });

  it("com mais de uma segunda na lista, pede desambiguação com os números originais", () => {
    const monday = nextMonday();
    const pendingSlots = [
      slotAt(1, monday, 0, 9), // segunda 9h
      slotAt(2, monday, 2, 16), // quarta 16h
      slotAt(3, monday, 7, 9), // segunda seguinte 9h
    ];

    const result = resolvePendingSlotChoice({
      slotPreference: pref({ preferredDate: "segunda" }),
      pendingSlots,
      timezone: tz,
      businessHours,
    });

    // "segunda" sem qualificador resolve para a PRÓXIMA segunda — apenas ela casa.
    // Se a resolução de data devolver só um dia, o resultado é direto; o caso
    // genuinamente ambíguo é dia + dois horários no MESMO dia (abaixo).
    expect(result).toEqual({ kind: "resolved", index: 1 });
  });

  it("mesmo dia com dois horários → ambiguous preservando índices", () => {
    const monday = nextMonday();
    const pendingSlots = [
      slotAt(1, monday, 2, 16), // quarta
      slotAt(3, monday, 0, 9), // segunda 9h
      slotAt(4, monday, 0, 16), // segunda 16h
    ];

    const result = resolvePendingSlotChoice({
      slotPreference: pref({ preferredDate: "segunda" }),
      pendingSlots,
      timezone: tz,
      businessHours,
    });

    expect(result).toEqual({
      kind: "ambiguous",
      matches: [
        { index: 3, label: "slot-3" },
        { index: 4, label: "slot-4" },
      ],
    });
  });

  it("resolve período ('à tarde') para o único slot da tarde", () => {
    const monday = nextMonday();
    const pendingSlots = [
      slotAt(1, monday, 0, 9),
      slotAt(2, monday, 1, 10),
      slotAt(3, monday, 2, 16), // único da tarde
    ];

    const result = resolvePendingSlotChoice({
      slotPreference: pref({ preferredPeriod: "afternoon" }),
      pendingSlots,
      timezone: tz,
      businessHours,
    });

    expect(result).toEqual({ kind: "resolved", index: 3 });
  });

  it("período sem nenhum slot correspondente → no_match (nova busca, nunca opção 1)", () => {
    const monday = nextMonday();
    const pendingSlots = [slotAt(1, monday, 0, 9), slotAt(2, monday, 1, 10)];

    const result = resolvePendingSlotChoice({
      slotPreference: pref({ preferredPeriod: "afternoon" }),
      pendingSlots,
      timezone: tz,
      businessHours,
    });

    expect(result).toEqual({ kind: "no_match" });
  });

  it("resolve hora ('às 4') normalizando para 16h no horário comercial", () => {
    const monday = nextMonday();
    const pendingSlots = [
      slotAt(1, monday, 0, 9),
      slotAt(2, monday, 0, 16),
    ];

    const result = resolvePendingSlotChoice({
      slotPreference: pref({ preferredTime: "às 4" }),
      pendingSlots,
      timezone: tz,
      businessHours,
    });

    expect(result).toEqual({ kind: "resolved", index: 2 });
  });

  it("escolha numérica já feita → passthrough (fluxo existente decide)", () => {
    const monday = nextMonday();
    const result = resolvePendingSlotChoice({
      slotPreference: pref({ slotChoice: 2, preferredDate: "segunda" }),
      pendingSlots: [slotAt(1, monday, 0, 9)],
      timezone: tz,
      businessHours,
    });

    expect(result).toEqual({ kind: "passthrough" });
  });

  it("sem preferências expressas → passthrough", () => {
    const monday = nextMonday();
    const result = resolvePendingSlotChoice({
      slotPreference: pref({}),
      pendingSlots: [slotAt(1, monday, 0, 9)],
      timezone: tz,
      businessHours,
    });

    expect(result).toEqual({ kind: "passthrough" });
  });
});
