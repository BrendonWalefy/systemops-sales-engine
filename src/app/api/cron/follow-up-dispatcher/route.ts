import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import type { Message } from "@/domain/entities/conversation";
import { createHash } from "crypto";
import { db } from "@/infrastructure/db/client";
import { resolveActiveEditorialConfig } from "@/application/config/editorial-config";
import { listAllClinicIds } from "@/application/tenancy/resolve-clinic";
import { organizations, conversations, messages } from "@/infrastructure/db/schema";
import { DrizzleFollowUpRepository } from "@/infrastructure/repositories/drizzle-follow-up-repository";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { inferReceptionistNameFromGreeting } from "@/core/intelligence/receptionist-name";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import {
  selectOneFollowUpPerLead,
  shouldSuppressFollowUpForOperatorActivity,
} from "@/application/use-cases/leads/follow-up-dispatch-policy";
import { shouldSendAutomatedClinicOutbound } from "@/application/automation/clinic-automation-policy";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { resolveClinicVoiceConfig } from "@/lib/tts-send";
import type { TtsConfig } from "@/domain/entities/tts-config";
import type { FollowUp } from "@/domain/entities/follow-up";

export const dynamic = "force-dynamic";

// Max concurrent follow-up sends per clinic. Keeps Z-API happy and Vercel
// function slots from exhausting. When migrating to Inngest, remove this and
// let Inngest handle concurrency via its `concurrency` step config instead.
const DISPATCH_CONCURRENCY = 5;

type ClinicResult = { clinicId: string; dispatched: number; failed: number; total: number };
type FollowUpOutcome = "dispatched" | "failed" | "skipped";

function createConcurrencyLimiter(max: number) {
  let running = 0;
  const queue: Array<() => void> = [];

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (running >= max) {
      await new Promise<void>((res) => queue.push(res));
    }
    running++;
    try {
      return await fn();
    } finally {
      running--;
      queue.shift()?.();
    }
  };
}

type DispatchDeps = {
  followUpRepository: DrizzleFollowUpRepository;
  leadRepository: DrizzleLeadRepository;
  appointmentRepository: DrizzleAppointmentRepository;
  composer: ResponseComposer;
  clinic: typeof organizations.$inferSelect;
  editorial: Awaited<ReturnType<typeof resolveActiveEditorialConfig>>;
  timezone: ClinicTimezone;
  now: Date;
  voiceEnabled: boolean;
  ttsConfig: TtsConfig;
  // deferred: used to cancel stale video follow-ups for the same lead after dispatch
  deferred: FollowUp[];
};

export function buildFollowUpOutboxInput(input: {
  clinicId: string;
  conversationId: string;
  followUpId: string;
  leadId: string;
  to: string;
  text: string;
  useVoice: boolean;
  ttsConfig: TtsConfig;
}) {
  const agentMessageId = deterministicUuid(`automation-message:followup:${input.followUpId}`);
  return {
    agentMessageId,
    dedupeKey: `followup:${input.followUpId}`,
    outbound: {
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      channel: "whatsapp" as const,
      deliveryKind: input.useVoice ? "audio" as const : "text" as const,
      category: "follow_up" as const,
      dedupeKey: `followup:${input.followUpId}`,
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

// Isolated unit of work per follow-up. Extracted so Inngest can call it directly
// as a step function when the time comes — dispatcher becomes a fan-out trigger,
// this function becomes the per-message handler.
async function processOneFollowUp(
  followUp: FollowUp,
  deps: DispatchDeps,
): Promise<FollowUpOutcome> {
  const {
    followUpRepository,
    leadRepository,
    appointmentRepository,
    composer,
    clinic,
    editorial,
    timezone,
    now,
    deferred,
  } = deps;

  // Claim-before-send: atomic pending → sending. Guards against duplicate cron runs.
  const claimed = await followUpRepository.claimForSending(followUp.id);
  if (!claimed) return "skipped";

  const lead = await leadRepository.findById(followUp.leadId);
  if (!lead) {
    await followUpRepository.save({ ...followUp, status: "cancelled", updatedAt: now });
    return "skipped";
  }

  const [conv] = await db
    .select({ id: conversations.id, category: conversations.category, aiPaused: conversations.aiPaused })
    .from(conversations)
    .where(eq(conversations.leadId, followUp.leadId))
    .limit(1);
  if (!conv || conv.category !== "sales") {
    await followUpRepository.save({ ...followUp, status: "cancelled", updatedAt: now });
    return "skipped";
  }

  // Operador conduzindo a conversa (takeover ou última mensagem humana recente):
  // não reengajar por cima do atendimento humano. Volta a pending — a próxima
  // execução reavalia quando o operador tiver saído.
  const [lastMsg] = await db
    .select({ author: messages.author, sentAt: messages.sentAt })
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(desc(messages.sentAt))
    .limit(1);
  if (
    shouldSuppressFollowUpForOperatorActivity({
      aiPaused: conv.aiPaused,
      lastMessageAuthor: lastMsg?.author ?? null,
      lastMessageSentAt: lastMsg?.sentAt ?? null,
      now,
    })
  ) {
    await followUpRepository.save({ ...followUp, status: "pending", updatedAt: now });
    console.log(
      `[FollowUpDispatcher] follow-up ${followUp.id} adiado — operador ativo na conversa ${conv.id}`,
    );
    return "skipped";
  }

  const channelAddress = resolveWhatsAppChannelAddress({
    phone: lead.phone,
    whatsappLid: lead.whatsappLid,
  });
  if (!channelAddress) {
    await followUpRepository.save({ ...followUp, status: "cancelled", updatedAt: now });
    return "skipped";
  }

  // Don't re-engage a lead that already has a future appointment.
  const upcomingAppt = await appointmentRepository.findActiveByLeadId(followUp.leadId);
  if (upcomingAppt && upcomingAppt.startsAt > now) {
    await followUpRepository.save({ ...followUp, status: "cancelled", updatedAt: now });
    console.log(
      `[FollowUpDispatcher] follow-up ${followUp.id} cancelado — lead tem consulta em ${upcomingAppt.startsAt.toISOString()}`,
    );
    return "skipped";
  }

  const isVideoFollowUp = followUp.reason.startsWith("video_sent:");

  // Don't re-engage a lead whose appointment already happened but status wasn't updated to won.
  // appointment_scheduled + no future appointment = attended or no-show, either way not a cold lead.
  if (lead.status === "appointment_scheduled" && !upcomingAppt && !isVideoFollowUp) {
    await followUpRepository.save({ ...followUp, status: "cancelled", updatedAt: now });
    console.log(
      `[FollowUpDispatcher] follow-up ${followUp.id} cancelado — lead com appointment_scheduled sem consulta futura`,
    );
    return "skipped";
  }
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

  // Fetch conversation and recent messages so the LLM can personalise the reactivation
  // based on what the lead was actually discussing, not just a generic template.
  const conversationHistory: Message[] = conv
    ? await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(desc(messages.sentAt))
        .limit(8)
        .then((rows) =>
          rows.reverse().map(
            (m): Message => ({
              id: m.id,
              conversationId: m.conversationId,
              author: m.author as Message["author"],
              body: m.body,
              mediaUrl: m.mediaUrl,
              mediaType: m.mediaType as Message["mediaType"],
              sentAt: m.sentAt,
              externalId: m.externalId,
              intent: m.intent,
              deliveryFormat: m.deliveryFormat as Message["deliveryFormat"],
            }),
          ),
        )
    : [];

  const composed = await composer.compose({
    actionResult,
    conversationHistory,
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

  const { agentMessageId, outbound } = buildFollowUpOutboxInput({
    clinicId: clinic.id,
    conversationId: conv.id,
    followUpId: followUp.id,
    leadId: followUp.leadId,
    to: channelAddress,
    text: composed.text,
    useVoice: deps.voiceEnabled,
    ttsConfig: deps.ttsConfig,
  });

  await db
    .insert(messages)
    .values({
      id: agentMessageId,
      conversationId: conv.id,
      author: "agent",
      body: composed.text,
      sentAt: now,
      externalId: null,
      intent: "reengagement" as const,
      deliveryFormat: null,
    })
    .onConflictDoNothing();

  await enqueueOutboundMessage(outbound, {
    outboundMessageStore: new DrizzleOutboundMessageStore(),
    jobQueue: new DrizzleJobQueue(),
  });

  // Cancel stale video follow-ups for this same lead that were deferred.
  const staleVideoFollowUps = deferred.filter(
    (d) => d.leadId === followUp.leadId && d.reason.startsWith("video_sent:"),
  );
  await Promise.allSettled(
    staleVideoFollowUps.map((d) =>
      followUpRepository.save({ ...d, status: "cancelled", updatedAt: now }),
    ),
  );

  return "dispatched";
}

async function processClinic(clinicId: string): Promise<ClinicResult | null> {
  const clinic = await db.query.organizations.findFirst({ where: eq(organizations.id, clinicId) });
  if (!clinic) return null;
  if (!shouldSendAutomatedClinicOutbound(clinic)) {
    console.log(`[FollowUpDispatcher] outbound automatizado pausado para clinic=${clinicId}`);
    return { clinicId, dispatched: 0, failed: 0, total: 0 };
  }

  const [editorial, { voiceEnabled, ttsConfig }] = await Promise.all([
    resolveActiveEditorialConfig(clinicId),
    resolveClinicVoiceConfig(clinicId),
  ]);

  const followUpRepository = new DrizzleFollowUpRepository();
  const leadRepository = new DrizzleLeadRepository();
  const appointmentRepository = new DrizzleAppointmentRepository();
  const composer = new ResponseComposer();
  const timezone = new ClinicTimezone(clinic.timezone);

  const now = new Date();

  const staleCutoff = new Date(now.getTime() - 30 * 60_000);
  const recovered = await followUpRepository.recoverStaleSending({ clinicId, olderThan: staleCutoff });
  if (recovered > 0) {
    console.warn(
      `[FollowUpDispatcher] ${recovered} follow-up(s) recuperado(s) de "sending" stale (clinic=${clinicId})`,
    );
  }

  const dueFollowUps = await followUpRepository.listDue({ clinicId, now });
  const dispatchPlan = selectOneFollowUpPerLead(dueFollowUps);

  const deps: DispatchDeps = {
    followUpRepository,
    leadRepository,
    appointmentRepository,
    composer,
    clinic,
    editorial,
    timezone,
    now,
    voiceEnabled,
    ttsConfig,
    deferred: dispatchPlan.deferred,
  };

  const limit = createConcurrencyLimiter(DISPATCH_CONCURRENCY);

  const results = await Promise.allSettled(
    dispatchPlan.selected.map((followUp) =>
      limit(() => processOneFollowUp(followUp, deps)).catch((err) => {
        console.error("[FollowUpDispatcher] Failed for follow-up:", followUp.id, err);
        return "failed" as FollowUpOutcome;
      }),
    ),
  );

  let dispatched = 0;
  let failed = 0;
  for (const r of results) {
    const outcome = r.status === "fulfilled" ? r.value : "failed";
    if (outcome === "dispatched") dispatched++;
    else if (outcome === "failed") failed++;
  }

  return { clinicId, dispatched, failed, total: dueFollowUps.length };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const clinicIds = await listAllClinicIds();

  // Clinics are independent — run in parallel.
  const settled = await Promise.allSettled(clinicIds.map((id) => processClinic(id)));

  const results: ClinicResult[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) results.push(r.value);
    else if (r.status === "rejected")
      console.error("[FollowUpDispatcher] processClinic failed:", r.reason);
  }

  const dispatched = results.reduce((a, r) => a + r.dispatched, 0);
  const failed = results.reduce((a, r) => a + r.failed, 0);
  console.log(`[FollowUpDispatcher] organizations=${results.length} dispatched=${dispatched} failed=${failed}`);
  return NextResponse.json({ clinics: results.length, dispatched, failed, perClinic: results });
}
