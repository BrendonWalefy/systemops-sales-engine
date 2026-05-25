"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type Msg = {
  id: string;
  author: string;
  body: string;
  sentAt: Date | string;
};

const TZ = "America/Sao_Paulo";

function formatTime(sentAt: Date | string): string {
  const d = sentAt instanceof Date ? sentAt : new Date(sentAt);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
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
                {isAgent && <span className="agent-badge">IA Recepcionista</span>}
                {isOperator && (
                  <span className="agent-badge" style={{ color: "var(--cold)" }}>
                    Operador
                  </span>
                )}
                {!isRight && <span className="lead-badge">{displayName}</span>}
                <span className="message-time">{formatTime(msg.sentAt)}</span>
              </div>
              <p>{msg.body}</p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
