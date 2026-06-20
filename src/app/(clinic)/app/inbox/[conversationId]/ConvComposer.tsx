"use client";

import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Calendar, Send, AlertCircle, CalendarPlus } from "lucide-react";
import { pauseAi, resumeAi } from "./actions";

interface Props {
  conversationId: string;
  leadId: string;
  aiPaused: boolean;
  leadName: string | null;
  treatmentInterest: string | null;
  temperature: string | null;
  leadStatus: string | null;
  needsAttention: boolean;
  attentionReason: string | null;
  defaultDurationMinutes: number;
  timezone: string;
}

function deriveNextAction(params: {
  temperature: string | null;
  status: string | null;
  needsAttention: boolean;
  attentionReason: string | null;
  aiPaused: boolean;
}): string | null {
  if (params.needsAttention) return params.attentionReason ?? "Lead pediu atendimento humano";
  if (!params.aiPaused) return null;
  if (params.temperature === "hot") {
    if (params.status === "qualified" || params.status === "proposal_sent") return "Confirmar proposta ou fechar agendamento";
    return "Avançar para proposta — lead está quente";
  }
  if (params.temperature === "warm") {
    return "Enviar casos reais para reforçar valor";
  }
  return "Qualificar interesse e identificar tratamento";
}

export function ConvComposer({
  conversationId,
  leadId,
  aiPaused,
  treatmentInterest,
  temperature,
  leadStatus,
  needsAttention,
  attentionReason,
  defaultDurationMinutes,
  timezone,
}: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, startSend] = useTransition();
  const [isAiToggling, startAiToggle] = useTransition();
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("");
  const [schedDuration, setSchedDuration] = useState(String(defaultDurationMinutes));
  const [schedError, setSchedError] = useState<string | null>(null);
  const [isScheduling, startSchedule] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  const nextAction = deriveNextAction({ temperature, status: leadStatus, needsAttention, attentionReason, aiPaused });

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    setError(null);
    startSend(async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Erro ao enviar mensagem.");
          return;
        }
        setText("");
        router.refresh();
      } catch {
        setError("Falha na conexão. Tente novamente.");
      }
    });
  }, [text, isSending, conversationId, router]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestAi = async () => {
    if (isSuggesting) return;
    setIsSuggesting(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/suggest-reply`);
      if (!res.ok) throw new Error("Erro");
      const data: { suggestion?: string } = await res.json();
      if (data.suggestion) {
        setText(data.suggestion);
        textareaRef.current?.focus();
      }
    } catch {
      setError("Não foi possível gerar sugestão. Tente novamente.");
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleAiToggle = () => {
    startAiToggle(() => {
      if (aiPaused) return resumeAi(conversationId);
      return pauseAi(conversationId, leadId);
    });
  };

  function fillTemplate(template: string) {
    setText(template);
    textareaRef.current?.focus();
  }

  function handleOpenSchedule() {
    if (!scheduleOpen) {
      const now = new Date();
      const localStr = now.toLocaleString("sv-SE", { timeZone: timezone });
      const [datePart, timePart] = localStr.split(" ");
      setSchedDate(datePart);
      setSchedTime(timePart.slice(0, 5));
    }
    setScheduleOpen((v) => !v);
  }

  function handleScheduleSubmit() {
    if (!schedDate || !schedTime) return;
    setSchedError(null);
    startSchedule(async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}/register-appointment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: schedDate,
            time: schedTime,
            durationMinutes: Number(schedDuration) || defaultDurationMinutes,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setSchedError(data.error ?? "Erro ao registrar."); return; }
        setScheduleOpen(false);
        router.refresh();
      } catch {
        setSchedError("Falha na conexão.");
      }
    });
  }

  const proposalTemplate = treatmentInterest
    ? `Ótimo! Posso preparar uma proposta personalizada para ${treatmentInterest}. Você prefere receber por aqui ou quer agendar uma consulta de avaliação sem compromisso?`
    : `Ótimo! Posso preparar uma proposta personalizada para você. Qual é a melhor forma de te enviar?`;

  const casesTemplate = treatmentInterest
    ? `Vou te mostrar alguns casos reais de ${treatmentInterest} que realizamos. Um momento! 😊`
    : `Vou te enviar alguns casos reais do nosso trabalho. Um momento!`;

  return (
    <div className="conv-composer">
      {nextAction && (
        <div className="conv-next-action-bar">
          <Sparkles size={12} color="var(--accent-strong)" />
          <span className="conv-next-action-label">Próxima ação: {nextAction}</span>
        </div>
      )}

      <div className="conv-chips-row">
        <button
          className="conv-chip chip-ai"
          onClick={handleSuggestAi}
          disabled={isSuggesting}
          title="Gera uma sugestão de resposta com IA"
        >
          <Sparkles size={12} />
          {isSuggesting ? "Gerando…" : "Sugerir IA"}
        </button>

        <button
          className="conv-chip"
          onClick={() => fillTemplate(casesTemplate)}
          title="Pré-preenche resposta sobre casos reais"
        >
          Casos reais
        </button>

        <button
          className="conv-chip"
          onClick={() => fillTemplate(proposalTemplate)}
          title="Pré-preenche template de proposta"
        >
          Proposta
        </button>

        <button
          className="conv-chip"
          onClick={handleOpenSchedule}
          title="Registrar agendamento"
        >
          <Calendar size={12} />
          Agendar
        </button>
      </div>

      {scheduleOpen && (
        <div className="conv-schedule-panel">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 0 4px" }}>
            {schedError && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--danger)" }}>
                <AlertCircle size={13} />
                {schedError}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <label style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Data</label>
                <input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <label style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Horário</label>
                <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <label style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Duração (min)</label>
              <input
                type="number" min={15} max={480}
                value={schedDuration} onChange={(e) => setSchedDuration(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="primary-button"
                style={{ flex: 1, justifyContent: "center", gap: 6 }}
                onClick={handleScheduleSubmit}
                disabled={!schedDate || !schedTime || isScheduling}
              >
                <CalendarPlus size={13} />
                {isScheduling ? "Registrando…" : "Confirmar"}
              </button>
              <button className="secondary-button" onClick={() => setScheduleOpen(false)} disabled={isScheduling}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="conv-composer-error">
          <AlertCircle size={13} />
          {error}
        </div>
      )}

      <div className="conv-input-row">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Responder como operador…"
          rows={1}
          disabled={isSending}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={false}
          enterKeyHint="send"
        />
        <button
          className="conv-send-btn"
          onClick={handleSend}
          disabled={!text.trim() || isSending}
          title="Enviar"
        >
          <Send size={15} />
        </button>
      </div>
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
