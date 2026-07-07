// Pure function — sem I/O, sem side effects, 100% testável.
// Recebe configuração + eventos existentes e retorna slots livres.

import type { CalendarSlot } from "@/domain/entities/calendar-slot";
import type { ProfessionalWorkSchedule } from "@/domain/entities/professional";
import { type ParsedBusinessHours, type ClinicTimezone } from "./ClinicTimezone";

export type SlotEngineParams = {
  timezone: ClinicTimezone;
  businessHours: ParsedBusinessHours;
  existingEvents: { startsAt: Date; endsAt: Date; appliesPostEventBuffer?: boolean }[];
  from: Date;
  to: Date;
  slotDurationMinutes: number;
  clinicId: string;
  postEventBufferMinutes?: number;
  maxSlots?: number;
  // Grade própria do profissional filtrado (ver ProfessionalWorkSchedule). Quando
  // presente, um slot só é válido se couber inteiro na janela do profissional para
  // aquele dia da semana, ALÉM de já caber no horário comercial da clínica — a grade
  // do profissional restringe, nunca amplia, o horário da clínica.
  professionalSchedule?: ProfessionalWorkSchedule | null;
};

// Verifica se o slot [cursor, slotEndDate) cabe inteiro na janela do profissional
// para o dia da semana em que o slot COMEÇA. Sem grade própria (schedule null/
// undefined), o profissional segue o horário da clínica sem restrição adicional.
function fitsProfessionalSchedule(
  schedule: ProfessionalWorkSchedule | null | undefined,
  timezone: ClinicTimezone,
  cursor: Date,
  slotEndDate: Date,
): boolean {
  if (!schedule) return true;

  const startParts = timezone.toLocalParts(cursor);
  const window = schedule[startParts.weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6];
  if (!window) return false;

  const startMin = startParts.hour * 60 + startParts.minute;
  const windowStartMin = window.startHour * 60 + window.startMinute;
  const windowEndMin = window.endHour * 60 + window.endMinute;
  if (startMin < windowStartMin || startMin >= windowEndMin) return false;

  const endParts = timezone.toLocalParts(slotEndDate);
  if (endParts.weekday !== startParts.weekday) return false;
  const endMin = endParts.hour * 60 + endParts.minute;
  return endMin <= windowEndMin;
}

export function computeAvailableSlots(params: SlotEngineParams): CalendarSlot[] {
  const {
    timezone,
    businessHours,
    existingEvents,
    from,
    to,
    slotDurationMinutes,
    clinicId,
    postEventBufferMinutes = 0,
    maxSlots = 100,
    professionalSchedule = null,
  } = params;

  const slotMs = slotDurationMinutes * 60_000;
  const bufferMs = Math.max(0, postEventBufferMinutes) * 60_000;
  const slots: CalendarSlot[] = [];

  // Converte eventos em ranges de timestamp para lookup O(n) por slot
  const busyRanges = existingEvents.map((e) => ({
    start: e.startsAt.getTime(),
    end: e.endsAt.getTime() + (e.appliesPostEventBuffer === false ? 0 : bufferMs),
  }));

  let cursor = new Date(from.getTime());

  while (cursor < to && slots.length < maxSlots) {
    const slotStart = cursor.getTime();
    const slotEnd = slotStart + slotMs;

    if (timezone.isBusinessHour(cursor, businessHours)) {
      // Verifica se o FIM do slot também está dentro do horário comercial
      const slotEndDate = new Date(slotEnd);
      const endParts = timezone.toLocalParts(slotEndDate);
      const endTimeMin = endParts.hour * 60 + endParts.minute;
      const isSaturdayEnd = endParts.weekday === 6 && businessHours.saturdayEndHour !== undefined;
      const endBusinessMin = isSaturdayEnd
        ? businessHours.saturdayEndHour! * 60 + (businessHours.saturdayEndMinute ?? 0)
        : businessHours.endHour * 60 + businessHours.endMinute;
      const endStillInBusiness =
        businessHours.days.includes(endParts.weekday) &&
        endTimeMin <= endBusinessMin;

      if (endStillInBusiness && fitsProfessionalSchedule(professionalSchedule, timezone, cursor, slotEndDate)) {
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
// Usa o fuso horário da clínica para classificar manhã/tarde e identificar o dia correto.
// Faz round-robin entre os buckets para garantir variedade de horário nas sugestões.
export function selectBestSlots(slots: CalendarSlot[], count: number, timezone: ClinicTimezone): CalendarSlot[] {
  if (slots.length <= count) return slots;

  // Agrupa por (dia local + período), produzindo buckets como "2026-05-25-morning"
  const byDayPeriod = new Map<string, CalendarSlot[]>();
  for (const slot of slots) {
    const parts = timezone.toLocalParts(slot.startsAt);
    const dayKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    const period = parts.hour < 12 ? "morning" : "afternoon";
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
