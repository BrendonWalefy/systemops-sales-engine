"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, AlertTriangle, Calendar, CheckCircle2, MessageSquare, Inbox, PauseCircle } from "lucide-react";
import { filterBySearch, resolveEmConversa, resolveAgendados, type InboxFilter } from "./inbox-filter";

export type ConvRow = {
  convId: string;
  leadId: string;
  lastMessageAt: Date | null;
  needsAttention: boolean;
  attentionReason: string | null;
  aiPaused: boolean;
  leadName: string | null;
  leadPhone: string | null;
  leadStatus: string;
  leadTemperature: string | null;
  appointmentStartsAt?: Date | null;
};

type Filter = InboxFilter;

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

function tempLabel(temp: string | null): string {
  if (temp === "hot") return "Quente";
  if (temp === "warm") return "Morno";
  return "Frio";
}

function tempKey(temp: string | null): "hot" | "warm" | "cold" {
  if (temp === "hot") return "hot";
  if (temp === "warm") return "warm";
  return "cold";
}

function statusLabel(status: string): string {
  if (status === "appointment_scheduled") return "Agendado";
  if (status === "won") return "Ganho";
  if (status === "lost") return "Perdido";
  return "Pausado";
}

function avatarColor(temp: string | null): string {
  if (temp === "hot") return "var(--hot)";
  if (temp === "warm") return "var(--warm)";
  return "var(--cold)";
}

function authorPreviewPrefix(author: string): string {
  if (author === "agent") return "IA: ";
  if (author === "clinic_user") return "Operador: ";
  if (author === "lead") return "Lead: ";
  return "";
}

function ActiveCard({ row, lastMsg }: { row: ConvRow; lastMsg: { body: string; author: string } }) {
  const initial = row.leadName?.[0]?.toUpperCase() ?? row.leadPhone?.[0] ?? "?";
  const displayName = row.leadName ?? row.leadPhone ?? "Lead";
  const authorPrefix = authorPreviewPrefix(lastMsg.author);
  const preview = (authorPrefix + lastMsg.body).slice(0, 65);
  const tk = tempKey(row.leadTemperature);
  const isHandoff = row.needsAttention && row.aiPaused;

  return (
    <Link href={`/app/inbox/${row.convId}`} style={{ textDecoration: "none" }}>
      <div className={`inbox-active-card conv-temp-${tk}${isHandoff ? " needs-attention" : ""}`}>
        {/* Header: avatar + name + badge + time */}
        <div className="inbox-card-header">
          <div
            className="avatar"
            style={{
              width: 36,
              height: 36,
              fontSize: 13,
              borderColor: avatarColor(row.leadTemperature),
              background: `linear-gradient(145deg, color-mix(in srgb, ${avatarColor(row.leadTemperature)} 20%, transparent), var(--surface-raised))`,
              color: avatarColor(row.leadTemperature),
              flexShrink: 0,
            }}
          >
            {initial}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {displayName}
            </div>
            {row.leadPhone && row.leadName && (
              <div className="lead-phone" style={{ fontSize: 11 }}>{row.leadPhone}</div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
            <span className={`temp-badge temp-${tk}`} style={{ fontSize: 10, padding: "2px 7px" }}>
              {tempLabel(row.leadTemperature)}
            </span>
            <span style={{ fontSize: 10, color: "var(--muted)" }}>
              {row.lastMessageAt ? relativeTime(new Date(row.lastMessageAt)) : "—"}
            </span>
          </div>
        </div>

        {/* Attention reason */}
        {isHandoff && row.attentionReason && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--warm)", fontWeight: 600 }}>
            <AlertTriangle size={10} />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.attentionReason}</span>
          </div>
        )}

        {/* Footer: preview */}
        <div className="inbox-card-footer">
          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
            <MessageSquare size={10} style={{ opacity: 0.35, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {preview || "Sem mensagens"}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function formatAppointmentDate(date: Date): string {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).replace(".", "");
}

function ScheduledCard({ row }: { row: ConvRow }) {
  const initial = row.leadName?.[0]?.toUpperCase() ?? row.leadPhone?.[0] ?? "?";
  const displayName = row.leadName ?? row.leadPhone ?? "Lead";
  const tk = tempKey(row.leadTemperature);
  const isManualPause = row.aiPaused && !row.needsAttention;
  const apptDate = row.appointmentStartsAt ? new Date(row.appointmentStartsAt) : null;

  return (
    <Link href={`/app/inbox/${row.convId}`} style={{ textDecoration: "none" }}>
      <div className={`inbox-scheduled-card conv-temp-${tk}`}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 8 }}>
          <div
            className="avatar"
            style={{
              width: 32,
              height: 32,
              fontSize: 12,
              borderColor: avatarColor(row.leadTemperature),
              background: `linear-gradient(145deg, color-mix(in srgb, ${avatarColor(row.leadTemperature)} 20%, transparent), var(--surface-raised))`,
              color: avatarColor(row.leadTemperature),
              flexShrink: 0,
            }}
          >
            {initial}
          </div>
          {isManualPause ? (
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--warm-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <PauseCircle size={11} style={{ color: "var(--warm)" }} />
            </div>
          ) : (
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CheckCircle2 size={11} style={{ color: "var(--accent-strong)" }} />
            </div>
          )}
        </div>
        <div style={{ fontWeight: 700, fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 4 }}>
          {displayName}
        </div>
        {apptDate && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
            <Calendar size={10} style={{ color: "var(--accent-strong)", flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: "var(--accent-strong)", fontWeight: 600 }}>
              {formatAppointmentDate(apptDate)}
            </span>
          </div>
        )}
        <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, marginBottom: 6 }}>
          {isManualPause ? "Pausado manualmente" : statusLabel(row.leadStatus)}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
          <span className={`temp-badge temp-${tk}`} style={{ fontSize: 10, padding: "2px 6px" }}>
            {tempLabel(row.leadTemperature)}
          </span>
          <span style={{ fontSize: 10, color: "var(--muted)" }}>
            {row.lastMessageAt ? relativeTime(new Date(row.lastMessageAt)) : "—"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function SectionLabel({ label, count, icon }: { label: string; count: number; icon: React.ReactNode }) {
  return (
    <div className="inbox-section-label">
      {icon}
      <span>{label}</span>
      <span className="inbox-section-count">{count}</span>
    </div>
  );
}

export function InboxClient({
  activeRows,
  handoffRows,
  scheduledRows,
  pausedRows,
  closedRows,
  lastMsgMap,
  autoReplyEnabled,
}: {
  activeRows: ConvRow[];
  handoffRows: ConvRow[];
  scheduledRows: ConvRow[];
  pausedRows: ConvRow[];
  closedRows: ConvRow[];
  lastMsgMap: Record<string, { body: string; author: string }>;
  autoReplyEnabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const totalActive = activeRows.length + handoffRows.length;
  const totalAll = totalActive + scheduledRows.length + pausedRows.length + closedRows.length;

  const emConversaRows = resolveEmConversa(handoffRows, activeRows, filter, search);
  const agendadosRows = resolveAgendados(scheduledRows, filter, search);
  const pausedVisibleRows = filter === "all" ? filterBySearch(pausedRows, search) : [];
  const closedVisibleRows = filter === "all" ? filterBySearch(closedRows, search) : [];

  const totalVisible = emConversaRows.length + agendadosRows.length + pausedVisibleRows.length + closedVisibleRows.length;

  if (totalAll === 0) {
    return (
      <div className="inbox-content">
        <div className="empty-state">
          <Inbox size={32} style={{ margin: "0 auto 12px", display: "block", opacity: 0.4 }} />
          <p style={{ margin: 0 }}>Nenhuma conversa ainda.</p>
          <p style={{ margin: "4px 0 0", fontSize: 12 }}>
            Assim que um lead enviar mensagem via WhatsApp, ela aparecerá aqui.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── Topbar ── */}
      <div className="inbox-topbar">
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Inbox
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              {totalActive} conversa{totalActive !== 1 ? "s" : ""} ativa{totalActive !== 1 ? "s" : ""}
            </span>
            {autoReplyEnabled && (
              <span className="ia-active-badge">
                <span className="live-dot" style={{ width: 5, height: 5 }} />
                IA Ativa
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Search + Filter tabs ── */}
      <div className="inbox-filter-bar">
        <div className="inbox-search-wrap">
          <Search size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Buscar"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="inbox-search-input"
          />
        </div>
        <div className="inbox-filter-tabs" role="tablist">
          {(["all", "attention", "scheduled"] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={`inbox-filter-tab${filter === f ? " active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "Todos" : f === "attention" ? (
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  Requer Atenção
                  {handoffRows.length > 0 && (
                    <span style={{
                      background: filter === "attention" ? "rgba(239,68,68,0.25)" : "rgba(239,68,68,0.18)",
                      color: "#ef4444",
                      fontSize: 10,
                      fontWeight: 700,
                      borderRadius: 999,
                      padding: "1px 6px",
                      lineHeight: 1.5,
                    }}>
                      {handoffRows.length}
                    </span>
                  )}
                </span>
              ) : "Agendados"}
            </button>
          ))}
        </div>
      </div>

      <div className="inbox-content">
        {totalVisible === 0 ? (
          <div className="empty-state">
            <Search size={28} style={{ margin: "0 auto 12px", display: "block", opacity: 0.3 }} />
            <p style={{ margin: 0 }}>Nenhuma conversa encontrada.</p>
          </div>
        ) : (
          <>
            {/* ── Em Conversa ── */}
            {emConversaRows.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <SectionLabel
                  label="Em Conversa"
                  count={emConversaRows.length}
                  icon={<MessageSquare size={13} />}
                />
                <div className="conversation-grid">
                  {emConversaRows.map((row) => (
                    <ActiveCard key={row.convId} row={row} lastMsg={lastMsgMap[row.convId] ?? { body: "", author: "" }} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Agendados ── */}
            {agendadosRows.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <SectionLabel
                  label="Agendados"
                  count={agendadosRows.length}
                  icon={<Calendar size={13} />}
                />
                <div className="scheduled-grid">
                  {agendadosRows.map((row) => (
                    <ScheduledCard key={row.convId} row={row} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Pausados manualmente ── */}
            {pausedVisibleRows.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <SectionLabel
                  label="Pausados manualmente"
                  count={pausedVisibleRows.length}
                  icon={<PauseCircle size={13} />}
                />
                <div className="scheduled-grid">
                  {pausedVisibleRows.map((row) => (
                    <ScheduledCard key={row.convId} row={row} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Encerrados ── */}
            {closedVisibleRows.length > 0 && (
              <div>
                <SectionLabel
                  label="Encerrados"
                  count={closedVisibleRows.length}
                  icon={<CheckCircle2 size={13} />}
                />
                <div className="scheduled-grid">
                  {closedVisibleRows.map((row) => (
                    <ScheduledCard key={row.convId} row={row} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
