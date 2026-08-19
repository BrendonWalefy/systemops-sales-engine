import { z } from "zod";

import { isConversationOutboundPayload } from "@/application/jobs/conversation-outbound-payload";
import type { ProcessMessageJobHandler } from "@/application/jobs/process-message-job";
import type { SendMessageJobHandler } from "@/application/jobs/send-message-job";
import {
  createInternalLabSyntheticAddress,
  isInternalLabSyntheticAddress,
} from "@/application/labs/internal-lab-synthetic-delivery";
import type { InboundEventStore } from "@/application/ports/inbound-event-store";
import type { JobQueue, JobQueueName, JobRecord } from "@/application/ports/job-queue";
import type { OutboundMessageStore } from "@/application/ports/outbound-message-store";
import { getJobRetryAt } from "@/application/services/job-retry-policy";
import { persistInboundEventAndEnqueue } from "@/application/whatsapp/persist-inbound-event";

export const SYSTEMOPS_LAB_PERSONA_EXPECTATIONS = Object.freeze([
  "factual_correctness",
  "unauthorized_facts",
  "price_subject_binding",
  "scheduling_correctness",
  "outcome_inversion",
  "escalation",
  "invented_commitment",
  "relevance",
  "journey_advancement",
  "critical_regression",
  "safety",
] as const);

export type SystemOpsLabPersonaExpectation =
  typeof SYSTEMOPS_LAB_PERSONA_EXPECTATIONS[number];

export type SystemOpsLabPersona = Readonly<{
  schemaVersion: 1;
  personaId: string;
  displayName: string;
  scenario: "price_scheduling" | "objection_escalation" | "booking_revalidation"
    // Abertura social e turno fora do catálogo transacional: era exatamente a
    // classe que nenhuma persona cobria e que a V2 não sabia responder.
    | "reception_opening" | "out_of_scope";
  turns: readonly Readonly<{
    leadText: string;
    expected: readonly SystemOpsLabPersonaExpectation[];
  }>[];
}>;

export type SystemOpsLabRunResult = Readonly<{
  runId: string;
  clinicId: string;
  personaId: string;
  conversationId: string;
  turns: readonly Readonly<{
    turnId: string;
    leadMessageId: string;
    outboundMessageId: string;
    persistedAgentMessageId: string;
    captured: true;
  }>[];
}>;

type PersistedPersonaMessage = Readonly<{
  id: string;
  conversationId: string;
  author: "lead" | "clinic_user" | "agent" | "system";
  body: string;
  sentAt: Date;
  externalId: string | null;
}>;

type InboxPersonaConversation = Readonly<{
  convId: string;
  leadId: string;
}>;

export type SystemOpsLabPersonaRunnerDependencies = {
  inboundEventStore: InboundEventStore;
  jobQueue: JobQueue;
  processMessageHandler: Pick<ProcessMessageJobHandler, "processJob">;
  outboundMessageStore: Pick<
    OutboundMessageStore,
    "findConversationReplyByTurnId" | "markOutboundPending" | "markOutboundDead"
  >;
  sendMessageHandler: Pick<SendMessageJobHandler, "processJob">;
  listConversationMessages(input: {
    conversationId: string;
    clinicId: string;
  }): Promise<Readonly<{
    messages: readonly PersistedPersonaMessage[];
    hasMore: boolean;
  }>>;
  listClinicConversations(input: {
    clinicId: string;
    ids: string[];
  }): Promise<Readonly<{
    rows: readonly InboxPersonaConversation[];
    nextCursor: string | null;
  }>>;
  deliveryAudit: Readonly<{
    capturedDestinations(): readonly string[];
    externalProviderCallCount(): number;
  }>;
  isolationClinicId: string;
  now(): Date;
};

const componentPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const numericOrE164Pattern = /^\+?\d+$/;

const personaSchema = z.object({
  schemaVersion: z.literal(1),
  personaId: z.string()
    .min(1)
    .max(48)
    .regex(componentPattern)
    .refine((value) => !value.includes("--") && !numericOrE164Pattern.test(value)),
  displayName: z.string().trim().min(1).max(120),
  scenario: z.enum(["price_scheduling", "objection_escalation", "booking_revalidation", "reception_opening", "out_of_scope"]),
  turns: z.array(z.object({
    leadText: z.string().trim().min(1).max(1_000),
    expected: z.array(z.enum(SYSTEMOPS_LAB_PERSONA_EXPECTATIONS))
      .min(1)
      .max(SYSTEMOPS_LAB_PERSONA_EXPECTATIONS.length)
      .refine((values) => new Set(values).size === values.length),
  }).strict()).min(2).max(8),
}).strict();

function freezePersona(parsed: z.infer<typeof personaSchema>): SystemOpsLabPersona {
  return Object.freeze({
    ...parsed,
    turns: Object.freeze(parsed.turns.map((turn) => Object.freeze({
      ...turn,
      expected: Object.freeze([...turn.expected]),
    }))),
  });
}

export function parseSystemOpsLabPersona(input: unknown): SystemOpsLabPersona {
  const parsed = personaSchema.safeParse(input);
  if (!parsed.success) {
    const numericIdentity = typeof input === "object"
      && input !== null
      && numericOrE164Pattern.test(String((input as { personaId?: unknown }).personaId ?? ""));
    throw new Error(numericIdentity
      ? "SystemOps Lab persona rejects numeric or E.164 identities"
      : "SystemOps Lab persona JSON is invalid");
  }
  return freezePersona(parsed.data);
}

export function assertSystemOpsLabRunId(runId: string): void {
  if (
    runId.length < 4
    || runId.length > 64
    || !componentPattern.test(runId)
    || runId.includes("--")
  ) throw new Error("SystemOps Lab runId has invalid charset or length");
  if (numericOrE164Pattern.test(runId)) {
    throw new Error("SystemOps Lab runId rejects numeric or E.164 identities");
  }
}

function assertExactClinicIds(clinicId: string, isolationClinicId: string): void {
  if (!uuidPattern.test(clinicId) || !uuidPattern.test(isolationClinicId)) {
    throw new Error("SystemOps Lab runner requires exact UUID tenant identifiers");
  }
  if (clinicId === isolationClinicId) {
    throw new Error("SystemOps Lab runner isolation tenant must differ from the target");
  }
}

function messageProcessPayload(job: JobRecord): string | null {
  if (!job.payload || typeof job.payload !== "object") return null;
  const value = (job.payload as { inboundEventId?: unknown }).inboundEventId;
  return typeof value === "string" ? value : null;
}

function messageSendPayload(job: JobRecord): Readonly<{
  outboundMessageId: string;
  turnId: string;
}> | null {
  if (!job.payload || typeof job.payload !== "object") return null;
  const value = job.payload as { outboundMessageId?: unknown; turnId?: unknown };
  return typeof value.outboundMessageId === "string" && typeof value.turnId === "string"
    ? Object.freeze({ outboundMessageId: value.outboundMessageId, turnId: value.turnId })
    : null;
}

async function claimExactJob(input: Readonly<{
  queue: JobQueueName;
  dedupeKey: string;
  workerId: string;
  now: Date;
  jobQueue: JobQueue;
}>): Promise<JobRecord> {
  const job = await input.jobQueue.claimNextJob({
    queues: [input.queue],
    workerId: input.workerId,
    now: input.now,
    dedupeKey: input.dedupeKey,
  });
  if (!job || job.queue !== input.queue || job.dedupeKey !== input.dedupeKey) {
    throw new Error(`SystemOps Lab runner could not claim the exact ${input.queue} job`);
  }
  return job;
}

async function completeExactJob(input: Readonly<{
  job: JobRecord;
  workerId: string;
  jobQueue: JobQueue;
  now: Date;
}>): Promise<void> {
  const completed = await input.jobQueue.completeJob(
    input.job.id,
    input.workerId,
    input.now,
  );
  if (!completed) throw new Error(`SystemOps Lab runner could not acknowledge ${input.job.queue}`);
}

async function failProcessClaim(input: Readonly<{
  job: JobRecord;
  turnId: string;
  workerId: string;
  dependencies: SystemOpsLabPersonaRunnerDependencies;
}>): Promise<void> {
  const now = input.dependencies.now();
  const status = await input.dependencies.jobQueue.failJob({
    job: input.job,
    workerId: input.workerId,
    error: "systemops_lab_persona_process_failed",
    retryAt: getJobRetryAt(input.job, now),
    now,
  });
  if (status === "pending") {
    await input.dependencies.inboundEventStore.markInboundEventPending(input.turnId);
  } else if (status === "dead") {
    await input.dependencies.inboundEventStore.markInboundEventFailed(input.turnId);
  }
}

async function failSendClaim(input: Readonly<{
  job: JobRecord;
  outboundMessageId: string;
  workerId: string;
  dependencies: SystemOpsLabPersonaRunnerDependencies;
}>): Promise<void> {
  const now = input.dependencies.now();
  const status = await input.dependencies.jobQueue.failJob({
    job: input.job,
    workerId: input.workerId,
    error: "systemops_lab_persona_send_failed",
    retryAt: getJobRetryAt(input.job, now),
    now,
  });
  if (status === "pending") {
    await input.dependencies.outboundMessageStore.markOutboundPending(
      input.outboundMessageId,
      "systemops_lab_persona_send_failed",
    );
  } else if (status === "dead") {
    await input.dependencies.outboundMessageStore.markOutboundDead(
      input.outboundMessageId,
      "systemops_lab_persona_send_failed",
    );
  }
}

function assertPersistedTurnOrder(
  messages: readonly PersistedPersonaMessage[],
  completedTurns: readonly SystemOpsLabRunResult["turns"][number][],
): void {
  const expectedIds = completedTurns.flatMap((turn) => [
    turn.leadMessageId,
    turn.persistedAgentMessageId,
  ]);
  const expectedAuthors = completedTurns.flatMap(() => ["lead", "agent"] as const);
  const expectedIdSet = new Set(expectedIds);
  const persisted = messages.filter((message) => expectedIdSet.has(message.id));
  if (
    persisted.length !== expectedIds.length
    || persisted.some((message, index) =>
      message.id !== expectedIds[index]
      || message.author !== expectedAuthors[index])
  ) throw new Error("SystemOps Lab persisted message order is not lead-agent interleaved");
}

export async function runSystemOpsLabPersona(input: Readonly<{
  runId: string;
  clinicId: string;
  persona: SystemOpsLabPersona;
  dependencies: SystemOpsLabPersonaRunnerDependencies;
}>): Promise<SystemOpsLabRunResult> {
  assertSystemOpsLabRunId(input.runId);
  assertExactClinicIds(input.clinicId, input.dependencies.isolationClinicId);
  const persona = parseSystemOpsLabPersona(input.persona);
  const syntheticAddress = createInternalLabSyntheticAddress({
    runId: input.runId,
    personaId: persona.personaId,
  });
  if (!isInternalLabSyntheticAddress(syntheticAddress)) {
    throw new Error("SystemOps Lab runner did not derive a closed synthetic address");
  }
  if (input.dependencies.deliveryAudit.externalProviderCallCount() !== 0) {
    throw new Error("SystemOps Lab runner detected an external provider call before execution");
  }

  const processWorkerId = `systemops-lab-process:${input.runId}:${persona.personaId}`;
  const senderWorkerId = `systemops-lab-send:${input.runId}:${persona.personaId}`;
  const completedTurns: SystemOpsLabRunResult["turns"][number][] = [];
  let conversationId: string | null = null;
  let nextReceivedAt = input.dependencies.now();

  for (let index = 0; index < persona.turns.length; index += 1) {
    const turn = persona.turns[index]!;
    const providerMessageId = `systemops-lab-${input.runId}-${persona.personaId}-turn-${index + 1}`;
    const persisted = await persistInboundEventAndEnqueue({
      clinicId: input.clinicId,
      provider: "z_api",
      providerMessageId,
      conversationKey: syntheticAddress,
      payload: {
        phone: syntheticAddress,
        chatLid: syntheticAddress,
        instanceId: `systemops-lab-${input.runId}`,
        messageId: providerMessageId,
        momment: nextReceivedAt.getTime(),
        status: "RECEIVED_MESSAGE",
        chatName: persona.displayName,
        senderName: persona.displayName,
        isGroupMsg: false,
        isStatusReply: false,
        isEdit: false,
        fromMe: false,
        text: { message: turn.leadText },
      },
      normalizedText: turn.leadText,
      mediaType: null,
      dedupeKey: `z-api:systemops-lab-${input.runId}:${providerMessageId}`,
      receivedAt: nextReceivedAt,
    }, {
      inboundEventStore: input.dependencies.inboundEventStore,
      jobQueue: input.dependencies.jobQueue,
    });
    if (!persisted.eventWasNew || !persisted.jobWasNew) {
      throw new Error("SystemOps Lab persona run reuses an existing inbound turn");
    }
    const turnId = persisted.inboundEventId;
    const processJob = await claimExactJob({
      queue: "message.process",
      dedupeKey: `inbound-event:${turnId}`,
      workerId: processWorkerId,
      now: input.dependencies.now(),
      jobQueue: input.dependencies.jobQueue,
    });
    try {
      if (messageProcessPayload(processJob) !== turnId) {
        throw new Error("message.process payload mismatch");
      }
      const processResult = await input.dependencies.processMessageHandler.processJob(processJob);
      if (processResult.outcome !== "processed" || processResult.inboundEventId !== turnId) {
        throw new Error("message.process outcome mismatch");
      }
      await completeExactJob({
        job: processJob,
        workerId: processWorkerId,
        jobQueue: input.dependencies.jobQueue,
        now: input.dependencies.now(),
      });
    } catch {
      await failProcessClaim({
        job: processJob,
        turnId,
        workerId: processWorkerId,
        dependencies: input.dependencies,
      });
      throw new Error("SystemOps Lab message.process failed for the exact inbound turn");
    }

    const outbound = await input.dependencies.outboundMessageStore.findConversationReplyByTurnId({
      clinicId: input.clinicId,
      turnId,
    });
    if (
      !outbound
      || outbound.clinicId !== input.clinicId
      || outbound.category !== "reply"
      || !isConversationOutboundPayload(outbound.payload)
      || outbound.payload.turnId !== turnId
      || outbound.payload.to !== syntheticAddress
      || outbound.payload.agentMessagePersistence !== "sender"
    ) throw new Error("SystemOps Lab exact V2 outbound reply is missing or belongs to another turn");
    const outboundPayload = outbound.payload;
    if (conversationId !== null && outbound.conversationId !== conversationId) {
      throw new Error("SystemOps Lab persona created more than one conversation");
    }
    conversationId ??= outbound.conversationId;

    const sendJob = await claimExactJob({
      queue: "message.send",
      dedupeKey: `outbound-message:${outbound.id}`,
      workerId: senderWorkerId,
      now: input.dependencies.now(),
      jobQueue: input.dependencies.jobQueue,
    });
    const capturedBefore = input.dependencies.deliveryAudit.capturedDestinations();
    let sent: Awaited<ReturnType<SystemOpsLabPersonaRunnerDependencies["sendMessageHandler"]["processJob"]>>;
    try {
      const sendPayload = messageSendPayload(sendJob);
      if (
        !sendPayload
        || sendPayload.outboundMessageId !== outbound.id
        || sendPayload.turnId !== turnId
      ) throw new Error("message.send payload mismatch");
      sent = await input.dependencies.sendMessageHandler.processJob(sendJob);
    } catch {
      await failSendClaim({
        job: sendJob,
        outboundMessageId: outbound.id,
        workerId: senderWorkerId,
        dependencies: input.dependencies,
      });
      throw new Error("SystemOps Lab message.send failed for the exact outbound turn");
    }
    if (sent === "deferred" || (typeof sent === "object" && sent.status === "deferred")) {
      const released = await input.dependencies.jobQueue.releaseJob(
        sendJob.id,
        senderWorkerId,
        sent === "deferred"
          ? new Date(input.dependencies.now().getTime() + 1_000)
          : sent.runAt,
        input.dependencies.now(),
      );
      if (!released) throw new Error("SystemOps Lab deferred message.send release failed");
      throw new Error("SystemOps Lab message.send was deferred");
    }
    if (sent !== "sent") {
      await completeExactJob({
        job: sendJob,
        workerId: senderWorkerId,
        jobQueue: input.dependencies.jobQueue,
        now: input.dependencies.now(),
      });
      throw new Error("SystemOps Lab sender ignored the exact reply");
    }
    const capturedAfter = input.dependencies.deliveryAudit.capturedDestinations();
    const newlyCaptured = capturedAfter.slice(capturedBefore.length);
    if (
      newlyCaptured.length === 0
      || newlyCaptured.some((destination) => destination !== syntheticAddress)
    ) {
      await failSendClaim({
        job: sendJob,
        outboundMessageId: outbound.id,
        workerId: senderWorkerId,
        dependencies: input.dependencies,
      });
      throw new Error("SystemOps Lab synthetic delivery capture is missing or mismatched");
    }
    if (input.dependencies.deliveryAudit.externalProviderCallCount() !== 0) {
      await failSendClaim({
        job: sendJob,
        outboundMessageId: outbound.id,
        workerId: senderWorkerId,
        dependencies: input.dependencies,
      });
      throw new Error("SystemOps Lab runner detected an external provider call");
    }
    await completeExactJob({
      job: sendJob,
      workerId: senderWorkerId,
      jobQueue: input.dependencies.jobQueue,
      now: input.dependencies.now(),
    });

    const persistedMessages = await input.dependencies.listConversationMessages({
      conversationId,
      clinicId: input.clinicId,
    });
    if (persistedMessages.hasMore) {
      throw new Error("SystemOps Lab new persona conversation unexpectedly exceeds the Inbox window");
    }
    const leadMessage = persistedMessages.messages.find((message) =>
      message.conversationId === conversationId
      && message.author === "lead"
      && message.externalId === providerMessageId);
    const agentMessage = persistedMessages.messages.find((message) =>
      message.conversationId === conversationId
      && message.author === "agent"
      && message.id === outboundPayload.agentMessageId
      && message.body === outboundPayload.replyText);
    if (!leadMessage) throw new Error("SystemOps Lab persisted lead message is missing");
    if (!agentMessage) throw new Error("SystemOps Lab persisted agent reply is missing");
    const completedTurn = Object.freeze({
      turnId,
      leadMessageId: leadMessage.id,
      outboundMessageId: outbound.id,
      persistedAgentMessageId: agentMessage.id,
      captured: true as const,
    });
    completedTurns.push(completedTurn);
    assertPersistedTurnOrder(persistedMessages.messages, completedTurns);
    const latestSentAt = persistedMessages.messages.reduce(
      (latest, message) => Math.max(latest, message.sentAt.getTime()),
      nextReceivedAt.getTime(),
    );
    nextReceivedAt = new Date(Math.max(input.dependencies.now().getTime(), latestSentAt + 1));
  }

  if (!conversationId) throw new Error("SystemOps Lab persona produced no conversation");
  const [visible, isolated] = await Promise.all([
    input.dependencies.listClinicConversations({
      clinicId: input.clinicId,
      ids: [conversationId],
    }),
    input.dependencies.listClinicConversations({
      clinicId: input.dependencies.isolationClinicId,
      ids: [conversationId],
    }),
  ]);
  if (
    visible.rows.length !== 1
    || visible.rows[0]?.convId !== conversationId
    || !visible.rows[0].leadId
  ) throw new Error("SystemOps Lab conversation is not visible in the exact tenant Inbox");
  if (isolated.rows.length !== 0) {
    throw new Error("SystemOps Lab conversation crossed the tenant Inbox boundary");
  }

  return Object.freeze({
    runId: input.runId,
    clinicId: input.clinicId,
    personaId: persona.personaId,
    conversationId,
    turns: Object.freeze([...completedTurns]),
  });
}
