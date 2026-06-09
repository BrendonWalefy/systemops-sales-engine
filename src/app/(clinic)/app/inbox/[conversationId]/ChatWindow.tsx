"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type Msg = {
  id: string;
  author: string;
  body: string;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | "audio" | "document" | null;
  sentAt: Date | string;
  deliveryFormat?: "text" | "audio" | null;
};

const TZ = "America/Sao_Paulo";

function formatTime(sentAt: Date | string): string {
  const d = sentAt instanceof Date ? sentAt : new Date(sentAt);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

function MediaPreview({ url, type }: { url?: string | null; type?: string | null }) {
  if (!url || !type) return null;

  if (type === "image") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: "block", marginBottom: "4px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="imagem" style={{ maxWidth: "220px", maxHeight: "180px", borderRadius: "8px", display: "block", objectFit: "cover" }} />
      </a>
    );
  }

  if (type === "video") {
    return (
      <video controls src={url} style={{ maxWidth: "280px", borderRadius: "8px", display: "block", marginBottom: "4px" }}>
        <track kind="captions" />
      </video>
    );
  }

  if (type === "audio") {
    return (
      <audio controls src={url} style={{ width: "220px", display: "block", marginBottom: "4px" }} />
    );
  }

  if (type === "document") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#34d399", marginBottom: "4px" }}>
        📎 Documento
      </a>
    );
  }

  return null;
}

interface Props {
  initialMessages: Msg[];
  conversationId: string;
  leadName: string | null;
  leadPhone: string | null;
}

export function ChatWindow({ initialMessages, conversationId, leadName, leadPhone }: Props) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const scrollToBottom = useCallback((instant = false) => {
    if (!isNearBottomRef.current && !instant) return;
    bottomRef.current?.scrollIntoView({ behavior: instant ? "instant" : "smooth" });
  }, []);

  // Scroll to bottom on first render
  useEffect(() => {
    scrollToBottom(true);
  }, [scrollToBottom]);

  // Track if user is near the bottom to decide whether to auto-scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 120;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // Sync when server re-renders with more messages (e.g. after router.refresh())
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages((prev) =>
      initialMessages.length > prev.length ? initialMessages : prev,
    );
  }, [initialMessages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for new messages every 3 seconds
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages`);
        if (!res.ok) return;
        const data: { messages: Msg[] } = await res.json();
        setMessages((prev) => (data.messages.length !== prev.length ? data.messages : prev));
      } catch {
        // silently ignore network errors between polls
      }
    };

    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [conversationId]);

  // Auto-scroll when message count grows
  useEffect(() => {
    scrollToBottom(false);
  }, [messages.length, scrollToBottom]);

  // Scroll to bottom when keyboard opens/closes (visual viewport resize)
  useEffect(() => {
    const vp = window.visualViewport;
    if (!vp) return;
    const onResize = () => {
      if (isNearBottomRef.current) scrollToBottom(true);
    };
    vp.addEventListener("resize", onResize);
    return () => vp.removeEventListener("resize", onResize);
  }, [scrollToBottom]);

  const displayName = leadName ?? leadPhone ?? "Lead";

  return (
    <div ref={containerRef} className="conv-messages">
      <div className="chat-window" style={{ flex: 1, maxHeight: "none", minHeight: 0 }}>
        {messages.length === 0 && (
          <div className="empty-conversation" style={{ margin: "auto" }}>
            <strong>Sem mensagens</strong>
            <span>As mensagens desta conversa aparecerão aqui.</span>
          </div>
        )}
        {messages.map((msg) => {
          const isAgent = msg.author === "agent";
          const isOperator = msg.author === "clinic_user";
          const isRight = isAgent || isOperator;
          return (
            <div key={msg.id} className={`chat-message ${isRight ? "agent" : "lead"}`}>
              <div className="message-meta">
                {isAgent && (
                  <span className="agent-badge" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    IA Recepcionista
                    {msg.deliveryFormat === "audio" && (
                      <span title="Enviado como áudio" style={{ fontSize: 10, opacity: 0.75 }}>🔊</span>
                    )}
                  </span>
                )}
                {isOperator && (
                  <span className="agent-badge" style={{ color: "var(--cold)" }}>
                    Operador
                  </span>
                )}
                {!isRight && <span className="lead-badge">{displayName}</span>}
                <span className="message-time">{formatTime(msg.sentAt)}</span>
              </div>
              <MediaPreview url={msg.mediaUrl} type={msg.mediaType} />
              {msg.body && <p>{msg.body}</p>}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
