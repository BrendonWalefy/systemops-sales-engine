"use client";

import { useState, useEffect, useRef } from "react";
import { X, Search, Loader2 } from "lucide-react";
import type { Professional } from "./types";

type LeadResult = { id: string; name: string | null; phone: string | null };

type Props = {
  defaultDate?: string;
  defaultTime?: string;
  professionals: Professional[];
  onClose: () => void;
  onCreated: () => void;
};

export function AppointmentModal({ defaultDate, defaultTime, professionals, onClose, onCreated }: Props) {
  const [date, setDate] = useState(defaultDate ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(defaultTime ?? "09:00");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [professionalId, setProfessionalId] = useState(professionals[0]?.id ?? "");
  const [treatmentName, setTreatmentName] = useState("");
  const [leadQuery, setLeadQuery] = useState("");
  const [leadResults, setLeadResults] = useState<LeadResult[]>([]);
  const [selectedLead, setSelectedLead] = useState<LeadResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (leadQuery.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLeadResults([]);
      return;
    }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/leads/search?q=${encodeURIComponent(leadQuery)}`);
        const data = await res.json();
        setLeadResults(data.leads ?? []);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [leadQuery]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLead) {
      setError("Selecione um paciente");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: selectedLead.id,
          date,
          time,
          durationMinutes,
          professionalId: professionalId || undefined,
          treatmentName: treatmentName || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Erro ao criar agendamento");
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
          <h2 className="modal-title">Novo Agendamento</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {/* Busca de paciente */}
          <div className="field-group">
            <label className="field-label">Paciente</label>
            {selectedLead ? (
              <div className="lead-selected">
                <span>{selectedLead.name ?? selectedLead.phone ?? selectedLead.id}</span>
                <button type="button" className="lead-clear" onClick={() => { setSelectedLead(null); setLeadQuery(""); }}>
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="search-wrapper">
                <Search size={14} className="search-icon" />
                <input
                  className="field-input search-input"
                  placeholder="Nome ou telefone..."
                  value={leadQuery}
                  onChange={(e) => setLeadQuery(e.target.value)}
                  autoFocus
                />
                {searching && <Loader2 size={14} className="search-loading" />}
                {leadResults.length > 0 && (
                  <ul className="search-results">
                    {leadResults.map((l) => (
                      <li key={l.id} className="search-result-item" onClick={() => { setSelectedLead(l); setLeadQuery(""); setLeadResults([]); }}>
                        <span className="result-name">{l.name ?? "—"}</span>
                        <span className="result-phone">{l.phone ?? ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Data e hora */}
          <div className="field-row">
            <div className="field-group">
              <label className="field-label">Data</label>
              <input className="field-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="field-group">
              <label className="field-label">Horário</label>
              <input className="field-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
            </div>
            <div className="field-group">
              <label className="field-label">Duração (min)</label>
              <select className="field-input" value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))}>
                {[30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{d} min</option>)}
              </select>
            </div>
          </div>

          {/* Profissional */}
          {professionals.length > 0 && (
            <div className="field-group">
              <label className="field-label">Profissional</label>
              <select className="field-input" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
                <option value="">— Qualquer —</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.specialty ? ` — ${p.specialty}` : ""}</option>
                ))}
              </select>
            </div>
          )}

          {/* Procedimento */}
          <div className="field-group">
            <label className="field-label">Procedimento (opcional)</label>
            <input className="field-input" type="text" placeholder="Ex: Limpeza, Avaliação..." value={treatmentName} onChange={(e) => setTreatmentName(e.target.value)} />
          </div>

          {error && <p className="field-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? <Loader2 size={14} className="spin" /> : "Agendar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
