"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Inbox } from "lucide-react";
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
  leadName: string | null;
  leadPhone: string | null;
  leadStatus: string;
  leadTemperature: string | null;
  leadTreatmentInterest: string | null;
  leadProfilePicUrl: string | null;
  appointmentStartsAt?: Date | null;
};

const PIPELINE_STEPS = ["Novo", "Qualific.", "Proposta", "Agendar", "Fechado"] as const;

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

function segmentRows(rows: ConvRow[]) {
  const handoff = rows.filter((r) => r.aiPaused && r.needsAttention);
  const active  = rows.filter((r) => !r.aiPaused && r.leadStatus !== "lost" && r.leadStatus !== "won");
  const paused  = rows.filter((r) => r.aiPaused && !r.needsAttention && r.leadStatus !== "lost" && r.leadStatus !== "won");
  const closed  = rows.filter((r) => r.leadStatus === "won" || r.leadStatus === "lost");
  return { handoff, active, paused, closed };
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
  const [tab, setTab] = useState<LiveInboxTabFilter>("all");

  const { handoff, active, paused, closed } = segmentRows(rows);
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

  const TABS: { key: LiveInboxTabFilter; label: string; count: number }[] = [
    { key: "all",       label: "Todas",      count: allLive.length },
    { key: "hot",       label: "Quentes",    count: allLive.filter((r) => r.leadTemperature === "hot").length },
    { key: "attention", label: "Atenção",    count: allLive.filter((r) => r.needsAttention).length },
    { key: "paused",    label: "Pausados",   count: paused.length },
    { key: "cold",      label: "Resfriadas", count: allLive.filter((r) => r.leadTemperature === "cold").length },
  ];

  const baseRows = filterLiveRowsByTab(allLive, tab);

  const sortedRows = sortInboxRowsByRecency(filterBySearch(baseRows, search));

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
