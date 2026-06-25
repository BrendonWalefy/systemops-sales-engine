"use client";

import { useState, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, Sparkles, Users } from "lucide-react";
import type { AppointmentEvent } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const HOUR_START     = 8;
const HOUR_END       = 19;
const HOUR_HEIGHT_PX = 52;
const TIME_AXIS_W    = 44;
const DAYS_TO_SHOW   = 5; // Mon → Fri

const CATEGORY_COLORS = {
  confirmed: "#00d4aa",
  pending:   "#f5b451",
  lead:      "#a855f7",
  return:    "#60a5fa",
} as const;

type Category       = keyof typeof CATEGORY_COLORS;
type CategoryFilter = "all" | Category | "ia";

const WEEKDAY_ABBR = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

const FILTER_CHIPS: { id: CategoryFilter; label: string; color?: string }[] = [
  { id: "confirmed", label: "Confirmados", color: CATEGORY_COLORS.confirmed },
  { id: "pending",   label: "Pendentes",   color: CATEGORY_COLORS.pending },
  { id: "lead",      label: "Leads",       color: CATEGORY_COLORS.lead },
  { id: "return",    label: "Retornos",    color: CATEGORY_COLORS.return },
  { id: "ia",        label: "IA Sugestão" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function getMonday(d: Date): Date {
  const day  = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon  = new Date(d);
  mon.setDate(d.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(d.getDate() + n);
  return r;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function eventDateStr(event: AppointmentEvent, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(event.startsAt));
  } catch { return event.startsAt.slice(0, 10); }
}

function formatHourMin(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(iso));
  } catch { return iso.slice(11, 16); }
}

function getCategory(event: AppointmentEvent): Category {
  if (event.status === "confirmed" || event.status === "completed") return "confirmed";
  const t = (event.leadTreatmentInterest ?? "").toLowerCase();
  if (t.includes("retorno")) return "return";
  if ((event.leadName ?? "").toLowerCase().includes("lead")) return "lead";
  return "pending";
}

function eventPosition(
  event: AppointmentEvent,
  tz: string,
): { top: number; height: number } | null {
  try {
    const [sh, sm] = formatHourMin(event.startsAt, tz).split(":").map(Number);
    const [eh, em] = formatHourMin(event.endsAt,   tz).split(":").map(Number);
    const startMins  = sh * 60 + sm;
    const endMins    = eh * 60 + em;
    const startOffset = startMins - HOUR_START * 60;
    const durationMin = Math.max(endMins - startMins, 30); // min 30min for legibility
    if (startOffset < 0 || sh >= HOUR_END) return null;
    return {
      top:    (startOffset / 60) * HOUR_HEIGHT_PX,
      height: Math.max((durationMin / 60) * HOUR_HEIGHT_PX - 2, 28),
    };
  } catch { return null; }
}

// ── Component ──────────────────────────────────────────────────────────────────

type Props = {
  events:        AppointmentEvent[];
  timezone?:     string;
  onEventClick:  (event: AppointmentEvent) => void;
  onSlotClick:   (date: string, time: string) => void;
};

export function MobileWeekView({
  events,
  timezone = "America/Sao_Paulo",
  onEventClick,
  onSlotClick,
}: Props) {
  const today = useMemo(() => toDateStr(new Date()), []);

  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [filter, setFilter]       = useState<CategoryFilter>("all");

  // Mon → Fri
  const weekDays = useMemo(
    () => Array.from({ length: DAYS_TO_SHOW }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const weekLabel = useMemo(() => {
    const first = weekDays[0];
    const last  = weekDays[weekDays.length - 1];
    const sameMonth = first.getMonth() === last.getMonth();
    const monthFmt  = (d: Date) =>
      new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(d);
    if (sameMonth) {
      return `${first.getDate()} – ${last.getDate()} de ${monthFmt(first)} de ${first.getFullYear()}`;
    }
    return `${first.getDate()} de ${monthFmt(first)} – ${last.getDate()} de ${monthFmt(last)} de ${last.getFullYear()}`;
  }, [weekDays]);

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

  const filterEvent = useCallback(
    (e: AppointmentEvent): boolean => {
      if (filter === "all" || filter === "ia") return true;
      return getCategory(e) === filter;
    },
    [filter],
  );

  const unconfirmedToday = useMemo(() => {
    const todayEvs = eventsByDate.get(today) ?? [];
    return todayEvs.filter((e) => e.status === "scheduled").length;
  }, [eventsByDate, today]);

  const totalHeight = (HOUR_END - HOUR_START) * HOUR_HEIGHT_PX;
  const hours = Array.from(
    { length: HOUR_END - HOUR_START + 1 },
    (_, i) => HOUR_START + i,
  );

  return (
    <div className="mwv-wrapper">

      {/* ── Range nav ── */}
      <div className="mwv-range-nav">
        <button
          className="mmv-nav-btn"
          onClick={() => setWeekStart((w) => addDays(w, -7))}
          aria-label="Semana anterior"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="mwv-range-label">{weekLabel}</span>
        <button
          className="mmv-nav-btn"
          onClick={() => setWeekStart((w) => addDays(w, 7))}
          aria-label="Próxima semana"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* ── Filter chips ── */}
      <div className="mmv-filter-chips">
        {FILTER_CHIPS.map((chip) => (
          <button
            key={chip.id}
            className={`mmv-chip${filter === chip.id ? " mmv-chip--active" : ""}`}
            onClick={() => setFilter(filter === chip.id ? "all" : chip.id)}
          >
            {chip.id === "ia"
              ? <Sparkles size={10} />
              : chip.color && <span className="mmv-chip-dot" style={{ background: chip.color }} />
            }
            {chip.label}
          </button>
        ))}
      </div>

      {/* ── Grid container ── */}
      <div className="mwv-grid-container">

        {/* Day column headers */}
        <div className="mwv-col-headers">
          <div className="mwv-axis-spacer" style={{ width: TIME_AXIS_W }} />
          {weekDays.map((day, i) => {
            const ds      = toDateStr(day);
            const isToday = ds === today;
            return (
              <div
                key={ds}
                className={`mwv-col-header${isToday ? " mwv-col-header--today" : ""}`}
              >
                <span className="mwv-col-day-name">{WEEKDAY_ABBR[i]}</span>
                <span className={`mwv-col-day-num${isToday ? " mwv-col-day-num--today" : ""}`}>
                  {day.getDate()}
                </span>
              </div>
            );
          })}
        </div>

        {/* Scrollable time body */}
        <div className="mwv-body-scroll">
          {/* Time axis */}
          <div className="mwv-time-axis" style={{ width: TIME_AXIS_W, minHeight: totalHeight }}>
            {hours.map((h) => (
              <div
                key={h}
                className="mwv-hour-label"
                style={{ top: (h - HOUR_START) * HOUR_HEIGHT_PX }}
              >
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Columns area */}
          <div className="mwv-cols" style={{ height: totalHeight }}>
            {/* Horizontal hour lines */}
            {hours.map((h) => (
              <div
                key={h}
                className="mwv-hour-line"
                style={{ top: (h - HOUR_START) * HOUR_HEIGHT_PX }}
              />
            ))}

            {/* Per-day columns */}
            {weekDays.map((day, colIdx) => {
              const ds     = toDateStr(day);
              const colEvs = (eventsByDate.get(ds) ?? []).filter(filterEvent);

              return (
                <div
                  key={ds}
                  className="mwv-col"
                  style={{
                    left:  `calc(${colIdx} * (100% / ${DAYS_TO_SHOW}))`,
                    width: `calc(100% / ${DAYS_TO_SHOW})`,
                  }}
                  onClick={() => onSlotClick(ds, "09:00")}
                >
                  {/* Column separator */}
                  <div className="mwv-col-sep" />

                  {colEvs.map((event) => {
                    const pos = eventPosition(event, timezone);
                    if (!pos) return null;
                    const cat   = getCategory(event);
                    const color = CATEGORY_COLORS[cat];
                    const startLabel = formatHourMin(event.startsAt, timezone);

                    return (
                      <div
                        key={event.id}
                        className="mwv-event"
                        style={{
                          top:             pos.top,
                          height:          pos.height,
                          background:      `${color}1e`,
                          borderLeftColor: color,
                        }}
                        onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                      >
                        <span className="mwv-event-time">{startLabel}</span>
                        <span className="mwv-event-name">{event.leadName ?? "Paciente"}</span>
                        {pos.height >= 52 && event.leadTreatmentInterest && (
                          <span className="mwv-event-type">
                            <span className="mwv-event-dot" style={{ background: color }} />
                            {event.leadTreatmentInterest}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Unconfirmed patients alert ── */}
      {unconfirmedToday > 0 && (
        <div className="mwv-alert">
          <Users size={15} className="mwv-alert-icon" />
          <div className="mwv-alert-body">
            <span className="mwv-alert-title">
              {unconfirmedToday} {unconfirmedToday === 1 ? "paciente ainda não confirmou" : "pacientes ainda não confirmaram"}
            </span>
            <span className="mwv-alert-sub">
              Toque para enviar lembretes ou confirmar.
            </span>
          </div>
          <button className="mwv-alert-cta">Ver detalhes</button>
        </div>
      )}
    </div>
  );
}
