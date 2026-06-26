"use client";

import { useState, useMemo, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Phone,
  Check,
  MessageCircle,
  SlidersHorizontal,
  CheckCircle2,
  Clock,
  Users,
  Sparkles,
  Ban,
} from "lucide-react";
import type { AppointmentEvent } from "./types";

// ── Helpers ────────────────────────────────────────────────────────────────────

const CATEGORY_COLORS = {
  confirmed: "#00d4aa",
  pending:   "#f5b451",
  lead:      "#a855f7",
  return:    "#60a5fa",
} as const;

type Category = keyof typeof CATEGORY_COLORS;

function getCategory(event: AppointmentEvent): Category {
  if (event.status === "confirmed" || event.status === "completed") return "confirmed";
  const t = (event.leadTreatmentInterest ?? "").toLowerCase();
  if (t.includes("retorno")) return "return";
  if ((event.leadName ?? "").toLowerCase().includes("lead")) return "lead";
  return "pending";
}

function eventDateStr(event: AppointmentEvent, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(event.startsAt));
  } catch { return event.startsAt.slice(0, 10); }
}

function formatTime(event: AppointmentEvent, tz: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(event.startsAt));
  } catch { return event.startsAt.slice(11, 16); }
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftDate(ds: string, delta: number): string {
  const [y, m, d] = ds.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  return toDateStr(date);
}

function getStatusBadge(event: AppointmentEvent): { label: string; cls: string } {
  const cat = getCategory(event);
  switch (cat) {
    case "confirmed": return { label: "Confirmado", cls: "mmv-badge--confirmed" };
    case "return":    return { label: "Retorno",    cls: "mmv-badge--return" };
    default:          return { label: "Pendente",   cls: "mmv-badge--pending" };
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

type Props = {
  events:           AppointmentEvent[];
  timezone?:        string;
  onEventClick:     (event: AppointmentEvent) => void;
  onQuickConfirm:   (event: AppointmentEvent) => Promise<void>;
  onNewAppointment: () => void;
};

export function MobileDayView({
  events,
  timezone = "America/Sao_Paulo",
  onEventClick,
  onQuickConfirm,
  onNewAppointment,
}: Props) {
  const today = useMemo(() => toDateStr(new Date()), []);

  const [selectedDate, setSelectedDate] = useState(today);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // ── Group events by date (appointments and blocks separate) ──
  const { eventsByDate, blocksByDate } = useMemo(() => {
    const evMap = new Map<string, AppointmentEvent[]>();
    const blMap = new Map<string, AppointmentEvent[]>();
    for (const e of events) {
      const ds = eventDateStr(e, timezone);
      if (e.status === "block") {
        if (!blMap.has(ds)) blMap.set(ds, []);
        blMap.get(ds)!.push(e);
      } else {
        if (!evMap.has(ds)) evMap.set(ds, []);
        evMap.get(ds)!.push(e);
      }
    }
    return { eventsByDate: evMap, blocksByDate: blMap };
  }, [events, timezone]);

  // ── Day appointments only (for stats) ──
  const dayAppointments = useMemo(() => {
    const evs = eventsByDate.get(selectedDate) ?? [];
    return [...evs].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [eventsByDate, selectedDate]);

  // ── All day events sorted (appointments + blocks interleaved) ──
  const dayEvents = useMemo(() => {
    const blks = blocksByDate.get(selectedDate) ?? [];
    return [...dayAppointments, ...blks].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [dayAppointments, blocksByDate, selectedDate]);

  // ── Stats (appointments only, blocks excluded) ──
  const stats = useMemo(() => ({
    total:     dayAppointments.length,
    pending:   dayAppointments.filter((e) => e.status === "scheduled").length,
    completed: dayAppointments.filter((e) => e.status === "completed").length,
  }), [dayAppointments]);

  // ── Date labels ──
  const dateLabel = useMemo(() => {
    try {
      const [y, m, d] = selectedDate.split("-").map(Number);
      const dt      = new Date(y, m - 1, d);
      const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(dt);
      const day     = d;
      const month   = new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(dt);
      return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)}, ${day} de ${month}`;
    } catch { return selectedDate; }
  }, [selectedDate]);

  const dateFormatted = useMemo(() => {
    try {
      const [y, m, d] = selectedDate.split("-").map(Number);
      return new Intl.DateTimeFormat("pt-BR").format(new Date(y, m - 1, d));
    } catch { return selectedDate; }
  }, [selectedDate]);

  const isToday = selectedDate === today;
  const showIABanner = isToday && stats.pending > 0;

  // ── Quick confirm ──
  const handleConfirm = useCallback(async (event: AppointmentEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmingId(event.id);
    try {
      await onQuickConfirm(event);
    } finally {
      setConfirmingId(null);
    }
  }, [onQuickConfirm]);

  return (
    <div className="mdv-wrapper">

      {/* ── Date navigation ── */}
      <div className="mdv-date-nav">
        <div className="mdv-date-nav-group">
          <button
            className="mmv-nav-btn"
            onClick={() => setSelectedDate((d) => shiftDate(d, -1))}
            aria-label="Dia anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="mdv-date-label">{dateLabel}</span>
          <button
            className="mmv-nav-btn"
            onClick={() => setSelectedDate((d) => shiftDate(d, 1))}
            aria-label="Próximo dia"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <button className="mmv-goto-today" onClick={() => setSelectedDate(today)}>
          <CalendarDays size={12} />
          {dateFormatted}
        </button>
      </div>

      {/* ── Stats cards ── */}
      <div className="mdv-stats-row">
        <div className="mdv-stat-card">
          <CalendarDays size={18} className="mdv-stat-icon mdv-stat-icon--accent" />
          <span className="mdv-stat-value">{stats.total}</span>
          <span className="mdv-stat-label">atendimentos{"\n"}agendados hoje</span>
        </div>
        <div className="mdv-stat-card">
          <Clock size={18} className="mdv-stat-icon mdv-stat-icon--warn" />
          <span className="mdv-stat-value mdv-stat-value--warn">{stats.pending}</span>
          <span className="mdv-stat-label">confirmações{"\n"}pendentes</span>
        </div>
        <div className="mdv-stat-card">
          <Users size={18} className="mdv-stat-icon mdv-stat-icon--muted" />
          <span className="mdv-stat-value mdv-stat-value--muted">—</span>
          <span className="mdv-stat-label">encaixes{"\n"}disponíveis</span>
        </div>
      </div>

      {/* ── IA suggestion banner ── */}
      {showIABanner && (
        <div className="mdv-ia-banner">
          <Sparkles size={16} className="mdv-ia-icon" />
          <div className="mdv-ia-body">
            <span className="mdv-ia-title">
              IA sugere confirmar {stats.pending}{" "}
              {stats.pending === 1 ? "paciente" : "pacientes"} agora
            </span>
            <span className="mdv-ia-sub">
              Confirmações com maior risco de não comparecimento nas próximas 2 horas.
            </span>
          </div>
          <button className="mdv-ia-cta">Ver sugestões</button>
        </div>
      )}

      {/* ── List card: section header + list ── */}
      <div className="mdv-list-card">
      <div className="mdv-section-header">
        <span className="mdv-section-title">Agenda do dia</span>
        <button className="mdv-filter-btn" onClick={() => {/* future: open filter sheet */}}>
          <SlidersHorizontal size={13} />
          Filtros
        </button>
      </div>

      {/* ── Appointment list ── */}
      <div className="mdv-list">
        {dayEvents.length === 0 ? (
          <div className="mmv-day-empty">
            <CalendarDays size={32} strokeWidth={1.2} />
            <span>Nenhum agendamento para este dia</span>
            <button className="mmv-day-empty-cta" onClick={onNewAppointment}>
              <Check size={13} />
              Novo agendamento
            </button>
          </div>
        ) : (
          dayEvents.map((event) => {
            if (event.status === "block") {
              return (
                <div
                  key={event.id}
                  className="mmv-event-row"
                  style={{ "--event-border": "#6b7280" } as React.CSSProperties}
                  onClick={() => onEventClick(event)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onEventClick(event)}
                >
                  <div className="mmv-event-time">{formatTime(event, timezone)}</div>
                  <div className="mmv-event-avatar" aria-hidden style={{ color: "#6b7280" }}>
                    <Ban size={15} />
                  </div>
                  <div className="mmv-event-body">
                    <span className="mmv-event-name" style={{ color: "#9ca3af" }}>
                      {event.leadName ?? "Horário bloqueado"}
                    </span>
                  </div>
                  <span className="mmv-badge" style={{ background: "#6b728020", color: "#9ca3af", border: "1px solid #6b728040" }}>
                    Bloqueio
                  </span>
                </div>
              );
            }

            const cat          = getCategory(event);
            const color        = CATEGORY_COLORS[cat];
            const time         = formatTime(event, timezone);
            const isConfirming = confirmingId === event.id;
            const { label: badgeLabel, cls: badgeCls } = getStatusBadge(event);

            return (
              <div
                key={event.id}
                className="mmv-event-row"
                style={{ "--event-border": color } as React.CSSProperties}
                onClick={() => onEventClick(event)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onEventClick(event)}
              >
                {/* Time */}
                <div className="mmv-event-time">{time}</div>

                {/* Avatar */}
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

                {/* Info */}
                <div className="mmv-event-body">
                  <span className="mmv-event-name">{event.leadName ?? "Paciente"}</span>
                  {event.leadTreatmentInterest && (
                    <span className="mmv-event-treatment">
                      {event.leadTreatmentInterest}
                    </span>
                  )}
                </div>

                {/* Status badge */}
                <span className={`mmv-badge ${badgeCls}`}>{badgeLabel}</span>

                {/* Action buttons */}
                <div
                  className="mmv-event-actions"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <button
                    className="mmv-action-btn"
                    aria-label="Abrir conversa"
                    disabled={!event.conversationId}
                    onClick={() => {/* navigate to inbox */}}
                  >
                    <MessageCircle size={14} />
                  </button>

                  {event.leadPhone ? (
                    <a
                      className="mmv-action-btn"
                      href={`tel:${event.leadPhone}`}
                      aria-label="Ligar"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Phone size={14} />
                    </a>
                  ) : (
                    <button className="mmv-action-btn" disabled>
                      <Phone size={14} />
                    </button>
                  )}

                  <button
                    className="mmv-action-btn"
                    aria-label="Confirmar"
                    disabled={event.status !== "scheduled" || isConfirming}
                    onClick={(e) => void handleConfirm(event, e)}
                  >
                    <Check size={14} className={isConfirming ? "mdv-spin" : ""} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Footer inside the glass card ── */}
      <div className="mdv-footer">
        <div className="mdv-footer-stat">
          <CheckCircle2 size={13} className="mdv-footer-icon--done" />
          <span>Realizados</span>
          <strong>{stats.completed}</strong>
        </div>
        <div className="mdv-footer-divider" />
        <div className="mdv-footer-stat">
          <Clock size={13} className="mdv-footer-icon--pending" />
          <span>Pendentes</span>
          <strong>{stats.pending}</strong>
        </div>
        <div className="mdv-footer-divider" />
        <div className="mdv-footer-stat mdv-footer-stat--muted">
          <Users size={13} />
          <span>Encaixes</span>
          <strong>—</strong>
        </div>
      </div>
      </div>{/* end mdv-list-card */}
    </div>
  );
}
