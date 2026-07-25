import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { e2eGuard, E2E_CLINIC_ID } from "@/app/api/e2e/_guard";
import { POST as receiveZApiWebhook } from "@/app/api/whatsapp/zapi/route";
import { drainMessageProcessQueue } from "@/application/jobs/drain-message-process-queue";
import { drainMessageSendQueue } from "@/application/jobs/drain-message-send-queue";
import { ProcessMessageJobHandler } from "@/application/jobs/process-message-job";
import { SendMessageJobHandler } from "@/application/jobs/send-message-job";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type { ReplayScenarioV1 } from "@/application/replay/contracts";
import { loadReplayClinicManifest } from "@/application/replay/load-replay-clinic-manifest";
import { ReplayCalendarCapture } from "@/application/replay/replay-calendar-capture";
import { ReplayOutboundCapture } from "@/application/replay/replay-outbound-capture";
import { isReplayTurnTraceComplete } from "@/application/replay/replay-trace-contract";
import { assertReplaySandboxEnvironment } from "@/application/replay/replay-sandbox-policy";
import { ConversationOrchestrator } from "@/core/pipeline/ConversationOrchestrator";
import { InMemoryDecisionTraceSink } from "@/core/observability/DecisionTrace";
import {
  resolveCalendarGateway,
  resolveCalendarMode,
} from "@/infrastructure/adapters/calendar/resolve-calendar-gateway";
import { InternalCalendarGateway } from "@/infrastructure/adapters/calendar/internal/internal-calendar-gateway";
import { DrizzleClinicAutomationPolicyReader } from "@/infrastructure/repositories/drizzle-clinic-automation-policy-reader";
import { DrizzleInboundEventStore } from "@/infrastructure/repositories/drizzle-inbound-event-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleOutboundSafetyContextReader } from "@/infrastructure/repositories/drizzle-outbound-safety-context-reader";
import { db } from "@/infrastructure/db/client";
import {
  agentRecommendations,
  aiUsageCosts,
  appointments,
  conversations,
  conversationStates,
  followUps,
  humanReviewRequests,
  inboundEvents,
  jobs,
  leadOutcomes,
  leads,
  messages,
  outboundMessages,
  reactivationCampaignTargets,
  slotReservations,
  treatmentGapReports,
} from "@/infrastructure/db/schema";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ReplayScenarioRequest = {
  runId: string;
  mode: "closed_loop";
  scenario: ReplayScenarioV1;
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const blocked = e2eGuard(request);
  if (blocked) return blocked;

  try {
    assertReplaySandboxEnvironment(process.env);
    const input = assertRequest(await request.json());
    if (!E2E_CLINIC_ID) throw new Error("E2E_CLINIC_ID is required");

    const manifest = await loadReplayClinicManifest(
      input.scenario.clinic.clinicKey,
    );
    if (manifest.clinic.id !== E2E_CLINIC_ID) {
      throw new Error("Scenario clinic does not match the isolated E2E clinic");
    }
    if (
      manifest.configFingerprint !== input.scenario.clinic.configFingerprint ||
      manifest.playbookFingerprint !== input.scenario.clinic.playbookFingerprint
    ) {
      return NextResponse.json({
        error: "clinic_fingerprint_mismatch",
        expected: input.scenario.clinic,
        observed: {
          clinicKey: manifest.clinic.slug,
          configFingerprint: manifest.configFingerprint,
          playbookFingerprint: manifest.playbookFingerprint,
        },
      }, { status: 409 });
    }

    const nonTerminalJobs = await db
      .select({ id: jobs.id, queue: jobs.queue, status: jobs.status })
      .from(jobs)
      .where(inArray(jobs.status, ["pending", "processing"]));
    if (nonTerminalJobs.length > 0) {
      return NextResponse.json({
        error: "sandbox_queue_not_empty",
        jobs: nonTerminalJobs.slice(0, 20),
      }, { status: 409 });
    }

    const result = await runClosedLoopScenario(input, manifest.clinic);
    return NextResponse.json(result, {
      status: result.checks.every((check) => check.passed) ? 200 : 422,
    });
  } catch (error) {
    return NextResponse.json({
      error: "replay_scenario_failed",
      message: error instanceof Error ? error.message : String(error),
    }, { status: 400 });
  }
}

async function runClosedLoopScenario(
  input: ReplayScenarioRequest,
  clinic: Awaited<ReturnType<typeof loadReplayClinicManifest>>["clinic"],
) {
  const decisionTrace = new InMemoryDecisionTraceSink();
  const executionStartedAt = new Date();
  const outboundCapture = new ReplayOutboundCapture();
  const calendarCaptures: ReplayCalendarCapture[] = [];
  const jobQueue = new DrizzleJobQueue();
  const inboundEventStore = new DrizzleInboundEventStore();
  const outboundMessageStore = new DrizzleOutboundMessageStore();
  const phone = replayPhone(input.runId, input.scenario.id);
  const shiftedStart = Date.now();
  const turnRuns: Array<{
    scenarioTurnId: string;
    turnId: string;
    process: Awaited<ReturnType<typeof drainMessageProcessQueue>>;
    send: Awaited<ReturnType<typeof drainMessageSendQueue>>;
  }> = [];
  let replayLeadId: string | null = null;
  let replayConversationId: string | null = null;

  try {
    for (const turn of input.scenario.turns) {
    if (turn.author !== "lead") continue;
    const payload = buildReplayZApiPayload({
      phone,
      runId: input.runId,
      turn,
      timestamp: new Date(shiftedStart + turn.offsetMs),
    });
    const webhookUrl = new URL(
      "http://replay.local/api/whatsapp/zapi",
    );
    webhookUrl.searchParams.set("clinicId", clinic.id);
    if (process.env.ZAPI_WEBHOOK_SECRET) {
      webhookUrl.searchParams.set("secret", process.env.ZAPI_WEBHOOK_SECRET);
    }
    const webhookResponse = await receiveZApiWebhook(new NextRequest(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    if (!webhookResponse.ok) {
      throw new Error(`Webhook rejected replay turn ${turn.id}: ${webhookResponse.status}`);
    }
    const [inboundEvent] = await db
      .select({ id: inboundEvents.id })
      .from(inboundEvents)
      .where(eq(inboundEvents.providerMessageId, payload.messageId))
      .limit(1);
    if (!inboundEvent) {
      throw new Error(`Webhook did not persist replay turn ${turn.id}`);
    }

    const calendarGatewayResolver: typeof resolveCalendarGateway = (
      calendarInput,
    ) => {
      const readGateway: CalendarGateway =
        resolveCalendarMode(calendarInput) === "internal"
          ? new InternalCalendarGateway({
              timezone: calendarInput.timezone,
              businessHours: calendarInput.businessHours,
              postAppointmentBufferMinutes:
                calendarInput.postAppointmentBufferMinutes,
            })
          : unavailableCalendarSnapshot();
      const capture = new ReplayCalendarCapture(readGateway);
      calendarCaptures.push(capture);
      return capture;
    };
    const processHandler = new ProcessMessageJobHandler({
      inboundEventStore,
      automationPolicy: new DrizzleClinicAutomationPolicyReader(),
      conversationHandler: new ConversationOrchestrator({
        decisionTraceSink: decisionTrace,
        calendarGatewayResolver,
      }),
      transcribeAudio: async () =>
        turn.content.text.replace(/^\[MIDIA:AUDIO\]\s*/i, ""),
      decisionTraceSink: decisionTrace,
    });
    const processDrain = await drainMessageProcessQueue({
      jobQueue,
      inboundEventStore,
      handler: processHandler,
      workerId: `replay-process:${input.runId}:${turn.id}`,
      maxJobs: 1,
    });
    const sendDrain = await drainMessageSendQueue({
      jobQueue,
      outboundMessageStore,
      handler: new SendMessageJobHandler({
        outboundMessageStore,
        safetyContextReader: new DrizzleOutboundSafetyContextReader(),
        decisionTraceSink: decisionTrace,
        outboundBoundary: outboundCapture.createBoundary(),
      }),
      workerId: `replay-send:${input.runId}:${turn.id}`,
      maxJobs: 10,
    });
    turnRuns.push({
      scenarioTurnId: turn.id,
      turnId: inboundEvent.id,
      process: processDrain,
      send: sendDrain,
    });
    }

    const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.phone, phone))
    .limit(1);
    replayLeadId = lead?.id ?? null;
    const [conversation] = lead
    ? await db
        .select()
        .from(conversations)
        .where(eq(conversations.leadId, lead.id))
        .limit(1)
    : [];
    replayConversationId = conversation?.id ?? null;
    const transcript = conversation
    ? await db
        .select({
          author: messages.author,
          body: messages.body,
          mediaType: messages.mediaType,
          intent: messages.intent,
          sentAt: messages.sentAt,
        })
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(asc(messages.sentAt))
    : [];
    const expectedLeadTurns = input.scenario.turns.filter(
    (turn) => turn.author === "lead",
  ).length;
    const agentTurns = transcript.filter((message) => message.author === "agent");
    const traces = decisionTrace.getEvents();
    const checks = [
    {
      code: "all_lead_turns_processed",
      passed:
        turnRuns.length === expectedLeadTurns &&
        turnRuns.every((run) => run.process.processed === 1),
    },
    {
      code: "no_dead_or_retried_jobs",
      passed: turnRuns.every(
        (run) =>
          run.process.dead === 0 &&
          run.process.retried === 0 &&
          run.send.dead === 0 &&
          run.send.retried === 0,
      ),
    },
    {
      code: "agent_replied",
      passed: agentTurns.length > 0,
    },
    {
      code: "delivery_effect_observed",
      passed: outboundCapture.effects.length > 0,
    },
    {
      code: "trace_complete",
      passed: turnRuns.every((run) =>
        isReplayTurnTraceComplete(traces, run.turnId)
      ),
    },
    ];

    return {
    schemaVersion: "replay-scenario-run.v1",
    runId: input.runId,
    scenarioId: input.scenario.id,
    mode: input.mode,
    clockMode: "current_shifted_preserving_offsets",
    clinic: input.scenario.clinic,
    transcript,
    trace: traces,
    effects: {
      outbound: outboundCapture.effects,
      calendar: calendarCaptures.flatMap((capture) => capture.effects),
    },
    turnRuns,
    checks,
    };
  } finally {
    if (!replayLeadId) {
      const [lead] = await db
        .select({ id: leads.id })
        .from(leads)
        .where(eq(leads.phone, phone))
        .limit(1);
      replayLeadId = lead?.id ?? null;
    }
    if (replayLeadId && !replayConversationId) {
      const [conversation] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.leadId, replayLeadId))
        .limit(1);
      replayConversationId = conversation?.id ?? null;
    }
    await cleanupReplayScenario({
      clinicId: clinic.id,
      phone,
      leadId: replayLeadId,
      conversationId: replayConversationId,
      executionStartedAt,
    });
  }
}

function assertRequest(value: unknown): ReplayScenarioRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid replay request");
  const input = value as Partial<ReplayScenarioRequest>;
  if (
    typeof input.runId !== "string" ||
    !/^[a-zA-Z0-9._:-]{4,160}$/.test(input.runId) ||
    input.mode !== "closed_loop" ||
    !input.scenario ||
    input.scenario.schemaVersion !== "replay-scenario.v1" ||
    !Array.isArray(input.scenario.turns) ||
    input.scenario.turns.length === 0
  ) {
    throw new Error("Invalid closed-loop replay scenario request");
  }
  return input as ReplayScenarioRequest;
}

function replayPhone(runId: string, scenarioId: string): string {
  const digits = createHash("sha256")
    .update(`${runId}\u001f${scenarioId}`)
    .digest("hex")
    .replace(/[a-f]/g, (letter) => String(letter.charCodeAt(0) - 87))
    .slice(0, 11);
  return `55${digits}`;
}

function buildReplayZApiPayload(input: {
  phone: string;
  runId: string;
  turn: ReplayScenarioV1["turns"][number];
  timestamp: Date;
}): ZApiInboundPayload {
  const base: ZApiInboundPayload = {
    phone: input.phone,
    instanceId: "REPLAY_SANDBOX",
    messageId: `replay-${input.runId}-${input.turn.id}-${randomUUID()}`,
    momment: input.timestamp.getTime(),
    status: "RECEIVED",
    chatName: "Lead replay",
    senderName: "Lead replay",
    isGroupMsg: false,
    isStatusReply: false,
    isEdit: false,
    fromMe: false,
  };
  const text = input.turn.content.text.replace(
    /^\[MIDIA:(?:IMAGE|VIDEO|AUDIO|DOCUMENT)\]\s*/i,
    "",
  );
  switch (input.turn.content.type) {
    case "text":
      return { ...base, text: { message: text } };
    case "image":
      return {
        ...base,
        image: {
          imageUrl: `https://replay.invalid/${input.turn.id}.jpg`,
          caption: text,
          mimeType: "image/jpeg",
        },
      };
    case "video":
      return {
        ...base,
        video: {
          videoUrl: `https://replay.invalid/${input.turn.id}.mp4`,
          caption: text,
          mimeType: "video/mp4",
        },
      };
    case "audio":
      return {
        ...base,
        audio: {
          audioUrl: `https://replay.invalid/${input.turn.id}.ogg`,
          mimeType: "audio/ogg",
        },
      };
    case "document":
      return {
        ...base,
        document: {
          documentUrl: `https://replay.invalid/${input.turn.id}.pdf`,
          fileName: text || "documento.pdf",
          mimeType: "application/pdf",
        },
      };
  }
}

function unavailableCalendarSnapshot(): CalendarGateway {
  const unavailable = async () => {
    throw new Error(
      "calendar_snapshot_required: Google Calendar reads are forbidden in replay",
    );
  };
  return {
    listAvailableSlots: unavailable,
    listBlockEvents: unavailable,
    isSlotFree: unavailable,
    createAppointment: unavailable,
    cancelAppointment: unavailable,
    updateCalendarEvent: unavailable,
    createBlockEvent: unavailable,
    deleteBlockEvent: unavailable,
    updateBlockEvent: unavailable,
  } as CalendarGateway;
}

async function cleanupReplayScenario(input: {
  clinicId: string;
  phone: string;
  leadId: string | null;
  conversationId: string | null;
  executionStartedAt: Date;
}): Promise<void> {
  if (input.conversationId) {
    await db
      .delete(treatmentGapReports)
      .where(eq(treatmentGapReports.conversationId, input.conversationId));
    await db
      .delete(humanReviewRequests)
      .where(eq(humanReviewRequests.conversationId, input.conversationId));
    await db
      .delete(reactivationCampaignTargets)
      .where(eq(reactivationCampaignTargets.conversationId, input.conversationId));
    await db
      .delete(agentRecommendations)
      .where(eq(agentRecommendations.conversationId, input.conversationId));
    await db
      .delete(outboundMessages)
      .where(eq(outboundMessages.conversationId, input.conversationId));
    await db
      .delete(conversationStates)
      .where(eq(conversationStates.conversationId, input.conversationId));
    await db
      .delete(messages)
      .where(eq(messages.conversationId, input.conversationId));
  }
  if (input.leadId) {
    await db
      .delete(slotReservations)
      .where(eq(slotReservations.leadId, input.leadId));
    await db
      .delete(appointments)
      .where(eq(appointments.leadId, input.leadId));
    await db.delete(followUps).where(eq(followUps.leadId, input.leadId));
    await db.delete(leadOutcomes).where(eq(leadOutcomes.leadId, input.leadId));
  }
  if (input.conversationId) {
    await db
      .delete(conversations)
      .where(eq(conversations.id, input.conversationId));
  }
  if (input.leadId) {
    await db.delete(leads).where(eq(leads.id, input.leadId));
  }
  await db
    .delete(inboundEvents)
    .where(
      and(
        eq(inboundEvents.clinicId, input.clinicId),
        eq(inboundEvents.conversationKey, input.phone),
      ),
    );
  await db
    .delete(aiUsageCosts)
    .where(
      and(
        eq(aiUsageCosts.clinicId, input.clinicId),
        gte(aiUsageCosts.createdAt, input.executionStartedAt),
      ),
    );
  await db
    .delete(jobs)
    .where(gte(jobs.createdAt, input.executionStartedAt));
}
