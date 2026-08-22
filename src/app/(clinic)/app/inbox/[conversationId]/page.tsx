export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/infrastructure/db/client";
import { appointments, organizations, conversations, leads } from "@/infrastructure/db/schema";
import { eq, desc } from "drizzle-orm";
import { ArrowLeft, Phone, Calendar, ExternalLink } from "lucide-react";
import { isSalesConversationCategory } from "@/domain/value-objects/conversation-category";
import { AiPauseButton } from "./AiPauseButton";
import { ChatWindow } from "./ChatWindow";
import { attachInboxPreviews } from "@/application/messaging/attach-inbox-previews";
import { listConversationMessages } from "@/application/inbox/list-messages";
import { ContentReadyReporter } from "@/components/performance/content-ready-reporter";
import { ConvComposer } from "./ConvComposer";
import { DepositBanner } from "./DepositBanner";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import { ManualAppointmentForm } from "./ManualAppointmentForm";
import { ConversationReadMarker } from "./ConversationReadMarker";
import { tempLabel, statusLabel, channelLabel, avatarColor, conversationCategoryLabel } from "../inbox-utils";
import { LeadAvatar } from "./LeadAvatar";
import { ConversationCategoryControl } from "./ConversationCategoryControl";
import { avatarInitial } from "../avatar-initial";
import { measureServerOperation } from "@/infrastructure/observability/performance-logger";

const TZ = "America/Sao_Paulo";

function formatTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
}

async function prepareConversationPage(
  conversationId: string,
  conv: typeof conversations.$inferSelect,
) {
  // Um único round trip para tudo que só depende de `conv`.
  //
  // Estas cinco leituras eram cinco `await` em fila — lead → mensagens →
  // agendamento → clínica → estado do sinal — e nenhuma delas lê o resultado
  // da anterior: `appointments` filtra por `conv.leadId` (o mesmo id que
  // seleciona o lead), `organizations` por `conv.clinicId`, e mensagens e
  // estado do sinal só precisam do `conversationId` da URL. Em fila, a página
  // pagava 5 idas ao Postgres antes de renderizar; em paralelo, paga 1.
  // O ganho é proporcional ao RTT até o banco, então é grande exatamente onde
  // dói: a função serverless e o Neon não estão na mesma região.
  const [leadRows, conversationMessages, appointmentRows, clinicRows, depositState] =
    await Promise.all([
      db.select().from(leads).where(eq(leads.id, conv.leadId)).limit(1),
      listConversationMessages({ conversationId, clinicId: conv.clinicId }),
      db
        .select()
        .from(appointments)
        .where(eq(appointments.leadId, conv.leadId))
        .orderBy(desc(appointments.createdAt))
        .limit(1),
      db
        .select({
          timezone: organizations.timezone,
          defaultAppointmentDurationMinutes: organizations.defaultAppointmentDurationMinutes,
          autoReplyEnabled: organizations.autoReplyEnabled,
        })
        .from(organizations)
        .where(eq(organizations.id, conv.clinicId))
        .limit(1),
      new ConversationStateMachine().getDepositState(conversationId),
    ]);

  const [lead] = leadRows;
  if (!lead) notFound();

  const { messages: recentMsgs, hasMore: hasOlderMessages } = conversationMessages;
  // Depende das mensagens (lê o link no fim do corpo), então continua depois —
  // e só vai ao banco quando alguma mensagem termina em URL.
  const msgs = await attachInboxPreviews(recentMsgs);

  const [appointment] = appointmentRows;
  const [clinic] = clinicRows;

  // IA globalmente ligada para a clínica? (kill-switch em Configurações › IA)
  const clinicAutoReplyEnabled = clinic?.autoReplyEnabled ?? true;

  // Fluxo de sinal: se o comprovante foi recebido, mostra o banner de validação.
  const depositProofPending =
    depositState?.state === "deposit_proof_received" ? depositState.payload : null;

  const displayName = lead.name ?? lead.phone ?? "Lead";
  const initial = avatarInitial(displayName);
  const temp = tempLabel(lead.temperature ?? null);
  const { label: sLabel } = statusLabel(lead.status);
  const accentColor = avatarColor(lead.temperature ?? null);
  const isSalesConversation = isSalesConversationCategory(conv.category);

  return (
    <div className="conv-root">
      <ConversationReadMarker conversationId={conversationId} />
      <ContentReadyReporter surface="conversation" />

      {/* ── Header V2 ── */}
      <div className="conv-header-v2">
        <Link href="/app/inbox" className="conv-back-btn" aria-label="Voltar ao Inbox">
          <ArrowLeft size={18} />
        </Link>

        <LeadAvatar
          profilePicUrl={lead.profilePicUrl}
          displayName={displayName}
          initial={initial}
          accentColor={accentColor}
          className="conv-header-avatar"
        />

        <div className="conv-header-info">
          <div className="conv-header-name">{displayName}</div>
          <div className="conv-header-sub">
            <span className={`conv-temp-pill conv-temp-pill-${temp.cls}`}>{temp.label}</span>
            {lead.treatmentInterest && (
              <span className="conv-header-treatment">· {lead.treatmentInterest}</span>
            )}
          </div>
        </div>

        <div className="conv-header-actions">
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="conv-action-btn" title="Ligar">
              <Phone size={15} />
            </a>
          )}
          {isSalesConversation && (
            <div className="ai-mobile-toggle">
              <AiPauseButton
                conversationId={conversationId}
                leadId={lead.id}
                aiPaused={conv.aiPaused}
                clinicAutoReplyEnabled={clinicAutoReplyEnabled}
                compact
              />
            </div>
          )}
        </div>
      </div>

      {depositProofPending && (
        <DepositBanner
          conversationId={conversationId}
          slotLabel={depositProofPending.slotLabel}
          amountLabel={
            depositProofPending.depositAmountCents
              ? `R$ ${(depositProofPending.depositAmountCents / 100).toLocaleString("pt-BR")}`
              : null
          }
        />
      )}

      {conv.needsAttention && !depositProofPending && (
        <div className="attention-card-conv">
          <div className="attention-card-icon">!</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 12 }}>
              {conv.attentionReason ?? "Lead quer atenção humana"}
            </div>
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 1 }}>
              Responda abaixo — aviso some ao enviar
            </div>
          </div>
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
            hasOlderMessages={hasOlderMessages}
          />

          <ConvComposer
            conversationId={conversationId}
            aiPaused={conv.aiPaused}
            leadName={lead.name ?? null}
            treatmentInterest={lead.treatmentInterest ?? null}
            temperature={lead.temperature ?? null}
            leadStatus={lead.status}
            conversationCategory={conv.category}
            needsAttention={conv.needsAttention}
            attentionReason={conv.attentionReason ?? null}
            defaultDurationMinutes={clinic?.defaultAppointmentDurationMinutes ?? 60}
            timezone={clinic?.timezone ?? "America/Sao_Paulo"}
          />
        </div>

        {/* Painel lateral */}
        <div className="conv-lead-panel">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LeadAvatar
              profilePicUrl={lead.profilePicUrl}
              displayName={displayName}
              initial={initial}
              accentColor={accentColor}
              className="avatar-v2"
              style={{ width: 44, height: 44, minWidth: 44, fontSize: 15 }}
            />
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
              <span>Categoria</span>
              <strong>{conversationCategoryLabel(conv.category)}</strong>
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

          <ConversationCategoryControl
            conversationId={conversationId}
            category={conv.category}
          />

          {isSalesConversation && appointment && (appointment.status === "scheduled" || appointment.status === "confirmed") && (
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

          {isSalesConversation && (
            <>
              <ManualAppointmentForm
                conversationId={conversationId}
                defaultDurationMinutes={clinic?.defaultAppointmentDurationMinutes ?? 60}
                timezone={clinic?.timezone ?? "America/Sao_Paulo"}
              />

              <AiPauseButton
                conversationId={conversationId}
                leadId={lead.id}
                aiPaused={conv.aiPaused}
                clinicAutoReplyEnabled={clinicAutoReplyEnabled}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  let clinicId: string | null = null;

  return measureServerOperation(
    {
      getClinicId: () => clinicId,
      surface: "conversation",
      operation: "conversation_total",
    },
    async () => {
      const [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);

      if (!conv) notFound();
      clinicId = conv.clinicId;
      return prepareConversationPage(conversationId, conv);
    },
  );
}
