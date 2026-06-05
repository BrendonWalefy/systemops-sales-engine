"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";

interface Props {
  conversationId: string;
  defaultDurationMinutes: number;
  timezone: string;
}

export function ManualAppointmentForm({ conversationId, defaultDurationMinutes, timezone }: Props) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(String(defaultDurationMinutes));
  const [calendarEventId, setCalendarEventId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Preenche data/hora com "agora" no fuso da clínica ao abrir o form
  function handleOpen() {
    if (!open) {
      const now = new Date();
      const localStr = now.toLocaleString("sv-SE", { timeZone: timezone }); // "YYYY-MM-DD HH:MM:SS"
      const [datePart, timePart] = localStr.split(" ");
      setDate(datePart);
      setTime(timePart.slice(0, 5));
    }
    setOpen((v) => !v);
  }

  function handleSubmit() {
    if (!date || !time) return;
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}/register-appointment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date,
            time,
            durationMinutes: Number(duration) || defaultDurationMinutes,
            calendarEventId: calendarEventId.trim() || undefined,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Erro ao registrar agendamento.");
          return;
        }

        setOpen(false);
        setCalendarEventId("");
        setShowAdvanced(false);
        router.refresh();
      } catch {
        setError("Falha na conexão. Tente novamente.");
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        className="secondary-button"
        style={{ width: "100%", justifyContent: "space-between" }}
        onClick={handleOpen}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <CalendarPlus size={14} />
          Registrar agendamento
        </span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {open && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "12px",
            background: "color-mix(in srgb, var(--surface-raised) 80%, transparent)",
            border: "1px solid var(--line)",
            borderRadius: 8,
          }}
        >
          {error && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--danger)" }}>
              <AlertCircle size={13} />
              {error}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Data</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Horário</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
              Duração (min)
            </label>
            <input
              type="number"
              min={15}
              max={480}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              style={inputStyle}
            />
          </div>

          <button
            onClick={() => setShowAdvanced((v) => !v)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--muted)",
              fontSize: 11,
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {showAdvanced ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            Evento externo já existe
          </button>

          {showAdvanced && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
                ID do evento (opcional)
              </label>
              <input
                type="text"
                placeholder="Ex: abc123xyz..."
                value={calendarEventId}
                onChange={(e) => setCalendarEventId(e.target.value)}
                style={inputStyle}
              />
              <span style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.4 }}>
                Informe o ID para vincular ao evento existente e evitar duplicata externa.
              </span>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="primary-button"
              style={{ flex: 1, justifyContent: "center" }}
              onClick={handleSubmit}
              disabled={!date || !time || isPending}
            >
              {isPending ? "Registrando…" : "Confirmar agendamento"}
            </button>
            <button
              className="secondary-button"
              style={{ flexShrink: 0 }}
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 10px",
  color: "var(--text)",
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  colorScheme: "dark",
};
