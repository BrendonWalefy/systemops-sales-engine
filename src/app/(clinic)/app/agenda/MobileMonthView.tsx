"use client";

import { useState, useMemo, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Phone,
  Plus,
  CalendarDays,
  Home,
} from "lucide-react";
import type { AppointmentEvent } from "./types";

const CATEGORY_COLORS = {
  confirmed: "#00d4aa",
  pending:   "#f5b451",
  lead:      "#a855f7",
  return:    "#60a5fa",
} as const;

type Category = keyof typeof CATEGORY_COLORS;
type CategoryFilter = "all" | Category;

const CATEGORY_ORDER: Category[] = ["confirmed", "pending", "lead", "return"];

const FILTER_CHIPS: { id: CategoryFilter; label: string; color?: string }[] = [
  { id: "all",       label: "Todos" },
  { id: "confirmed", label: "Confirmados", color: CATEGORY_COLORS.confirmed },
  { id: "pending",   label: "Pendentes",   color: CATEGORY_COLORS.pending },
  { id: "lead",      label: "Leads",       color: CATEGORY_COLORS.lead },
  { id: "return",    label: "Retornos",    color: CATEGORY_COLORS.return },
];

const WEEKDAY_LABELS = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

function eventDateStr(event: AppointmentEvent, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(event.startsAt));
  } catch {
    return event.startsAt.slice(0, 10);
  }
}

function formatTime(event: AppointmentEvent, tz: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(event.startsAt));
  } catch {
    return event.startsAt.slice(11, 16);
  }
}

function getCategory(event: AppointmentEvent): Category {
  if (event.status === "confirmed" || event.status === "completed") return "confirmed";
  const t = (event.leadTreatmentInterest ?? "").toLowerCase();
  if (t.includes("retorno")) return "return";
  if ((event.leadName ?? "").toLowerCase().includes("lead")) return "lead";
  return "pending";
}

function getStatusBadge(event: AppointmentEvent): { label: string; cls: string } {
  const cat = getCategory(event);
  switch (cat) {
    case "confirmed": return { label: "Confirmado", cls: "mmv-badge--confirmed" };
    case "return":    return { label: "Retorno",    cls: "mmv-badge--return" };
    case "lead":      return { label: "Pendente",   cls: "mmv-badge--pending" };
    default:          return { label: "Pendente",   cls: "mmv-badge--pending" };
  }
}

function localTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Props = {
  events: AppointmentEvent[];
  timezone?: string;
  onEventClick: (event: AppointmentEvent) => void;
  onSlotClick: (date: string, time: string) => void;
  onNewAppointment: () => void;
};

export function MobileMonthView({
  events,
  timezone = "America/Sao_Paulo",
  onEventClick,
  onSlotClick: _onSlotClick,
  onNewAppointment,
}: Props) {
  const today = useMemo(() => localTodayStr(), []);

  const [year,  setYear]  = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState(today);
  const [filter, setFilter] = useState<CategoryFilter>("all");

  // ── month label ──────────────────────────────────────────────
  const monthLabel = useMemo(() => {
    const raw = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" })
      .format(new Date(year, month, 1));
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [year, month]);

  // ── month grid cells ─────────────────────────────────────────
  const gridCells = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);
    const startPad = (firstDay.getDay() + 6) % 7; // Mon-first
    const total    = lastDay.getDate();
    const cells: (number | null)[] = [
      ...Array<null>(startPad).fill(null),
      ...Array.from({ length: total }, (_, i) => i + 1),
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [year, month]);

  // ── events grouped by date ───────────────────────────────────
  const eventsByDate = useMemo(() => {
    const map = new Map<string, AppointmentEvent[]>();
    for (const e of events) {
      if (e.status === "block") continue;
      const ds = eventDateStr(e, timezone);
      if (!map.has(ds)) map.set(ds, []);
      map.get(ds)!.push(e);
    }
    return map;
  }, [events, timezone]);

  // ── navigation ───────────────────────────────────────────────
  const prevMonth = useCallback(() => {
    setMonth((m) => {
      if (m === 0) { setYear((y) => y - 1); return 11; }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setMonth((m) => {
      if (m === 11) { setYear((y) => y + 1); return 0; }
      return m + 1;
    });
  }, []);

  const goToToday = useCallback(() => {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth());
    setSelectedDate(today);
  }, [today]);

  // ── helpers ──────────────────────────────────────────────────
  const dayStr = useCallback(
    (day: number) =>
      `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    [year, month],
  );

  // ── selected day events ──────────────────────────────────────
  const selectedDayEvents = useMemo(() => {
    const evs = eventsByDate.get(selectedDate) ?? [];
    const filtered =
      filter === "all" ? evs : evs.filter((e) => getCategory(e) === filter);
    return [...filtered].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [eventsByDate, selectedDate, filter]);

  // ── today stats ──────────────────────────────────────────────
  const todayStats = useMemo(() => {
    const evs = eventsByDate.get(today) ?? [];
    return {
      total:   evs.length,
      pending: evs.filter((e) => e.status === "scheduled").length,
    };
  }, [eventsByDate, today]);

  // ── selected date label ──────────────────────────────────────
  const selectedDateLabel = useMemo(() => {
    try {
      const [y, m, d] = selectedDate.split("-").map(Number);
      return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" })
        .format(new Date(y, m - 1, d));
    } catch { return selectedDate; }
  }, [selectedDate]);

  // ── today formatted ──────────────────────────────────────────
  const todayFormatted = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("pt-BR").format(new Date());
    } catch { return today; }
  }, [today]);

  return (
    <div className="mmv-wrapper">

      {/* ── Stats bar ── */}
      <div className="mmv-stats-bar">
        <Home size={13} className="mmv-stats-home" />
        <span className="mmv-stats-text">
          Hoje:{" "}
          <strong className="mmv-stat--accent">{todayStats.total} atendimentos</strong>
          {todayStats.pending > 0 && (
            <>
              {" · "}
              <strong className="mmv-stat--warn">{todayStats.pending} pendências</strong>
            </>
          )}
        </span>
      </div>

      {/* ── Month navigation ── */}
      <div className="mmv-month-nav">
        <div className="mmv-month-nav-group">
          <button className="mmv-nav-btn" onClick={prevMonth} aria-label="Mês anterior">
            <ChevronLeft size={16} />
          </button>
          <span className="mmv-month-label">{monthLabel}</span>
          <button className="mmv-nav-btn" onClick={nextMonth} aria-label="Próximo mês">
            <ChevronRight size={16} />
          </button>
        </div>
        <button className="mmv-goto-today" onClick={goToToday}>
          <CalendarDays size={12} />
          {todayFormatted}
        </button>
      </div>

      {/* ── Filter chips ── */}
      <div className="mmv-filter-chips">
        {FILTER_CHIPS.map((chip) => (
          <button
            key={chip.id}
            className={`mmv-chip${filter === chip.id ? " mmv-chip--active" : ""}`}
            onClick={() => setFilter(chip.id)}
          >
            {chip.color && (
              <span className="mmv-chip-dot" style={{ background: chip.color }} />
            )}
            {chip.label}
          </button>
        ))}
      </div>

      {/* ── Month grid ── */}
      <div className="mmv-grid">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="mmv-grid-weekday">{label}</div>
        ))}

        {gridCells.map((day, i) => {
          if (!day) return <div key={`pad-${i}`} className="mmv-grid-cell mmv-grid-cell--pad" />;

          const ds         = dayStr(day);
          const isToday    = ds === today;
          const isSelected = ds === selectedDate;
          const dayEvs     = eventsByDate.get(ds) ?? [];
          const filtered   = filter === "all" ? dayEvs : dayEvs.filter((e) => getCategory(e) === filter);
          const count      = filtered.length;
          const dotCats    = CATEGORY_ORDER.filter((cat) => filtered.some((e) => getCategory(e) === cat));

          return (
            <button
              key={ds}
              className={[
                "mmv-grid-cell",
                isToday    ? "mmv-grid-cell--today"    : "",
                isSelected && !isToday ? "mmv-grid-cell--selected" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => setSelectedDate(ds)}
            >
              <span className="mmv-cell-day">{day}</span>
              {count > 0 && (
                <div className="mmv-cell-dots">
                  {dotCats.map((cat) => (
                    <span
                      key={cat}
                      className="mmv-dot"
                      style={{ background: CATEGORY_COLORS[cat] }}
                    />
                  ))}
                  <span className="mmv-cell-count">{count}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Day detail panel ── */}
      <div className="mmv-day-panel">
        <div className="mmv-day-panel-drag" />

        <div className="mmv-day-panel-header">
          <span className="mmv-day-panel-title">{selectedDateLabel}</span>
          {selectedDayEvents.length > 0 && (
            <span className="mmv-day-panel-count">
              {selectedDayEvents.length} agendamentos
            </span>
          )}
        </div>

        <div className="mmv-day-panel-list">
          {selectedDayEvents.length === 0 ? (
            <div className="mmv-day-empty">
              <CalendarDays size={32} strokeWidth={1.2} />
              <span>Nenhum agendamento para este dia</span>
              <button className="mmv-day-empty-cta" onClick={onNewAppointment}>
                <Plus size={13} />
                Novo agendamento
              </button>
            </div>
          ) : (
            selectedDayEvents.map((event) => {
              const { label, cls } = getStatusBadge(event);
              const cat            = getCategory(event);
              const time           = formatTime(event, timezone);

              return (
                <div
                  key={event.id}
                  className="mmv-event-row"
                  style={{ "--event-border": CATEGORY_COLORS[cat] } as React.CSSProperties}
                  onClick={() => onEventClick(event)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onEventClick(event)}
                >
                  <div className="mmv-event-time">{time}</div>

                  <div className="mmv-event-avatar" aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="8" r="4.5" fill="currentColor" opacity="0.5" />
                      <path
                        d="M3 20c0-5 4-9 9-9s9 4 9 9"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        fill="none"
                        strokeLinecap="round"
                        opacity="0.5"
                      />
                    </svg>
                  </div>

                  <div className="mmv-event-body">
                    <span className="mmv-event-name">{event.leadName ?? "Paciente"}</span>
                    {event.leadTreatmentInterest && (
                      <span className="mmv-event-treatment">
                        {event.leadTreatmentInterest}
                      </span>
                    )}
                  </div>

                  <span className={`mmv-badge ${cls}`}>{label}</span>

                  <div
                    className="mmv-event-actions"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {event.conversationId && (
                      <button className="mmv-action-btn" aria-label="Abrir conversa">
                        <MessageCircle size={14} />
                      </button>
                    )}
                    {event.leadPhone && (
                      <a
                        className="mmv-action-btn"
                        href={`tel:${event.leadPhone}`}
                        aria-label="Ligar"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Phone size={14} />
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
