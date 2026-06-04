"use client";

import { useState } from "react";
import { X, ExternalLink, Loader2, CheckCircle2, XCircle, Clock, UserX, Trash2 } from "lucide-react";
import Link from "next/link";
import type { AppointmentEvent } from "./types";

type Props = {
  event: AppointmentEvent;
  conversationId?: string;
  onClose: () => void;
  onUpdated: () => void;
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Agendado",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  completed: "Concluído",
  no_show: "Não compareceu",
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: "status-scheduled",
  confirmed: "status-confirmed",
  cancelled: "status-cancelled",
  completed: "status-completed",
  no_show: "status-no_show",
};

type Action = "confirmed" | "cancelled" | "completed" | "no_show";

export function AppointmentDrawer({ event, conversationId, onClose, onUpdated }: Props) {
  const [loading, setLoading] = useState<Action | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);

  const dateStr = startsAt.toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
  const timeStr = `${startsAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })} – ${endsAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}`;

  async function updateStatus(status: Action) {
    setLoading(status);
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Erro ao atualizar");
        return;
      }
      onUpdated();
      onClose();
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(null);
    }
  }

  async function deleteBlock() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/calendar/blocks/${event.calendarEventId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erro ao remover bloqueio");
        return;
      }
      onUpdated();
      onClose();
    } catch {
      setError("Erro de conexão");
    } finally {
      setDeleting(false);
    }
  }

  const isBlock = event.status === "block";
  const isActive = event.status === "scheduled" || event.status === "confirmed";

  // ── Block drawer ──────────────────────────────────────────────────────
  if (isBlock) {
    return (
      <div className="drawer-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="drawer-panel">
          <div className="drawer-header">
            <div>
              <h2 className="drawer-title">Horário Bloqueado</h2>
              {event.leadName && event.leadName !== "Horário bloqueado" && (
                <p className="drawer-subtitle">{event.leadName}</p>
              )}
            </div>
            <button className="modal-close" onClick={onClose}><X size={18} /></button>
          </div>

          <div className="drawer-body">
            <div className="drawer-section">
              <p className="drawer-date">{dateStr}</p>
              <p className="drawer-time">{timeStr}</p>
            </div>

            {error && <p className="field-error">{error}</p>}

            <div className="drawer-actions">
              <button
                className="btn-action btn-cancel"
                onClick={deleteBlock}
                disabled={deleting}
              >
                {deleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                Remover bloqueio
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Appointment drawer ────────────────────────────────────────────────
  return (
    <div className="drawer-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer-panel">
        <div className="drawer-header">
          <div>
            <h2 className="drawer-title">{event.leadName ?? event.leadPhone ?? "Paciente"}</h2>
            {event.leadPhone && <p className="drawer-subtitle">{event.leadPhone}</p>}
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="drawer-body">
          <div className="drawer-section">
            <p className="drawer-date">{dateStr}</p>
            <p className="drawer-time">{timeStr}</p>
          </div>

          <div className="drawer-section">
            <span className={`status-badge ${STATUS_COLORS[event.status] ?? ""}`}>
              {STATUS_LABELS[event.status] ?? event.status}
            </span>
            {event.source === "gcal_import" && (
              <span className="source-badge">Importado do Google Calendar</span>
            )}
          </div>

          {event.professionalName && (
            <div className="drawer-section">
              <div className="professional-row">
                <span
                  className="professional-dot"
                  style={{ background: event.professionalColor ?? "#10b981" }}
                />
                <span className="professional-name">{event.professionalName}</span>
              </div>
            </div>
          )}

          {event.calendarEventUrl && (
            <a href={event.calendarEventUrl} target="_blank" rel="noopener noreferrer" className="gcal-link">
              <ExternalLink size={12} />
              Ver no Google Calendar
            </a>
          )}

          {conversationId && (
            <Link href={`/app/inbox/${conversationId}`} className="gcal-link">
              <ExternalLink size={12} />
              Ver conversa na Inbox
            </Link>
          )}

          {error && <p className="field-error">{error}</p>}

          {isActive && (
            <div className="drawer-actions">
              <button
                className="btn-action btn-confirm"
                onClick={() => updateStatus("confirmed")}
                disabled={loading !== null || event.status === "confirmed"}
              >
                {loading === "confirmed" ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
                Confirmar
              </button>
              <button
                className="btn-action btn-noshow"
                onClick={() => updateStatus("no_show")}
                disabled={loading !== null}
              >
                {loading === "no_show" ? <Loader2 size={14} className="spin" /> : <UserX size={14} />}
                Não compareceu
              </button>
              <button
                className="btn-action btn-complete"
                onClick={() => updateStatus("completed")}
                disabled={loading !== null}
              >
                {loading === "completed" ? <Loader2 size={14} className="spin" /> : <Clock size={14} />}
                Concluir
              </button>
              <button
                className="btn-action btn-cancel"
                onClick={() => updateStatus("cancelled")}
                disabled={loading !== null}
              >
                {loading === "cancelled" ? <Loader2 size={14} className="spin" /> : <XCircle size={14} />}
                Cancelar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
