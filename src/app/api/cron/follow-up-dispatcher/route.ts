import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db/client";
import { resolveActiveEditorialConfig } from "@/application/config/editorial-config";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import {
  listAllClinicIds,
  resolveWhatsappChannelClinicForOutbound,
} from "@/application/tenancy/resolve-clinic";
import { clinics, conversations, messages } from "@/infrastructure/db/schema";
import { DrizzleFollowUpRepository } from "@/infrastructure/repositories/drizzle-follow-up-repository";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import { selectOneFollowUpPerLead } from "@/application/use-cases/leads/follow-up-dispatch-policy";

export const dynamic = "force-dynamic";

type ClinicResult = { clinicId: string; dispatched: number; failed: number; total: number };

async function processClinic(clinicId: string): Promise<ClinicResult | null> {
  const clinic = await db.query.clinics.findFirst({ where: eq(clinics.id, clinicId) });
  if (!clinic) return null;

  const editorial = await resolveActiveEditorialConfig(clinicId);
  const defaultChannelConfig = resolveChannelConfig(clinic);

  const followUpRepository = new DrizzleFollowUpRepository();
  const leadRepository = new DrizzleLeadRepository();
  const appointmentRepository = new DrizzleAppointmentRepository();
  const composer = new ResponseComposer();
  const timezone = new ClinicTimezone(clinic.timezone);

  const now = new Date();

  // Recupera follow-ups presos em "sending" por um run anterior que morreu
  // (crash entre o claim e a conclusão). 30min de margem evita colidir com
  // um run lento ainda em andamento.
  const staleCutoff = new Date(now.getTime() - 30 * 60_000);
  const recovered = await followUpRepository.recoverStaleSending({ clinicId, olderThan: staleCutoff });
  if (recovered > 0) {
    console.warn(`[FollowUpDispatcher] ${recovered} follow-up(s) recuperado(s) de "sending" stale (clinic=${clinicId})`);
  }

  const dueFollowUps = await followUpRepository.listDue({ clinicId, now });
  const dispatchPlan = selectOneFollowUpPerLead(dueFollowUps);

  let dispatched = 0;
  let failed = 0;

  for (const followUp of dispatchPlan.selected) {
    try {
      // Claim-before-send: transição atômica pending → sending. Se outro run
      // (cron duplicado, redeploy) já reivindicou, pular — evita mensagem dupla.
      const claimed = await followUpRepository.claimForSending(followUp.id);
      if (!claimed) continue;

      const lead = await leadRepository.findById(followUp.leadId);
      if (!lead) {
        await followUpRepository.save({ ...followUp, status: "cancelled", updatedAt: now });
        continue;
      }
      const channelAddress = resolveWhatsAppChannelAddress({
        phone: lead.phone,
        whatsappLid: lead.whatsappLid,
      });
      if (!channelAddress) {
        await followUpRepository.save({ ...followUp, status: "cancelled", updatedAt: now });
        continue;
      }
      let channelConfig = defaultChannelConfig;
      const channelClinicId = await resolveWhatsappChannelClinicForOutbound({
        clinicId,
        phone: lead.phone,
      });
      if (channelClinicId !== clinicId) {
        const channelClinic = await db.query.clinics.findFirst({ where: eq(clinics.id, channelClinicId) });
        if (!channelClinic) throw new Error(`Channel clinic not found: ${channelClinicId}`);
        channelConfig = resolveChannelConfig(channelClinic);
      }

      const isVideoFollowUp = followUp.reason.startsWith("video_sent:");
      const videoTitle = isVideoFollowUp ? followUp.reason.slice("video_sent:".length) : null;

      let actionResult: Parameters<typeof composer.compose>[0]["actionResult"];

      if (isVideoFollowUp && videoTitle) {
        actionResult = { type: "video_sent_followup", videoTitle };
      } else {
        const lastAppointment = await appointmentRepository.findByLeadId(followUp.leadId);
        const lastAppointmentLabel = lastAppointment
          ? new Intl.DateTimeFormat("pt-BR", {
              timeZone: clinic.timezone,
              weekday: "short",
              day: "2-digit",
              month: "2-digit",
            }).format(lastAppointment.startsAt)
          : "consulta anterior";
        actionResult = { type: "reengagement", lastAppointmentLabel };
      }

      const composed = await composer.compose({
        actionResult,
        conversationHistory: [],
        clinic: {
          name: clinic.name,
          specialty: editorial?.specialty ?? clinic.specialty,
          toneOfVoice: editorial?.toneOfVoice ?? null,
          playbook: editorial?.playbookText ?? null,
          commercialPolicy: editorial?.commercialPolicy ?? null,
        },
        leadName: lead.name,
        timezone,
        isFirstMessage: true,
      });

      const zapiMessageId = await sendTextMessage(channelAddress, composed.text, channelConfig);

      // Salva a mensagem enviada como "agent" para que o echo Z-API (fromMe ou não)
      // seja reconhecido como já processado e não dispare o Orchestrator novamente.
      const [conv] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.leadId, followUp.leadId))
        .limit(1);
      if (conv) {
        await db.insert(messages).values({
          id: randomUUID(),
          conversationId: conv.id,
          author: "agent",
          body: composed.text,
          sentAt: now,
          externalId: zapiMessageId ?? null,
          intent: "reengagement" as const,
          deliveryFormat: "text",
        }).onConflictDoNothing();
      }

      await followUpRepository.save({ ...followUp, status: "done", completedAt: now, updatedAt: now });
      await leadRepository.save({ ...lead, status: "in_conversation", updatedAt: now });

      const duplicateVideoFollowUps = dispatchPlan.deferred.filter(
        (deferredFollowUp) =>
          deferredFollowUp.leadId === followUp.leadId &&
          deferredFollowUp.reason.startsWith("video_sent:"),
      );
      for (const duplicateVideoFollowUp of duplicateVideoFollowUps) {
        await followUpRepository.save({
          ...duplicateVideoFollowUp,
          status: "cancelled",
          updatedAt: now,
        });
      }

      dispatched++;
    } catch (err) {
      console.error("[FollowUpDispatcher] Failed for follow-up:", followUp.id, err);
      failed++;
    }
  }

  return { clinicId, dispatched, failed, total: dueFollowUps.length };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Roda para todas as clínicas cadastradas.
  const clinicIds = await listAllClinicIds();
  const results: ClinicResult[] = [];
  for (const id of clinicIds) {
    const r = await processClinic(id);
    if (r) results.push(r);
  }

  const dispatched = results.reduce((a, r) => a + r.dispatched, 0);
  const failed = results.reduce((a, r) => a + r.failed, 0);
  console.log(`[FollowUpDispatcher] clinics=${results.length} dispatched=${dispatched} failed=${failed}`);
  return NextResponse.json({ clinics: results.length, dispatched, failed, perClinic: results });
}
