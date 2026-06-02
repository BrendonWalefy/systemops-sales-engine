"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";

type Props = {
  defaultDate?: string;
  defaultTime?: string;
  onClose: () => void;
  onCreated: () => void;
};

export function BlockModal({ defaultDate, defaultTime, onClose, onCreated }: Props) {
  const [date, setDate] = useState(defaultDate ?? new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState(defaultTime ?? "09:00");
  const [endTime, setEndTime] = useState(defaultTime ? addHour(defaultTime) : "10:00");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, startTime, endTime, reason }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Erro ao criar bloqueio");
        return;
      }
      onCreated();
      onClose();
    } catch {
      setError("Erro de conexão");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="modal-header">
          <h2 className="modal-title">Novo Bloqueio</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="field-group">
            <label className="field-label">Data</label>
            <input className="field-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>

          <div className="field-row">
            <div className="field-group">
              <label className="field-label">Início</label>
              <input className="field-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </div>
            <div className="field-group">
              <label className="field-label">Fim</label>
              <input className="field-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">Motivo (opcional)</label>
            <input className="field-input" type="text" placeholder="Ex: Almoço, Reunião..." value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>

          {error && <p className="field-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? <Loader2 size={14} className="spin" /> : "Bloquear"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function addHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const newH = (h + 1) % 24;
  return `${String(newH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
