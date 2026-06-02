"use client";

import { useState, useCallback, useEffect } from "react";
import { Ban, CalendarDays, ChevronLeft, ChevronRight, Plus, Users } from "lucide-react";
import { CalendarView } from "./CalendarView";
import { ResourceDayView } from "./ResourceDayView";
import { AppointmentModal } from "./AppointmentModal";
import { BlockModal } from "./BlockModal";
import { AppointmentDrawer } from "./AppointmentDrawer";
import type { AppointmentEvent, Professional } from "./types";

type View = "schedule" | "resource";

type Props = {
  professionals: Professional[];
  initialFrom: string;
  initialTo: string;
};

function formatResourceDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

export function AgendaClient({ professionals, initialFrom, initialTo }: Props) {
  const [events, setEvents] = useState<AppointmentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("schedule");
  const [resourceDate, setResourceDate] = useState(() => new Date());

  const [appointmentModal, setAppointmentModal] = useState<{
    open: boolean;
    date?: string;
    time?: string;
    professionalId?: string;
  }>({ open: false });

  const [blockModal, setBlockModal] = useState<{
    open: boolean;
    date?: string;
    time?: string;
  }>({ open: false });

  const [drawer, setDrawer] = useState<{ open: boolean; event?: AppointmentEvent }>({
    open: false,
  });

  const [range, setRange] = useState({ from: initialFrom, to: initialTo });

  const fetchEvents = useCallback(async (from: string, to: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/appointments?from=${from}&to=${to}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(
          (data.appointments ?? []).map((a: Record<string, unknown>) => ({
            ...a,
            startsAt:
              typeof a.startsAt === "string"
                ? a.startsAt
                : new Date(a.startsAt as string).toISOString(),
            endsAt:
              typeof a.endsAt === "string"
                ? a.endsAt
                : new Date(a.endsAt as string).toISOString(),
          })),
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchEvents(range.from, range.to);
  }, [range, fetchEvents]);

  // When navigating resource view outside the loaded range, extend the fetch window
  useEffect(() => {
    const iso = resourceDate.toISOString();
    if (iso < range.from || iso > range.to) {
      const from = addDays(resourceDate, -14).toISOString();
      const to = addDays(resourceDate, 28).toISOString();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRange({ from, to });
    }
  }, [resourceDate]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleEventUpdate(id: string, startsAt: string, endsAt: string) {
    const [date, time] = startsAt.split(" ");
    const startDate = new Date(startsAt.replace(" ", "T") + "Z");
    const endDate = new Date(endsAt.replace(" ", "T") + "Z");
    const durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60_000);

    await fetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, time: time.slice(0, 5), durationMinutes }),
    });
    fetchEvents(range.from, range.to);
  }

  const refresh = () => fetchEvents(range.from, range.to);
  const hasProfs = professionals.length > 0;

  return (
    <div className="agenda-v2">
      {/* ── Toolbar ── */}
      <div className="agenda-v2-header">
        {/* Left: title or date navigation */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {view === "resource" ? (
            <div className="agenda-date-nav">
              <button
                className="agenda-nav-btn"
                onClick={() => setResourceDate((d) => addDays(d, -1))}
                aria-label="Dia anterior"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                className="agenda-today-btn"
                onClick={() => setResourceDate(new Date())}
              >
                Hoje
              </button>
              <h1>{formatResourceDate(resourceDate)}</h1>
              <button
                className="agenda-nav-btn"
                onClick={() => setResourceDate((d) => addDays(d, 1))}
                aria-label="Próximo dia"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          ) : (
            <div>
              <p className="eyebrow">Agenda</p>
              <h1>Agenda da clínica</h1>
            </div>
          )}

          {/* View switcher — only when professionals exist */}
          {hasProfs && (
            <div className="agenda-view-tabs">
              <button
                className={`agenda-view-tab${view === "schedule" ? " active" : ""}`}
                onClick={() => setView("schedule")}
              >
                <CalendarDays size={12} />
                Semana
              </button>
              <button
                className={`agenda-view-tab${view === "resource" ? " active" : ""}`}
                onClick={() => setView("resource")}
              >
                <Users size={12} />
                Por profissional
              </button>
            </div>
          )}
        </div>

        {/* Right: actions */}
        <div className="agenda-v2-actions">
          <button
            className="btn-secondary btn-sm"
            onClick={() => setBlockModal({ open: true })}
          >
            <Ban size={14} />
            Bloquear horário
          </button>
          <button
            className="btn-primary btn-sm"
            onClick={() => setAppointmentModal({ open: true })}
          >
            <Plus size={14} />
            Novo agendamento
          </button>
        </div>
      </div>

      {/* ── Calendar area ── */}
      <div className="agenda-v2-calendar">
        {loading && events.length === 0 ? (
          <div className="calendar-loading">Carregando agenda...</div>
        ) : view === "schedule" ? (
          <CalendarView
            initialEvents={events}
            onSlotClick={(date, time) => setAppointmentModal({ open: true, date, time })}
            onEventClick={(event) => setDrawer({ open: true, event })}
            onEventUpdate={handleEventUpdate}
          />
        ) : (
          <ResourceDayView
            professionals={professionals}
            events={events}
            selectedDate={resourceDate}
            onSlotClick={(date, time, professionalId) =>
              setAppointmentModal({ open: true, date, time, professionalId })
            }
            onEventClick={(event) => setDrawer({ open: true, event })}
          />
        )}
      </div>

      {/* ── Modals ── */}
      {appointmentModal.open && (
        <AppointmentModal
          defaultDate={appointmentModal.date}
          defaultTime={appointmentModal.time}
          defaultProfessionalId={appointmentModal.professionalId}
          professionals={professionals}
          onClose={() => setAppointmentModal({ open: false })}
          onCreated={refresh}
        />
      )}

      {blockModal.open && (
        <BlockModal
          defaultDate={blockModal.date}
          defaultTime={blockModal.time}
          onClose={() => setBlockModal({ open: false })}
          onCreated={refresh}
        />
      )}

      {drawer.open && drawer.event && (
        <AppointmentDrawer
          event={drawer.event}
          conversationId={drawer.event.conversationId ?? undefined}
          onClose={() => setDrawer({ open: false })}
          onUpdated={refresh}
        />
      )}
    </div>
  );
}
