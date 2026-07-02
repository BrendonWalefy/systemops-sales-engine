"use client";

import { useState, useEffect, useRef } from "react";
import { X, Search, Loader2 } from "lucide-react";
import type { Professional } from "./types";
import { DurationHoursInput } from "@/components/DurationHoursInput";

type LeadResult = { id: string; name: string | null; phone: string | null };

type Props = {
  defaultDate?: string;
  defaultTime?: string;
  defaultProfessionalId?: string;
  defaultDurationMinutes: number;
  professionals: Professional[];
  onClose: () => void;
  onCreated: () => void;
};

function normalizeLeadText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .trim();
}

function pickSingleLead(query: string, results: LeadResult[]): LeadResult | null {
  if (results.length === 1) return results[0];
  const normalizedQuery = normalizeLeadText(query);
  if (!normalizedQuery) return null;

  const exact = results.find((lead) => {
    const name = normalizeLeadText(lead.name);
    const phone = normalizeLeadText(lead.phone);
    return name === normalizedQuery || phone === normalizedQuery;
  });
  return exact ?? null;
}

export function AppointmentModal({
  defaultDate,
  defaultTime,
  defaultProfessionalId,
  defaultDurationMinutes,
  professionals,
  onClose,
  onCreated,
}: Props) {
  const [date, setDate] = useState(defaultDate ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(defaultTime ?? "09:00");
  const [durationMinutes, setDurationMinutes] = useState(defaultDurationMinutes);
  const [professionalId, setProfessionalId] = useState(defaultProfessionalId ?? professionals[0]?.id ?? "");
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
    let leadToSchedule = selectedLead;

    if (!leadToSchedule) {
      leadToSchedule = pickSingleLead(leadQuery, leadResults);
    }

    if (!leadToSchedule && leadQuery.trim().length >= 2) {
      setSearching(true);
      try {
        const res = await fetch(`/api/leads/search?q=${encodeURIComponent(leadQuery.trim())}`);
        const data: { leads?: LeadResult[] } = await res.json();
        const freshResults = data.leads ?? [];
        setLeadResults(freshResults);
        leadToSchedule = pickSingleLead(leadQuery, freshResults);
      } finally {
        setSearching(false);
      }
    }

    if (!leadToSchedule) {
      setError("Selecione o paciente na lista");
      return;
    }

    setSelectedLead(leadToSchedule);
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: leadToSchedule.id,
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
                      <li key={l.id} className="search-result-item" onPointerDown={() => { setSelectedLead(l); setLeadQuery(""); setLeadResults([]); }}>
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
              <label className="field-label">Duração</label>
              <DurationHoursInput
                minutes={durationMinutes}
                onChangeMinutes={setDurationMinutes}
                inputStyle={durationInputStyle}
                labelStyle={{ color: "var(--agenda-muted)" }}
              />
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

const durationInputStyle: React.CSSProperties = {
  background: "var(--agenda-panel-raised)",
  border: "1px solid var(--agenda-border)",
  borderRadius: 7,
  color: "var(--agenda-text)",
  fontSize: 16,
  padding: "8px 10px",
  width: 64,
  minWidth: 0,
  boxSizing: "border-box",
  fontFamily: "inherit",
  colorScheme: "dark",
};
