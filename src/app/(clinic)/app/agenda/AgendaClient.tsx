"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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
import { MobileMonthView } from "./MobileMonthView";
import { MobileWeekView } from "./MobileWeekView";
import { MobileDayView } from "./MobileDayView";
import { AppointmentModal } from "./AppointmentModal";
import { BlockModal } from "./BlockModal";
import { AppointmentDrawer } from "./AppointmentDrawer";
import { AgendaSidebar } from "./AgendaSidebar";
import { AgendaStatsHeader } from "./AgendaStatsHeader";
import {
  getCachedJson,
  hasFreshJsonCache,
  invalidateJsonCacheByPrefix,
} from "@/lib/client-json-cache";
import type { AppointmentEvent, BlockEvent, Professional } from "./types";
import { createViewWeek, createViewDay, createViewMonthGrid } from "@schedule-x/calendar";

type ScheduleView = "week" | "day" | "month";
type View = ScheduleView | "resource";

const SX_VIEW_NAMES: Record<ScheduleView, string> = {
  week: createViewWeek().name,
  day: createViewDay().name,
  month: createViewMonthGrid().name,
};

export type TreatmentOption = {
  id: string;
  name: string;
  priceCents: number | null;
};

type Props = {
  professionals: Professional[];
  treatments: TreatmentOption[];
  memberRole: string;
  serviceNoun: string;
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
    leadTreatmentInterest: null,
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

export function AgendaClient({ professionals, treatments, memberRole, serviceNoun, initialFrom, initialTo, openNew, timezone = "America/Sao_Paulo" }: Props) {
  const [events, setEvents] = useState<AppointmentEvent[]>([]);
  const [blocks, setBlocks] = useState<BlockEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("month");
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

  const [drawer, setDrawer] = useState<{
    open: boolean;
    event?: AppointmentEvent;
    initialCompletedModalOpen?: boolean;
  }>({
    open: false,
  });

  const [range, setRange] = useState({ from: initialFrom, to: initialTo });
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string | null>(null);

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 640px)").matches;
  });

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const fetchEvents = useCallback(async (
    from: string,
    to: string,
    options?: { force?: boolean },
  ) => {
    const query = `/api/appointments?from=${from}&to=${to}`;
    const shouldShowLoading = options?.force || !hasFreshJsonCache(query);
    if (shouldShowLoading) {
      setLoading(true);
    }

    try {
      const data = await getCachedJson(
        query,
        async () => {
          const res = await fetch(query);
          if (!res.ok) {
            throw new Error(`Falha ao buscar agenda (${res.status})`);
          }
          return res.json();
        },
        { ttlMs: 20_000, force: options?.force },
      );

      setEvents(
        ((data as { appointments?: Record<string, unknown>[] }).appointments ?? []).map(
          (a) =>
            ({
              ...(a as AppointmentEvent),
              startsAt:
                typeof a.startsAt === "string"
                  ? a.startsAt
                  : new Date(a.startsAt as string).toISOString(),
              endsAt:
                typeof a.endsAt === "string"
                  ? a.endsAt
                  : new Date(a.endsAt as string).toISOString(),
            }) satisfies AppointmentEvent,
        ),
      );
    } catch (err) {
      console.error("[AgendaClient] fetchEvents error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBlocks = useCallback(async (options?: { force?: boolean }) => {
    const query = "/api/calendar/blocks";
    try {
      const data = await getCachedJson(
        query,
        async () => {
          const res = await fetch(query);
          if (!res.ok) {
            throw new Error(`Falha ao buscar bloqueios (${res.status})`);
          }
          return res.json();
        },
        { ttlMs: 30_000, force: options?.force },
      );

      setBlocks((data as { blocks?: BlockEvent[] }).blocks ?? []);
    } catch (err) {
      console.error("[AgendaClient] fetchBlocks error:", err);
    }
  }, []);

  const refreshAll = useCallback(() => {
    invalidateJsonCacheByPrefix("/api/appointments?");
    invalidateJsonCacheByPrefix("/api/calendar/blocks");
    fetchEvents(range.from, range.to, { force: true });
    fetchBlocks({ force: true });
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

  const agendaVersionRef = useRef<string | null>(null);

  useEffect(() => {
    agendaVersionRef.current = null;
  }, [range]);

  useEffect(() => {
    const check = async () => {
      if (document.hidden) return;
      try {
        const query = `/api/agenda/check?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
        const res = await fetch(query, { cache: "no-store" });
        if (!res.ok) return;
        const data: { version?: string } = await res.json();
        if (!data.version) return;
        if (agendaVersionRef.current === null) {
          agendaVersionRef.current = data.version;
          return;
        }
        if (data.version !== agendaVersionRef.current) {
          agendaVersionRef.current = data.version;
          fetchEvents(range.from, range.to, { force: true });
        }
      } catch {
        // Ignora falhas transitórias e tenta novamente no próximo ciclo.
      }
    };

    void check();
    const id = setInterval(() => {
      void check();
    }, 10_000);
    return () => clearInterval(id);
  }, [range, fetchEvents]);

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
      invalidateJsonCacheByPrefix("/api/appointments?");
      fetchEvents(range.from, range.to, { force: true });
    }
  }

  function openDrawer(event: AppointmentEvent, options?: { initialCompletedModalOpen?: boolean }) {
    setDrawer({
      open: true,
      event,
      initialCompletedModalOpen: options?.initialCompletedModalOpen ?? false,
    });
  }

  async function handleSidebarQuickAction(
    event: AppointmentEvent,
    action: "complete" | "no_show",
  ): Promise<void> {
    if (action === "complete") {
      openDrawer(event, { initialCompletedModalOpen: true });
      return;
    }

    const res = await fetch(`/api/appointments/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "no_show" }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Erro ao marcar no-show");
    }

    refreshAll();
  }

  async function handleQuickConfirm(event: AppointmentEvent): Promise<void> {
    const res = await fetch(`/api/appointments/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "confirmed" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? "Erro ao confirmar");
    }
    refreshAll();
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
            <span className="tab-label-full">Dia</span>
            <span className="tab-label-short">Hoje</span>
          </button>
          <button
            className={`agenda-view-tab${view === "week" ? " active" : ""}`}
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
              className={`agenda-view-tab agenda-tab--resource${view === "resource" ? " active" : ""}`}
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
          ) : view === "month" && isMobile ? (
            <MobileMonthView
              events={events}
              timezone={timezone}
              onEventClick={(event) => openDrawer(event)}
              onSlotClick={(date, time) => setAppointmentModal({ open: true, date, time })}
              onNewAppointment={() => setAppointmentModal({ open: true })}
            />
          ) : view === "week" && isMobile ? (
            <MobileWeekView
              events={events}
              timezone={timezone}
              onEventClick={(event) => openDrawer(event)}
              onSlotClick={(date, time) => setAppointmentModal({ open: true, date, time })}
            />
          ) : view === "day" && isMobile ? (
            <MobileDayView
              events={events}
              timezone={timezone}
              onEventClick={(event) => openDrawer(event)}
              onQuickConfirm={handleQuickConfirm}
              onNewAppointment={() => setAppointmentModal({ open: true })}
            />
          ) : isScheduleView ? (
            <CalendarView
              currentView={SX_VIEW_NAMES[view as ScheduleView]}
              initialEvents={filteredCalendarEvents}
              timezone={timezone}
              onSlotClick={(date, time) => setAppointmentModal({ open: true, date, time })}
              onEventClick={(event) => openDrawer(event)}
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
              onEventClick={(event) => openDrawer(event)}
            />
          )}
        </div>

        <AgendaSidebar
          events={events}
          professionals={professionals}
          selectedProfessionalId={selectedProfessionalId}
          onSelectProfessional={setSelectedProfessionalId}
          onEventClick={(event) => openDrawer(event)}
          onQuickAction={handleSidebarQuickAction}
          timezone={timezone}
        />
      </div>

      {/* ── FAB mobile: novo agendamento ── */}
      <button
        className="agenda-fab"
        onClick={() => setAppointmentModal({ open: true })}
        aria-label="Novo agendamento"
      >
        <Plus size={24} />
      </button>

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
          key={`${drawer.event.id}:${drawer.initialCompletedModalOpen ? "complete" : "view"}`}
          event={drawer.event}
          conversationId={drawer.event.conversationId ?? undefined}
          treatments={treatments}
          memberRole={memberRole}
          serviceNoun={serviceNoun}
          initialCompletedModalOpen={drawer.initialCompletedModalOpen}
          onClose={() => setDrawer({ open: false, event: undefined, initialCompletedModalOpen: false })}
          onUpdated={refreshAll}
        />
      )}
    </div>
  );
}
