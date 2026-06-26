"use client";

import { useState } from "react";
import { X, ExternalLink, Loader2, CheckCircle2, XCircle, Clock, UserX, Trash2, Pencil } from "lucide-react";
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

const BLOCK_REASONS = [
  { key: "almoco",        label: "Horário de almoço" },
  { key: "outra_clinica", label: "Atend. outra clínica" },
  { key: "reuniao",       label: "Reunião interna" },
  { key: "ferias",        label: "Férias / folga" },
  { key: "manutencao",    label: "Manutenção" },
  { key: "outro",         label: "Outro..." },
] as const;

type BlockReasonKey = typeof BLOCK_REASONS[number]["key"];

function resolveBlockReasonKey(reason: string): { key: BlockReasonKey; custom: string } {
  const match = BLOCK_REASONS.find((r) => r.key !== "outro" && r.label === reason);
  if (match) return { key: match.key as BlockReasonKey, custom: "" };
  return { key: "outro", custom: reason === "Horário bloqueado" ? "" : reason };
}

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
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Block edit state (initialised once on mount) ──────────────────────────────
  const _tz0 = "America/Sao_Paulo";
  const _blockStart = new Date(event.startsAt);
  const _blockEnd   = new Date(event.endsAt);
  const _initDate   = new Intl.DateTimeFormat("en-CA", { timeZone: _tz0, year: "numeric", month: "2-digit", day: "2-digit" }).format(_blockStart);
  const _initStart  = new Intl.DateTimeFormat("pt-BR", { timeZone: _tz0, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(_blockStart);
  const _initEnd    = new Intl.DateTimeFormat("pt-BR", { timeZone: _tz0, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(_blockEnd);
  const _initReason = resolveBlockReasonKey(event.leadName ?? "");

  const [editDate,         setEditDate]         = useState(_initDate);
  const [editStart,        setEditStart]        = useState(_initStart);
  const [editEnd,          setEditEnd]          = useState(_initEnd);
  const [editReasonKey,    setEditReasonKey]    = useState<BlockReasonKey>(_initReason.key);
  const [editCustomReason, setEditCustomReason] = useState(_initReason.custom);

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

  async function saveBlockEdit() {
    setSaving(true);
    setError(null);
    try {
      const reason = editReasonKey === "outro"
        ? editCustomReason.trim()
        : (BLOCK_REASONS.find((r) => r.key === editReasonKey)?.label ?? "");

      const res = await fetch(`/api/calendar/blocks/${event.calendarEventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: editDate, startTime: editStart, endTime: editEnd, reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erro ao editar bloqueio");
        return;
      }
      onUpdated();
      onClose();
    } catch {
      setError("Erro de conexão");
    } finally {
      setSaving(false);
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
            {!editing ? (
              <>
                <div className="drawer-section">
                  <p className="drawer-date">{dateStr}</p>
                  <p className="drawer-time">{timeStr}</p>
                </div>

                {error && <p className="field-error">{error}</p>}

                <div className="drawer-actions">
                  <button
                    className="btn-action btn-confirm"
                    onClick={() => { setEditing(true); setError(null); }}
                  >
                    <Pencil size={14} />
                    Editar bloqueio
                  </button>
                  <button
                    className="btn-action btn-cancel"
                    onClick={deleteBlock}
                    disabled={deleting}
                  >
                    {deleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                    Remover bloqueio
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="drawer-section" style={{ display: "grid", gap: "12px" }}>
                  <label style={{ margin: 0 }}>
                    <span style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "6px" }}>Data</span>
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      style={{ width: "100%", margin: 0 }}
                    />
                  </label>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <label style={{ margin: 0 }}>
                      <span style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "6px" }}>De</span>
                      <input
                        type="time"
                        value={editStart}
                        onChange={(e) => setEditStart(e.target.value)}
                        style={{ width: "100%", margin: 0 }}
                      />
                    </label>
                    <label style={{ margin: 0 }}>
                      <span style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "6px" }}>Até</span>
                      <input
                        type="time"
                        value={editEnd}
                        onChange={(e) => setEditEnd(e.target.value)}
                        style={{ width: "100%", margin: 0 }}
                      />
                    </label>
                  </div>

                  <label style={{ margin: 0 }}>
                    <span style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "6px" }}>Motivo</span>
                    <select
                      value={editReasonKey}
                      onChange={(e) => setEditReasonKey(e.target.value as BlockReasonKey)}
                      style={{ width: "100%", margin: 0 }}
                    >
                      {BLOCK_REASONS.map((r) => (
                        <option key={r.key} value={r.key}>{r.label}</option>
                      ))}
                    </select>
                  </label>

                  {editReasonKey === "outro" && (
                    <input
                      type="text"
                      placeholder="Descreva o motivo..."
                      value={editCustomReason}
                      onChange={(e) => setEditCustomReason(e.target.value)}
                      style={{ margin: 0 }}
                      autoFocus
                    />
                  )}
                </div>

                {error && <p className="field-error">{error}</p>}

                <div style={{ display: "flex", gap: "10px", marginTop: "16px", justifyContent: "flex-end" }}>
                  <button
                    className="secondary-button"
                    onClick={() => { setEditing(false); setError(null); }}
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                  <button
                    className="primary-button"
                    onClick={saveBlockEdit}
                    disabled={saving}
                    style={{ gap: "8px" }}
                  >
                    {saving ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
                    Salvar
                  </button>
                </div>
              </>
            )}
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
