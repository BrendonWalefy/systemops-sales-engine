export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/infrastructure/db/client";
import { appointments, clinics, conversations, leads, messages } from "@/infrastructure/db/schema";
import { eq, asc, desc } from "drizzle-orm";
import { ArrowLeft, Phone, Calendar, ExternalLink } from "lucide-react";
import { AiPauseButton } from "./AiPauseButton";
import { MessageInput } from "./MessageInput";
import { ChatWindow } from "./ChatWindow";
import { ManualAppointmentForm } from "./ManualAppointmentForm";
import { ConversationReadMarker } from "./ConversationReadMarker";
import { tempLabel, statusLabel, channelLabel, relativeTime, avatarColor } from "../inbox-utils";

const TZ = "America/Sao_Paulo";

function formatTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
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
  if (!lead) notFound();

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

  const [clinic] = await db
    .select({
      timezone: clinics.timezone,
      defaultAppointmentDurationMinutes: clinics.defaultAppointmentDurationMinutes,
    })
    .from(clinics)
    .where(eq(clinics.id, conv.clinicId))
    .limit(1);

  const displayName = lead.name ?? lead.phone ?? "Lead";
  const initial = displayName[0]?.toUpperCase() ?? "?";
  const temp = tempLabel(lead.temperature ?? null);
  const { label: sLabel } = statusLabel(lead.status);
  const accentColor = avatarColor(lead.temperature ?? null);
  const waPhone = lead.phone?.replace(/\D/g, "");

  return (
    <div className="conv-root">
      <ConversationReadMarker conversationId={conversationId} />

      {/* ── Header V2 ── */}
      <div className="conv-header-v2">
        <Link href="/app/inbox" className="conv-back-btn" aria-label="Voltar ao Inbox">
          <ArrowLeft size={18} />
        </Link>

        {lead.profilePicUrl ? (
          <img
            src={lead.profilePicUrl}
            alt={displayName}
            className="conv-header-avatar"
            style={{ objectFit: "cover", borderColor: accentColor }}
          />
        ) : (
          <div
            className="conv-header-avatar"
            style={{
              background: `linear-gradient(145deg, color-mix(in srgb, ${accentColor} 22%, transparent), var(--surface-raised))`,
              borderColor: accentColor,
              color: accentColor,
            }}
          >
            {initial}
          </div>
        )}

        <div className="conv-header-info">
          <div className="conv-header-name">{displayName}</div>
          <div className="conv-header-sub">
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{sLabel}</span>
          </div>
        </div>

        <div className="conv-header-actions">
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="conv-action-btn" title="Ligar">
              <Phone size={15} />
            </a>
          )}
          <div className="ai-mobile-toggle">
            <AiPauseButton
              conversationId={conversationId}
              leadId={lead.id}
              aiPaused={conv.aiPaused}
              compact
            />
          </div>
        </div>
      </div>

      {conv.needsAttention && (
        <div className="attention-banner-conv">
          <span>{conv.attentionReason ?? "Esta conversa precisa de atenção"}</span>
          <span style={{ opacity: 0.6, fontSize: 11 }}>— Será limpo ao enviar uma mensagem</span>
        </div>
      )}

      <div className="conv-body">
        <div className="conv-message-col">
          {/* Área de mensagens */}
          <ChatWindow
            initialMessages={msgs}
            conversationId={conversationId}
            leadName={lead.name ?? null}
            leadPhone={lead.phone ?? null}
          />

          {/* Ações rápidas — mobile only */}
          <div className="conv-mobile-actions">
            <ManualAppointmentForm
              conversationId={conversationId}
              defaultDurationMinutes={clinic?.defaultAppointmentDurationMinutes ?? 60}
              timezone={clinic?.timezone ?? "America/Sao_Paulo"}
            />
          </div>

          {/* Input do operador */}
          <MessageInput conversationId={conversationId} />
        </div>

        {/* Painel lateral */}
        <div className="conv-lead-panel">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              className="avatar-v2"
              style={{
                width: 44, height: 44, minWidth: 44, fontSize: 15,
                background: `linear-gradient(145deg, color-mix(in srgb, ${accentColor} 22%, transparent), var(--surface-raised))`,
                borderColor: accentColor,
                color: accentColor,
              }}
            >
              {initial}
            </div>
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
            {lead.treatmentInterest && (
              <div className="signal">
                <span>Interesse</span>
                <strong style={{ fontSize: 12 }}>{lead.treatmentInterest}</strong>
              </div>
            )}
            <div className="signal">
              <span>Canal</span>
              <strong>{channelLabel(lead.channel)}</strong>
            </div>
            {lead.phone && (
              <div className="signal">
                <span>Telefone</span>
                <strong style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                  <Phone size={12} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12 }}>{lead.phone}</span>
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

          {appointment && (appointment.status === "scheduled" || appointment.status === "confirmed") && (
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
          )}

          <ManualAppointmentForm
            conversationId={conversationId}
            defaultDurationMinutes={clinic?.defaultAppointmentDurationMinutes ?? 60}
            timezone={clinic?.timezone ?? "America/Sao_Paulo"}
          />

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
