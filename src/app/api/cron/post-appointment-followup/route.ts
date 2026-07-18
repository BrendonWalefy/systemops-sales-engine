import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, inArray, lte, notInArray } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "@/infrastructure/db/client";
import { appointments, mediaAssets, organizations } from "@/infrastructure/db/schema";
import { listAllClinicIds } from "@/application/tenancy/resolve-clinic";
import { shouldSendAutomatedClinicOutbound } from "@/application/automation/clinic-automation-policy";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import type { OutboundDeliveryPart } from "@/application/jobs/conversation-outbound-payload";
import {
  postAppointmentDedupeKey,
  renderPostAppointmentMessage,
  type PostAppointmentRule,
} from "@/domain/entities/post-appointment-rule";
import { requireCronAuthorization } from "@/app/api/cron/_auth";

export const dynamic = "force-dynamic";

// Catch-up: além do disparo pontual, reescaneia uma janela para trás para
// sobreviver a runs perdidos e a marcações de "concluído" feitas com atraso
// (feedback só dispara depois que o doutor marca). O dedupe da outbox garante
// que cada regra saia uma única vez por consulta, então reescanear é seguro.
const CATCHUP_HOURS = 48;
const HOUR_MS = 60 * 60 * 1000;

function deterministicUuid(input: string): string {
  const bytes = Buffer.from(createHash("sha256").update(input).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Resolve os mediaIds da regra em partes prontas para envio, preservando a ordem
// da regra e descartando ids inválidos, de outra clínica ou não entregáveis.
async function resolveRuleMedia(
  clinicId: string,
  mediaIds: string[] | undefined,
): Promise<OutboundDeliveryPart[]> {
  if (!mediaIds?.length) return [];
  const rows = await db
    .select({ id: mediaAssets.id, url: mediaAssets.url, type: mediaAssets.type, title: mediaAssets.title })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.clinicId, clinicId), inArray(mediaAssets.id, mediaIds)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parts: OutboundDeliveryPart[] = [];
  for (const id of mediaIds) {
    const row = byId.get(id);
    if (!row) continue;
    if (row.type !== "image" && row.type !== "video") continue; // sendMediaMessage entrega image/video
    parts.push({ type: "media", mediaId: row.id, url: row.url, mediaType: row.type, title: row.title });
  }
  return parts;
}

type ClinicResult = { enqueued: number; skipped: number };

async function processClinic(clinicId: string): Promise<ClinicResult> {
  const [clinic] = await db
    .select({
      name: organizations.name,
      rules: organizations.postAppointmentRules,
      autoReplyEnabled: organizations.autoReplyEnabled,
      operationalStatus: organizations.operationalStatus,
      shadowModeEnabled: organizations.shadowModeEnabled,
    })
    .from(organizations)
    .where(eq(organizations.id, clinicId))
    .limit(1);

  const rules = clinic?.rules ?? [];
  if (!clinic || rules.length === 0) return { enqueued: 0, skipped: 0 };
  if (!shouldSendAutomatedClinicOutbound(clinic)) {
    return { enqueued: 0, skipped: 0 };
  }

  const leadRepository = new DrizzleLeadRepository();
  const conversationRepository = new DrizzleConversationRepository();
  const now = new Date();

  let enqueued = 0;
  let skipped = 0;

  for (const rule of rules as PostAppointmentRule[]) {
    // Gatilho passou: endsAt <= now - offset. Janela: >= now - offset - catchup.
    const triggerBefore = new Date(now.getTime() - rule.offsetHours * HOUR_MS);
    const windowStart = new Date(triggerBefore.getTime() - CATCHUP_HOURS * HOUR_MS);

    const conditions = [
      eq(appointments.clinicId, clinicId),
      lte(appointments.endsAt, triggerBefore),
      gte(appointments.endsAt, windowStart),
      // Nunca pós-atendimento para quem cancelou ou não compareceu.
      notInArray(appointments.status, ["cancelled", "no_show"]),
    ];
    // Híbrido: regra com requiresStatus só dispara nesse estado (feedback só se
    // "completed"); sem requiresStatus, dispara por relógio (cuidados).
    if (rule.requiresStatus) conditions.push(eq(appointments.status, rule.requiresStatus));
    if (rule.treatmentIds?.length) conditions.push(inArray(appointments.treatmentId, rule.treatmentIds));

    const due = await db
      .select({ id: appointments.id, leadId: appointments.leadId })
      .from(appointments)
      .where(and(...conditions));

    const mediaParts = await resolveRuleMedia(clinicId, rule.mediaIds);

    for (const appt of due) {
      try {
        const lead = await leadRepository.findById(appt.leadId);
        if (!lead) { skipped++; continue; }
        const to = resolveWhatsAppChannelAddress({ phone: lead.phone, whatsappLid: lead.whatsappLid });
        if (!to) { skipped++; continue; }
        const conversation = await conversationRepository.findByLeadId(lead.id);
        if (!conversation) { skipped++; continue; }

        const text = renderPostAppointmentMessage(rule.message, {
          leadName: lead.name,
          clinicName: clinic.name,
        });
        const dedupeKey = postAppointmentDedupeKey(rule.id, appt.id);
        const agentMessageId = deterministicUuid(`automation-message:${dedupeKey}`);

        const { messageWasNew } = await enqueueOutboundMessage(
          {
            clinicId,
            conversationId: conversation.id,
            channel: "whatsapp",
            deliveryKind: "text",
            category: rule.category,
            dedupeKey,
            payload: {
              version: 1,
              kind: "automation",
              to,
              text,
              leadId: lead.id,
              conversationId: conversation.id,
              agentMessageId,
              useVoice: false,
              mediaParts,
            },
          },
          { outboundMessageStore: new DrizzleOutboundMessageStore(), jobQueue: new DrizzleJobQueue() },
        );

        // Só pré-registra no inbox se ESTE run criou a outbox (idempotência): em
        // reescaneios da janela de catch-up, messageWasNew=false e nada se repete.
        if (messageWasNew) {
          await conversationRepository.appendMessage({
            id: agentMessageId,
            conversationId: conversation.id,
            author: "agent",
            body: text,
            mediaUrl: null,
            mediaType: null,
            sentAt: now,
            externalId: null,
            intent: null,
            deliveryFormat: null,
          });
          enqueued++;
          console.log(`[PostAppointmentFollowup] clinic=${clinicId} rule=${rule.id} appt=${appt.id} enfileirado`);
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`[PostAppointmentFollowup] falha clinic=${clinicId} rule=${rule.id} appt=${appt.id}:`, err);
        skipped++;
      }
    }
  }

  return { enqueued, skipped };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const clinicIds = await listAllClinicIds();
  const results = await Promise.allSettled(clinicIds.map((id) => processClinic(id)));

  let enqueued = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      enqueued += r.value.enqueued;
      skipped += r.value.skipped;
    } else {
      console.error("[PostAppointmentFollowup] processClinic failed:", r.reason);
    }
  }

  return NextResponse.json({ clinics: clinicIds.length, enqueued, skipped });
}
