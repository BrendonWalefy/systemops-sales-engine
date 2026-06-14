"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Ban,
  Calendar,
  CalendarDays,
  LayoutGrid,
  Plus,
  Users,
} from "lucide-react";
import { CalendarView } from "./CalendarView";
import { ResourceDayView } from "./ResourceDayView";
import { AppointmentModal } from "./AppointmentModal";
import { BlockModal } from "./BlockModal";
import { AppointmentDrawer } from "./AppointmentDrawer";
import { AgendaSidebar } from "./AgendaSidebar";
import { AgendaStatsHeader } from "./AgendaStatsHeader";
import type { AppointmentEvent, BlockEvent, Professional } from "./types";
import { createViewWeek, createViewDay, createViewMonthGrid } from "@schedule-x/calendar";

type ScheduleView = "week" | "day" | "month";
type View = ScheduleView | "resource";

const SX_VIEW_NAMES: Record<ScheduleView, string> = {
  week: createViewWeek().name,
  day: createViewDay().name,
  month: createViewMonthGrid().name,
};

type Props = {
  professionals: Professional[];
  initialFrom: string;
  initialTo: string;
  openNew?: boolean;
  timezone?: string;
};

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

function blockToEvent(block: BlockEvent): AppointmentEvent {
  return {
    id: block.calendarEventId,
    leadId: "",
    leadName: block.reason || "Horário bloqueado",
    leadPhone: null,
    professionalId: null,
    professionalName: null,
    professionalColor: null,
    calendarEventId: block.calendarEventId,
    calendarEventUrl: null,
    conversationId: null,
    startsAt: block.startsAt,
    endsAt: block.endsAt,
    status: "block",
    source: "app",
  };
}

export function AgendaClient({ professionals, initialFrom, initialTo, openNew, timezone = "America/Sao_Paulo" }: Props) {
  const [events, setEvents] = useState<AppointmentEvent[]>([]);
  const [blocks, setBlocks] = useState<BlockEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>(() =>
    typeof window !== "undefined" && window.innerWidth < 640 ? "day" : "week"
  );
  const [resourceDate, setResourceDate] = useState(() => new Date());

  const [appointmentModal, setAppointmentModal] = useState<{
    open: boolean;
    date?: string;
    time?: string;
    professionalId?: string;
  }>(() => ({ open: openNew === true }));

  const [blockModal, setBlockModal] = useState<{
    open: boolean;
    date?: string;
    time?: string;
  }>({ open: false });

  const [drawer, setDrawer] = useState<{ open: boolean; event?: AppointmentEvent }>({
    open: false,
  });

  const [range, setRange] = useState({ from: initialFrom, to: initialTo });
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string | null>(null);

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
    } catch (err) {
      console.error("[AgendaClient] fetchEvents error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBlocks = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar/blocks");
      if (res.ok) {
        const data = await res.json();
        setBlocks(data.blocks ?? []);
      }
    } catch (err) {
      console.error("[AgendaClient] fetchBlocks error:", err);
    }
  }, []);

  const refreshAll = useCallback(() => {
    fetchEvents(range.from, range.to);
    fetchBlocks();
  }, [fetchEvents, fetchBlocks, range]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchEvents(range.from, range.to);
    fetchBlocks();
  }, [range, fetchEvents, fetchBlocks]);

  useEffect(() => {
    const iso = resourceDate.toISOString();
    if (iso < range.from || iso > range.to) {
      const from = addDays(resourceDate, -14).toISOString();
      const to = addDays(resourceDate, 28).toISOString();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRange({ from, to });
    }
  }, [resourceDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling: agenda atualiza automaticamente quando IA agenda/cancela via WhatsApp
  useEffect(() => {
    const id = setInterval(() => refreshAll(), 30_000);
    return () => clearInterval(id);
  }, [refreshAll]);

  async function handleEventUpdate(id: string, startsAt: string, endsAt: string) {
    const [date, time] = startsAt.split(" ");
    const [, endTime] = endsAt.split(" ");

    // Compute duration from local time components — never add "Z" to a local time string
    const [sh, sm] = time.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    let durationMinutes = eh * 60 + em - (sh * 60 + sm);
    if (durationMinutes <= 0) durationMinutes += 24 * 60; // midnight-crossing edge case

    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, time: time.slice(0, 5), durationMinutes }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[AgendaClient] drag-drop update failed:", data.error);
      }
    } catch (err) {
      console.error("[AgendaClient] drag-drop update error:", err);
    } finally {
      fetchEvents(range.from, range.to);
    }
  }

  const hasProfs = professionals.length > 0;
  const isScheduleView = view !== "resource";

  // Merge appointment events + block events for the calendar views
  const allCalendarEvents: AppointmentEvent[] = [
    ...events,
    ...blocks.map(blockToEvent),
  ];

  // Calendar grid shows only the selected professional's events (blocks always visible)
  const filteredCalendarEvents = selectedProfessionalId
    ? allCalendarEvents.filter(
        (e) => e.status === "block" || e.professionalId === selectedProfessionalId,
      )
    : allCalendarEvents;

  return (
    <div className="agenda-v2">
      {/* ── Toolbar ── */}
      <div className="agenda-v2-header">
        {/* Row 1: title/date-nav + actions */}
        <div className="agenda-v2-header-top">
          <div className="agenda-v2-title-area">
            <div>
              <p className="eyebrow">Agenda</p>
              <h1>Agenda da clínica</h1>
            </div>
          </div>

          <div className="agenda-v2-actions">
            <button
              className="btn-secondary btn-sm"
              onClick={() => setBlockModal({ open: true })}
              aria-label="Bloquear horário"
            >
              <Ban size={14} />
              <span className="agenda-btn-label">Bloquear horário</span>
            </button>
            <button
              className="btn-primary btn-sm"
              onClick={() => setAppointmentModal({ open: true })}
            >
              <Plus size={14} />
              <span className="agenda-btn-label">Novo agendamento</span>
            </button>
          </div>
        </div>

        {/* Row 2: view tabs */}
        <div className="agenda-view-tabs">
          <button
            className={`agenda-view-tab${view === "day" ? " active" : ""}`}
            onClick={() => setView("day")}
          >
            <Calendar size={12} />
            Dia
          </button>
          <button
            className={`agenda-view-tab agenda-tab--week${view === "week" ? " active" : ""}`}
            onClick={() => setView("week")}
          >
            <CalendarDays size={12} />
            Semana
          </button>
          <button
            className={`agenda-view-tab${view === "month" ? " active" : ""}`}
            onClick={() => setView("month")}
          >
            <LayoutGrid size={12} />
            Mês
          </button>
          {hasProfs && (
            <button
              className={`agenda-view-tab${view === "resource" ? " active" : ""}`}
              onClick={() => setView("resource")}
            >
              <Users size={12} />
              <span className="tab-label-full">Profissionais</span>
              <span className="tab-label-short">Profis.</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Stats header (desktop only) ── */}
      <AgendaStatsHeader events={events} />

      {/* ── Mobile filter bar ── */}
      {hasProfs && (
        <div className="agenda-filter-bar-mobile">
          <button
            className={`agenda-filter-chip${!selectedProfessionalId ? " active" : ""}`}
            onClick={() => setSelectedProfessionalId(null)}
          >
            Todos
          </button>
          {professionals.map((p) => (
            <button
              key={p.id}
              className={`agenda-filter-chip${selectedProfessionalId === p.id ? " active" : ""}`}
              onClick={() =>
                setSelectedProfessionalId(selectedProfessionalId === p.id ? null : p.id)
              }
            >
              <span className="agenda-filter-chip-dot" style={{ background: p.color }} />
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Body: calendar + sidebar ── */}
      <div className="agenda-v2-body">
        <div className="agenda-v2-calendar">
          {loading && events.length === 0 ? (
            <div className="calendar-loading">Carregando agenda...</div>
          ) : isScheduleView ? (
            <CalendarView
              currentView={SX_VIEW_NAMES[view as ScheduleView]}
              initialEvents={filteredCalendarEvents}
              timezone={timezone}
              onSlotClick={(date, time) => setAppointmentModal({ open: true, date, time })}
              onEventClick={(event) => setDrawer({ open: true, event })}
              onEventUpdate={handleEventUpdate}
            />
          ) : (
            <ResourceDayView
              professionals={
                selectedProfessionalId
                  ? professionals.filter((p) => p.id === selectedProfessionalId)
                  : professionals
              }
              events={
                selectedProfessionalId
                  ? events.filter((e) => e.professionalId === selectedProfessionalId)
                  : events
              }
              selectedDate={resourceDate}
              onPrevDay={() => setResourceDate((d) => addDays(d, -1))}
              onNextDay={() => setResourceDate((d) => addDays(d, 1))}
              onToday={() => setResourceDate(new Date())}
              onSlotClick={(date, time, professionalId) =>
                setAppointmentModal({ open: true, date, time, professionalId })
              }
              onEventClick={(event) => setDrawer({ open: true, event })}
            />
          )}
        </div>

        <AgendaSidebar
          events={events}
          professionals={professionals}
          selectedProfessionalId={selectedProfessionalId}
          onSelectProfessional={setSelectedProfessionalId}
          onEventClick={(event) => setDrawer({ open: true, event })}
          timezone={timezone}
        />
      </div>

      {/* ── Modals ── */}
      {appointmentModal.open && (
        <AppointmentModal
          defaultDate={appointmentModal.date}
          defaultTime={appointmentModal.time}
          defaultProfessionalId={appointmentModal.professionalId}
          professionals={professionals}
          onClose={() => setAppointmentModal({ open: false })}
          onCreated={refreshAll}
        />
      )}

      {blockModal.open && (
        <BlockModal
          defaultDate={blockModal.date}
          defaultTime={blockModal.time}
          onClose={() => setBlockModal({ open: false })}
          onCreated={refreshAll}
        />
      )}

      {drawer.open && drawer.event && (
        <AppointmentDrawer
          event={drawer.event}
          conversationId={drawer.event.conversationId ?? undefined}
          onClose={() => setDrawer({ open: false })}
          onUpdated={refreshAll}
        />
      )}
    </div>
  );
}
