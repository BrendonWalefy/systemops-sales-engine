"use client";

import { useState } from "react";
import { X, ExternalLink, Loader2, CheckCircle2, XCircle, Clock, UserX, Trash2 } from "lucide-react";
import Link from "next/link";
import type { AppointmentEvent } from "./types";
import type { TreatmentOption } from "./AgendaClient";

type Props = {
  event: AppointmentEvent;
  conversationId?: string;
  treatments: TreatmentOption[];
  memberRole: string;
  serviceNoun: string;
  initialCompletedModalOpen?: boolean;
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

type Action = "confirmed" | "cancelled" | "no_show";

type CompletedModalState = {
  open: boolean;
  treatmentId: string;
  valueStr: string; // reais com vírgula, ex: "8500,00"
};

function formatCents(cents: number | null): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

function reaisToMaybeCents(str: string): number | null {
  const normalized = str.replace(",", ".").replace(/[^\d.]/g, "");
  const val = parseFloat(normalized);
  if (isNaN(val) || val < 0) return null;
  return Math.round(val * 100);
}

function buildCompletedModalState(
  event: AppointmentEvent,
  treatments: TreatmentOption[],
  open: boolean,
): CompletedModalState {
  const preselected = treatments.find((t) =>
    event.leadTreatmentInterest
      ? t.name.toLowerCase().includes(event.leadTreatmentInterest.toLowerCase())
      : false,
  ) ?? treatments[0];

  return {
    open,
    treatmentId: preselected?.id ?? "",
    valueStr: formatCents(preselected?.priceCents ?? null),
  };
}

export function AppointmentDrawer({
  event,
  conversationId,
  treatments,
  memberRole,
  serviceNoun,
  initialCompletedModalOpen = false,
  onClose,
  onUpdated,
}: Props) {
  const [loading, setLoading] = useState<Action | null>(null);
  const [completingLoading, setCompletingLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [completedModal, setCompletedModal] = useState<CompletedModalState>(() =>
    buildCompletedModalState(event, treatments, initialCompletedModalOpen),
  );

  const serviceNounCapitalized = serviceNoun.charAt(0).toUpperCase() + serviceNoun.slice(1);
  const canSeeValue = memberRole !== "receptionist";

  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);

  const _tz = "America/Sao_Paulo";
  const _weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long",  timeZone: _tz }).format(startsAt);
  const _day     = new Intl.DateTimeFormat("pt-BR", { day: "numeric",   timeZone: _tz }).format(startsAt);
  const _month   = new Intl.DateTimeFormat("pt-BR", { month: "long",    timeZone: _tz }).format(startsAt);
  const _year    = new Intl.DateTimeFormat("pt-BR", { year: "numeric",  timeZone: _tz }).format(startsAt);
  const dateStr  = `${_weekday.charAt(0).toUpperCase() + _weekday.slice(1)}, ${_day} de ${_month} de ${_year}`;
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

  function openCompletedModal() {
    setCompletedModal(buildCompletedModalState(event, treatments, true));
    setError(null);
  }

  function handleTreatmentChange(id: string) {
    const t = treatments.find((t) => t.id === id);
    setCompletedModal((prev) => ({
      ...prev,
      treatmentId: id,
      // só preenche automaticamente se o campo estava com o valor do tratamento anterior
      valueStr: t?.priceCents != null ? formatCents(t.priceCents) : prev.valueStr,
    }));
  }

  async function confirmCompleted() {
    setCompletingLoading(true);
    setError(null);
    try {
      const valueCents = canSeeValue ? reaisToMaybeCents(completedModal.valueStr) : null;
      const res = await fetch(`/api/appointments/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          treatmentId: completedModal.treatmentId || null,
          valueCents,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Erro ao concluir");
        return;
      }
      onUpdated();
      onClose();
    } catch {
      setError("Erro de conexão");
    } finally {
      setCompletingLoading(false);
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
    <>
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
                  onClick={openCompletedModal}
                  disabled={loading !== null}
                >
                  <Clock size={14} />
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

      {/* ── Modal "Consulta Realizada" ───────────────────────────────── */}
      {completedModal.open && (
        <div
          className="drawer-overlay"
          style={{ zIndex: 200 }}
          onClick={(e) => e.target === e.currentTarget && setCompletedModal((p) => ({ ...p, open: false }))}
        >
          <div
            className="drawer-panel"
            style={{ maxWidth: 440 }}
          >
            <div className="drawer-header">
              <div>
                <h2 className="drawer-title">Consulta Realizada</h2>
                <p className="drawer-subtitle">{event.leadName ?? "Paciente"}</p>
              </div>
              <button
                className="modal-close"
                onClick={() => setCompletedModal((p) => ({ ...p, open: false }))}
              >
                <X size={18} />
              </button>
            </div>

            <div className="drawer-body" style={{ display: "grid", gap: "16px" }}>
              {treatments.length > 0 && (
                <label style={{ margin: 0 }}>
                  <span style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "6px" }}>
                    {serviceNounCapitalized} realizado
                  </span>
                  <select
                    value={completedModal.treatmentId}
                    onChange={(e) => handleTreatmentChange(e.target.value)}
                    style={{ width: "100%", margin: 0, fontSize: "15px" }}
                  >
                    <option value="">— Não especificado —</option>
                    {treatments.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </label>
              )}

              {canSeeValue && (
                <label style={{ margin: 0 }}>
                  <span style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "6px" }}>
                    Valor cobrado (R$)
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={completedModal.valueStr}
                    onChange={(e) => setCompletedModal((p) => ({ ...p, valueStr: e.target.value }))}
                    placeholder="0,00"
                    style={{ width: "100%", margin: 0, fontSize: "15px" }}
                  />
                  <span style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px", display: "block" }}>
                    Ajuste se o valor cobrado foi diferente
                  </span>
                </label>
              )}

              {error && <p className="field-error">{error}</p>}

              <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                <button
                  className="secondary-button"
                  onClick={() => setCompletedModal((p) => ({ ...p, open: false }))}
                  disabled={completingLoading}
                >
                  Cancelar
                </button>
                <button
                  className="primary-button"
                  onClick={confirmCompleted}
                  disabled={completingLoading}
                  style={{ gap: "8px" }}
                >
                  {completingLoading ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <CheckCircle2 size={14} />
                  )}
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
