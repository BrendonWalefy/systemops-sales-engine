"use client";

import { CheckCircle2, Loader2, UserX } from "lucide-react";
import { useState } from "react";
import type { AppointmentEvent, Professional } from "./types";

const STATUS_COLORS: Record<string, string> = {
  scheduled: "#60a5fa",
  confirmed: "#00d4aa",
  completed: "#22c55e",
  cancelled: "#64748b",
  no_show: "#fb7185",
};

function formatLocalTime(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezone,
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
  onQuickAction: (
    event: AppointmentEvent,
    action: "complete" | "no_show",
  ) => Promise<void>;
  timezone?: string;
};

export function AgendaSidebar({
  events,
  professionals,
  selectedProfessionalId,
  onSelectProfessional,
  onEventClick,
  onQuickAction,
  timezone = "America/Sao_Paulo",
}: Props) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const now = new Date();
  async function handleQuickAction(
    event: AppointmentEvent,
    action: "complete" | "no_show",
  ) {
    const key = `${event.id}:${action}`;
    setLoadingAction(key);
    try {
      await onQuickAction(event, action);
    } finally {
      setLoadingAction(null);
    }
  }
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);

  const todayEvents = events
    .filter((e) => {
      if (e.status === "block" || e.status === "cancelled") return false;
      const d = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(e.startsAt));
      return d === todayStr;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
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

      {/* ── Consultas de Hoje ── */}
      {todayEvents.length > 0 && (
        <section className="agenda-sidebar-section">
          <h3 className="agenda-sidebar-heading">
            Hoje
            <span style={{ marginLeft: 6, background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent-strong)", borderRadius: 6, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>
              {todayEvents.length}
            </span>
          </h3>
          <ul className="agenda-sidebar-list">
            {todayEvents.map((event) => {
              const isPast = new Date(event.endsAt) < now;
              const canQuickAct =
                isPast &&
                (event.status === "scheduled" || event.status === "confirmed");
              return (
                <li
                  key={event.id}
                  className="agenda-sidebar-card"
                  onClick={() => onEventClick(event)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onEventClick(event)}
                  style={{ opacity: isPast ? 0.5 : 1 }}
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
                      {formatLocalTime(event.startsAt, timezone)}
                      {event.professionalName && ` · ${event.professionalName}`}
                    </span>
                    {canQuickAct && (
                      <div className="agenda-sidebar-card-actions">
                        <button
                          className="agenda-sidebar-quick-btn agenda-sidebar-quick-btn--complete"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleQuickAction(event, "complete");
                          }}
                          disabled={loadingAction !== null}
                        >
                          {loadingAction === `${event.id}:complete` ? (
                            <Loader2 size={12} className="spin" />
                          ) : (
                            <CheckCircle2 size={12} />
                          )}
                          Concluir
                        </button>
                        <button
                          className="agenda-sidebar-quick-btn agenda-sidebar-quick-btn--noshow"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleQuickAction(event, "no_show");
                          }}
                          disabled={loadingAction !== null}
                        >
                          {loadingAction === `${event.id}:no_show` ? (
                            <Loader2 size={12} className="spin" />
                          ) : (
                            <UserX size={12} />
                          )}
                          No-show
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
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
                    {formatLocalTime(event.startsAt, timezone)}
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
