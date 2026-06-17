"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Play, FileText, Image as ImageIcon } from "lucide-react";

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

function VideoCard({ url, title }: { url: string; title?: string }) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <div style={{ marginBottom: 6 }}>
        <video
          controls
          autoPlay
          src={url}
          style={{ width: "100%", borderRadius: 10, display: "block", maxHeight: 220 }}
        >
          <track kind="captions" />
        </video>
      </div>
    );
  }

  return (
    <button
      className="msg-media-card"
      onClick={() => setExpanded(true)}
      style={{ width: "100%", background: "none", border: "none", padding: 0, textAlign: "left" }}
    >
      <div className="msg-media-thumb">
        <video
          src={`${url}#t=0.5`}
          preload="metadata"
          muted
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        <div className="msg-media-thumb-overlay">
          <Play size={18} fill="white" color="white" />
        </div>
      </div>
      <div className="msg-media-info">
        <div className="msg-media-title">{title || "Vídeo"}</div>
        <div className="msg-media-sub">Toque para assistir</div>
      </div>
    </button>
  );
}

function ImageCard({ url, title }: { url: string; title?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="msg-media-card"
      style={{ display: "flex", textDecoration: "none" }}
    >
      <div className="msg-media-thumb">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={title || "imagem"} />
      </div>
      <div className="msg-media-info">
        <div className="msg-media-title">{title || "Imagem"}</div>
        <div className="msg-media-sub">Toque para ampliar</div>
      </div>
    </a>
  );
}

function AudioPlayer({ url }: { url: string }) {
  return (
    <audio controls src={url} style={{ width: "100%", marginBottom: 4, display: "block" }} />
  );
}

function DocumentLink({ url, title }: { url: string; title?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="msg-media-card"
      style={{ display: "flex", textDecoration: "none" }}
    >
      <div className="msg-media-thumb">
        <FileText size={20} color="rgba(255,255,255,0.7)" />
      </div>
      <div className="msg-media-info">
        <div className="msg-media-title">{title || "Documento"}</div>
        <div className="msg-media-sub">Toque para abrir</div>
      </div>
    </a>
  );
}

function MediaPreview({ url, type, title }: { url?: string | null; type?: string | null; title?: string }) {
  if (!url || !type) return null;
  if (type === "video") return <VideoCard url={url} title={title} />;
  if (type === "image") return <ImageCard url={url} title={title} />;
  if (type === "audio") return <AudioPlayer url={url} />;
  if (type === "document") return <DocumentLink url={url} title={title} />;
  return null;
}

function cleanBody(body: string): string {
  return body.replace(/\[(?:VÍDEO|VIDEO|FOTO|IMAGEM|IMAGE|MEDIA:[a-zA-Z0-9_-]+)\][^\n]*/gi, "").trim();
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
  const latestMessageIdRef = useRef<string | null>(initialMessages.at(-1)?.id ?? null);

  const scrollToBottom = useCallback((instant = false) => {
    if (!isNearBottomRef.current && !instant) return;
    bottomRef.current?.scrollIntoView({ behavior: instant ? "instant" : "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(true); }, [scrollToBottom]);

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages((prev) =>
      initialMessages.length > prev.length ? initialMessages : prev,
    );
  }, [initialMessages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    latestMessageIdRef.current = messages.at(-1)?.id ?? null;
  }, [messages]);

  useEffect(() => {
    const poll = async () => {
      try {
        const params = new URLSearchParams();
        if (latestMessageIdRef.current) params.set("after", latestMessageIdRef.current);
        const query = params.toString();
        const res = await fetch(`/api/conversations/${conversationId}/messages${query ? `?${query}` : ""}`);
        if (!res.ok) return;
        const data: { messages: Msg[] } = await res.json();
        if (data.messages.length === 0) return;
        setMessages((prev) => {
          const knownIds = new Set(prev.map((msg) => msg.id));
          const nextMessages = data.messages.filter((msg) => !knownIds.has(msg.id));
          return nextMessages.length > 0 ? [...prev, ...nextMessages] : prev;
        });
      } catch {
        // ignore network errors between polls
      }
    };
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [conversationId]);

  useEffect(() => { scrollToBottom(false); }, [messages.length, scrollToBottom]);

  useEffect(() => {
    const vp = window.visualViewport;
    if (!vp) return;
    const onResize = () => { if (isNearBottomRef.current) scrollToBottom(true); };
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
          const hasMedia = !!(msg.mediaUrl && msg.mediaType);
          const bodyText = cleanBody(msg.body);

          return (
            <div key={msg.id} className={`chat-message ${isRight ? "agent" : "lead"}`}>
              <div className="message-meta">
                {isAgent && (
                  <span className="agent-badge">
                    IA
                    {msg.deliveryFormat === "audio" && (
                      <span title="Enviado como áudio" style={{ fontSize: 10 }}>🔊</span>
                    )}
                  </span>
                )}
                {isOperator && (
                  <span className="agent-badge" style={{ color: "var(--cold)" }}>OP</span>
                )}
                {!isRight && <span className="lead-badge">{displayName}</span>}
                <span className="message-time">{formatTime(msg.sentAt)}</span>
              </div>

              {hasMedia && (
                <MediaPreview
                  url={msg.mediaUrl}
                  type={msg.mediaType}
                  title={bodyText || undefined}
                />
              )}

              {bodyText && !hasMedia && <p>{bodyText}</p>}
              {bodyText && hasMedia && msg.mediaType === "audio" && <p>{bodyText}</p>}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
