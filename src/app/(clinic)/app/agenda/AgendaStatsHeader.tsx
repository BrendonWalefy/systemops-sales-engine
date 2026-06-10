"use client";

import type { AppointmentEvent } from "./types";

const CALENDAR_TIMEZONE = "America/Sao_Paulo";

function getTodayInTZ(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CALENDAR_TIMEZONE }).format(new Date());
}

function getDateInTZ(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: CALENDAR_TIMEZONE }).format(
      new Date(iso),
    );
  } catch {
    return iso.slice(0, 10);
  }
}

type Props = {
  events: AppointmentEvent[];
};

export function AgendaStatsHeader({ events }: Props) {
  const today = getTodayInTZ();
  const todayAppointments = events.filter(
    (e) => e.status !== "block" && getDateInTZ(e.startsAt) === today,
  );
  const confirmed = todayAppointments.filter(
    (e) => e.status === "confirmed" || e.status === "completed",
  ).length;
  const atRisk = todayAppointments.filter(
    (e) => e.status === "cancelled" || e.status === "no_show",
  ).length;

  return (
    <div className="agenda-stats-header">
      <span className="agenda-stats-period-label">Hoje</span>
      <div className="agenda-stat-divider" aria-hidden />
      <div className="agenda-stat">
        <span className="agenda-stat-value">{todayAppointments.length}</span>
        <span className="agenda-stat-label">Agendamentos</span>
      </div>
      <div className="agenda-stat-divider" aria-hidden />
      <div className="agenda-stat">
        <span className="agenda-stat-value agenda-stat--accent">{confirmed}</span>
        <span className="agenda-stat-label">Confirmados</span>
      </div>
      {atRisk > 0 && (
        <>
          <div className="agenda-stat-divider" aria-hidden />
          <div className="agenda-stat">
            <span className="agenda-stat-value agenda-stat--danger">{atRisk}</span>
            <span className="agenda-stat-label">Cancelados</span>
          </div>
        </>
      )}
    </div>
  );
}
