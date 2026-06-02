"use client";

import { useState, useTransition } from "react";
import {
  CalendarCheck2,
  CalendarDays,
  CalendarRange,
  Clock3,
  Loader2,
  Moon,
  Sun,
  Sunset,
} from "lucide-react";
import { createBlock, createBlockRange } from "./actions";

const PRESETS = [
  { key: "manha", label: "Manhã", detail: "08:00 - 12:00", Icon: Sun, start: "08:00", end: "12:00" },
  { key: "tarde", label: "Tarde", detail: "13:00 - 18:00", Icon: Sunset, start: "13:00", end: "18:00" },
  { key: "noite", label: "Noite", detail: "18:00 - 22:00", Icon: Moon, start: "18:00", end: "22:00" },
] as const;

const MOTIVOS = [
  "Outro consultório",
  "Clínica própria",
  "Reunião",
  "Folga / Férias",
  "Feriado",
  "Outro",
];

type BlockMode = "single" | "range";

function todayISO() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

function diffDays(from: string, to: string): number {
  if (!from || !to) return 0;
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000) + 1);
}

function formatShortDate(date: string): string {
  if (!date) return "";
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return "";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function pluralize(value: number, singular: string, plural: string) {
  return value === 1 ? singular : plural;
}

export function BlockForm() {
  const [mode, setMode] = useState<BlockMode>("single");
  const [isFullDay, setIsFullDay] = useState(false);
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
  const isRange = mode === "range";
  const activePreset = isFullDay ? "dia-inteiro" : PRESETS.find((p) => p.start === startTime && p.end === endTime)?.key;
  const periodDays = isRange ? diffDays(dateFrom, dateTo) : 0;
  const isLongPeriod = periodDays >= 7;

  function selectMode(nextMode: BlockMode) {
    setMode(nextMode);
    setError(null);
    setSuccess(null);
  }

  function applyFullDay() {
    setIsFullDay(true);
    setStartTime("");
    setEndTime("");
  }

  function applyPreset(start: string, end: string) {
    setIsFullDay(false);
    setStartTime(start);
    setEndTime(end);
  }

  function resetDates() {
    setDate("");
    setDateFrom("");
    setDateTo("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("reason", reason);
        fd.set("allDay", isFullDay ? "true" : "false");

        if (!isFullDay) {
          fd.set("startTime", startTime);
          fd.set("endTime", endTime);
        }

        if (isRange) {
          fd.set("dateFrom", dateFrom);
          fd.set("dateTo", dateTo);
          await createBlockRange(fd);

          const daysLabel = pluralize(periodDays, "dia", "dias");
          const rangeLabel = `${formatShortDate(dateFrom)} a ${formatShortDate(dateTo)}`;
          setSuccess(
            isFullDay
              ? `${periodDays} ${daysLabel} inteiros bloqueados (${rangeLabel}).`
              : `${periodDays} ${pluralize(periodDays, "bloqueio salvo", "bloqueios salvos")} (${rangeLabel}).`,
          );
        } else {
          fd.set("date", date);
          const result = await createBlock(fd);
          if (result?.error) {
            setError(result.error);
            return;
          }

          const dayLabel = formatShortDate(date);
          setSuccess(isFullDay ? `Dia inteiro de ${dayLabel} bloqueado.` : `Bloqueio de ${dayLabel} salvo.`);
        }

        resetDates();
        setTimeout(() => setSuccess(null), 5000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao salvar bloqueio.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="agenda-form">
      <div className="agenda-mode-toggle" role="group" aria-label="Tipo de bloqueio">
        <button
          type="button"
          className={`agenda-mode-btn${!isRange ? " active" : ""}`}
          onClick={() => selectMode("single")}
          aria-pressed={!isRange}
          disabled={isPending}
        >
          <CalendarDays size={16} strokeWidth={2} />
          <span>Dia único</span>
        </button>
        <button
          type="button"
          className={`agenda-mode-btn${isRange ? " active" : ""}`}
          onClick={() => selectMode("range")}
          aria-pressed={isRange}
          disabled={isPending}
        >
          <CalendarRange size={16} strokeWidth={2} />
          <span>Vários dias</span>
        </button>
      </div>

      {isRange ? (
        <div className="agenda-date-grid">
          <label>
            <span className="agenda-field-label">De</span>
            <input
              type="date"
              required
              value={dateFrom}
              min={today}
              disabled={isPending}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label>
            <span className="agenda-field-label">Até</span>
            <input
              type="date"
              required
              value={dateTo}
              min={dateFrom || today}
              disabled={isPending}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
        </div>
      ) : (
        <label>
          <span className="agenda-field-label">Data</span>
          <input
            type="date"
            required
            value={date}
            min={today}
            disabled={isPending}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      )}

      <div className="agenda-form-group">
        <div className="agenda-label-row">
          <span className="agenda-field-label">Escopo</span>
          <span>{isFullDay ? "Fecha o dia todo para a IA" : "Use um atalho ou ajuste abaixo"}</span>
        </div>

        <div className="agenda-preset-grid" role="group" aria-label="Escopo do bloqueio">
          <button
            type="button"
            className={`agenda-quick-btn${activePreset === "dia-inteiro" ? " active" : ""}`}
            onClick={applyFullDay}
            aria-pressed={isFullDay}
            disabled={isPending}
          >
            <CalendarCheck2 size={18} strokeWidth={2} />
            <span>Dia inteiro</span>
            <small>00:00 - 24:00</small>
          </button>

          {PRESETS.map(({ key, label, detail, Icon, start, end }) => (
            <button
              key={key}
              type="button"
              className={`agenda-quick-btn${activePreset === key ? " active" : ""}`}
              onClick={() => applyPreset(start, end)}
              aria-pressed={activePreset === key}
              disabled={isPending}
            >
              <Icon size={18} strokeWidth={2} />
              <span>{label}</span>
              <small>{detail}</small>
            </button>
          ))}
        </div>
      </div>

      {isFullDay ? (
        <div className="agenda-full-day-note">
          <Clock3 size={16} strokeWidth={2} />
          <span>O bloqueio vai da meia-noite ao início do dia seguinte no fuso da clínica.</span>
        </div>
      ) : (
        <div className="agenda-time-grid">
          <label>
            <span className="agenda-field-label">Início</span>
            <input
              type="time"
              required
              value={startTime}
              disabled={isPending}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </label>
          <label>
            <span className="agenda-field-label">Fim</span>
            <input
              type="time"
              required
              value={endTime}
              disabled={isPending}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </label>
        </div>
      )}

      <label>
        <span className="agenda-field-label">Motivo</span>
        <select
          className="agenda-select"
          value={reason}
          disabled={isPending}
          onChange={(e) => setReason(e.target.value)}
        >
          {MOTIVOS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </label>

      {isPending && isLongPeriod && (
        <p className="agenda-inline-status muted">
          Criando {periodDays} bloqueios no calendário, aguarde...
        </p>
      )}

      {error && <p className="agenda-inline-status error">{error}</p>}
      {success && <p className="agenda-inline-status success">{success}</p>}

      <button type="submit" className="primary-button agenda-submit" disabled={isPending}>
        {isPending ? (
          <Loader2 size={15} strokeWidth={2} style={{ animation: "spin 1s linear infinite" }} />
        ) : (
          <CalendarCheck2 size={15} strokeWidth={2} />
        )}
        {isPending ? "Salvando..." : isFullDay ? "Bloquear dia inteiro" : "Salvar bloqueio"}
      </button>
    </form>
  );
}
