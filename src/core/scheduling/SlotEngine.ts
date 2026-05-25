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

// Seleciona os N melhores slots distribuídos por dias diferentes.
// Pega o primeiro slot disponível de cada dia em ordem cronológica,
// ciclando pelos dias até atingir o count.
export function selectBestSlots(slots: CalendarSlot[], count: number): CalendarSlot[] {
  if (slots.length <= count) return slots;

  // Agrupa por dia UTC (funciona para BRT pois horário comercial 8-18h BRT = 11-21h UTC,
  // sempre no mesmo dia do calendário)
  const byDay = new Map<string, CalendarSlot[]>();
  for (const slot of slots) {
    const dayKey = slot.startsAt.toISOString().slice(0, 10);
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey)!.push(slot);
  }

  const days = [...byDay.values()];
  const result: CalendarSlot[] = [];
  let i = 0;

  while (result.length < count && days.length > 0) {
    const idx = i % days.length;
    const slot = days[idx].shift();
    if (slot) {
      result.push(slot);
    }
    if (days[idx].length === 0) {
      days.splice(idx, 1);
    } else {
      i++;
    }
  }

  return result;
}
