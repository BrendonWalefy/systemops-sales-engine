"use client";

import { useState, useMemo } from "react";
import { X, Loader2, ChevronDown, Check } from "lucide-react";
import type { Professional, TreatmentOption } from "./types";
import { DurationHoursInput } from "@/components/DurationHoursInput";
import { combineAppointmentValueCents } from "@/application/config/price-campaigns";

type Props = {
  defaultDate?: string;
  defaultTime?: string;
  defaultProfessionalId?: string;
  defaultDurationMinutes: number;
  professionals: Professional[];
  treatments: TreatmentOption[];
  serviceNoun: string;
  onClose: () => void;
  onCreated: () => void;
};

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function AppointmentModal({
  defaultDate,
  defaultTime,
  defaultProfessionalId,
  defaultDurationMinutes,
  professionals,
  treatments,
  serviceNoun,
  onClose,
  onCreated,
}: Props) {
  const [date, setDate] = useState(defaultDate ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(defaultTime ?? "09:00");
  const [durationMinutes, setDurationMinutes] = useState(defaultDurationMinutes);
  const [professionalId, setProfessionalId] = useState(defaultProfessionalId ?? professionals[0]?.id ?? "");
  const [patientName, setPatientName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedTreatmentIds, setSelectedTreatmentIds] = useState<string[]>([]);
  const [proceduresOpen, setProceduresOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTreatments = useMemo(
    () => treatments.filter((t) => selectedTreatmentIds.includes(t.id)),
    [treatments, selectedTreatmentIds],
  );

  // Valor estimado: sinal (dedutível) é abatido, não somado — mesma regra do backend.
  const estimatedValueCents = useMemo(
    () => combineAppointmentValueCents(selectedTreatments.map((t) => ({ valueCents: t.priceCents, deductible: t.deductible }))),
    [selectedTreatments],
  );
  const someWithoutPrice = selectedTreatments.some((t) => t.priceCents == null);
  // Sinal abatido quando combinado com um procedimento real (para a nota da UI).
  const abatedDeposit = useMemo(() => {
    const hasRealProcedure = selectedTreatments.some((t) => !t.deductible && t.priceCents != null);
    if (!hasRealProcedure) return null;
    const deposit = selectedTreatments
      .filter((t) => t.deductible && t.priceCents != null)
      .reduce((sum, t) => sum + (t.priceCents ?? 0), 0);
    return deposit > 0 ? deposit : null;
  }, [selectedTreatments]);

  function toggleTreatment(id: string) {
    const next = selectedTreatmentIds.includes(id)
      ? selectedTreatmentIds.filter((x) => x !== id)
      : [...selectedTreatmentIds, id];
    setSelectedTreatmentIds(next);
    // Soma a duração dos procedimentos e pré-preenche como SUGESTÃO (editável).
    const summed = treatments
      .filter((t) => next.includes(t.id))
      .reduce((total, t) => total + (t.durationMinutes || 0), 0);
    if (summed > 0) setDurationMinutes(summed);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = patientName.trim();
    if (!name) {
      setError("Informe o nome do paciente");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName: name,
          phone: phone.trim() || undefined,
          date,
          time,
          durationMinutes,
          professionalId: professionalId || undefined,
          treatmentIds: selectedTreatmentIds.length > 0 ? selectedTreatmentIds : undefined,
          description: description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
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

  const proceduresLabel =
    selectedTreatments.length === 0
      ? `Selecione ${serviceNoun === "tratamento" ? "os procedimentos" : `os ${serviceNoun}s`}...`
      : selectedTreatments.map((t) => t.name).join(", ");

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="modal-header">
          <h2 className="modal-title">Novo Agendamento</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {/* Nome do paciente — texto livre (sem autocomplete) */}
          <div className="field-group">
            <label className="field-label">Nome do paciente</label>
            <input
              className="field-input"
              type="text"
              placeholder="Nome completo"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              autoFocus
              required
            />
          </div>

          {/* Telefone — opcional */}
          <div className="field-group">
            <label className="field-label">Telefone (opcional)</label>
            <input
              className="field-input"
              type="tel"
              inputMode="tel"
              placeholder="(00) 00000-0000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          {/* Procedimentos — multi-seleção com soma de duração e valor */}
          {treatments.length > 0 && (
            <div className="field-group">
              <label className="field-label">Procedimentos (opcional — pode combinar vários)</label>
              <button
                type="button"
                className="field-input"
                onClick={() => setProceduresOpen((o) => !o)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 8, textAlign: "left", cursor: "pointer",
                  color: selectedTreatments.length === 0 ? "var(--agenda-muted)" : "var(--agenda-text)",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proceduresLabel}</span>
                <ChevronDown size={15} style={{ flexShrink: 0, transition: "transform 150ms", transform: proceduresOpen ? "rotate(180deg)" : "none" }} />
              </button>

              {proceduresOpen && (
                <div
                  style={{
                    marginTop: 6, border: "1px solid var(--agenda-border)", borderRadius: 8,
                    background: "var(--agenda-panel-raised)", maxHeight: 220, overflowY: "auto",
                  }}
                >
                  {treatments.map((t) => {
                    const checked = selectedTreatmentIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTreatment(t.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, width: "100%",
                          padding: "9px 12px", background: checked ? "var(--agenda-accent-soft, rgba(0,224,178,0.08))" : "transparent",
                          border: "none", borderBottom: "1px solid var(--agenda-border)", cursor: "pointer", textAlign: "left",
                        }}
                      >
                        <span
                          style={{
                            width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                            border: `1.5px solid ${checked ? "var(--agenda-accent, #00E0B2)" : "var(--agenda-border)"}`,
                            background: checked ? "var(--agenda-accent, #00E0B2)" : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}
                        >
                          {checked && <Check size={11} color="#071115" strokeWidth={3} />}
                        </span>
                        <span style={{ flex: 1, fontSize: 14, color: "var(--agenda-text)" }}>{t.name}</span>
                        <span style={{ fontSize: 12, color: "var(--agenda-muted)", flexShrink: 0 }}>
                          {t.durationMinutes} min{t.priceCents != null ? ` · ${formatBRL(t.priceCents)}` : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedTreatments.length > 0 && (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--agenda-muted)" }}>
                  {selectedTreatments.length} selecionado{selectedTreatments.length !== 1 ? "s" : ""} · duração somada preenchida abaixo
                  {estimatedValueCents != null && (
                    <> · valor estimado <strong style={{ color: "var(--agenda-text)" }}>{formatBRL(estimatedValueCents)}</strong></>
                  )}
                  {abatedDeposit != null && ` (inclui sinal de ${formatBRL(abatedDeposit)} abatido do total)`}
                  {someWithoutPrice && estimatedValueCents != null && " · alguns sem preço cadastrado"}
                </p>
              )}
            </div>
          )}

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

          {/* Descrição / anotações — texto livre */}
          <div className="field-group">
            <label className="field-label">Descrição / anotações (opcional)</label>
            <textarea
              className="field-input"
              placeholder="Qualquer observação sobre o agendamento..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ resize: "vertical", minHeight: 64, fontFamily: "inherit", lineHeight: 1.5, padding: "8px 10px" }}
            />
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
