"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Inbox } from "lucide-react";
import { filterBySearch } from "./inbox-filter";
import { isConversationUnreadByClinic } from "./inbox-visibility";

export type ConvRow = {
  convId: string;
  leadId: string;
  lastMessageAt: Date | null;
  lastReadAt: Date | null;
  needsAttention: boolean;
  attentionReason: string | null;
  aiPaused: boolean;
  leadName: string | null;
  leadPhone: string | null;
  leadStatus: string;
  leadTemperature: string | null;
  leadTreatmentInterest: string | null;
  leadProfilePicUrl: string | null;
  appointmentStartsAt?: Date | null;
};

type TabFilter = "all" | "hot" | "attention" | "cold";

const PIPELINE_STEPS = ["Novo", "Qualific.", "Proposta", "Agendar", "Fechado"] as const;

function pipelineIndex(status: string): number {
  if (status === "new") return 0;
  if (status === "waiting_response" || status === "in_conversation") return 1;
  if (status === "follow_up_due") return 2;
  if (status === "appointment_scheduled") return 3;
  return 4;
}

function tempKey(temp: string | null): "hot" | "warm" | "cold" {
  if (temp === "hot") return "hot";
  if (temp === "warm") return "warm";
  return "cold";
}

function tempLabel(temp: string | null): string {
  if (temp === "hot") return "Quente";
  if (temp === "warm") return "Morno";
  return "Frio";
}

function avatarColor(temp: string | null): string {
  if (temp === "hot") return "var(--hot)";
  if (temp === "warm") return "var(--warm)";
  return "var(--cold)";
}

function relativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) {
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay)
      return date.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      });
    return `${h}h`;
  }
  return `${Math.floor(h / 24)}d`;
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

function tempSortWeight(temp: string | null, needsAttention: boolean): number {
  if (needsAttention) return 0;
  if (temp === "hot") return 1;
  if (temp === "warm") return 2;
  return 3;
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
  const pipeStep = pipelineIndex(row.leadStatus);
  const hasUnread = isConversationUnreadByClinic({
    lastAuthor: lastMsg.author,
    lastMessageAt: row.lastMessageAt,
    lastReadAt: row.lastReadAt,
  });
  const badge = convStatusBadge(row, lastMsg.author);
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
        className={`inbox-card-v2 conv-temp-${tk}${row.needsAttention ? " needs-attention" : ""}${hasUnread ? " has-unread" : ""}`}
      >
        {/* temperature badge + time + unread dot */}
        <div className="inbox-card-v2-top">
          {row.needsAttention ? (
            <span className="temp-badge-v2 temp-badge-v2-attention">Atenção</span>
          ) : (
            <span className={`temp-badge-v2 temp-badge-v2-${tk}`}>
              {tempLabel(row.leadTemperature)}
            </span>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {row.lastMessageAt ? relativeTime(new Date(row.lastMessageAt)) : "—"}
            </span>
            {hasUnread && <span className="unread-dot-v2" />}
          </div>
        </div>

        {/* avatar + name/treatment + score */}
        <div className="inbox-card-v2-body">
          {row.leadProfilePicUrl ? (
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

        {/* pipeline steps */}
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

        {/* message preview + status badge */}
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

export function InboxClient({
  activeRows,
  handoffRows,
  pausedRows,
  closedRows,
  lastMsgMap,
  autoReplyEnabled,
}: {
  activeRows: ConvRow[];
  handoffRows: ConvRow[];
  pausedRows: ConvRow[];
  closedRows: ConvRow[];
  lastMsgMap: Record<string, { body: string; author: string }>;
  autoReplyEnabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<TabFilter>("all");

  const allLive = [...handoffRows, ...activeRows, ...pausedRows];
  const totalActive = handoffRows.length + activeRows.length;
  const totalAll = allLive.length + closedRows.length;

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

  const hotCount = allLive.filter((r) => r.leadTemperature === "hot").length;
  const attentionCount = allLive.filter((r) => r.needsAttention).length;
  const coldCount = allLive.filter((r) => r.leadTemperature === "cold").length;

  const TABS: { key: TabFilter; label: string; count: number }[] = [
    { key: "all", label: "Todas", count: allLive.length },
    { key: "hot", label: "Quentes", count: hotCount },
    { key: "attention", label: "Atenção", count: attentionCount },
    { key: "cold", label: "Resfriadas", count: coldCount },
  ];

  const baseRows = (() => {
    if (tab === "hot") return allLive.filter((r) => r.leadTemperature === "hot");
    if (tab === "attention") return allLive.filter((r) => r.needsAttention);
    if (tab === "cold") return allLive.filter((r) => r.leadTemperature === "cold");
    return allLive;
  })();

  const sortedRows = filterBySearch(baseRows, search).sort((a, b) => {
    const wa = tempSortWeight(a.leadTemperature, a.needsAttention);
    const wb = tempSortWeight(b.leadTemperature, b.needsAttention);
    if (wa !== wb) return wa - wb;
    return (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0);
  });

  return (
    <>
      {/* topbar */}
      <div className="inbox-topbar">
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Inbox IA
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}>
            <span
              className="live-dot"
              style={{ width: 6, height: 6, flexShrink: 0 }}
            />
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

      {/* tabs */}
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

      {/* search */}
      <div className="inbox-search-bar">
        <Search size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Buscar lead..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="inbox-search-input"
        />
      </div>

      <div className="inbox-content">
        {sortedRows.length === 0 ? (
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
