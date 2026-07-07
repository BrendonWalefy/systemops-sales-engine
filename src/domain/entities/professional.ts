// Janela de atendimento de um profissional num dia da semana específico.
// endHour/endMinute são exclusivos, espelhando ParsedBusinessHours (ClinicTimezone.ts).
export type WeekdayWindow = {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
};

// Grade semanal de um profissional. Chave = dia da semana (0=Dom..6=Sáb);
// dia ausente = o profissional não atende nesse dia.
// null no campo workSchedule do Professional = sem grade própria, segue o
// horário da clínica inteira (comportamento padrão, sem regressão).
export type ProfessionalWorkSchedule = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, WeekdayWindow>>;

export type Professional = {
  id: string;
  clinicId: string;
  name: string;
  specialty: string | null;
  color: string;
  workSchedule: ProfessionalWorkSchedule | null;
  googleCalendarId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const VALID_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

function isValidWindow(value: unknown): value is WeekdayWindow {
  if (!value || typeof value !== "object") return false;
  const { startHour, startMinute, endHour, endMinute } = value as Record<string, unknown>;
  const fields = { startHour, startMinute, endHour, endMinute };
  if (!Object.values(fields).every((n) => typeof n === "number" && Number.isInteger(n))) return false;
  if ((startHour as number) < 0 || (startHour as number) > 23) return false;
  if ((endHour as number) < 0 || (endHour as number) > 23) return false;
  if ((startMinute as number) < 0 || (startMinute as number) > 59) return false;
  if ((endMinute as number) < 0 || (endMinute as number) > 59) return false;
  const startTotal = (startHour as number) * 60 + (startMinute as number);
  const endTotal = (endHour as number) * 60 + (endMinute as number);
  return startTotal < endTotal;
}

// Valida um payload não-nulo de grade semanal vindo do cliente antes de persistir.
// null é sempre um valor válido separadamente (limpa a grade própria) — não é
// coberto aqui de propósito, para forçar quem chama a decidir esse caso primeiro.
export function isValidWorkSchedule(value: unknown): value is ProfessionalWorkSchedule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(([key, window]) => {
    const day = Number(key);
    return VALID_WEEKDAYS.includes(day as (typeof VALID_WEEKDAYS)[number]) && isValidWindow(window);
  });
}

const WEEKDAY_SHORT_PT = { 0: "Dom", 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb" } as const;
const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

function formatWindowTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function isWindowInvalid(w: WeekdayWindow): boolean {
  return w.startHour * 60 + w.startMinute >= w.endHour * 60 + w.endMinute;
}

// Resumo compacto da grade pra quem administra (ex: dono) enxergar a disponibilidade
// de um contratado sem precisar perguntar. Grade padrão (null) não gera texto — só
// o que foge do horário geral da clínica é sinalizado, único dono desta formatação
// (usada tanto em Configurações > Profissionais quanto na Agenda).
export function formatWorkScheduleSummary(schedule: ProfessionalWorkSchedule | null): string | null {
  if (!schedule) return null;
  const entries = WEEKDAY_DISPLAY_ORDER.filter((day) => schedule[day]).map((day) => {
    const w = schedule[day]!;
    return `${WEEKDAY_SHORT_PT[day]} ${formatWindowTime(w.startHour, w.startMinute)}–${formatWindowTime(w.endHour, w.endMinute)}`;
  });
  if (entries.length === 0) return "Sem dias de atendimento definidos";
  return entries.join(" · ");
}
