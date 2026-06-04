// Único ponto de conversão de timezone no sistema.
// Usa Intl.DateTimeFormat nativo (Node 18+) — sem dependência externa.
// Todas as Dates armazenadas no banco são UTC. Esta classe converte para exibição local.

export type ParsedBusinessHours = {
  startHour: number;   // ex: 8
  startMinute: number; // ex: 0 ou 30
  endHour: number;     // ex: 18 (exclusivo — slots até endHour ou endHour:endMinute)
  endMinute: number;   // ex: 0 ou 30
  days: number[];      // 0=Dom, 1=Seg, ..., 6=Sáb
  saturdayStartHour?: number;  // horário de início exclusivo do sábado
  saturdayStartMinute?: number;
  saturdayEndHour?: number;    // horário de fim exclusivo do sábado (ex: 13)
  saturdayEndMinute?: number;
};

export type LocalDateParts = {
  year: number;
  month: number;  // 0-indexed (0=Jan)
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Dom, 1=Seg, ..., 6=Sáb
};

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

const WEEKDAY_PT: Record<number, string> = {
  0: "Dom", 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb",
};

// Meses em pt-BR normalizados (sem acento) → índice 0-based
const MONTH_NAME_PT: Record<string, number> = {
  janeiro: 0, fevereiro: 1, marco: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

const MONTH_PT: Record<number, string> = {
  1: "jan", 2: "fev", 3: "mar", 4: "abr", 5: "mai", 6: "jun",
  7: "jul", 8: "ago", 9: "set", 10: "out", 11: "nov", 12: "dez",
};

// Default para clínicas sem horário configurado
export const DEFAULT_BUSINESS_HOURS: ParsedBusinessHours = {
  startHour: 8,
  startMinute: 0,
  endHour: 18,
  endMinute: 0,
  days: [1, 2, 3, 4, 5], // Seg-Sex
};

export class ClinicTimezone {
  private readonly ianaZone: string;
  private readonly formatter: Intl.DateTimeFormat;

  constructor(ianaZone: string) {
    this.ianaZone = ianaZone;
    this.formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: ianaZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    });
  }

  // Converte UTC → partes no fuso da clínica
  toLocalParts(utc: Date): LocalDateParts {
    const parts = this.formatter.formatToParts(utc);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";

    return {
      year: Number(get("year")),
      month: Number(get("month")) - 1, // 0-indexed
      day: Number(get("day")),
      hour: Number(get("hour")) % 24,  // "24" vira 0
      minute: Number(get("minute")),
      weekday: WEEKDAY_MAP[get("weekday")] ?? 0,
    };
  }

  // Converte partes no fuso da clínica → UTC
  fromLocalParts(
    year: number,
    month: number, // 0-indexed
    day: number,
    hour: number,
    minute = 0,
  ): Date {
    // Estratégia: cria data em UTC e ajusta iterativamente.
    // Intl.DateTimeFormat é confiável para ler, não para escrever.
    // Partimos do meio-dia UTC (12h) para garantir que o toLocalParts do estimado
    // retorne o MESMO dia calendário que o solicitado — evita o off-by-one em UTC-3
    // onde meia-noite UTC (0h) é 21h do dia anterior no fuso local.
    const estimated = new Date(Date.UTC(year, month, day, 12, 0));
    const localBack = this.toLocalParts(estimated);

    const diffMinutes =
      (hour - localBack.hour) * 60 + (minute - localBack.minute);

    const corrected = new Date(estimated.getTime() + diffMinutes * 60_000);

    // Uma verificação final para DST edge cases
    const check = this.toLocalParts(corrected);
    if (check.hour !== hour || check.minute !== minute) {
      // Corrige segunda vez (raro, mas cobre horário de verão)
      const diff2 = (hour - check.hour) * 60 + (minute - check.minute);
      return new Date(corrected.getTime() + diff2 * 60_000);
    }

    return corrected;
  }

  // "Seg 26/05 às 14h" — formato padrão para WhatsApp
  formatForHuman(utc: Date): string {
    const p = this.toLocalParts(utc);
    const month = p.month + 1;
    const d = String(p.day).padStart(2, "0");
    const m = String(month).padStart(2, "0");
    return `${WEEKDAY_PT[p.weekday]} ${d}/${m} às ${p.hour}h`;
  }

  // "segunda-feira, 26 de maio às 14h" — para confirmações mais formais
  formatForConfirmation(utc: Date): string {
    const p = this.toLocalParts(utc);
    const month = MONTH_PT[p.month + 1];
    return `${WEEKDAY_PT[p.weekday].toLowerCase()}-feira, dia ${p.day} de ${month} às ${p.hour}h`;
  }

  // Início do dia local (meia-noite do dia) em UTC
  startOfLocalDay(utc: Date): Date {
    const p = this.toLocalParts(utc);
    return this.fromLocalParts(p.year, p.month, p.day, 0, 0);
  }

  // Hora atual no fuso da clínica
  currentTime(): Date {
    return new Date();
  }

  // Verifica se um instante UTC está dentro do horário comercial da clínica
  isBusinessHour(utc: Date, bh: ParsedBusinessHours): boolean {
    const p = this.toLocalParts(utc);
    if (!bh.days.includes(p.weekday)) return false;
    const timeMin = p.hour * 60 + p.minute;
    if (p.weekday === 6 && bh.saturdayEndHour !== undefined) {
      const satStartMin = (bh.saturdayStartHour ?? bh.startHour) * 60 + (bh.saturdayStartMinute ?? bh.startMinute);
      const satEndMin = bh.saturdayEndHour * 60 + (bh.saturdayEndMinute ?? 0);
      return timeMin >= satStartMin && timeMin < satEndMin;
    }
    const startMin = bh.startHour * 60 + bh.startMinute;
    const endMin = bh.endHour * 60 + bh.endMinute;
    return timeMin >= startMin && timeMin < endMin;
  }

  // Data/hora atual no fuso, formatada para prompt do LLM
  formatNowForPrompt(): string {
    const now = new Date();
    return now.toLocaleString("pt-BR", {
      timeZone: this.ianaZone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Converte preferência textual de data (ex: "sexta", "amanhã", "próxima semana")
  // para o início desse dia no fuso da clínica, em UTC.
  // Retorna null quando a string não mapeia para um dia específico.
  // businessHours: quando fornecido, "sexta" no dia sexta retorna hoje se ainda há horário;
  //               caso contrário retorna sempre a próxima semana.
  resolvePreferredDate(raw: string, now: Date, businessHours?: ParsedBusinessHours | null): Date | null {
    const s = raw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    const today = this.toLocalParts(now);

    if (/\bhoje\b/.test(s)) {
      return this.fromLocalParts(today.year, today.month, today.day, 0, 0);
    }

    if (/\bamanha\b/.test(s)) {
      const t = new Date(now.getTime() + 24 * 60 * 60_000);
      const p = this.toLocalParts(t);
      return this.fromLocalParts(p.year, p.month, p.day, 0, 0);
    }

    const dayNames: [RegExp, number][] = [
      [/\bdom(ingo)?\b/, 0],
      [/\bseg(unda)?(-feira)?\b/, 1],
      [/\bter(ca|ça)?(-feira)?\b/, 2],
      [/\bqua(rta)?(-feira)?\b/, 3],
      [/\bqui(nta)?(-feira)?\b/, 4],
      [/\bsex(ta)?(-feira)?\b/, 5],
      [/\bsab(ado)?\b/, 6],
    ];

    for (const [pattern, weekday] of dayNames) {
      if (pattern.test(s)) {
        let daysAhead = weekday - today.weekday;
        if (daysAhead === 0) {
          // Lead pediu exatamente hoje — retorna hoje só se ainda há horário comercial
          if (!businessHours || today.hour >= businessHours.endHour - 1) daysAhead = 7;
        } else if (daysAhead < 0) {
          daysAhead += 7;
        }
        const target = new Date(now.getTime() + daysAhead * 24 * 60 * 60_000);
        const p = this.toLocalParts(target);
        return this.fromLocalParts(p.year, p.month, p.day, 0, 0);
      }
    }

    // "DD/MM" ou "DD/MM/YYYY"
    const dmyMatch = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
    if (dmyMatch) {
      const day = parseInt(dmyMatch[1], 10);
      const month = parseInt(dmyMatch[2], 10) - 1; // 0-indexed
      const year = dmyMatch[3] ? parseInt(dmyMatch[3], 10) : today.year;
      const startOfToday = this.fromLocalParts(today.year, today.month, today.day, 0, 0);
      const target = this.fromLocalParts(year, month, day, 0, 0);
      if (target < startOfToday) return this.fromLocalParts(year + 1, month, day, 0, 0);
      return target;
    }

    // "DD de <mês>"
    const ddDeMonthMatch = s.match(/(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/);
    if (ddDeMonthMatch) {
      const day = parseInt(ddDeMonthMatch[1], 10);
      const month = MONTH_NAME_PT[ddDeMonthMatch[2]];
      const startOfToday = this.fromLocalParts(today.year, today.month, today.day, 0, 0);
      const target = this.fromLocalParts(today.year, month, day, 0, 0);
      if (target < startOfToday) return this.fromLocalParts(today.year + 1, month, day, 0, 0);
      return target;
    }

    // "dia DD" (sem mês — usa mês atual, avança se o dia já passou)
    const diaDDMatch = s.match(/\bdia\s+(\d{1,2})\b/);
    if (diaDDMatch) {
      const day = parseInt(diaDDMatch[1], 10);
      let month = today.month;
      let year = today.year;
      if (day < today.day) {
        month += 1;
        if (month > 11) { month = 0; year += 1; }
      }
      const startOfToday = this.fromLocalParts(today.year, today.month, today.day, 0, 0);
      const target = this.fromLocalParts(year, month, day, 0, 0);
      if (target < startOfToday) return this.fromLocalParts(year + 1, month, day, 0, 0);
      return target;
    }

    return null;
  }

  get zone(): string {
    return this.ianaZone;
  }
}

// Parseia string de businessHours (ex: "seg-sex 8h-18h", "9h30-18h30", "08:30-18:00") → ParsedBusinessHours
// Mantém compatibilidade com o campo texto existente no banco
export function parseBusinessHours(raw: string | null): ParsedBusinessHours {
  if (!raw) return DEFAULT_BUSINESS_HOURS;

  const normalized = raw.toLowerCase().trim();

  // Captura hora e minutos opcionais em dois formatos:
  //   "8h" ou "8h30"  → grupo 1 = hora, grupo 2 = minutos (hXX)
  //   "08:00" ou "08:30" → grupo 1 = hora, grupo 3 = minutos (:XX)
  const hoursMatch = normalized.match(
    /(\d{1,2})(?:h(\d{2})?|:(\d{2}))?\s*[-–]\s*(\d{1,2})(?:h(\d{2})?|:(\d{2}))?/,
  );

  const startHour   = hoursMatch ? Number(hoursMatch[1]) : 8;
  const startMinute = hoursMatch ? Number(hoursMatch[2] ?? hoursMatch[3] ?? "0") : 0;
  const endHour     = hoursMatch ? Number(hoursMatch[4]) : 18;
  const endMinute   = hoursMatch ? Number(hoursMatch[5] ?? hoursMatch[6] ?? "0") : 0;

  // Detecta sábado
  const hasSaturday = /s[aá]b/.test(normalized);
  const days = hasSaturday ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];

  // Tenta capturar horário específico do sábado (ex: "sab 8h-13h")
  const satMatch = normalized.match(
    /s[aá]b(?:ado)?\s+(\d{1,2})(?:h(\d{2})?|:(\d{2}))?\s*[-–]\s*(\d{1,2})(?:h(\d{2})?|:(\d{2}))?/,
  );
  const saturdayStartHour   = satMatch ? Number(satMatch[1]) : undefined;
  const saturdayStartMinute = satMatch ? Number(satMatch[2] ?? satMatch[3] ?? "0") : undefined;
  const saturdayEndHour     = satMatch ? Number(satMatch[4]) : undefined;
  const saturdayEndMinute   = satMatch ? Number(satMatch[5] ?? satMatch[6] ?? "0") : undefined;

  return { startHour, startMinute, endHour, endMinute, days, saturdayStartHour, saturdayStartMinute, saturdayEndHour, saturdayEndMinute };
}

/**
 * Saudação temporal baseada na hora local da clínica.
 * Madrugada (00h–04h) retorna "Boa noite" para evitar "Bom dia" às 00:00.
 */
export function getTimeGreeting(hour: number): "Bom dia" | "Boa tarde" | "Boa noite" {
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}
