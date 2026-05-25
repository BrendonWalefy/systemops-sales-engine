"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Send, AlertCircle } from "lucide-react";

interface Props {
  conversationId: string;
}

export function MessageInput({ conversationId }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Ajusta altura do textarea automaticamente
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || isPending) return;
    setError(null);

    startTransition(async () => {
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
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      style={{
        borderTop: "1px solid var(--line)",
        background: "var(--surface)",
        flexShrink: 0,
        padding: "12px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--danger)",
          }}
        >
          <AlertCircle size={13} />
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Responder como operador… (Enter para enviar, Shift+Enter para nova linha)"
          rows={1}
          disabled={isPending}
          style={{
            flex: 1,
            resize: "none",
            overflow: "hidden",
            background: "var(--surface-raised)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "9px 13px",
            color: "var(--text)",
            fontSize: 14,
            lineHeight: 1.5,
            outline: "none",
            transition: "border-color 120ms ease",
          }}
        />
        <button
          className="primary-button"
          onClick={handleSubmit}
          disabled={!text.trim() || isPending}
          style={{ padding: "0 16px", height: 40, flexShrink: 0 }}
          title="Enviar"
        >
          <Send size={14} />
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "var(--muted)", opacity: 0.7 }}>
        Mensagem enviada como operador — IA pausada automaticamente nesta conversa.
      </p>
    </div>
  );
}
