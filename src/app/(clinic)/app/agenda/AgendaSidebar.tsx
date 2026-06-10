"use client";

import type { AppointmentEvent, Professional } from "./types";

const CALENDAR_TIMEZONE = "America/Sao_Paulo";

const STATUS_COLORS: Record<string, string> = {
  scheduled: "#60a5fa",
  confirmed: "#00d4aa",
  completed: "#22c55e",
  cancelled: "#64748b",
  no_show: "#fb7185",
};

function formatLocalTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: CALENDAR_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

type Props = {
  events: AppointmentEvent[];
  professionals: Professional[];
  selectedProfessionalId: string | null;
  onSelectProfessional: (id: string | null) => void;
  onEventClick: (event: AppointmentEvent) => void;
};

export function AgendaSidebar({
  events,
  professionals,
  selectedProfessionalId,
  onSelectProfessional,
  onEventClick,
}: Props) {
  const now = new Date();

  const upcoming = events
    .filter(
      (e) =>
        e.status !== "block" &&
        e.status !== "cancelled" &&
        e.status !== "no_show" &&
        new Date(e.endsAt) >= now,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 6);

  const profCounts = professionals.map((p) => ({
    ...p,
    count: events.filter((e) => e.professionalId === p.id && e.status !== "block").length,
  }));

  return (
    <aside className="agenda-sidebar">
      {/* ── Filtros rápidos ── */}
      {professionals.length > 0 && (
        <section className="agenda-sidebar-section">
          <h3 className="agenda-sidebar-heading">Filtros rápidos</h3>
          <div className="agenda-filter-chips">
            <button
              className={`agenda-filter-chip${!selectedProfessionalId ? " active" : ""}`}
              onClick={() => onSelectProfessional(null)}
            >
              Todos
            </button>
            {profCounts.map((p) => (
              <button
                key={p.id}
                className={`agenda-filter-chip${selectedProfessionalId === p.id ? " active" : ""}`}
                onClick={() =>
                  onSelectProfessional(selectedProfessionalId === p.id ? null : p.id)
                }
              >
                <span
                  className="agenda-filter-chip-dot"
                  style={{ background: p.color }}
                />
                {p.name}
                {p.count > 0 && (
                  <span className="agenda-filter-chip-count">{p.count}</span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Próximos agendamentos ── */}
      <section className="agenda-sidebar-section">
        <h3 className="agenda-sidebar-heading">Próximos</h3>
        {upcoming.length === 0 ? (
          <p className="agenda-sidebar-empty">Nenhum agendamento próximo</p>
        ) : (
          <ul className="agenda-sidebar-list">
            {upcoming.map((event) => (
              <li
                key={event.id}
                className="agenda-sidebar-card"
                onClick={() => onEventClick(event)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onEventClick(event)}
              >
                <span
                  className="agenda-sidebar-status-dot"
                  style={{ background: STATUS_COLORS[event.status] ?? "#64748b" }}
                />
                <div className="agenda-sidebar-card-body">
                  <span className="agenda-sidebar-card-name">
                    {event.leadName ?? event.leadPhone ?? "Paciente"}
                  </span>
                  <span className="agenda-sidebar-card-meta">
                    {formatLocalTime(event.startsAt)}
                    {event.professionalName && ` · ${event.professionalName}`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Profissionais ── */}
      {profCounts.length > 0 && (
        <section className="agenda-sidebar-section">
          <h3 className="agenda-sidebar-heading">Profissionais</h3>
          <ul className="agenda-sidebar-prof-list">
            {profCounts.map((p) => (
              <li key={p.id} className="agenda-sidebar-prof-item">
                <span
                  className="agenda-sidebar-prof-dot"
                  style={{ background: p.color }}
                />
                <span className="agenda-sidebar-prof-name">{p.name}</span>
                <span className="agenda-sidebar-prof-count">{p.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
