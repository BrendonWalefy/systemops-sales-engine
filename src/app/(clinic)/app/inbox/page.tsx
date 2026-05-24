import Link from "next/link";
import { db } from "@/infrastructure/db/client";
import { conversations, leads, messages } from "@/infrastructure/db/schema";
import { eq, desc } from "drizzle-orm";
import { MessageSquare, Inbox } from "lucide-react";

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

function statusLabel(status: string): { label: string; handoff: boolean } {
  const map: Record<string, { label: string; handoff: boolean }> = {
    new: { label: "Novo", handoff: false },
    waiting_response: { label: "Aguardando", handoff: false },
    in_conversation: { label: "Em conversa", handoff: false },
    follow_up_due: { label: "Follow-up", handoff: true },
    appointment_scheduled: { label: "Agendado", handoff: false },
    lost: { label: "Perdido", handoff: true },
    won: { label: "Ganho", handoff: false },
  };
  return map[status] ?? { label: status, handoff: false };
}

function tempLabel(temp: string | null): string {
  if (temp === "hot") return "Quente";
  if (temp === "warm") return "Morno";
  return "Frio";
}

export default async function InboxPage() {
  const clinicId = process.env.PILOT_CLINIC_ID ?? "";

  const rows = await db
    .select({
      convId: conversations.id,
      lastMessageAt: conversations.lastMessageAt,
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
  const activeCount = rows.filter((r) => r.leadStatus !== "lost" && r.leadStatus !== "won").length;

  return (
    <div>
      <div className="product-topbar">
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Inbox
          </h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
            {activeCount} conversa{activeCount !== 1 ? "s" : ""} ativa{activeCount !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <div style={{ padding: "0 28px 28px" }}>
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
            {rows.map((row) => {
              const initial = row.leadName?.[0]?.toUpperCase() ?? row.leadPhone?.[0] ?? "?";
              const displayName = row.leadName ?? row.leadPhone ?? "Lead";
              const preview = (lastMsgMap[row.convId] ?? "").slice(0, 60);
              const { label, handoff } = statusLabel(row.leadStatus);
              const temp = row.leadTemperature ?? "cold";

              return (
                <Link
                  key={row.convId}
                  href={`/app/inbox/${row.convId}`}
                  style={{ textDecoration: "none" }}
                >
                  <div className="conversation-card">
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

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 13, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        <MessageSquare size={12} style={{ marginRight: 5, verticalAlign: "middle", opacity: 0.5 }} />
                        {preview || "Sem mensagens"}
                      </span>
                      <span className={`status-pill${handoff ? " status-handoff" : ""}`} style={{ fontSize: 11, padding: "4px 10px" }}>
                        <span className="status-dot" />
                        {label}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
