import { describe, expect, it, vi } from "vitest";
import { drainMessageProcessQueue } from "@/application/jobs/drain-message-process-queue";
import { ProcessMessageJobHandler } from "@/application/jobs/process-message-job";
import { persistInboundEventAndEnqueue } from "@/application/whatsapp/persist-inbound-event";
import type {
  InboundEvent,
  InboundEventStore,
  RecordInboundEventInput,
} from "@/application/ports/inbound-event-store";
import type {
  EnqueueJobInput,
  JobQueue,
  JobRecord,
} from "@/application/ports/job-queue";

const T0 = new Date("2026-08-24T12:00:00.000Z");
const T5 = new Date(T0.getTime() + 5_000);
const T16 = new Date(T0.getTime() + 16_000);
const T20 = new Date(T0.getTime() + 20_000);

type AuthorityFields = {
  streamId?: string | null;
  streamGeneration?: number | null;
  claimToken?: string | null;
  claimJobId?: string | null;
  authorityState?: "active" | "provisional" | null;
  aliasValues?: string[];
  identityConflict?: boolean;
};

function authorityFields(event: InboundEvent): AuthorityFields {
  return event as InboundEvent & AuthorityFields;
}

class InMemoryInboundEventStore implements InboundEventStore {
  readonly events = new Map<string, InboundEvent>();

  async recordInboundEvent(input: RecordInboundEventInput) {
    const id = `event-${this.events.size + 1}`;
    const event: InboundEvent = {
      id,
      clinicId: input.clinicId,
      provider: input.provider,
      providerMessageId: input.providerMessageId,
      conversationKey: input.conversationKey,
      payload: input.payload,
      normalizedText: input.normalizedText ?? null,
      mediaType: input.mediaType ?? null,
      dedupeKey: input.dedupeKey,
      processingStatus: "pending",
      receivedAt: input.receivedAt ?? new Date(T0),
      processedAt: null,
    };
    this.events.set(id, event);
    return { event, isNew: true };
  }

  async findInboundEvent(id: string) {
    return this.events.get(id) ?? null;
  }

  async markInboundEventProcessing(id: string) {
    this.events.get(id)!.processingStatus = "processing";
  }

  async markInboundEventPending(id: string) {
    this.events.get(id)!.processingStatus = "pending";
  }

  async markInboundEventProcessed(id: string) {
    const event = this.events.get(id)!;
    event.processingStatus = "processed";
    event.processedAt = new Date(T16);
  }

  async markInboundEventFailed(id: string) {
    this.events.get(id)!.processingStatus = "failed";
  }

  async markInboundEventIgnored(id: string) {
    this.events.get(id)!.processingStatus = "ignored";
  }
}

class InMemoryJobQueue implements JobQueue {
  readonly jobs: JobRecord[] = [];

  async enqueueJob(input: EnqueueJobInput) {
    const now = new Date(T0);
    const job: JobRecord = {
      id: `job-${this.jobs.length + 1}`,
      queue: input.queue,
      status: "pending",
      payload: input.payload,
      dedupeKey: input.dedupeKey ?? null,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 10,
      runAt: input.runAt ?? now,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.push(job);
    return { job, isNew: true };
  }

  async claimNextJob(input: Parameters<JobQueue["claimNextJob"]>[0]) {
    const job = this.jobs
      .filter((candidate) =>
        candidate.status === "pending"
        && input.queues.includes(candidate.queue)
        && candidate.runAt <= (input.now ?? new Date()),
      )
      .sort((left, right) => left.runAt.getTime() - right.runAt.getTime())[0];
    if (!job) return null;
    job.status = "processing";
    job.lockedAt = input.now ?? new Date(T0);
    job.lockedBy = input.workerId;
    job.attempts += 1;
    return job;
  }

  async completeJob(jobId: string, workerId: string) {
    const job = this.jobs.find((candidate) => candidate.id === jobId && candidate.lockedBy === workerId);
    if (!job) return false;
    job.status = "done";
    return true;
  }

  async releaseJob(jobId: string, workerId: string, runAt: Date) {
    const job = this.jobs.find((candidate) => candidate.id === jobId && candidate.lockedBy === workerId);
    if (!job) return false;
    job.status = "pending";
    job.runAt = runAt;
    job.lockedBy = null;
    return true;
  }

  async failJob(input: Parameters<JobQueue["failJob"]>[0]) {
    const job = this.jobs.find((candidate) => candidate.id === input.job.id && candidate.lockedBy === input.workerId);
    if (!job) return null;
    job.status = "pending";
    job.runAt = input.retryAt;
    job.lockedBy = null;
    return "pending" as const;
  }

  async recoverStaleJobs() {
    return 0;
  }
}

type TestStreamAuthority = {
  id: string;
  currentGeneration: number;
  latestInboundEventId: string;
};

type AtomicClaimInput = {
  job: JobRecord;
  stream: TestStreamAuthority;
  event: InboundEvent;
  workerId: string;
  now: Date;
};

type AtomicClaimResult = {
  job: JobRecord;
  streamId: string;
  streamGeneration: number;
  inboundEventId: string;
  claimToken: string;
};

/**
 * Test-only contract for the approved claim boundary. Production must replace
 * this with one database statement that locks and updates the same four
 * durable records atomically.
 */
class InMemoryAtomicClaimBoundary {
  private tokenSequence = 0;

  async claim(input: AtomicClaimInput): Promise<AtomicClaimResult> {
    const authority = authorityFields(input.event);
    if (
      authority.streamId !== input.stream.id
      || authority.streamGeneration !== input.stream.currentGeneration
      || input.stream.latestInboundEventId !== input.event.id
    ) {
      throw new Error("event is not the current settled stream generation");
    }

    if (authority.claimJobId && authority.claimJobId !== input.job.id) {
      throw new Error("claim token belongs to a different job");
    }

    const claimToken = authority.claimToken ?? `claim-${++this.tokenSequence}`;
    authority.claimToken = claimToken;
    authority.claimJobId = input.job.id;

    input.job.status = "processing";
    input.job.lockedAt = input.now;
    input.job.lockedBy = input.workerId;
    input.job.attempts += 1;

    return {
      job: input.job,
      streamId: input.stream.id,
      streamGeneration: input.stream.currentGeneration,
      inboundEventId: input.event.id,
      claimToken,
    };
  }
}

function payload(messageId: string, message: string, chatLid?: string) {
  return {
    phone: "5511999999999",
    ...(chatLid ? { chatLid } : {}),
    instanceId: "instance-1",
    messageId,
    text: { message },
    fromMe: false,
    isGroupMsg: false,
    isStatusReply: false,
    isEdit: false,
  };
}

async function recordMessage(
  inboundEventStore: InMemoryInboundEventStore,
  jobQueue: InMemoryJobQueue,
  input: {
    messageId: string;
    message: string;
    conversationKey?: string;
    chatLid?: string;
    receivedAt?: Date;
  },
) {
  return persistInboundEventAndEnqueue({
    clinicId: "clinic-1",
    provider: "z_api",
    providerMessageId: input.messageId,
    conversationKey: input.conversationKey ?? "5511999999999",
    payload: payload(input.messageId, input.message, input.chatLid),
    normalizedText: input.message,
    dedupeKey: `z-api:instance-1:${input.messageId}`,
    receivedAt: input.receivedAt ?? T0,
  }, { inboundEventStore, jobQueue });
}

function replyHandler(replies: string[]) {
  return {
    async handle(input: { messageText: string }) {
      replies.push(input.messageText);
      return { replied: true };
    },
  };
}

function processHandler(
  inboundEventStore: InMemoryInboundEventStore,
  replies: string[],
  conversationHandler = replyHandler(replies),
) {
  return new ProcessMessageJobHandler({
    inboundEventStore,
    automationPolicy: { getAutomationMode: vi.fn().mockResolvedValue("live") },
    resolveInboundContent: vi.fn().mockImplementation(async ({ payload: input }) => ({
      messageText: input.text?.message ?? "",
      shouldReply: true,
    })),
    transcribeAudio: vi.fn(),
    conversationHandler,
  });
}

describe("scheduled burst debounce through the durable inbox", () => {
  it("does not reply to A when B arrived before A's job was drained", async () => {
    const inboundEventStore = new InMemoryInboundEventStore();
    const jobQueue = new InMemoryJobQueue();
    const replies: string[] = [];
    const convertedConversationMessages: string[] = [];

    await persistInboundEventAndEnqueue({
      clinicId: "clinic-1",
      provider: "z_api",
      providerMessageId: "message-a",
      conversationKey: "5511999999999",
      payload: payload("message-a", "A"),
      normalizedText: "A",
      dedupeKey: "z-api:instance-1:message-a",
      receivedAt: T0,
    }, { inboundEventStore, jobQueue });
    await persistInboundEventAndEnqueue({
      clinicId: "clinic-1",
      provider: "z_api",
      providerMessageId: "message-b",
      conversationKey: "5511999999999",
      payload: payload("message-b", "B"),
      normalizedText: "B",
      dedupeKey: "z-api:instance-1:message-b",
      receivedAt: T5,
    }, { inboundEventStore, jobQueue });

    expect(jobQueue.jobs.map((job) => job.runAt)).toEqual([T0.getTime() + 15_000, T5.getTime() + 15_000].map((time) => new Date(time)));
    expect(jobQueue.jobs[0]?.runAt).toEqual(new Date(T0.getTime() + 15_000));
    expect(jobQueue.jobs[1]?.runAt).toEqual(T20);

    const processMessageHandler = new ProcessMessageJobHandler({
      inboundEventStore,
      automationPolicy: { getAutomationMode: vi.fn().mockResolvedValue("live") },
      resolveInboundContent: vi.fn().mockImplementation(async ({ payload: input }) => ({
        messageText: input.text?.message ?? "",
        shouldReply: true,
      })),
      transcribeAudio: vi.fn(),
      conversationHandler: {
        async handle(input) {
          // This is the current boundary: only a message that has already been
          // converted from inbound_events is visible to conversation logic.
          convertedConversationMessages.push(input.messageText);
          replies.push(input.messageText);
          return { replied: true };
        },
      },
    });

    await drainMessageProcessQueue({
      jobQueue,
      inboundEventStore,
      handler: processMessageHandler,
      workerId: "worker-1",
      maxJobs: 10,
      now: T16,
    });

    // B is durable and already received, but its process job is not eligible
    // until t=20, so it has not become a conversation message at t=16.
    expect(inboundEventStore.events.get("event-2")?.processingStatus).toBe("pending");
    expect(convertedConversationMessages).not.toContain("B");
    expect(replies).toEqual([]);
  });

  it("replies once from B after the complete burst quiet window", async () => {
    const inboundEventStore = new InMemoryInboundEventStore();
    const jobQueue = new InMemoryJobQueue();
    const replies: string[] = [];

    await recordMessage(inboundEventStore, jobQueue, {
      messageId: "message-a",
      message: "A",
      receivedAt: T0,
    });
    await recordMessage(inboundEventStore, jobQueue, {
      messageId: "message-b",
      message: "B",
      receivedAt: T5,
    });

    const handler = processHandler(inboundEventStore, replies);
    await drainMessageProcessQueue({
      jobQueue,
      inboundEventStore,
      handler,
      workerId: "worker-1",
      maxJobs: 10,
      now: T20,
    });

    expect(replies).toEqual(["B"]);
  });

  it("keeps A authorized after claim when B arrives before A finishes", async () => {
    const inboundEventStore = new InMemoryInboundEventStore();
    const jobQueue = new InMemoryJobQueue();
    const replies: string[] = [];
    const claimBoundary = new InMemoryAtomicClaimBoundary();

    await recordMessage(inboundEventStore, jobQueue, {
      messageId: "message-a",
      message: "A",
      receivedAt: T0,
    });

    const eventA = inboundEventStore.events.get("event-1")!;
    Object.assign(authorityFields(eventA), {
      streamId: "stream-1",
      streamGeneration: 1,
      claimToken: null,
      claimJobId: null,
      authorityState: "active",
    });
    const stream: TestStreamAuthority = {
      id: "stream-1",
      currentGeneration: 1,
      latestInboundEventId: eventA.id,
    };

    const claimed = await claimBoundary.claim({
      job: jobQueue.jobs[0]!,
      stream,
      event: eventA,
      workerId: "worker-1",
      now: new Date(T0.getTime() + 15_000),
    });
    expect(claimed).toMatchObject({
      streamId: "stream-1",
      streamGeneration: 1,
      inboundEventId: eventA.id,
    });
    const firstToken = claimed.claimToken;

    claimed.job.status = "pending";
    claimed.job.lockedBy = null;
    const retried = await claimBoundary.claim({
      job: claimed.job,
      stream,
      event: eventA,
      workerId: "worker-2",
      now: new Date(T0.getTime() + 15_500),
    });
    expect(retried.claimToken).toBe(firstToken);

    await recordMessage(inboundEventStore, jobQueue, {
      messageId: "message-b",
      message: "B",
      receivedAt: T5,
    });

    expect(authorityFields(eventA).claimToken).toBe(firstToken);

    const handler = processHandler(inboundEventStore, replies);
    await handler.processJob(claimed.job);

    expect(replies).toEqual(["A"]);

    await drainMessageProcessQueue({
      jobQueue,
      inboundEventStore,
      handler,
      workerId: "worker-2",
      maxJobs: 10,
      now: T20,
    });

    expect(replies).toEqual(["A", "B"]);
  });

  it("assigns one stream and ordered generations to concurrent ingress", async () => {
    const inboundEventStore = new InMemoryInboundEventStore();
    const jobQueue = new InMemoryJobQueue();

    await Promise.all([
      recordMessage(inboundEventStore, jobQueue, {
        messageId: "message-a",
        message: "A",
        receivedAt: T0,
      }),
      recordMessage(inboundEventStore, jobQueue, {
        messageId: "message-b",
        message: "B",
        receivedAt: T5,
      }),
    ]);

    const events = [...inboundEventStore.events.values()];
    expect(events).toHaveLength(2);
    expect(new Set(events.map((event) => authorityFields(event).streamId))).toEqual(new Set(["stream-1"]));

    const generations = events.map((event) => authorityFields(event).streamGeneration);
    expect(new Set(generations)).toEqual(new Set([1, 2]));
    expect(generations.every((generation) => typeof generation === "number")).toBe(true);

    const canonicalHistory = [...events]
      .sort((left, right) => authorityFields(left).streamGeneration! - authorityFields(right).streamGeneration!)
      .map((event) => event.normalizedText);
    expect(new Set(canonicalHistory)).toEqual(new Set(["A", "B"]));
  });

  it("converges two concurrent introductions of the same unknown alias", async () => {
    const inboundEventStore = new InMemoryInboundEventStore();
    const jobQueue = new InMemoryJobQueue();

    await Promise.all([
      recordMessage(inboundEventStore, jobQueue, {
        messageId: "message-a",
        message: "A",
        conversationKey: "5511999999999",
        chatLid: "unknown-lid",
      }),
      recordMessage(inboundEventStore, jobQueue, {
        messageId: "message-b",
        message: "B",
        conversationKey: "5511999999999",
        chatLid: "unknown-lid",
      }),
    ]);

    const events = [...inboundEventStore.events.values()];
    const streamIds = new Set(events.map((event) => authorityFields(event).streamId));
    expect(streamIds).toEqual(new Set(["stream-1"]));
    expect(events.every((event) => authorityFields(event).authorityState === "active")).toBe(true);
    expect(events.every((event) => authorityFields(event).aliasValues?.includes("5511999999999"))).toBe(true);
    expect(events.every((event) => authorityFields(event).aliasValues?.includes("unknown-lid"))).toBe(true);
    expect(events.every((event) => !authorityFields(event).authorityState || authorityFields(event).authorityState !== "provisional")).toBe(true);
    expect(jobQueue.jobs).toHaveLength(2);
  });

  it("fails closed when two genuinely active alias winners conflict", async () => {
    const inboundEventStore = new InMemoryInboundEventStore();
    const jobQueue = new InMemoryJobQueue();

    await recordMessage(inboundEventStore, jobQueue, {
      messageId: "conflicting-alias-message",
      message: "conflict",
      conversationKey: "5511999999999",
      chatLid: "lid-owned-by-another-stream",
    });

    const event = inboundEventStore.events.get("event-1")!;
    expect(authorityFields(event).identityConflict).toBe(true);
    expect(event.processingStatus as string).toBe("identity_conflict");
    expect(jobQueue.jobs).toHaveLength(0);
  });

  it("does not create a second event or generation for a duplicate provider delivery", async () => {
    const inboundEventStore = new InMemoryInboundEventStore();
    const jobQueue = new InMemoryJobQueue();

    await recordMessage(inboundEventStore, jobQueue, {
      messageId: "duplicate-message",
      message: "A",
      receivedAt: T0,
    });
    await recordMessage(inboundEventStore, jobQueue, {
      messageId: "duplicate-message",
      message: "A",
      receivedAt: T5,
    });

    expect(inboundEventStore.events.size).toBe(1);
    expect(jobQueue.jobs).toHaveLength(1);
  });

  it("preserves canonical arrival order when provider timestamps are reversed", async () => {
    const inboundEventStore = new InMemoryInboundEventStore();
    const jobQueue = new InMemoryJobQueue();

    await recordMessage(inboundEventStore, jobQueue, {
      messageId: "message-a",
      message: "A",
      receivedAt: T5,
    });
    await recordMessage(inboundEventStore, jobQueue, {
      messageId: "message-b",
      message: "B",
      receivedAt: T0,
    });

    const events = [...inboundEventStore.events.values()];
    expect(events.map((event) => authorityFields(event).streamGeneration)).toEqual([1, 2]);
    expect(events.map((event) => event.normalizedText)).toEqual(["A", "B"]);
  });

  it("retains the claim token across a failed composition and retry", async () => {
    const inboundEventStore = new InMemoryInboundEventStore();
    const jobQueue = new InMemoryJobQueue();
    const replies: string[] = [];
    await recordMessage(inboundEventStore, jobQueue, {
      messageId: "message-a",
      message: "A",
      receivedAt: T0,
    });

    const failingHandler = processHandler(inboundEventStore, replies, {
      async handle() {
        throw new Error("composition failed");
      },
    });
    await drainMessageProcessQueue({
      jobQueue,
      inboundEventStore,
      handler: failingHandler,
      workerId: "worker-1",
      maxJobs: 1,
      now: new Date(T0.getTime() + 15_000),
    });

    const event = inboundEventStore.events.get("event-1")!;
    const retainedToken = authorityFields(event).claimToken;
    expect.soft(typeof retainedToken).toBe("string");

    jobQueue.jobs[0]!.runAt = new Date(T0.getTime() + 20_000);
    const successfulHandler = processHandler(inboundEventStore, replies);
    await drainMessageProcessQueue({
      jobQueue,
      inboundEventStore,
      handler: successfulHandler,
      workerId: "worker-2",
      maxJobs: 1,
      now: T20,
    });

    expect.soft(authorityFields(event).claimToken).toBe(retainedToken);
    expect(replies).toEqual(["A"]);
  });

  it("replies only from the newest generation in each independent stream", async () => {
    const inboundEventStore = new InMemoryInboundEventStore();
    const jobQueue = new InMemoryJobQueue();
    const replies: string[] = [];

    await recordMessage(inboundEventStore, jobQueue, {
      messageId: "stream-a-1",
      message: "A1",
      conversationKey: "stream-a",
      receivedAt: T0,
    });
    await recordMessage(inboundEventStore, jobQueue, {
      messageId: "stream-a-2",
      message: "A2",
      conversationKey: "stream-a",
      receivedAt: T5,
    });
    await recordMessage(inboundEventStore, jobQueue, {
      messageId: "stream-b-1",
      message: "B1",
      conversationKey: "stream-b",
      receivedAt: T0,
    });

    await drainMessageProcessQueue({
      jobQueue,
      inboundEventStore,
      handler: processHandler(inboundEventStore, replies),
      workerId: "worker-1",
      maxJobs: 10,
      now: T20,
    });

    expect(replies).toEqual(["A2", "B1"]);
  });

  it("replies only from the fifth message in a five-message burst", async () => {
    const inboundEventStore = new InMemoryInboundEventStore();
    const jobQueue = new InMemoryJobQueue();
    const replies: string[] = [];

    for (let index = 0; index < 5; index += 1) {
      await recordMessage(inboundEventStore, jobQueue, {
        messageId: `message-${index + 1}`,
        message: String.fromCharCode("A".charCodeAt(0) + index),
        receivedAt: new Date(T0.getTime() + index * 1_000),
      });
    }

    await drainMessageProcessQueue({
      jobQueue,
      inboundEventStore,
      handler: processHandler(inboundEventStore, replies),
      workerId: "worker-1",
      maxJobs: 10,
      now: new Date(T0.getTime() + 20_000),
    });

    expect(replies).toEqual(["E"]);
  });
});
