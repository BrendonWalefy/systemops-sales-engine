"use client";

import { useState } from "react";
import { X, Loader2, ChevronLeft, ChevronRight, AlertCircle, RefreshCw } from "lucide-react";

type Props = {
  defaultDate?: string;
  defaultTime?: string;
  onClose: () => void;
  onCreated: () => void;
};

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const PRESETS = [
  { key: "manha",    label: "Manhã",       sub: "07–12h", start: "07:00", end: "12:00" },
  { key: "tarde",    label: "Tarde",       sub: "12–18h", start: "12:00", end: "18:00" },
  { key: "noite",    label: "Noite",       sub: "18–22h", start: "18:00", end: "22:00" },
  { key: "dia",      label: "Dia inteiro", sub: "07–22h", start: "07:00", end: "22:00" },
] as const;

const REASONS = [
  { key: "almoco",        label: "Horário de almoço" },
  { key: "outra_clinica", label: "Atend. outra clínica" },
  { key: "reuniao",       label: "Reunião interna" },
  { key: "ferias",        label: "Férias / folga" },
  { key: "manutencao",    label: "Manutenção" },
  { key: "outro",         label: "Outro..." },
] as const;

type ReasonKey = typeof REASONS[number]["key"];

export function BlockModal({ defaultDate, defaultTime, onClose, onCreated }: Props) {
  const today = new Date().toISOString().slice(0, 10);

  const [selectedDates, setSelectedDates] = useState<Set<string>>(() =>
    new Set([defaultDate ?? today]),
  );

  const [calYear, setCalYear] = useState(() => {
    const d = defaultDate ? new Date(defaultDate + "T00:00:00") : new Date();
    return d.getFullYear();
  });
  const [calMonth, setCalMonth] = useState(() => {
    const d = defaultDate ? new Date(defaultDate + "T00:00:00") : new Date();
    return d.getMonth();
  });

  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [startTime, setStartTime] = useState(defaultTime ?? "09:00");
  const [endTime, setEndTime] = useState(() => defaultTime ? addHour(defaultTime) : "10:00");
  const [reasonKey, setReasonKey] = useState<ReasonKey>("almoco");
  const [customReason, setCustomReason] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [partialFailed, setPartialFailed] = useState<string[]>([]);
  const [successCount, setSuccessCount] = useState(0);

  // ── Calendar navigation ────────────────────────────────────────

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  }
  function toggleDate(dateStr: string) {
    setSelectedDates(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr); else next.add(dateStr);
      return next;
    });
  }

  // ── Preset handling ────────────────────────────────────────────

  function applyPreset(p: typeof PRESETS[number]) {
    setStartTime(p.start);
    setEndTime(p.end);
    setActivePreset(p.key);
  }
  function handleStartChange(v: string) { setStartTime(v); setActivePreset(null); }
  function handleEndChange(v: string)   { setEndTime(v);   setActivePreset(null); }

  // ── Submit ─────────────────────────────────────────────────────

  const resolvedReason = reasonKey === "outro"
    ? customReason.trim()
    : (REASONS.find(r => r.key === reasonKey)?.label ?? "");

  async function postBlocks(dates: string[]) {
    return Promise.all(
      dates.map(async (date) => {
        try {
          const res = await fetch("/api/calendar/blocks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date, startTime, endTime, reason: resolvedReason }),
          });
          return { date, ok: res.ok };
        } catch {
          return { date, ok: false };
        }
      }),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const dates = Array.from(selectedDates).sort();
    if (dates.length === 0) return;
    setSubmitting(true);
    setPartialFailed([]);
    setSuccessCount(0);
    const results = await postBlocks(dates);
    const failed = results.filter(r => !r.ok).map(r => r.date);
    const ok = results.filter(r => r.ok).length;
    setSubmitting(false);
    if (ok > 0) onCreated();
    if (failed.length === 0) { onClose(); return; }
    setPartialFailed(failed);
    setSuccessCount(ok);
  }

  async function handleRetry() {
    setSubmitting(true);
    const results = await postBlocks(partialFailed);
    const stillFailed = results.filter(r => !r.ok).map(r => r.date);
    const ok = results.filter(r => r.ok).length;
    setSubmitting(false);
    if (ok > 0) onCreated();
    if (stillFailed.length === 0) { onClose(); return; }
    setPartialFailed(stillFailed);
    setSuccessCount(prev => prev + ok);
  }

  // ── Status bar ─────────────────────────────────────────────────

  const count = selectedDates.size;
  const preset = PRESETS.find(p => p.key === activePreset);
  const periodLabel = preset
    ? `${preset.label} (${startTime}–${endTime})`
    : `${startTime}–${endTime}`;
  const statusText = count === 0
    ? "Nenhum dia selecionado"
    : `${count} ${count === 1 ? "dia" : "dias"} · ${periodLabel}`;

  const calDays = buildCalendarDays(calYear, calMonth);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="modal-header">
          <h2 className="modal-title">Bloquear horário</h2>
          <button className="modal-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">

          {/* ── Mini calendar ── */}
          <div className="field-group">
            <span className="field-label">Dias</span>
            <div className="block-cal">
              <div className="block-cal-nav">
                <button type="button" className="block-cal-nav-btn" onClick={prevMonth}>
                  <ChevronLeft size={14} />
                </button>
                <span className="block-cal-month">{MONTHS_PT[calMonth]} {calYear}</span>
                <button type="button" className="block-cal-nav-btn" onClick={nextMonth}>
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="block-cal-grid">
                {WEEKDAYS.map(d => (
                  <div key={d} className="block-cal-header">{d}</div>
                ))}
                {calDays.flat().map((dateStr, i) => {
                  if (!dateStr) return <div key={`e-${i}`} className="block-cal-day empty" />;
                  const selected = selectedDates.has(dateStr);
                  const past = dateStr < today;
                  const isToday = dateStr === today;
                  return (
                    <button
                      key={dateStr}
                      type="button"
                      disabled={past}
                      onClick={() => toggleDate(dateStr)}
                      className={[
                        "block-cal-day",
                        selected && "selected",
                        isToday && !selected && "is-today",
                        past && "past",
                      ].filter(Boolean).join(" ")}
                    >
                      {Number(dateStr.split("-")[2])}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Period presets ── */}
          <div className="field-group">
            <span className="field-label">Período</span>
            <div className="period-presets">
              {PRESETS.map(p => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={`period-btn${activePreset === p.key ? " active" : ""}`}
                >
                  <span className="period-label">{p.label}</span>
                  <span className="period-sub">{p.sub}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Time fields ── */}
          <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="field-group">
              <label className="field-label">De</label>
              <input
                className="field-input"
                type="time"
                value={startTime}
                onChange={e => handleStartChange(e.target.value)}
                required
              />
            </div>
            <div className="field-group">
              <label className="field-label">Até</label>
              <input
                className="field-input"
                type="time"
                value={endTime}
                onChange={e => handleEndChange(e.target.value)}
                required
              />
            </div>
          </div>

          {/* ── Reason ── */}
          <div className="field-group">
            <label className="field-label">Motivo</label>
            <select
              className="field-input"
              value={reasonKey}
              onChange={e => setReasonKey(e.target.value as ReasonKey)}
            >
              {REASONS.map(r => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
            {reasonKey === "outro" && (
              <input
                className="field-input"
                type="text"
                placeholder="Descreva o motivo..."
                value={customReason}
                onChange={e => setCustomReason(e.target.value)}
                autoFocus
              />
            )}
          </div>

          {/* ── Partial failure banner ── */}
          {partialFailed.length > 0 && (
            <div className="block-partial-error">
              <AlertCircle size={14} className="block-partial-icon" />
              <div className="block-partial-body">
                <p>
                  {successCount > 0 && `${successCount} ${successCount === 1 ? "dia bloqueado" : "dias bloqueados"}. `}
                  Falha em: {partialFailed.map(formatDateShort).join(", ")}
                </p>
                <button
                  type="button"
                  className="block-retry-btn"
                  onClick={handleRetry}
                  disabled={submitting}
                >
                  <RefreshCw size={11} />
                  Tentar novamente
                </button>
              </div>
            </div>
          )}

          {/* ── Footer: status + actions ── */}
          <div className="block-footer">
            <span className="block-status">{statusText}</span>
            <div className="block-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancelar
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={submitting || count === 0}
              >
                {submitting ? <Loader2 size={14} className="spin" /> : "Bloquear"}
              </button>
            </div>
          </div>

        </form>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function buildCalendarDays(year: number, month: number): (string | null)[][] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(
      `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    );
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function addHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDateShort(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}
