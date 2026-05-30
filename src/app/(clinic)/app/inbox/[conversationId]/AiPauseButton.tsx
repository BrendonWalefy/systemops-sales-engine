"use client";
import { useTransition } from "react";
import { PauseCircle, PlayCircle } from "lucide-react";
import { pauseAi, resumeAi } from "./actions";

interface Props {
  conversationId: string;
  leadId: string;
  aiPaused: boolean;
  compact?: boolean;
}

export function AiPauseButton({ conversationId, leadId, aiPaused, compact }: Props) {
  const [pending, startTransition] = useTransition();

  const handleToggle = () => {
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
        className={aiPaused ? "primary-button" : "secondary-button"}
        style={{ gap: 6, padding: "5px 10px", fontSize: 12 }}
        disabled={pending}
        onClick={handleToggle}
        title={aiPaused ? "IA pausada — clique para retomar" : "IA ativa — clique para pausar"}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            flexShrink: 0,
            background: aiPaused ? "var(--warning)" : "var(--accent)",
            boxShadow: aiPaused ? "0 0 5px var(--warning)" : "0 0 5px var(--accent)",
          }}
        />
        {aiPaused ? (
          <>
            <PlayCircle size={13} />
            {pending ? "Retomando…" : "Ativar IA"}
          </>
        ) : (
          <>
            <PauseCircle size={13} />
            {pending ? "Pausando…" : "Pausar IA"}
          </>
        )}
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
          border: `1px solid ${aiPaused ? "color-mix(in srgb, var(--warning) 30%, transparent)" : "color-mix(in srgb, var(--accent) 30%, transparent)"}`,
          background: aiPaused
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
            background: aiPaused ? "var(--warning)" : "var(--accent)",
            boxShadow: aiPaused
              ? "0 0 6px var(--warning)"
              : "0 0 6px var(--accent)",
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 600, color: aiPaused ? "var(--warning)" : "var(--accent-strong)" }}>
          {aiPaused ? "IA pausada · respondendo pelo WhatsApp" : "IA respondendo automaticamente"}
        </span>
      </div>

      <button
        className={aiPaused ? "primary-button" : "secondary-button"}
        style={{ width: "100%", justifyContent: "center" }}
        disabled={pending}
        onClick={handleToggle}
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
