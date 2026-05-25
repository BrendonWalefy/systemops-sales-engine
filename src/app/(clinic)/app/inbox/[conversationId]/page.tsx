export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/infrastructure/db/client";
import { appointments, conversations, leads, messages } from "@/infrastructure/db/schema";
import { eq, asc, desc } from "drizzle-orm";
import { ArrowLeft, Phone, Calendar, ExternalLink } from "lucide-react";
import { AiPauseButton } from "./AiPauseButton";
import { MessageInput } from "./MessageInput";

const TZ = "America/Sao_Paulo";

function formatTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
}

function tempLabel(temp: string | null) {
  if (temp === "hot") return { label: "Quente", cls: "hot" };
  if (temp === "warm") return { label: "Morno", cls: "warm" };
  return { label: "Frio", cls: "cold" };
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

function channelLabel(channel: string): string {
  const map: Record<string, string> = {
    whatsapp: "WhatsApp",
    instagram: "Instagram",
    landing_form: "Formulário",
    google_ads: "Google Ads",
    meta_ads: "Meta Ads",
    phone: "Telefone",
    referral: "Indicação",
    manual: "Manual",
  };
  return map[channel] ?? channel;
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!conv) notFound();

  const [lead] = await db.select().from(leads).where(eq(leads.id, conv.leadId)).limit(1);

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.sentAt));

  const [appointment] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.leadId, lead.id))
    .orderBy(desc(appointments.createdAt))
    .limit(1);

  const displayName = lead.name ?? lead.phone ?? "Lead";
  const initial = displayName[0]?.toUpperCase() ?? "?";
  const temp = tempLabel(lead.temperature ?? null);
  const { label: sLabel, handoff } = statusLabel(lead.status);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "16px 28px",
          borderBottom: "1px solid var(--line)",
          background: "var(--surface)",
          flexShrink: 0,
        }}
      >
        <Link
          href="/app/inbox"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "var(--muted)",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <ArrowLeft size={14} />
          Inbox
        </Link>
        <span style={{ color: "var(--line-strong)" }}>·</span>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{displayName}</span>
        <span className={`status-pill${handoff ? " status-handoff" : ""}`} style={{ fontSize: 11, padding: "3px 10px" }}>
          <span className="status-dot" />
          {sLabel}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", flex: 1, minHeight: 0 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid var(--line)",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* Área de mensagens — scrollável */}
          <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
            <div className="chat-window" style={{ flex: 1, maxHeight: "none", minHeight: 0 }}>
              {msgs.length === 0 && (
                <div className="empty-conversation" style={{ margin: "auto" }}>
                  <strong>Sem mensagens</strong>
                  <span>As mensagens desta conversa aparecerão aqui.</span>
                </div>
              )}
              {msgs.map((msg) => {
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
                      {!isRight && (
                        <span className="lead-badge">{lead.name ?? lead.phone ?? "Lead"}</span>
                      )}
                      <span className="message-time">{formatTime(new Date(msg.sentAt))}</span>
                    </div>
                    <p>{msg.body}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Input fixo do operador */}
          <MessageInput conversationId={conversationId} />
        </div>

        <div
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            overflowY: "auto",
            background: "color-mix(in srgb, var(--surface) 76%, transparent)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="avatar">{initial}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{displayName}</div>
              {lead.phone && <div className="lead-phone">{lead.phone}</div>}
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <p className="eyebrow" style={{ margin: 0 }}>Dados do lead</p>
            <div className="signal">
              <span>Temperatura</span>
              <strong><span className={`temp-badge temp-${temp.cls}`}>{temp.label}</span></strong>
            </div>
            <div className="signal">
              <span>Status</span>
              <strong>{sLabel}</strong>
            </div>
            <div className="signal">
              <span>Canal</span>
              <strong>{channelLabel(lead.channel)}</strong>
            </div>
            {lead.phone && (
              <div className="signal">
                <span>Telefone</span>
                <strong style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                  <Phone size={12} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12, letterSpacing: "0.01em" }}>{lead.phone}</span>
                </strong>
              </div>
            )}
            <div className="signal">
              <span>Primeiro contato</span>
              <strong style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <Calendar size={12} />
                {formatDate(new Date(lead.createdAt))}
              </strong>
            </div>
            <div className="signal">
              <span>Mensagens</span>
              <strong>{msgs.length}</strong>
            </div>
          </div>

          {appointment && (appointment.status === "scheduled" || appointment.status === "confirmed") ? (
            <div style={{ display: "grid", gap: 8 }}>
              <p className="eyebrow" style={{ margin: 0 }}>Agendamento</p>
              <div className="signal">
                <span>Data</span>
                <strong style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Calendar size={12} />
                  {formatDate(new Date(appointment.startsAt))}
                </strong>
              </div>
              <div className="signal">
                <span>Horário</span>
                <strong>{formatTime(new Date(appointment.startsAt))} – {formatTime(new Date(appointment.endsAt))}</strong>
              </div>
              <div className="signal">
                <span>Status</span>
                <strong>{appointment.status === "confirmed" ? "Confirmado" : "Agendado"}</strong>
              </div>
              {appointment.calendarEventUrl && (
                <a
                  href={appointment.calendarEventUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--accent)", textDecoration: "none", marginTop: 2 }}
                >
                  <ExternalLink size={12} />
                  Ver no Google Calendar
                </a>
              )}
            </div>
          ) : null}

          <AiPauseButton
            conversationId={conversationId}
            leadId={lead.id}
            aiPaused={conv.aiPaused}
          />
        </div>
      </div>
    </div>
  );
}
