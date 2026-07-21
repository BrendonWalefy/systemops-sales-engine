/**
 * Chama de volta quem faltou, já com horários concretos.
 *
 * A falta é o único desfecho que se descobre no fim do dia, e ela não é fim de
 * linha: é um lead que voltou ao funil. Perguntar "quer remarcar?" e esperar
 * resposta perde o momento — a oferta sai com os horários prontos, e um número
 * fecha.
 *
 * Sai pela **outbox**, não pelo sender direto: assim passa pelo Safety Gate
 * (opt-out, limite de frequência, horário de silêncio). O doutor confirma às
 * 21h; a paciente não pode receber convite naquele instante.
 */

import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { appointments, conversations, leads, messages, organizations } from "@/infrastructure/db/schema";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { getStaffReminderWindows } from "@/core/scheduling/appointment-reminder-staff";
import { resolveCalendarGateway } from "@/infrastructure/adapters/calendar/resolve-calendar-gateway";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import { createHash } from "crypto";
import { toTimeCode } from "./appointment-completion-review";

// Mesma entrada → mesmo id, para o pré-registro da mensagem casar com o dedupe
// da outbox se o doutor tocar duas vezes.
function deterministicUuid(input: string): string {
  const bytes = Buffer.from(createHash("sha256").update(input).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const LOOKAHEAD_DAYS = 14;
const MAX_SLOTS = 3;

export function buildNoShowRecoveryText(params: {
  leadName: string | null;
  slotLabels: string[];
}): string {
  const nome = params.leadName?.split(/\s+/)[0];
  const saudacao = nome ? `Oi, ${nome}!` : "Oi!";
  if (params.slotLabels.length === 0) {
    return `${saudacao} Senti sua falta hoje na clínica. Quer que eu veja um novo horário para você?`;
  }
  return [
    `${saudacao} Senti sua falta hoje na clínica. 😊`,
    "",
    "Separei estes horários para remarcar:",
    ...params.slotLabels.map((label, i) => `${i + 1}. ${label}`),
    "",
    "Responda apenas com o número da opção que prefere.",
  ].join("\n");
}

export async function enqueueNoShowRecovery(params: {
  clinicId: string;
  timeCode: string;
  now?: Date;
}): Promise<{ enqueued: boolean; reason?: string }> {
  const now = params.now ?? new Date();

  const [clinic] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, params.clinicId))
    .limit(1);
  if (!clinic) return { enqueued: false, reason: "clinic_not_found" };

  const timezone = new ClinicTimezone(clinic.timezone);
  const { startOfToday, startOfTomorrow } = getStaffReminderWindows(timezone, now);
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: clinic.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  });

  // A consulta já foi marcada como no_show antes deste passo.
  const candidatos = await db
    .select({
      id: appointments.id,
      leadId: appointments.leadId,
      startsAt: appointments.startsAt,
      treatmentId: appointments.treatmentId,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, params.clinicId),
        eq(appointments.status, "no_show"),
        gte(appointments.startsAt, startOfToday),
        lt(appointments.startsAt, startOfTomorrow),
      ),
    );

  const alvo = candidatos.find((a) => toTimeCode(fmt.format(a.startsAt)) === params.timeCode);
  if (!alvo) return { enqueued: false, reason: "appointment_not_found" };

  const [lead] = await db.select().from(leads).where(eq(leads.id, alvo.leadId)).limit(1);
  if (!lead) return { enqueued: false, reason: "lead_not_found" };

  const to = resolveWhatsAppChannelAddress({ phone: lead.phone, whatsappLid: lead.whatsappLid });
  // Paciente importado da agenda pode não ter telefone — sem canal, não há convite.
  if (!to) return { enqueued: false, reason: "lead_without_channel" };

  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.leadId, lead.id))
    .limit(1);
  if (!conversation) return { enqueued: false, reason: "conversation_not_found" };

  // ── Horários concretos, não "quer remarcar?" ──
  const calendarGateway = resolveCalendarGateway({
    clinicId: clinic.id,
    calendarMode: clinic.calendarMode,
    googleCalendarId: clinic.googleCalendarId,
    timezone,
    businessHours: clinic.businessHours,
    postAppointmentBufferMinutes: clinic.postAppointmentBufferMinutes,
  });
  const from = now;
  const until = new Date(from.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60_000);
  const duration = clinic.defaultAppointmentDurationMinutes;

  let slots = await calendarGateway.listAvailableSlots({
    clinicId: clinic.id, from, to: until, slotDurationMinutes: duration,
  });

  const ocupados = await db
    .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, clinic.id),
        inArray(appointments.status, ["scheduled", "confirmed"]),
        lt(appointments.startsAt, until),
        gte(appointments.endsAt, from),
      ),
    );
  if (ocupados.length > 0) {
    const buffer = (clinic.postAppointmentBufferMinutes ?? 0) * 60_000;
    slots = slots.filter((slot) =>
      !ocupados.some((a) =>
        a.startsAt.getTime() < slot.endsAt.getTime() + buffer &&
        a.endsAt.getTime() + buffer > slot.startsAt.getTime()),
    );
  }

  const stateMachine = new ConversationStateMachine();
  const formatted = slots.length > 0
    ? await stateMachine.offerSlots(conversation.id, slots.slice(0, MAX_SLOTS), timezone, undefined, duration)
    : [];

  const text = buildNoShowRecoveryText({
    leadName: lead.name,
    slotLabels: formatted.map((s) => s.label),
  });

  const dayBucket = now.toISOString().slice(0, 10);
  const dedupeKey = `no-show-recovery:${alvo.id}:${dayBucket}`;
  const agentMessageId = deterministicUuid(`automation-message:${dedupeKey}`);

  await db.insert(messages).values({
    id: agentMessageId,
    conversationId: conversation.id,
    author: "agent",
    body: text,
    sentAt: now,
    externalId: null,
    intent: "reengagement",
    deliveryFormat: null,
  }).onConflictDoNothing();

  await enqueueOutboundMessage(
    {
      clinicId: clinic.id,
      conversationId: conversation.id,
      channel: "whatsapp",
      deliveryKind: "text",
      category: "recovery",
      dedupeKey,
      payload: {
        version: 1,
        kind: "automation",
        to,
        text,
        leadId: lead.id,
        conversationId: conversation.id,
        agentMessageId,
      },
    },
    { outboundMessageStore: new DrizzleOutboundMessageStore(), jobQueue: new DrizzleJobQueue() },
  );

  return { enqueued: true };
}
