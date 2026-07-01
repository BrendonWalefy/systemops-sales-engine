// Conversão pura entre minutos (unidade de armazenamento em todo o backend/agenda)
// e horas+minutos (unidade mais natural para humanos digitarem/lerem).
// Nenhuma lógica de agendamento usa horas — isso é só apresentação/entrada de dado.

export function minutesToHm(totalMinutes: number): { hours: number; minutes: number } {
  const safe = Math.max(0, Math.round(totalMinutes || 0));
  return { hours: Math.floor(safe / 60), minutes: safe % 60 };
}

export function hmToMinutes(hours: number, minutes: number): number {
  const h = Math.max(0, Math.round(hours || 0));
  const m = Math.max(0, Math.round(minutes || 0));
  return h * 60 + m;
}

// Formata minutos para leitura humana: "45 min", "1h", "1h30".
export function formatDurationLabel(totalMinutes: number): string {
  const { hours, minutes } = minutesToHm(totalMinutes);
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h${String(minutes).padStart(2, "0")}`;
}
