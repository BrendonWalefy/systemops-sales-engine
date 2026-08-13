// Pure function — sem I/O, sem side effects, 100% testável.
// Recebe configuração + eventos existentes e retorna slots livres.

import type { CalendarSlot } from "@/domain/entities/calendar-slot";
import type { ProfessionalWorkSchedule, } from "@/domain/entities/professional";
import type { TreatmentBookingWindow } from "@/domain/entities/treatment";
import { type ParsedBusinessHours, type ClinicTimezone } from "./ClinicTimezone";
import {
  isOpenOnWeekday,
  slotFitsInSingleWindow,
  type BusinessSchedule,
} from "@/core/scheduling/BusinessSchedule";

export type SlotEngineParams = {
  timezone: ClinicTimezone;
  businessHours: ParsedBusinessHours;
  // Escala por dia. Quando presente, ela governa dia e janela em lugar de
  // `businessHours`, o que permite clínica fechada no meio da semana, dois
  // turnos com almoço, e horário distinto por dia — nada disso é representável
  // no texto legado. Ausente = comportamento idêntico ao de antes desta opção.
  businessSchedule?: BusinessSchedule | null;
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
  // Janelas de início do tratamento (ex.: lentes só 09:00/16:00). Quando presentes, os
  // únicos horários candidatos são exatamente estes — a grade de slotDurationMinutes é
  // ignorada. Ver computeWindowedSlots.
  allowedStartWindows?: TreatmentBookingWindow[] | null;
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

// Slots restritos a janelas de início explícitas do tratamento (ex.: lentes 09:00/16:00).
// Diferente da grade: os candidatos são APENAS os horários das janelas, um por dia. O
// FIM do slot pode ultrapassar o fim do expediente (a janela é config mais específica e
// vence — sem isso, um tratamento de 300min às 16:00 nunca seria ofertável). Respeita os
// dias de operação da clínica (businessHours.days) e a ocupação pela duração inteira.
function computeWindowedSlots(
  params: SlotEngineParams,
  windows: TreatmentBookingWindow[],
): CalendarSlot[] {
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
    businessSchedule = null,
  } = params;

  const slotMs = slotDurationMinutes * 60_000;
  const bufferMs = Math.max(0, postEventBufferMinutes) * 60_000;
  const busyRanges = existingEvents.map((e) => ({
    start: e.startsAt.getTime(),
    end: e.endsAt.getTime() + (e.appliesPostEventBuffer === false ? 0 : bufferMs),
  }));

  const slots: CalendarSlot[] = [];

  // Itera dia a dia no fuso da clínica, do primeiro ao último dia da janela [from, to).
  const startParts = timezone.toLocalParts(from);
  let dayCursor = timezone.fromLocalParts(startParts.year, startParts.month, startParts.day, 0, 0);

  while (dayCursor < to && slots.length < maxSlots) {
    const dp = timezone.toLocalParts(dayCursor);
    // Só oferece em dias de operação da clínica.
    if (businessSchedule
      ? isOpenOnWeekday(businessSchedule, dp.weekday)
      : businessHours.days.includes(dp.weekday)) {
      // Ordena as janelas do dia por horário para candidatos cronológicos.
      const dayWindows = windows
        .filter((w) => !w.weekdays || w.weekdays.includes(dp.weekday))
        .sort((a, b) => a.startHour * 60 + a.startMinute - (b.startHour * 60 + b.startMinute));

      for (const w of dayWindows) {
        if (slots.length >= maxSlots) break;
        const startDate = timezone.fromLocalParts(dp.year, dp.month, dp.day, w.startHour, w.startMinute);
        const slotStart = startDate.getTime();
        const slotEnd = slotStart + slotMs;
        if (startDate < from || startDate >= to) continue;
        if (!fitsProfessionalSchedule(professionalSchedule, timezone, startDate, new Date(slotEnd))) continue;
        const isBusy = busyRanges.some((r) => r.start < slotEnd && r.end > slotStart);
        if (isBusy) continue;
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
    // Avança para o próximo dia (meia-noite local do dia seguinte).
    const next = new Date(dayCursor.getTime() + 26 * 3600_000);
    const np = timezone.toLocalParts(next);
    dayCursor = timezone.fromLocalParts(np.year, np.month, np.day, 0, 0);
  }

  return slots;
}

// Marcas de início candidatas: sempre em :00 ou :30 locais. Horários "quebrados"
// (14h20, 8h50) confundem o lead e a recepção; a grade só sai dessas marcas quando
// a config do tratamento pede explicitamente (allowedStartWindows).
const GRID_STEP_MINUTES = 30;

export function computeAvailableSlots(params: SlotEngineParams): CalendarSlot[] {
  // Janelas de início explícitas do tratamento têm precedência sobre a grade horária.
  if (params.allowedStartWindows?.length) {
    return computeWindowedSlots(params, params.allowedStartWindows);
  }

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
    businessSchedule = null,
  } = params;

  const slotMs = slotDurationMinutes * 60_000;
  const bufferMs = Math.max(0, postEventBufferMinutes) * 60_000;
  const slots: CalendarSlot[] = [];

  // Converte eventos em ranges de timestamp para lookup O(n) por slot
  const busyRanges = existingEvents.map((e) => ({
    start: e.startsAt.getTime(),
    end: e.endsAt.getTime() + (e.appliesPostEventBuffer === false ? 0 : bufferMs),
  }));

  // Fim do último slot aceito: candidatos seguintes não podem sobrepor um slot
  // que já vai ser ofertado (dois leads confirmando ofertas sobrepostas colidiriam
  // só na reserva, com a mensagem de "horário indisponível").
  let lastAcceptedEnd = 0;

  // Itera dia a dia no fuso da clínica, com candidatos APENAS nas marcas de
  // :00/:30 locais de cada dia. A grade antiga marchava um cursor contínuo de
  // slotDurationMinutes a partir de `from`, atravessando noites e fins de semana —
  // qualquer duração não múltipla de 30 (ex.: avaliação de 40min) espalhava o
  // resto por todos os dias seguintes (slots às 8h20, 12h20, 14h20).
  const startParts = timezone.toLocalParts(from);
  let dayCursor = timezone.fromLocalParts(startParts.year, startParts.month, startParts.day, 0, 0);

  while (dayCursor < to && slots.length < maxSlots) {
    const dp = timezone.toLocalParts(dayCursor);

    for (let minutes = 0; minutes < 24 * 60 && slots.length < maxSlots; minutes += GRID_STEP_MINUTES) {
      const startDate = timezone.fromLocalParts(dp.year, dp.month, dp.day, Math.floor(minutes / 60), minutes % 60);
      const slotStart = startDate.getTime();
      if (startDate < from || startDate >= to) continue;
      if (slotStart < lastAcceptedEnd) continue;
      if (businessSchedule) {
        // A escala decide dia E janela, e exige o slot inteiro numa só janela.
        if (!slotFitsInSingleWindow(
          businessSchedule, dp.weekday,
          Math.floor(minutes / 60), minutes % 60,
          slotDurationMinutes,
        )) continue;
      } else if (!timezone.isBusinessHour(startDate, businessHours)) continue;

      const slotEnd = slotStart + slotMs;
      // Verifica se o FIM do slot também está dentro do horário comercial
      const slotEndDate = new Date(slotEnd);
      const endParts = timezone.toLocalParts(slotEndDate);
      const endTimeMin = endParts.hour * 60 + endParts.minute;
      const isSaturdayEnd = endParts.weekday === 6 && businessHours.saturdayEndHour !== undefined;
      const endBusinessMin = isSaturdayEnd
        ? businessHours.saturdayEndHour! * 60 + (businessHours.saturdayEndMinute ?? 0)
        : businessHours.endHour * 60 + businessHours.endMinute;
      const endStillInBusiness = businessSchedule
        ? true // slotFitsInSingleWindow já garantiu que o slot cabe inteiro
        : businessHours.days.includes(endParts.weekday) && endTimeMin <= endBusinessMin;
      if (!endStillInBusiness) continue;

      if (!fitsProfessionalSchedule(professionalSchedule, timezone, startDate, slotEndDate)) continue;

      const isBusy = busyRanges.some((r) => r.start < slotEnd && r.end > slotStart);
      if (isBusy) continue;

      slots.push({
        id: `${clinicId}:${slotStart}`,
        clinicId,
        professionalId: null,
        startsAt: new Date(slotStart),
        endsAt: new Date(slotEnd),
        source: "google_calendar",
      });
      lastAcceptedEnd = slotEnd;
    }

    // Avança para o próximo dia (meia-noite local do dia seguinte).
    const next = new Date(dayCursor.getTime() + 26 * 3600_000);
    const np = timezone.toLocalParts(next);
    dayCursor = timezone.fromLocalParts(np.year, np.month, np.day, 0, 0);
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
