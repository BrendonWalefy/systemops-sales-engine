// Único ponto de conversão de timezone no sistema.
// Usa Intl.DateTimeFormat nativo (Node 18+) — sem dependência externa.
// Todas as Dates armazenadas no banco são UTC. Esta classe converte para exibição local.

export type ParsedBusinessHours = {
  startHour: number; // ex: 8
  endHour: number;   // ex: 18 (exclusivo — slots até 17h)
  days: number[];    // 0=Dom, 1=Seg, ..., 6=Sáb
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

const MONTH_PT: Record<number, string> = {
  1: "jan", 2: "fev", 3: "mar", 4: "abr", 5: "mai", 6: "jun",
  7: "jul", 8: "ago", 9: "set", 10: "out", 11: "nov", 12: "dez",
};

// Default para clínicas sem horário configurado
export const DEFAULT_BUSINESS_HOURS: ParsedBusinessHours = {
  startHour: 8,
  endHour: 18,
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
    // Usamos bissecção: estimamos UTC, verificamos diferença local, corrigimos.
    const estimated = new Date(Date.UTC(year, month, day, hour, minute));
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
    return bh.days.includes(p.weekday) && p.hour >= bh.startHour && p.hour < bh.endHour;
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
  resolvePreferredDate(raw: string, now: Date): Date | null {
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
        if (daysAhead <= 0) daysAhead += 7;
        const target = new Date(now.getTime() + daysAhead * 24 * 60 * 60_000);
        const p = this.toLocalParts(target);
        return this.fromLocalParts(p.year, p.month, p.day, 0, 0);
      }
    }

    return null;
  }

  get zone(): string {
    return this.ianaZone;
  }
}

// Parseia string de businessHours (ex: "seg-sex 8h-18h") → ParsedBusinessHours
// Mantém compatibilidade com o campo texto existente no banco
export function parseBusinessHours(raw: string | null): ParsedBusinessHours {
  if (!raw) return DEFAULT_BUSINESS_HOURS;

  const normalized = raw.toLowerCase().trim();

  // Extrai horas: "8h-18h", "08:00-18:00", "8-18"
  const hoursMatch = normalized.match(/(\d{1,2})(?:h|:00)?\s*[-–]\s*(\d{1,2})(?:h|:00)?/);
  const startHour = hoursMatch ? Number(hoursMatch[1]) : 8;
  const endHour = hoursMatch ? Number(hoursMatch[2]) : 18;

  // Detecta sábado
  const hasSaturday = /s[aá]b/.test(normalized);
  const days = hasSaturday ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];

  return { startHour, endHour, days };
}
