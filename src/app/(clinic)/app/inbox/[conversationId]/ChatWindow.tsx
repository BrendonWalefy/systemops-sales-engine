"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, useTransition } from "react";
import { Play, FileText } from "lucide-react";
import { useResourceVersion } from "@/components/use-resource-version";

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

function getLocalDateStr(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: TZ }); // "YYYY-MM-DD"
}

function formatDateLabel(dateStr: string): string {
  const now = new Date();
  const today = getLocalDateStr(now);
  const yesterday = getLocalDateStr(new Date(now.getTime() - 86_400_000));
  if (dateStr === today) return "Hoje";
  if (dateStr === yesterday) return "Ontem";

  // parse at noon to avoid DST edge cases
  const d = new Date(`${dateStr}T12:00:00`);
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  }
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
}

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="msg-date-separator">
      <span>{label}</span>
    </div>
  );
}

function VideoCard({ url, title }: { url: string; title?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (expanded) {
    return (
      <div style={{ marginBottom: 6 }}>
        <video controls autoPlay src={url}
          style={{ width: "100%", borderRadius: 10, display: "block", maxHeight: 280 }}>
          <track kind="captions" />
        </video>
      </div>
    );
  }
  return (
    <button className="msg-video-card" onClick={() => setExpanded(true)}>
      <div className="msg-video-thumb">
        <video src={`${url}#t=0.5`} preload="metadata" muted playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: "10px 10px 0 0" }} />
        <div className="msg-video-play">
          <div className="msg-video-play-btn">
            <Play size={22} fill="white" color="white" />
          </div>
        </div>
      </div>
      {title && (
        <div className="msg-video-footer">
          <span className="msg-video-title">{title}</span>
          <span className="msg-video-sub">Toque para assistir</span>
        </div>
      )}
    </button>
  );
}

function ImageCard({ url, title }: { url: string; title?: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="msg-media-card" style={{ display: "flex", textDecoration: "none" }}>
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

function DocumentLink({ url, title }: { url: string; title?: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="msg-media-card" style={{ display: "flex", textDecoration: "none" }}>
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
  if (type === "audio") return <audio controls src={url} style={{ width: "100%", marginBottom: 4, display: "block" }} />;
  if (type === "document") return <DocumentLink url={url} title={title} />;
  return null;
}

function cleanBody(body: string): string {
  return body.replace(/\[(?:VÍDEO|VIDEO|FOTO|IMAGEM|IMAGE|MEDIA:[a-zA-Z0-9_-]+)\][^\n]*/gi, "").trim();
}

type ListItem =
  | { kind: "separator"; dateStr: string }
  | { kind: "message"; msg: Msg };

interface Props {
  initialMessages: Msg[];
  conversationId: string;
  leadName: string | null;
  leadPhone: string | null;
  hasOlderMessages?: boolean;
}

export function ChatWindow({ initialMessages, conversationId, leadName, leadPhone, hasOlderMessages = false }: Props) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [canLoadOlder, setCanLoadOlder] = useState(hasOlderMessages);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const latestMessageIdRef = useRef<string | null>(initialMessages.at(-1)?.id ?? null);

  // Direct container scroll — mais confiável que scrollIntoView em layout fixed
  const scrollToBottom = useCallback((instant = false) => {
    const el = containerRef.current;
    if (!el) return;
    if (!isNearBottomRef.current && !instant) return;
    if (instant) {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, []);

  // useLayoutEffect garante scroll antes do paint — elimina o flash de topo
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []); // só na montagem

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

  const loadNewMessages = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (latestMessageIdRef.current) params.set("after", latestMessageIdRef.current);
      const query = params.toString();
      const res = await fetch(`/api/conversations/${conversationId}/messages${query ? `?${query}` : ""}`);
      if (!res.ok) return;
      const data: { messages: Msg[] } = await res.json();
      if (data.messages.length === 0) return;
      setMessages((prev) => {
        const knownIds = new Set(prev.map((m) => m.id));
        const next = data.messages.filter((m) => !knownIds.has(m.id));
        return next.length > 0 ? [...prev, ...next] : prev;
      });
    } catch {
      // Ignore network errors; the next version check retries safely.
    }
  }, [conversationId]);

  useResourceVersion(`/api/conversations/${conversationId}/version`, {
    intervalMs: 5_000,
    onChange: loadNewMessages,
  });

  useEffect(() => { scrollToBottom(false); }, [messages.length, scrollToBottom]);

  const loadOlderMessages = useCallback(() => {
    const firstId = messages[0]?.id;
    if (!firstId || !canLoadOlder) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages?before=${firstId}`);
        if (!res.ok) return;
        const data: { messages: Msg[] } = await res.json();
        if (data.messages.length === 0) { setCanLoadOlder(false); return; }
        const el = containerRef.current;
        const prevHeight = el?.scrollHeight ?? 0;
        setMessages((prev) => {
          const knownIds = new Set(prev.map((m) => m.id));
          const older = data.messages.filter((m) => !knownIds.has(m.id));
          return older.length > 0 ? [...older, ...prev] : prev;
        });
        setCanLoadOlder(data.messages.length >= 60);
        // Preserve scroll position after prepend
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight;
        });
      } catch { /* ignore */ }
    });
  }, [messages, conversationId, canLoadOlder]);

  useEffect(() => {
    const vp = window.visualViewport;
    if (!vp) return;
    const onResize = () => { if (isNearBottomRef.current) scrollToBottom(true); };
    vp.addEventListener("resize", onResize);
    return () => vp.removeEventListener("resize", onResize);
  }, [scrollToBottom]);

  const displayName = leadName ?? leadPhone ?? "Lead";

  // Intercala separadores de data entre mensagens de dias diferentes
  const listItems = useMemo<ListItem[]>(() => {
    let lastDateStr: string | null = null;
    const result: ListItem[] = [];
    for (const msg of messages) {
      const dateStr = getLocalDateStr(new Date(msg.sentAt));
      if (dateStr !== lastDateStr) {
        result.push({ kind: "separator", dateStr });
        lastDateStr = dateStr;
      }
      result.push({ kind: "message", msg });
    }
    return result;
  }, [messages]);

  return (
    <div ref={containerRef} className="conv-messages">
      <div className="chat-window" style={{ flex: 1, maxHeight: "none", minHeight: 0 }}>
        {canLoadOlder && (
          <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
            <button
              onClick={loadOlderMessages}
              disabled={isPending}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 20,
                color: "rgba(255,255,255,0.6)",
                fontSize: 12,
                padding: "5px 14px",
                cursor: isPending ? "default" : "pointer",
                opacity: isPending ? 0.5 : 1,
              }}
            >
              {isPending ? "Carregando..." : "Ver mensagens anteriores"}
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <div className="empty-conversation" style={{ margin: "auto" }}>
            <strong>Sem mensagens</strong>
            <span>As mensagens desta conversa aparecerão aqui.</span>
          </div>
        )}

        {listItems.map((item) => {
          if (item.kind === "separator") {
            return <DateSeparator key={`sep-${item.dateStr}`} label={formatDateLabel(item.dateStr)} />;
          }

          const { msg } = item;
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
                {isOperator && <span className="agent-badge" style={{ color: "var(--cold)" }}>OP</span>}
                {!isRight && <span className="lead-badge">{displayName}</span>}
                <span className="message-time">{formatTime(msg.sentAt)}</span>
              </div>

              {hasMedia && (
                <MediaPreview url={msg.mediaUrl} type={msg.mediaType} title={bodyText || undefined} />
              )}
              {bodyText && !hasMedia && <p>{bodyText}</p>}
              {bodyText && hasMedia && msg.mediaType === "audio" && <p>{bodyText}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
