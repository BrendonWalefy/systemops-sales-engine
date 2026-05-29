export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/infrastructure/db/client";
import { conversations, leads, messages } from "@/infrastructure/db/schema";
import { eq, desc } from "drizzle-orm";
import { MessageSquare, Inbox, AlertTriangle, Bot, Calendar } from "lucide-react";
import { InboxPoller } from "./InboxPoller";
import { EnableNotificationsButton } from "@/components/enable-notifications-button";

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

type ConvRow = {
  convId: string;
  lastMessageAt: Date | null;
  needsAttention: boolean;
  attentionReason: string | null;
  aiPaused: boolean;
  leadName: string | null;
  leadPhone: string | null;
  leadStatus: string;
  leadTemperature: string | null;
};

function ConversationCard({ row, lastMsg }: { row: ConvRow; lastMsg: string }) {
  const initial = row.leadName?.[0]?.toUpperCase() ?? row.leadPhone?.[0] ?? "?";
  const displayName = row.leadName ?? row.leadPhone ?? "Lead";
  const preview = lastMsg.slice(0, 65);
  const temp = row.leadTemperature ?? "cold";
  const isHandoff = row.needsAttention && row.aiPaused;

  return (
    <Link href={`/app/inbox/${row.convId}`} style={{ textDecoration: "none" }}>
      <div className={`conversation-card${isHandoff ? " needs-attention" : ""}`}>
        <div className="conversation-row">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="avatar" style={{ width: 40, height: 40, fontSize: 15 }}>
              {initial}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>
                {displayName}
              </div>
              {row.leadPhone && row.leadName && (
                <div className="lead-phone">{row.leadPhone}</div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span className={`temp-badge temp-${temp}`} style={{ fontSize: 11 }}>
              {tempLabel(temp)}
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {row.lastMessageAt ? relativeTime(new Date(row.lastMessageAt)) : "—"}
            </span>
          </div>
        </div>

        {isHandoff && row.attentionReason && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--amber, #f59e0b)",
            fontWeight: 500,
            marginBottom: 4,
          }}>
            <AlertTriangle size={12} />
            <span>{row.attentionReason}</span>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <MessageSquare size={12} style={{ opacity: 0.4, flexShrink: 0 }} />
          <span style={{
            fontSize: 13,
            color: "var(--muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}>
            {preview || "Sem mensagens"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function SectionHeader({ label, count, icon }: { label: string; count: number; icon: React.ReactNode }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "12px 0 8px",
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "var(--muted)",
      borderBottom: "1px solid var(--border)",
      marginBottom: 8,
    }}>
      {icon}
      <span>{label}</span>
      <span style={{
        marginLeft: "auto",
        background: "var(--surface-2, rgba(255,255,255,0.06))",
        borderRadius: 10,
        padding: "1px 8px",
        fontSize: 11,
        fontWeight: 600,
        color: "var(--muted)",
      }}>
        {count}
      </span>
    </div>
  );
}

export default async function InboxPage() {
  const clinicId = process.env.PILOT_CLINIC_ID ?? "";

  const rows = await db
    .select({
      convId: conversations.id,
      lastMessageAt: conversations.lastMessageAt,
      needsAttention: conversations.needsAttention,
      attentionReason: conversations.attentionReason,
      aiPaused: conversations.aiPaused,
      leadName: leads.name,
      leadPhone: leads.phone,
      leadStatus: leads.status,
      leadTemperature: leads.temperature,
    })
    .from(conversations)
    .innerJoin(leads, eq(conversations.leadId, leads.id))
    .where(eq(conversations.clinicId, clinicId))
    .orderBy(desc(conversations.lastMessageAt));

  const lastMessages = await Promise.all(
    rows.map(async (r) => {
      const [msg] = await db
        .select({ body: messages.body })
        .from(messages)
        .where(eq(messages.conversationId, r.convId))
        .orderBy(desc(messages.sentAt))
        .limit(1);
      return { convId: r.convId, body: msg?.body ?? "" };
    }),
  );

  const lastMsgMap = Object.fromEntries(lastMessages.map((m) => [m.convId, m.body]));

  // Seção 1: precisa de resposta humana (aiPaused + needsAttention)
  const handoffRows = rows.filter((r) => r.aiPaused && r.needsAttention);

  // Seção 2: IA em conversa (não pausada, não encerrado)
  const activeRows = rows.filter(
    (r) => !r.aiPaused && r.leadStatus !== "appointment_scheduled" && r.leadStatus !== "lost" && r.leadStatus !== "won",
  );

  // Seção 3: agendados + pausados sem needsAttention (operador assumiu manualmente)
  const scheduledRows = rows.filter(
    (r) =>
      r.leadStatus === "appointment_scheduled" ||
      r.leadStatus === "won" ||
      (r.aiPaused && !r.needsAttention),
  );

  return (
    <div>
      <InboxPoller />
      <div className="product-topbar">
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Inbox
          </h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
            {handoffRows.length > 0
              ? `${handoffRows.length} aguardando você · ${activeRows.length} em conversa`
              : `${activeRows.length} conversa${activeRows.length !== 1 ? "s" : ""} ativa${activeRows.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <EnableNotificationsButton />
      </div>

      <div className="inbox-content">
        {rows.length === 0 ? (
          <div className="empty-state">
            <Inbox size={32} style={{ margin: "0 auto 12px", display: "block", opacity: 0.4 }} />
            <p style={{ margin: 0 }}>Nenhuma conversa ainda.</p>
            <p style={{ margin: "4px 0 0", fontSize: 12 }}>
              Assim que um lead enviar mensagem via WhatsApp, ela aparecerá aqui.
            </p>
          </div>
        ) : (
          <div className="conversation-list">

            {/* ── Seção: Precisa de você ── */}
            {handoffRows.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <SectionHeader
                  label="Precisa de você"
                  count={handoffRows.length}
                  icon={<AlertTriangle size={13} style={{ color: "var(--amber, #f59e0b)" }} />}
                />
                {handoffRows.map((row) => (
                  <ConversationCard key={row.convId} row={row} lastMsg={lastMsgMap[row.convId] ?? ""} />
                ))}
              </div>
            )}

            {/* ── Seção: IA em conversa ── */}
            {activeRows.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <SectionHeader
                  label="Em conversa"
                  count={activeRows.length}
                  icon={<Bot size={13} />}
                />
                {activeRows.map((row) => (
                  <ConversationCard key={row.convId} row={row} lastMsg={lastMsgMap[row.convId] ?? ""} />
                ))}
              </div>
            )}

            {/* ── Seção: Agendados / Encerrados ── */}
            {scheduledRows.length > 0 && (
              <div>
                <SectionHeader
                  label="Agendados & encerrados"
                  count={scheduledRows.length}
                  icon={<Calendar size={13} />}
                />
                {scheduledRows.map((row) => (
                  <ConversationCard key={row.convId} row={row} lastMsg={lastMsgMap[row.convId] ?? ""} />
                ))}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
