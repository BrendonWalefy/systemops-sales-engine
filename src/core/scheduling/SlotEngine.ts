// Pure function — sem I/O, sem side effects, 100% testável.
// Recebe configuração + eventos existentes e retorna slots livres.

import type { CalendarSlot } from "@/domain/entities/calendar-slot";
import { type ParsedBusinessHours, type ClinicTimezone } from "./ClinicTimezone";

export type SlotEngineParams = {
  timezone: ClinicTimezone;
  businessHours: ParsedBusinessHours;
  existingEvents: { startsAt: Date; endsAt: Date }[];
  from: Date;
  to: Date;
  slotDurationMinutes: number;
  clinicId: string;
  maxSlots?: number;
};

export function computeAvailableSlots(params: SlotEngineParams): CalendarSlot[] {
  const {
    timezone,
    businessHours,
    existingEvents,
    from,
    to,
    slotDurationMinutes,
    clinicId,
    maxSlots = 100,
  } = params;

  const slotMs = slotDurationMinutes * 60_000;
  const slots: CalendarSlot[] = [];

  // Converte eventos em ranges de timestamp para lookup O(n) por slot
  const busyRanges = existingEvents.map((e) => ({
    start: e.startsAt.getTime(),
    end: e.endsAt.getTime(),
  }));

  let cursor = new Date(from.getTime());

  while (cursor < to && slots.length < maxSlots) {
    const slotStart = cursor.getTime();
    const slotEnd = slotStart + slotMs;

    if (timezone.isBusinessHour(cursor, businessHours)) {
      // Verifica se o FIM do slot também está dentro do horário comercial
      const slotEndDate = new Date(slotEnd);
      const endParts = timezone.toLocalParts(slotEndDate);
      const endStillInBusiness =
        businessHours.days.includes(endParts.weekday) &&
        endParts.hour <= businessHours.endHour &&
        !(endParts.hour === businessHours.endHour && endParts.minute > 0);

      if (endStillInBusiness) {
        const isBusy = busyRanges.some((r) => r.start < slotEnd && r.end > slotStart);

        if (!isBusy) {
          slots.push({
            id: `${clinicId}:${slotStart}`,
            clinicId,
            professionalId: null,
            startsAt: new Date(slotStart),
            endsAt: new Date(slotEnd),
            source: "google_calendar",
          });
        }
      }
    }

    cursor = new Date(slotStart + slotMs);
  }

  return slots;
}

// Seleciona os N melhores slots distribuídos por dias e períodos diferentes.
// Para cada dia, divide os slots em manhã (antes das 15h UTC = antes das 12h BRT)
// e tarde (a partir das 15h UTC = a partir das 12h BRT), depois faz round-robin
// entre esses buckets para garantir variedade de horário nas sugestões.
const AFTERNOON_UTC_BOUNDARY = 15; // 15h UTC = 12h BRT

export function selectBestSlots(slots: CalendarSlot[], count: number): CalendarSlot[] {
  if (slots.length <= count) return slots;

  // Agrupa por (dia + período), produzindo buckets como "2026-05-25-morning"
  const byDayPeriod = new Map<string, CalendarSlot[]>();
  for (const slot of slots) {
    const dayKey = slot.startsAt.toISOString().slice(0, 10);
    const period = slot.startsAt.getUTCHours() < AFTERNOON_UTC_BOUNDARY ? "morning" : "afternoon";
    const key = `${dayKey}-${period}`;
    if (!byDayPeriod.has(key)) byDayPeriod.set(key, []);
    byDayPeriod.get(key)!.push(slot);
  }

  // Ordena os buckets cronologicamente (manhã antes da tarde, dia mais próximo primeiro)
  const buckets = [...byDayPeriod.keys()]
    .sort()
    .map((key) => byDayPeriod.get(key)!);

  const result: CalendarSlot[] = [];
  let i = 0;

  while (result.length < count && buckets.length > 0) {
    const idx = i % buckets.length;
    const slot = buckets[idx].shift();
    if (slot) result.push(slot);
    if (buckets[idx].length === 0) {
      buckets.splice(idx, 1);
    } else {
      i++;
    }
  }

  return result;
}
