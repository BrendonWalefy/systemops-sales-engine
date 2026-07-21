"use client";
import { useTransition } from "react";
import { PauseCircle, PlayCircle } from "lucide-react";
import { pauseAi, resumeAi } from "./actions";

interface Props {
  conversationId: string;
  leadId: string;
  aiPaused: boolean;
  /** IA ligada para a clínica inteira. Se `false`, a IA está pausada globalmente
   *  e o toggle por conversa não a reativa — o indicador reflete esse estado. */
  clinicAutoReplyEnabled?: boolean;
  compact?: boolean;
}

export function AiPauseButton({ conversationId, leadId, aiPaused, clinicAutoReplyEnabled = true, compact }: Props) {
  const [pending, startTransition] = useTransition();

  // A IA só responde de fato se estiver ligada na clínica E não pausada nesta conversa.
  const clinicOff = clinicAutoReplyEnabled === false;
  const effectivePaused = aiPaused || clinicOff;

  const handleToggle = () => {
    if (clinicOff) return;
    startTransition(() => {
      if (aiPaused) {
        resumeAi(conversationId);
      } else {
        pauseAi(conversationId, leadId);
      }
    });
  };

  if (compact) {
    return (
      <button
        className={`ai-status-pill${effectivePaused ? " paused" : " active"}`}
        disabled={pending || clinicOff}
        onClick={handleToggle}
        title={
          clinicOff
            ? "IA desligada para toda a clínica — ative em Configurações › IA"
            : aiPaused
              ? "IA pausada — clique para retomar"
              : "IA ativa — clique para pausar"
        }
      >
        <span className="ai-status-dot" />
        {clinicOff
          ? "IA Pausada"
          : pending
            ? (aiPaused ? "Retomando…" : "Pausando…")
            : (aiPaused ? "IA Pausada" : "IA Ativa")}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 11px",
          borderRadius: 8,
          border: `1px solid ${effectivePaused ? "color-mix(in srgb, var(--warning) 30%, transparent)" : "color-mix(in srgb, var(--accent) 30%, transparent)"}`,
          background: effectivePaused
            ? "color-mix(in srgb, var(--warning) 8%, transparent)"
            : "color-mix(in srgb, var(--accent) 8%, transparent)",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            flexShrink: 0,
            background: effectivePaused ? "var(--warning)" : "var(--accent)",
            boxShadow: effectivePaused
              ? "0 0 6px var(--warning)"
              : "0 0 6px var(--accent)",
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 600, color: effectivePaused ? "var(--warning)" : "var(--accent-strong)" }}>
          {clinicOff
            ? "IA desligada para toda a clínica"
            : aiPaused
              ? "IA pausada · respondendo pelo WhatsApp"
              : "IA respondendo automaticamente"}
        </span>
      </div>

      <button
        className={effectivePaused ? "primary-button" : "secondary-button"}
        style={{ width: "100%", justifyContent: "center" }}
        disabled={pending || clinicOff}
        onClick={handleToggle}
        title={clinicOff ? "Ative a IA da clínica em Configurações › IA" : undefined}
      >
        {aiPaused ? (
          <>
            <PlayCircle size={14} />
            {pending ? "Retomando IA…" : "Retomar IA"}
          </>
        ) : (
          <>
            <PauseCircle size={14} />
            {pending ? "Pausando IA…" : "Pausar IA"}
          </>
        )}
      </button>
    </div>
  );
}
