// Escala de atendimento por dia da semana.
//
// O campo texto `organizations.business_hours` só consegue expressar UMA faixa de
// horário mais uma exceção de sábado — e `days` alimenta
// SlotEngine.computeAvailableSlots, que decide quais dias têm horário. Logo, o
// que o texto não consegue guardar (fechado na quarta, dois turnos, horário
// distinto por dia) virava disponibilidade errada, não apenas frase errada.
//
// Este módulo é a porta ÚNICA de leitura da escala. Nada deve ler
// `business_hours` nem chamar parseBusinessHours direto para decidir dia.
// Ver docs/superpowers/specs/2026-08-13-per-day-business-hours-design.md
import { parseBusinessHours, type ParsedBusinessHours } from "@/core/scheduling/ClinicTimezone";

/** 0=Dom, 1=Seg, ..., 6=Sáb — mesma numeração de `weekdays` em treatment.ts. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type DayWindow = {
  startHour: number;
  startMinute: number;
  /** Exclusivo: janela 8:00–12:00 não oferece slot começando às 12:00. */
  endHour: number;
  endMinute: number;
};

/**
 * Dia AUSENTE do mapa significa clínica fechada nesse dia. Não existe campo
 * "closed": ausência é o único jeito de estar fechado, o que elimina o estado
 * contraditório "fechado mas com janela".
 */
export type BusinessSchedule = {
  days: Partial<Record<Weekday, DayWindow[]>>;
};

const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** Segunda a sexta, 8h–18h: o mesmo default já embutido em parseBusinessHours. */
export const DEFAULT_BUSINESS_SCHEDULE: BusinessSchedule = {
  days: {
    1: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
    2: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
    3: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
    4: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
    5: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
  },
};

/**
 * Converte o resultado do parser legado na escala equivalente, preservando o
 * comportamento atual EXATAMENTE — inclusive as limitações. Não adivinha o que o
 * texto não diz: sábado sem horário próprio herda a faixa geral, que é o que o
 * sistema faz hoje.
 */
export function scheduleFromParsedBusinessHours(parsed: ParsedBusinessHours): BusinessSchedule {
  const general: DayWindow = {
    startHour: parsed.startHour,
    startMinute: parsed.startMinute,
    endHour: parsed.endHour,
    endMinute: parsed.endMinute,
  };
  const saturday: DayWindow =
    parsed.saturdayStartHour !== undefined && parsed.saturdayEndHour !== undefined
      ? {
          startHour: parsed.saturdayStartHour,
          startMinute: parsed.saturdayStartMinute ?? 0,
          endHour: parsed.saturdayEndHour,
          endMinute: parsed.saturdayEndMinute ?? 0,
        }
      : general;

  const days: Partial<Record<Weekday, DayWindow[]>> = {};
  for (const weekday of WEEKDAYS) {
    if (!parsed.days.includes(weekday)) continue;
    days[weekday] = [weekday === 6 ? saturday : general];
  }
  return { days };
}

/**
 * Porta única de leitura, com fallback explícito em três degraus:
 * escala estruturada → derivação do texto legado → padrão.
 *
 * Enquanto existir organização sem `businessSchedule`, o degrau do meio é
 * caminho vivo e parseBusinessHours não pode ser removido.
 */
export function resolveBusinessSchedule(organization: {
  businessSchedule?: BusinessSchedule | null;
  businessHours?: string | null;
}): BusinessSchedule {
  const stored = organization.businessSchedule;
  if (stored && Object.keys(stored.days).length > 0) return stored;
  if (organization.businessHours) {
    return scheduleFromParsedBusinessHours(parseBusinessHours(organization.businessHours));
  }
  return DEFAULT_BUSINESS_SCHEDULE;
}

/** Janelas do dia, ordenadas por horário. Dia fechado devolve lista vazia. */
export function windowsForWeekday(schedule: BusinessSchedule, weekday: number): DayWindow[] {
  const windows = schedule.days[weekday as Weekday];
  if (!windows || windows.length === 0) return [];
  return [...windows].sort(
    (a, b) => a.startHour * 60 + a.startMinute - (b.startHour * 60 + b.startMinute),
  );
}

export function isOpenOnWeekday(schedule: BusinessSchedule, weekday: number): boolean {
  return windowsForWeekday(schedule, weekday).length > 0;
}

/** Dias de operação, em ordem crescente. Substitui o uso de `ParsedBusinessHours.days`. */
export function operatingWeekdays(schedule: BusinessSchedule): Weekday[] {
  return WEEKDAYS.filter((weekday) => isOpenOnWeekday(schedule, weekday));
}

// ── Pergunta sobre um dia específico ─────────────────────────────────────────
// `isSaturdayQuestionForOperatingClinic` só sabia sobre sábado, e o comentário
// dela admitia: "Enquanto o parser não souber o resto da semana, o sistema não
// afirma o que não sabe". Com a escala, saber sobre quarta é a mesma consulta.

const WEEKDAY_PATTERNS: { weekday: Weekday; pattern: RegExp }[] = [
  { weekday: 0, pattern: /\bdomingos?\b/ },
  { weekday: 1, pattern: /\b(segunda|segundas|seg)\b/ },
  // "ter" fica FORA de propósito: colide com o verbo ter, e "queria ter um
  // horário" viraria terça-feira. "dom" também fica fora, por ser palavra.
  { weekday: 2, pattern: /\b(terca|tercas)\b/ },
  { weekday: 3, pattern: /\b(quarta|quartas|qua)\b/ },
  { weekday: 4, pattern: /\b(quinta|quintas|qui)\b/ },
  { weekday: 5, pattern: /\b(sexta|sextas|sex)\b/ },
  { weekday: 6, pattern: /\b(sabado|sabados|sab)\b/ },
];

/**
 * Dia da semana citado numa mensagem já normalizada (sem acento, minúscula).
 * Devolve null quando nenhum dia é citado, ou quando MAIS DE UM é: "de segunda a
 * sexta" cita dois e não é pergunta sobre um dia específico.
 */
export function detectWeekdayQuestion(normalizedMessage: string): Weekday | null {
  const matched = WEEKDAY_PATTERNS.filter(({ pattern }) => pattern.test(normalizedMessage));
  return matched.length === 1 ? matched[0].weekday : null;
}

export const WEEKDAY_NAME: Record<Weekday, string> = {
  0: "domingo",
  1: "segunda",
  2: "terça",
  3: "quarta",
  4: "quinta",
  5: "sexta",
  6: "sábado",
};

function formatWindow(window: DayWindow): string {
  const fmt = (hour: number, minute: number) =>
    minute === 0 ? `${hour}h` : `${hour}h${String(minute).padStart(2, "0")}`;
  return `${fmt(window.startHour, window.startMinute)} às ${fmt(window.endHour, window.endMinute)}`;
}

/** Horário do dia em prosa, ou null quando fechado. Ex.: "8h às 12h e 14h às 18h". */
export function describeWeekdayHours(schedule: BusinessSchedule, weekday: Weekday): string | null {
  const windows = windowsForWeekday(schedule, weekday);
  if (windows.length === 0) return null;
  return windows.map(formatWindow).join(" e ");
}

/**
 * Hora local cai dentro de alguma janela do dia. Substitui
 * ClinicTimezone.isBusinessHour quando há escala: o fim da janela é exclusivo,
 * então 12:00 não é horário válido numa janela que termina às 12:00.
 */
export function isOpenAtLocalTime(
  schedule: BusinessSchedule,
  weekday: number,
  hour: number,
  minute: number,
): boolean {
  const timeMin = hour * 60 + minute;
  return windowsForWeekday(schedule, weekday).some((w) => {
    const startMin = w.startHour * 60 + w.startMinute;
    const endMin = w.endHour * 60 + w.endMinute;
    return timeMin >= startMin && timeMin < endMin;
  });
}

/**
 * O slot INTEIRO cabe dentro de UMA janela do dia. Mais estrito que checar
 * início e fim separadamente: um slot de 60min começando às 11:30 num dia
 * 8:00-12:00 + 14:00-18:00 tem início e fim "em horário de atendimento" se os
 * dois forem avaliados isolados, mas atravessa o almoço e não existe.
 */
export function slotFitsInSingleWindow(
  schedule: BusinessSchedule,
  weekday: number,
  startHour: number,
  startMinute: number,
  durationMinutes: number,
): boolean {
  const startMin = startHour * 60 + startMinute;
  const endMin = startMin + durationMinutes;
  return windowsForWeekday(schedule, weekday).some(
    (w) =>
      startMin >= w.startHour * 60 + w.startMinute &&
      endMin <= w.endHour * 60 + w.endMinute,
  );
}
