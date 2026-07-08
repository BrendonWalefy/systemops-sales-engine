export interface CalendarEvent {
  uid: string;
  summary: string;
  description: string;
  startTime: Date;
  endTime: Date;
}

export interface ParseIcsResult {
  success: boolean;
  events: CalendarEvent[];
  errors: string[];
}

export function parseIcs(content: string): ParseIcsResult {
  const events: CalendarEvent[] = [];
  const errors: string[] = [];

  try {
    const lines = content.split("\n").map((l) => l.trim());

    if (!lines[0].includes("BEGIN:VCALENDAR")) {
      return {
        success: false,
        events: [],
        errors: ["Arquivo não é um iCalendar válido (BEGIN:VCALENDAR não encontrado)"],
      };
    }

    let currentEvent: Partial<CalendarEvent> | null = null;
    let eventIndex = 0;

    for (const line of lines) {
      if (line === "BEGIN:VEVENT") {
        currentEvent = {};
        eventIndex++;
      } else if (line === "END:VEVENT") {
        if (currentEvent) {
          if (currentEvent.uid && currentEvent.summary && currentEvent.startTime && currentEvent.endTime) {
            events.push(currentEvent as CalendarEvent);
          } else {
            const missing = [];
            if (!currentEvent.uid) missing.push("UID");
            if (!currentEvent.summary) missing.push("SUMMARY");
            if (!currentEvent.startTime) missing.push("DTSTART");
            if (!currentEvent.endTime) missing.push("DTEND");
            errors.push(`Evento ${eventIndex}: campos obrigatórios faltando: ${missing.join(", ")}`);
          }
        }
        currentEvent = null;
      } else if (currentEvent && line) {
        const [key, ...valueParts] = line.split(":");
        const value = valueParts.join(":");

        if (key === "UID") {
          currentEvent.uid = value;
        } else if (key === "SUMMARY") {
          currentEvent.summary = value;
        } else if (key === "DESCRIPTION") {
          currentEvent.description = value;
        } else if (key.startsWith("DTSTART")) {
          const parsed = parseIcsDateTime(value);
          if (parsed) {
            currentEvent.startTime = parsed;
          } else {
            errors.push(`Evento ${eventIndex}: DTSTART inválido: ${value}`);
          }
        } else if (key.startsWith("DTEND")) {
          const parsed = parseIcsDateTime(value);
          if (parsed) {
            currentEvent.endTime = parsed;
          } else {
            errors.push(`Evento ${eventIndex}: DTEND inválido: ${value}`);
          }
        }
      }
    }

    return {
      success: events.length > 0,
      events,
      errors,
    };
  } catch (error) {
    return {
      success: false,
      events: [],
      errors: [`Erro ao parsear ICS: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function parseIcsDateTime(dtString: string): Date | null {
  // Formatos esperados:
  // 20260708T150000 (sem timezone)
  // 20260708T150000Z (UTC)
  // 20260708 (apenas data)

  const dateMatch = dtString.match(/^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})(Z)?)?$/);

  if (!dateMatch) {
    return null;
  }

  const [, year, month, day, , hours, minutes, seconds] = dateMatch;

  const dateObj = new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    hours ? parseInt(hours, 10) : 0,
    minutes ? parseInt(minutes, 10) : 0,
    seconds ? parseInt(seconds, 10) : 0,
  );

  return dateObj;
}
