"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Search, Inbox, RefreshCw, Send, X } from "lucide-react";
import { composeRecoveryMessageAction, sendRecoveryMessageAction } from "./recovery-actions";
import { filterBySearch, filterLiveRowsByTab, sortInboxRowsByRecency, type LiveInboxTabFilter } from "./inbox-filter";
import { isConversationUnreadByClinic } from "./inbox-visibility";
import { tempKey, tempLabel, avatarColor, relativeTime } from "./inbox-utils";

export type ConvRow = {
  convId: string;
  leadId: string;
  lastMessageAt: Date | null;
  lastReadAt: Date | null;
  needsAttention: boolean;
  attentionReason: string | null;
  aiPaused: boolean;
  takeoverExpiresAt?: Date | null;
  leadName: string | null;
  leadPhone: string | null;
  leadStatus: string;
  leadTemperature: string | null;
  leadTreatmentInterest: string | null;
  leadProfilePicUrl: string | null;
  appointmentStartsAt?: Date | null;
  hoursWaiting?: number;
};

const PIPELINE_STEPS = ["Novo", "Qualific.", "Proposta", "Agendar", "Fechado"] as const;

const RECOVERY_WAIT_HOURS = 2;

function isRecoveryCandidate(
  row: ConvRow,
  lastMsg: { author: string } | undefined,
): boolean {
  if (row.leadStatus === "lost" || row.leadStatus === "won") return false;
  const hours = row.hoursWaiting ?? 0;
  // Takeover expirado mas cron ainda não rodou (até 1h de gap)
  if (row.aiPaused && row.takeoverExpiresAt && new Date(row.takeoverExpiresAt) < new Date()) return true;
  // IA ativa mas lead esperando 2h+ sem resposta do agente
  if (!row.aiPaused && lastMsg?.author === "lead" && hours >= RECOVERY_WAIT_HOURS) return true;
  return false;
}

function formatWaitTime(hours: number): string {
  if (hours < 1) return "< 1h";
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}

function RecoveryModal({
  row,
  lastMsg,
  onClose,
}: {
  row: ConvRow;
  lastMsg: { body: string; author: string };
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [, startTransition] = useTransition();

  const displayName = row.leadName ?? row.leadPhone ?? "Lead";

  function handleGenerate() {
    setLoading(true);
    setError(null);
    startTransition(async () => {
      const result = await composeRecoveryMessageAction(row.convId);
      setLoading(false);
      if (result.error) {
        setError(result.error);
      } else {
        setMessage(result.message ?? "");
      }
    });
  }

  function handleSend() {
    if (!message.trim()) return;
    setSending(true);
    setError(null);
    startTransition(async () => {
      const result = await sendRecoveryMessageAction(row.convId, message.trim());
      setSending(false);
      if (result.error) {
        setError(result.error);
      } else {
        setSent(true);
        setTimeout(onClose, 1200);
      }
    });
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 480,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
              Retomada — {displayName}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              Esperando há {formatWaitTime(row.hoursWaiting ?? 0)} · última msg: &ldquo;{lastMsg.body.slice(0, 60)}{lastMsg.body.length > 60 ? "…" : ""}&rdquo;
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--muted)" }}
          >
            <X size={18} />
          </button>
        </div>

        {!message && !loading && (
          <button
            onClick={handleGenerate}
            style={{
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "10px 16px",
              cursor: "pointer",
              fontSize: 13,
              color: "var(--text)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <RefreshCw size={14} />
            Gerar mensagem com IA
          </button>
        )}

        {loading && (
          <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "12px 0" }}>
            Gerando mensagem…
          </div>
        )}

        {message && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
              MENSAGEM (edite se necessário)
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              style={{
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                color: "var(--text)",
                fontSize: 14,
                resize: "vertical",
                fontFamily: "inherit",
                lineHeight: 1.5,
              }}
            />
            <button
              onClick={handleGenerate}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--muted)",
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: 0,
                alignSelf: "flex-start",
              }}
            >
              <RefreshCw size={12} />
              Gerar novamente
            </button>
          </div>
        )}

        {error && (
          <div style={{ fontSize: 12, color: "#ef4444", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: 6 }}>
            {error}
          </div>
        )}

        {sent && (
          <div style={{ fontSize: 13, color: "#10b981", textAlign: "center", fontWeight: 600 }}>
            Mensagem enviada ✓
          </div>
        )}

        {message && !sent && (
          <button
            onClick={handleSend}
            disabled={sending || !message.trim()}
            style={{
              background: "#059669",
              border: "none",
              borderRadius: 8,
              padding: "11px 16px",
              cursor: sending ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 600,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: sending ? 0.6 : 1,
            }}
          >
            <Send size={14} />
            {sending ? "Enviando…" : "Enviar"}
          </button>
        )}
      </div>
    </div>
  );
}

function RecoveryCard({
  row,
  lastMsg,
}: {
  row: ConvRow;
  lastMsg: { body: string; author: string };
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const displayName = row.leadName ?? row.leadPhone ?? "Lead";
  const accentColor = avatarColor(row.leadTemperature);
  const initial = displayName[0]?.toUpperCase() ?? "?";
  const hours = row.hoursWaiting ?? 0;
  const waitLabel = formatWaitTime(hours);
  const reason = row.aiPaused ? "Takeover expirado" : `Sem resposta há ${waitLabel}`;

  return (
    <>
      {modalOpen && (
        <RecoveryModal
          row={row}
          lastMsg={lastMsg}
          onClose={() => setModalOpen(false)}
        />
      )}
      <div
        className="inbox-card-v2"
        style={{ borderLeft: "3px solid #f59e0b" }}
      >
        <div className="inbox-card-v2-top">
          <span style={{ fontSize: 11, fontWeight: 600, color: "#f59e0b" }}>{reason}</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            {row.lastMessageAt ? relativeTime(new Date(row.lastMessageAt)) : "—"}
          </span>
        </div>

        <div className="inbox-card-v2-body">
          <div
            className="avatar-v2"
            style={{
              background: `linear-gradient(145deg, color-mix(in srgb, ${accentColor} 22%, transparent), var(--surface-raised))`,
              borderColor: accentColor,
              color: accentColor,
            }}
          >
            {initial}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {displayName}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {lastMsg.body ? `"${lastMsg.body.slice(0, 48)}${lastMsg.body.length > 48 ? "…" : ""}"` : "Sem mensagens"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <Link
            href={`/app/inbox/${row.convId}`}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "7px 0",
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              fontSize: 12,
              color: "var(--text)",
              textDecoration: "none",
            }}
          >
            Ver conversa
          </Link>
          <button
            onClick={() => setModalOpen(true)}
            style={{
              flex: 1,
              padding: "7px 0",
              background: "#059669",
              border: "none",
              borderRadius: 7,
              fontSize: 12,
              fontWeight: 600,
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <Send size={12} />
            Enviar retomada
          </button>
        </div>
      </div>
    </>
  );
}

function cardBorderClass(row: ConvRow, lastAuthor: string): string {
  if (row.needsAttention) return "card-border-attention";
  if (row.aiPaused) return "card-border-paused";
  if (lastAuthor === "agent") return "card-border-ai-active";
  return "card-border-default";
}

function pipelineIndex(status: string): number {
  if (status === "new") return 0;
  if (status === "waiting_response" || status === "in_conversation") return 1;
  if (status === "follow_up_due") return 2;
  if (status === "appointment_scheduled") return 3;
  return 4;
}

function convStatusBadge(
  row: ConvRow,
  lastAuthor: string,
): { label: string; variant: "hot" | "warm" | "accent" | "muted" } {
  if (row.needsAttention) return { label: "Requer humano", variant: "hot" };
  if (row.aiPaused) return { label: "Aguardando retorno", variant: "warm" };
  if (lastAuthor === "agent") return { label: "IA respondendo", variant: "accent" };
  if (lastAuthor === "lead") return { label: "Aguardando resposta", variant: "warm" };
  return { label: "Em conversa", variant: "muted" };
}

function markConversationRead(conversationId: string): void {
  void fetch(`/api/conversations/${conversationId}/read`, {
    method: "POST",
    keepalive: true,
  }).catch(() => {});
}

function InboxCard({
  row,
  lastMsg,
}: {
  row: ConvRow;
  lastMsg: { body: string; author: string };
}) {
  const initial =
    row.leadName?.[0]?.toUpperCase() ?? row.leadPhone?.[0]?.toUpperCase() ?? "?";
  const displayName = row.leadName ?? row.leadPhone ?? "Lead";
  const tk = tempKey(row.leadTemperature);
  const { label: tLabel } = tempLabel(row.leadTemperature);
  const pipeStep = pipelineIndex(row.leadStatus);
  const hasUnread = isConversationUnreadByClinic({
    lastAuthor: lastMsg.author,
    lastMessageAt: row.lastMessageAt,
    lastReadAt: row.lastReadAt,
  });
  const badge = convStatusBadge(row, lastMsg.author);
  const borderClass = cardBorderClass(row, lastMsg.author);
  const treatment =
    row.leadTreatmentInterest && row.leadTreatmentInterest.length > 28
      ? row.leadTreatmentInterest.slice(0, 26) + "…"
      : row.leadTreatmentInterest;
  const accentColor = avatarColor(row.leadTemperature);

  return (
    <Link
      href={`/app/inbox/${row.convId}`}
      onClick={() => markConversationRead(row.convId)}
      style={{ textDecoration: "none" }}
    >
      <div
        className={`inbox-card-v2 ${borderClass}${hasUnread ? " has-unread" : ""}`}
      >
        <div className="inbox-card-v2-top">
          {row.needsAttention ? (
            <span className="temp-badge-v2 temp-badge-v2-attention">Atenção</span>
          ) : (
            <span className={`temp-badge-v2 temp-badge-v2-${tk}`}>{tLabel}</span>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {row.lastMessageAt ? relativeTime(new Date(row.lastMessageAt)) : "—"}
            </span>
            {hasUnread && <span className="unread-dot-v2" />}
          </div>
        </div>

        <div className="inbox-card-v2-body">
          {row.leadProfilePicUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.leadProfilePicUrl}
              alt={displayName}
              className="avatar-v2"
              style={{ objectFit: "cover", borderColor: accentColor }}
              onError={(e) => {
                const el = e.currentTarget as HTMLImageElement;
                el.style.display = "none";
                el.nextElementSibling?.removeAttribute("style");
              }}
            />
          ) : null}
          <div
            className="avatar-v2"
            style={{
              display: row.leadProfilePicUrl ? "none" : undefined,
              background: `linear-gradient(145deg, color-mix(in srgb, ${accentColor} 22%, transparent), var(--surface-raised))`,
              borderColor: accentColor,
              color: accentColor,
            }}
          >
            {initial}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 14,
                color: "var(--text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {displayName}
            </div>
            {treatment && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  marginTop: 2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {treatment}
              </div>
            )}
          </div>
        </div>

        <div className="pipeline-v2">
          {PIPELINE_STEPS.map((step, i) => {
            const isDone = i < pipeStep;
            const isActive = i === pipeStep;
            return (
              <div
                key={step}
                className={`pipeline-v2-step${isActive ? " active" : isDone ? " done" : ""}`}
                style={
                  isActive
                    ? ({ "--step-color": accentColor } as React.CSSProperties)
                    : undefined
                }
              >
                <div className="pipeline-v2-dot" />
                <span className="pipeline-v2-label">{step}</span>
              </div>
            );
          })}
        </div>

        <div className="inbox-card-v2-footer">
          <span className="inbox-card-v2-preview">
            {lastMsg.body ? lastMsg.body.slice(0, 52) : "Sem mensagens"}
          </span>
          <span className={`status-badge-v2 status-badge-v2-${badge.variant}`}>
            {badge.label}
          </span>
        </div>
      </div>
    </Link>
  );
}

function segmentRows(rows: ConvRow[], lastMsgMap: Record<string, { body: string; author: string }>) {
  const handoff  = rows.filter((r) => r.aiPaused && r.needsAttention);
  const active   = rows.filter((r) => !r.aiPaused && r.leadStatus !== "lost" && r.leadStatus !== "won");
  const paused   = rows.filter((r) => r.aiPaused && !r.needsAttention && r.leadStatus !== "lost" && r.leadStatus !== "won");
  const closed   = rows.filter((r) => r.leadStatus === "won" || r.leadStatus === "lost");
  const recovery = rows.filter((r) => isRecoveryCandidate(r, lastMsgMap[r.convId]));
  return { handoff, active, paused, closed, recovery };
}

export function InboxClient({
  rows,
  lastMsgMap,
  autoReplyEnabled,
}: {
  rows: ConvRow[];
  lastMsgMap: Record<string, { body: string; author: string }>;
  autoReplyEnabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<LiveInboxTabFilter | "recovery">("all");

  const { handoff, active, paused, closed, recovery } = segmentRows(rows, lastMsgMap);
  const allLive = [...handoff, ...active, ...paused];
  const totalActive = handoff.length + active.length;
  const totalAll = allLive.length + closed.length;

  if (totalAll === 0) {
    return (
      <div className="inbox-content">
        <div className="empty-state">
          <Inbox
            size={32}
            style={{ margin: "0 auto 12px", display: "block", opacity: 0.4 }}
          />
          <p style={{ margin: 0 }}>Nenhuma conversa ainda.</p>
          <p style={{ margin: "4px 0 0", fontSize: 12 }}>
            Assim que um lead enviar mensagem via WhatsApp, ela aparecerá aqui.
          </p>
        </div>
      </div>
    );
  }

  const TABS: { key: LiveInboxTabFilter | "recovery"; label: string; count: number }[] = [
    { key: "all",       label: "Todas",       count: allLive.length },
    { key: "hot",       label: "Quentes",     count: allLive.filter((r) => r.leadTemperature === "hot").length },
    { key: "attention", label: "Atenção",     count: allLive.filter((r) => r.needsAttention).length },
    { key: "paused",    label: "Pausados",    count: paused.length },
    { key: "cold",      label: "Resfriadas",  count: allLive.filter((r) => r.leadTemperature === "cold").length },
    { key: "recovery",  label: "Recuperação", count: recovery.length },
  ];

  const isRecoveryTab = tab === "recovery";
  const baseRows = isRecoveryTab ? [] : filterLiveRowsByTab(allLive, tab as LiveInboxTabFilter);
  const sortedRows = isRecoveryTab ? [] : sortInboxRowsByRecency(filterBySearch(baseRows, search));

  return (
    <>
      <div className="inbox-topbar">
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Inbox IA
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}>
            <span className="live-dot" style={{ width: 6, height: 6, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              {totalActive} conversa{totalActive !== 1 ? "s" : ""} ativa{totalActive !== 1 ? "s" : ""}
            </span>
            {autoReplyEnabled && (
              <span className="ia-active-badge" style={{ fontSize: 10, padding: "2px 8px" }}>
                IA Ativa
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="inbox-tabs-bar">
        {TABS.map(({ key, label, count }) => (
          <button
            key={key}
            className={`inbox-tab-pill${tab === key ? " active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
            {count > 0 && (
              <span className={`inbox-tab-count${tab === key ? " active" : ""}`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="inbox-search-bar">
        <Search size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Nome, telefone ou tratamento..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="inbox-search-input"
        />
      </div>

      <div className="inbox-content">
        {isRecoveryTab ? (
          recovery.length === 0 ? (
            <div className="empty-state">
              <RefreshCw
                size={28}
                style={{ margin: "0 auto 12px", display: "block", opacity: 0.3 }}
              />
              <p style={{ margin: 0 }}>Nenhum lead precisa de recuperação.</p>
              <p style={{ margin: "4px 0 0", fontSize: 12 }}>
                Leads sem resposta há 2h+ ou com takeover expirado aparecem aqui.
              </p>
            </div>
          ) : (
            <div className="conversation-grid">
              {recovery.map((row) => (
                <RecoveryCard
                  key={row.convId}
                  row={row}
                  lastMsg={lastMsgMap[row.convId] ?? { body: "", author: "" }}
                />
              ))}
            </div>
          )
        ) : sortedRows.length === 0 ? (
          <div className="empty-state">
            <Search
              size={28}
              style={{ margin: "0 auto 12px", display: "block", opacity: 0.3 }}
            />
            <p style={{ margin: 0 }}>Nenhuma conversa encontrada.</p>
          </div>
        ) : (
          <div className="conversation-grid">
            {sortedRows.map((row) => (
              <InboxCard
                key={row.convId}
                row={row}
                lastMsg={lastMsgMap[row.convId] ?? { body: "", author: "" }}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
