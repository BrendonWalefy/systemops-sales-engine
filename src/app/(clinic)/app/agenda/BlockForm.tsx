"use client";

import { useState, useTransition } from "react";
import { CalendarDays, Sun, Sunset, Moon } from "lucide-react";
import { createBlock, createBlockRange } from "./actions";

const PRESETS = [
  { key: "manha", label: "Manhã", Icon: Sun, start: "08:00", end: "12:00" },
  { key: "tarde", label: "Tarde", Icon: Sunset, start: "13:00", end: "18:00" },
  { key: "noite", label: "Noite", Icon: Moon, start: "18:00", end: "22:00" },
] as const;

const MOTIVOS = [
  "Outro consultório",
  "Clínica própria",
  "Reunião",
  "Folga / Férias",
  "Outro",
];

function todayISO() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

export function BlockForm() {
  const [isPeriod, setIsPeriod] = useState(false);
  const [date, setDate] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [reason, setReason] = useState("Outro consultório");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const today = todayISO();
  const activePreset = PRESETS.find((p) => p.start === startTime && p.end === endTime)?.key;

  function applyPreset(start: string, end: string) {
    setStartTime(start);
    setEndTime(end);
  }

  function reset() {
    setDate("");
    setDateFrom("");
    setDateTo("");
    setStartTime("");
    setEndTime("");
    setReason("Outro consultório");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("startTime", startTime);
        fd.set("endTime", endTime);
        fd.set("reason", reason);

        if (isPeriod) {
          fd.set("dateFrom", dateFrom);
          fd.set("dateTo", dateTo);
          await createBlockRange(fd);
          const d1 = dateFrom.split("-").reverse().slice(0, 2).join("/");
          const d2 = dateTo.split("-").reverse().slice(0, 2).join("/");
          setSuccess(`Bloqueios de ${d1} a ${d2} salvos.`);
        } else {
          fd.set("date", date);
          await createBlock(fd);
          const d = date.split("-").reverse().slice(0, 2).join("/");
          setSuccess(`Bloqueio de ${d} salvo.`);
        }

        reset();
        setTimeout(() => setSuccess(null), 4000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao salvar bloqueio.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "16px" }}>
      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          className={`preset-btn${!isPeriod ? " active" : ""}`}
          onClick={() => setIsPeriod(false)}
        >
          Dia único
        </button>
        <button
          type="button"
          className={`preset-btn${isPeriod ? " active" : ""}`}
          onClick={() => setIsPeriod(true)}
        >
          Período
        </button>
      </div>

      {/* Date(s) */}
      {isPeriod ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={labelStyle}>De</span>
            <input
              type="date"
              required
              value={dateFrom}
              min={today}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={labelStyle}>Até</span>
            <input
              type="date"
              required
              value={dateTo}
              min={dateFrom || today}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>
        </div>
      ) : (
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={labelStyle}>Data</span>
          <input
            type="date"
            required
            value={date}
            min={today}
            onChange={(e) => setDate(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
      )}

      {/* Quick time presets */}
      <div>
        <span style={{ ...labelStyle, display: "block", marginBottom: 8 }}>Horário rápido</span>
        <div className="preset-buttons">
          {PRESETS.map(({ key, label, Icon, start, end }) => (
            <button
              key={key}
              type="button"
              className={`preset-btn${activePreset === key ? " active" : ""}`}
              onClick={() => applyPreset(start, end)}
            >
              <Icon size={13} strokeWidth={2} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom time inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={labelStyle}>Início</span>
          <input
            type="time"
            required
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={labelStyle}>Fim</span>
          <input
            type="time"
            required
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
      </div>

      {/* Reason */}
      <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={labelStyle}>Motivo</span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ width: "100%" }}
        >
          {MOTIVOS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </label>

      {error && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--danger)" }}>{error}</p>
      )}
      {success && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--accent)" }}>{success}</p>
      )}

      <div>
        <button
          type="submit"
          className="primary-button"
          disabled={isPending}
          style={{ gap: "8px" }}
        >
          <CalendarDays size={14} strokeWidth={2} />
          {isPending ? "Salvando…" : "Salvar bloqueio"}
        </button>
      </div>
    </form>
  );
}
