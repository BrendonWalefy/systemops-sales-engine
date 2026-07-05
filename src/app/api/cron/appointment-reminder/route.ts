import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "@/infrastructure/db/client";
import { resolveActiveEditorialConfig } from "@/application/config/editorial-config";
import { listAllClinicIds } from "@/application/tenancy/resolve-clinic";
import { organizations } from "@/infrastructure/db/schema";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";
import type { TtsConfig } from "@/domain/entities/tts-config";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { inferReceptionistNameFromGreeting } from "@/core/intelligence/receptionist-name";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import { shouldSendAutomatedClinicOutbound } from "@/application/automation/clinic-automation-policy";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { resolveClinicVoiceConfig } from "@/lib/tts-send";

export const dynamic = "force-dynamic";

// Janela: consultas que começam entre 20h e 32h a partir de agora.
const WINDOW_START_HOURS = 20;
const WINDOW_END_HOURS = 32;

type ClinicResult = { clinicId: string; sent: number; failed: number; total: number };

// Lembrete de consulta agendada pelo próprio lead. category "reminder" NÃO é
// gated (isento de opt-out e quiet hours) — passa direto pelo Safety Gate. O id
// determinístico por consulta casa o pré-registro em messages com o dedupe da
// outbox, e reminderSentAt (findDueReminders) já impede reenvio.
export function buildReminderOutboxInput(input: {
  clinicId: string;
  conversationId: string;
  appointmentId: string;
  leadId: string;
  to: string;
  text: string;
  useVoice: boolean;
  ttsConfig: TtsConfig;
}) {
  const agentMessageId = deterministicUuid(`automation-message:reminder:${input.appointmentId}`);
  const dedupeKey = `reminder:${input.appointmentId}`;
  return {
    agentMessageId,
    dedupeKey,
    outbound: {
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      channel: "whatsapp" as const,
      deliveryKind: input.useVoice ? ("audio" as const) : ("text" as const),
      category: "reminder" as const,
      dedupeKey,
      payload: {
        version: 1 as const,
        kind: "automation" as const,
        to: input.to,
        text: input.text,
        leadId: input.leadId,
        conversationId: input.conversationId,
        agentMessageId,
        useVoice: input.useVoice,
        ttsConfig: input.ttsConfig,
      },
    },
  };
}

function deterministicUuid(input: string): string {
  const bytes = Buffer.from(createHash("sha256").update(input).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function processClinic(clinicId: string): Promise<ClinicResult | null> {
  const clinic = await db.query.organizations.findFirst({ where: eq(organizations.id, clinicId) });
  if (!clinic) return null;
  if (!shouldSendAutomatedClinicOutbound(clinic)) {
    console.log(`[AppointmentReminder] outbound automatizado pausado para clinic=${clinicId}`);
    return { clinicId, sent: 0, failed: 0, total: 0 };
  }

  const [editorial, { voiceEnabled, ttsConfig }] = await Promise.all([
    resolveActiveEditorialConfig(clinicId),
    resolveClinicVoiceConfig(clinicId),
  ]);

  const appointmentRepository = new DrizzleAppointmentRepository();
  const leadRepository = new DrizzleLeadRepository();
  const conversationRepository = new DrizzleConversationRepository();
  const stateMachine = new ConversationStateMachine();
  const composer = new ResponseComposer();
  const timezone = new ClinicTimezone(clinic.timezone);

  const now = new Date();
  const windowStart = new Date(now.getTime() + WINDOW_START_HOURS * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + WINDOW_END_HOURS * 60 * 60 * 1000);

  const dueAppointments = await appointmentRepository.findDueReminders({ clinicId, windowStart, windowEnd });

  let sent = 0;
  let failed = 0;

  for (const appointment of dueAppointments) {
    try {
      const lead = await leadRepository.findById(appointment.leadId);
      if (!lead) continue;
      const channelAddress = resolveWhatsAppChannelAddress({
        phone: lead.phone,
        whatsappLid: lead.whatsappLid,
      });
      if (!channelAddress) continue;

      // A outbox é indexada por conversa: sem conversa não há como rotear o
      // lembrete pelo gate. Lead com consulta agendada sempre tem conversa;
      // ausência é edge case e é pulada (antes seria enviada sem persistir).
      const conversation = await conversationRepository.findByLeadId(lead.id);
      if (!conversation) {
        console.warn(`[AppointmentReminder] sem conversa para lead=${lead.id} — pulando`);
        continue;
      }

      const appointmentLabel = new Intl.DateTimeFormat("pt-BR", {
        timeZone: clinic.timezone,
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(appointment.startsAt);

      const composed = await composer.compose({
        actionResult: { type: "appointment_reminder_with_confirmation", appointmentLabel },
        conversationHistory: [],
        clinic: {
          name: clinic.name,
          plan: clinic.plan,
          specialty: editorial?.specialty ?? clinic.specialty,
          toneOfVoice: editorial?.toneOfVoice ?? null,
          playbook: editorial?.playbookText ?? null,
          commercialPolicy: editorial?.commercialPolicy ?? null,
          receptionistName: inferReceptionistNameFromGreeting(clinic.greetingMessage) ?? undefined,
        },
        leadName: lead.name,
        timezone,
        isFirstMessage: false,
      });

      const { agentMessageId, outbound } = buildReminderOutboxInput({
        clinicId,
        conversationId: conversation.id,
        appointmentId: appointment.id,
        leadId: lead.id,
        to: channelAddress,
        text: composed.text,
        useVoice: voiceEnabled,
        ttsConfig,
      });

      // Pré-registra a mensagem (id determinístico) para o Inbox; o sender
      // preenche externalId/deliveryFormat na entrega real.
      await conversationRepository.appendMessage({
        id: agentMessageId,
        conversationId: conversation.id,
        author: "agent",
        body: composed.text,
        mediaUrl: null,
        mediaType: null,
        sentAt: now,
        externalId: null,
        intent: "appointment_reminder",
        deliveryFormat: null,
      });

      await enqueueOutboundMessage(outbound, {
        outboundMessageStore: new DrizzleOutboundMessageStore(),
        jobQueue: new DrizzleJobQueue(),
      });

      // reminderSentAt no enqueue impede reenvio (findDueReminders filtra).
      await appointmentRepository.save({ ...appointment, reminderSentAt: now, updatedAt: now });

      // Registra estado de confirmação pendente na conversa do lead (TTL: 24h)
      try {
        await stateMachine.offerAppointmentConfirmation(
          conversation.id,
          appointment.id,
          appointmentLabel,
        );
      } catch (stateErr) {
        console.warn("[AppointmentReminder] Falha ao registrar estado de confirmação:", stateErr);
      }

      sent++;
    } catch (err) {
      console.error("[AppointmentReminder] Failed for appointment:", appointment.id, err);
      failed++;
    }
  }

  return { clinicId, sent, failed, total: dueAppointments.length };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const clinicIds = await listAllClinicIds();
  const results: ClinicResult[] = [];
  for (const id of clinicIds) {
    const r = await processClinic(id);
    if (r) results.push(r);
  }

  const sent = results.reduce((a, r) => a + r.sent, 0);
  const failed = results.reduce((a, r) => a + r.failed, 0);
  console.log(`[AppointmentReminder] organizations=${results.length} sent=${sent} failed=${failed}`);
  return NextResponse.json({ clinics: results.length, sent, failed, perClinic: results });
}
