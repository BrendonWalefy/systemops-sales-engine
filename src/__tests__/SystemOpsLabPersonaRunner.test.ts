import { link, lstat, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  parseSystemOpsLabPersona,
  runSystemOpsLabPersona,
  type SystemOpsLabPersona,
  type SystemOpsLabPersonaRunnerDependencies,
} from "@/application/labs/systemops-lab-persona";
import {
  parseSystemOpsLabPersonaCommandArgs,
  reserveSystemOpsLabRunResultFile,
  runSystemOpsLabPersonaCommand,
  writeSystemOpsLabRunResultFile,
} from "../../scripts/run-systemops-lab-personas";
import type { InboundEvent, InboundEventStore } from "@/application/ports/inbound-event-store";
import type { JobQueue, JobRecord } from "@/application/ports/job-queue";
import type { OutboundMessage } from "@/application/ports/outbound-message-store";

const labId = "11111111-1111-4111-8111-111111111111";
const otherTenantId = "22222222-2222-4222-8222-222222222222";
const runId = "persona-run-20260817";

const twoTurnPersona: SystemOpsLabPersona = Object.freeze({
  schemaVersion: 1,
  personaId: "price-scheduling",
  displayName: "Pessoa decidida e sensível a preço",
  scenario: "price_scheduling",
  turns: Object.freeze([
    Object.freeze({
      leadText: "Quanto custa o clareamento e tem horário amanhã?",
      expected: Object.freeze(["price_subject_binding", "scheduling_correctness"] as const),
    }),
    Object.freeze({
      leadText: "Pode marcar às 15?",
      expected: Object.freeze(["journey_advancement", "safety"] as const),
    }),
  ]),
});

const completedRunResult = Object.freeze({
  runId,
  clinicId: labId,
  personaId: "price-scheduling",
  conversationId: "conversation-1",
  turns: Object.freeze([
    Object.freeze({
      turnId: "turn-1",
      leadMessageId: "lead-message-1",
      outboundMessageId: "outbound-1",
      persistedAgentMessageId: "agent-message-1",
      captured: true as const,
    }),
    Object.freeze({
      turnId: "turn-2",
      leadMessageId: "lead-message-2",
      outboundMessageId: "outbound-2",
      persistedAgentMessageId: "agent-message-2",
      captured: true as const,
    }),
  ]),
});

type HarnessOptions = Readonly<{
  capture?: boolean;
  outboundTurn?: string;
  persistAgentReply?: boolean;
  externalProviderCalls?: number;
  processThrows?: boolean;
  sendResult?: "sent" | "deferred";
}>;

function makeHarness(options: HarnessOptions = {}) {
  const events = new Map<string, InboundEvent>();
  const jobs: JobRecord[] = [];
  const outbounds = new Map<string, OutboundMessage>();
  const messages: Array<{
    id: string;
    conversationId: string;
    author: "lead" | "agent";
    body: string;
    sentAt: Date;
    externalId: string | null;
  }> = [];
  const calls: string[] = [];
  const captureDestinations: string[] = [];
  let turnNumber = 0;

  const inboundEventStore: InboundEventStore = {
    async recordInboundEvent(input) {
      turnNumber += 1;
      calls.push(`persist-inbound:${turnNumber}`);
      const id = `turn-${turnNumber}`;
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
        receivedAt: input.receivedAt ?? new Date(),
        processedAt: null,
      };
      events.set(id, event);
      return { event, isNew: true };
    },
    async findInboundEvent(id) { return events.get(id) ?? null; },
    async markInboundEventProcessing() {},
    async markInboundEventPending(id) {
      const event = events.get(id);
      if (event) event.processingStatus = "pending";
    },
    async markInboundEventProcessed() {},
    async markInboundEventFailed(id) {
      const event = events.get(id);
      if (event) event.processingStatus = "failed";
    },
    async markInboundEventIgnored() {},
  };

  const jobQueue: JobQueue = {
    async enqueueJob(input) {
      const job: JobRecord = {
        id: `job-${jobs.length + 1}`,
        queue: input.queue,
        status: "pending",
        payload: input.payload,
        dedupeKey: input.dedupeKey ?? null,
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 10,
        runAt: input.runAt ?? new Date("2026-08-17T15:00:00.000Z"),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        createdAt: new Date("2026-08-17T15:00:00.000Z"),
        updatedAt: new Date("2026-08-17T15:00:00.000Z"),
      };
      jobs.push(job);
      return { job, isNew: true };
    },
    async claimNextJob(input) {
      const job = jobs.find((candidate) =>
        candidate.status === "pending"
        && input.queues.includes(candidate.queue)
        && candidate.dedupeKey === input.dedupeKey);
      if (!job) return null;
      job.status = "processing";
      job.lockedBy = input.workerId;
      job.attempts += 1;
      const index = job.queue === "message.process"
        ? Number(String(job.payload && (job.payload as { inboundEventId?: string }).inboundEventId).split("-").at(-1))
        : Number(String(job.payload && (job.payload as { turnId?: string }).turnId).split("-").at(-1));
      calls.push(job.queue === "message.process" ? `claim-process:${index}` : `claim-send:${index}`);
      return job;
    },
    async completeJob(jobId, workerId) {
      const job = jobs.find((candidate) => candidate.id === jobId && candidate.lockedBy === workerId);
      if (!job) return false;
      job.status = "done";
      return true;
    },
    async releaseJob(jobId, workerId) {
      const job = jobs.find((candidate) => candidate.id === jobId && candidate.lockedBy === workerId);
      if (!job) return false;
      job.status = "pending";
      job.lockedBy = null;
      return true;
    },
    async failJob(input) {
      const job = jobs.find((candidate) =>
        candidate.id === input.job.id && candidate.lockedBy === input.workerId);
      if (!job) return null;
      job.status = "pending";
      job.lockedBy = null;
      return "pending";
    },
    async recoverStaleJobs() { return 0; },
  };

  const dependencies: SystemOpsLabPersonaRunnerDependencies = {
    inboundEventStore,
    jobQueue,
    processMessageHandler: {
      async processJob(job) {
        const turnId = (job.payload as { inboundEventId: string }).inboundEventId;
        const index = Number(turnId.split("-").at(-1));
        calls.push(`process:${index}`);
        if (options.processThrows) throw new Error("model payload must not be persisted");
        const event = events.get(turnId)!;
        const payload = event.payload as { text: { message: string } };
        messages.push({
          id: `lead-message-${index}`,
          conversationId: "conversation-1",
          author: "lead",
          body: payload.text.message,
          sentAt: new Date(`2026-08-17T15:0${index}:00.000Z`),
          externalId: event.providerMessageId,
        });
        const outboundId = `outbound-${index}`;
        const effectiveTurn = options.outboundTurn ?? turnId;
        const address = event.conversationKey;
        outbounds.set(outboundId, {
          id: outboundId,
          clinicId: labId,
          conversationId: "conversation-1",
          channel: "whatsapp",
          payload: {
            version: 1,
            kind: "conversation_reply",
            turnId: effectiveTurn,
            to: address,
            agentMessageId: `agent-message-${index}`,
            agentMessagePersistence: "sender",
            internalLabBinding: {
              schemaVersion: "conversation-v2.internal-lab-delivery-binding.v1",
              tenantDigest: `sha256:${"1".repeat(64)}`,
              channelDigest: `sha256:${"2".repeat(64)}`,
              configDigest: `sha256:${"3".repeat(64)}`,
            },
            replyText: `Resposta ${index}`,
            intent: null,
            useVoice: false,
            ttsConfig: { provider: "nova", speed: 0.92 },
            interleavedParts: [],
            mediaParts: [],
            leadId: "lead-1",
            pipelineAdvance: null,
          },
          deliveryKind: "text",
          category: "reply",
          sequence: index,
          status: "pending",
          providerMessageId: null,
          dedupeKey: `conversation-reply:${turnId}`,
          attempts: 0,
          lastError: null,
          createdAt: new Date(`2026-08-17T15:0${index}:01.000Z`),
          sentAt: null,
        });
        await jobQueue.enqueueJob({
          queue: "message.send",
          payload: { outboundMessageId: outboundId, turnId },
          dedupeKey: `outbound-message:${outboundId}`,
        });
        return { outcome: "processed" as const, inboundEventId: turnId };
      },
    },
    outboundMessageStore: {
      async findConversationReplyByTurnId(input) {
        return [...outbounds.values()].find((outbound) =>
          outbound.clinicId === input.clinicId
          && (outbound.payload as { turnId?: string }).turnId === input.turnId) ?? null;
      },
      async markOutboundPending(id, error) {
        const outbound = outbounds.get(id);
        if (outbound) {
          outbound.status = "pending";
          outbound.lastError = error;
        }
      },
      async markOutboundDead(id, error) {
        const outbound = outbounds.get(id);
        if (outbound) {
          outbound.status = "dead";
          outbound.lastError = error;
        }
      },
    },
    sendMessageHandler: {
      async processJob(job) {
        const outboundId = (job.payload as { outboundMessageId: string }).outboundMessageId;
        const index = Number(outboundId.split("-").at(-1));
        calls.push(`send-capture:${index}`);
        const outbound = outbounds.get(outboundId)!;
        if (options.capture !== false) {
          captureDestinations.push((outbound.payload as { to: string }).to);
        }
        if (options.persistAgentReply !== false) {
          messages.push({
            id: `agent-message-${index}`,
            conversationId: "conversation-1",
            author: "agent",
            body: `Resposta ${index}`,
            sentAt: new Date(`2026-08-17T15:0${index}:01.000Z`),
            externalId: null,
          });
        }
        return options.sendResult ?? "sent";
      },
    },
    async listConversationMessages(input) {
      const index = messages.filter((message) => message.author === "lead").length;
      calls.push(`read-messages:${index}`);
      return {
        messages: messages.filter((message) => message.conversationId === input.conversationId),
        hasMore: false,
      };
    },
    async listClinicConversations(input) {
      if (input.clinicId !== labId || !input.ids.includes("conversation-1")) {
        return { rows: [], nextCursor: null };
      }
      return {
        rows: [{ convId: "conversation-1", leadId: "lead-1" }],
        nextCursor: null,
      };
    },
    deliveryAudit: {
      capturedDestinations: () => [...captureDestinations],
      externalProviderCallCount: () => options.externalProviderCalls ?? 0,
    },
    isolationClinicId: otherTenantId,
    now: () => new Date("2026-08-17T15:00:00.000Z"),
  };

  return { dependencies, calls, jobs, messages, events, outbounds };
}

describe("SystemOps Lab persona parser", () => {
  it("accepts only the closed version-one persona contract", () => {
    expect(parseSystemOpsLabPersona(twoTurnPersona)).toEqual(twoTurnPersona);
    expect(() => parseSystemOpsLabPersona({ ...twoTurnPersona, unknown: true })).toThrow(/persona/i);
    expect(() => parseSystemOpsLabPersona({ ...twoTurnPersona, schemaVersion: 2 })).toThrow(/persona/i);
    expect(() => parseSystemOpsLabPersona({ ...twoTurnPersona, personaId: "5511999999999" }))
      .toThrow(/numeric|E\.164/i);
    expect(() => parseSystemOpsLabPersona({
      ...twoTurnPersona,
      turns: [{ leadText: "Mensagem", expected: ["fabricated_verdict"] }],
    })).toThrow(/persona/i);
  });

  it("parses only the exact CLI flags and one execution mode", () => {
    expect(parseSystemOpsLabPersonaCommandArgs([
      "--dry-run",
      "--run-id", runId,
      "--clinic-id", labId,
      "--persona", "evals/systemops-lab/personas/price-scheduling.json",
      "--approval-file", "/dev/null",
    ])).toMatchObject({ mode: "dry-run", runId, clinicId: labId });

    expect(parseSystemOpsLabPersonaCommandArgs([
      "--execute",
      "--run-id", runId,
      "--clinic-id", labId,
      "--persona", "evals/systemops-lab/personas/price-scheduling.json",
      "--approval-file", "/approval.json",
      "--result-file", "/tmp/systemops-lab-run-result.json",
    ])).toMatchObject({
      mode: "execute",
      resultFile: "/tmp/systemops-lab-run-result.json",
    });

    expect(() => parseSystemOpsLabPersonaCommandArgs([
      "--execute", "--dry-run",
      "--run-id", runId,
      "--clinic-id", labId,
      "--persona", "persona.json",
      "--approval-file", "/approval.json",
    ])).toThrow(/exactly one mode/i);
    expect(() => parseSystemOpsLabPersonaCommandArgs([
      "--execute",
      "--run-id", "5511999999999",
      "--clinic-id", labId,
      "--persona", "persona.json",
      "--approval-file", "/approval.json",
    ])).toThrow(/numeric|E\.164/i);
    expect(() => parseSystemOpsLabPersonaCommandArgs([
      "--execute",
      "--run-id", runId,
      "--clinic-id", labId,
      "--persona", "persona.json",
      "--approval-file", "/approval.json",
    ])).toThrow(/result-file/i);
    expect(() => parseSystemOpsLabPersonaCommandArgs([
      "--execute",
      "--run-id", runId,
      "--clinic-id", labId,
      "--persona", "persona.json",
      "--approval-file", "/approval.json",
      "--result-file", "relative-result.json",
    ])).toThrow(/absolute/i);
    expect(() => parseSystemOpsLabPersonaCommandArgs([
      "--execute",
      "--run-id", runId,
      "--clinic-id", labId,
      "--persona", "persona.json",
      "--approval-file", "/approval.json",
      "--result-file", path.resolve("evals/systemops-lab/intermediate.json"),
    ])).toThrow(/outside|repository|evidence/i);
    expect(() => parseSystemOpsLabPersonaCommandArgs([
      "--execute",
      "--run-id", runId,
      "--clinic-id", labId,
      "--persona", "persona.json",
      "--approval-file", "/approval.json",
      "--result-file", path.resolve("..outside/run.json"),
    ])).toThrow(/outside|repository/i);
  });

  it("atomically writes one protected full run envelope and refuses overwrite aliases", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "systemops-lab-run-result-"));
    const resultFile = path.join(directory, "run.json");
    try {
      await writeSystemOpsLabRunResultFile(resultFile, completedRunResult);

      expect(JSON.parse(await readFile(resultFile, "utf8"))).toEqual(completedRunResult);
      expect((await lstat(resultFile)).mode & 0o777).toBe(0o600);
      await expect(writeSystemOpsLabRunResultFile(resultFile, completedRunResult))
        .rejects.toThrow(/exists|overwrite/i);

      const symbolicAlias = path.join(directory, "symbolic.json");
      await symlink(resultFile, symbolicAlias);
      await expect(writeSystemOpsLabRunResultFile(symbolicAlias, completedRunResult))
        .rejects.toThrow(/exists|symlink|overwrite/i);

      const hardAlias = path.join(directory, "hard.json");
      await link(resultFile, hardAlias);
      await expect(writeSystemOpsLabRunResultFile(hardAlias, completedRunResult))
        .rejects.toThrow(/exists|hardlink|overwrite/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("holds an exclusive reservation across execution and refuses an occupied destination", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "systemops-lab-run-reservation-"));
    const resultFile = path.join(directory, "run.json");
    const first = await reserveSystemOpsLabRunResultFile(resultFile);
    try {
      await expect(reserveSystemOpsLabRunResultFile(resultFile)).rejects.toThrow(/reserved|exists/i);
      await first.publish(completedRunResult);
      expect(JSON.parse(await readFile(resultFile, "utf8"))).toEqual(completedRunResult);
    } finally {
      await first.release();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("SystemOps Lab durable persona runner", () => {
  it("feeds turn N+1 only after the persisted agent reply from turn N exists", async () => {
    const harness = makeHarness();
    const result = await runSystemOpsLabPersona({
      runId,
      clinicId: labId,
      persona: twoTurnPersona,
      dependencies: harness.dependencies,
    });

    expect(harness.calls).toEqual([
      "persist-inbound:1", "claim-process:1", "process:1", "claim-send:1", "send-capture:1", "read-messages:1",
      "persist-inbound:2", "claim-process:2", "process:2", "claim-send:2", "send-capture:2", "read-messages:2",
    ]);
    expect(result.turns.every((turn) => turn.captured)).toBe(true);
    expect(result.conversationId).toBe("conversation-1");
    expect(harness.messages.map((message) => message.author)).toEqual(["lead", "agent", "lead", "agent"]);
    expect(result.turns.map((turn) => turn.leadMessageId)).toEqual(["lead-message-1", "lead-message-2"]);
    expect(result.turns.map((turn) => turn.persistedAgentMessageId)).toEqual(["agent-message-1", "agent-message-2"]);
  });

  it.each([
    ["capture is missing", { capture: false }, /capture/i],
    ["the outbound belongs to another turn", { outboundTurn: "wrong-turn" }, /outbound|turn/i],
    ["the agent reply is not persisted", { persistAgentReply: false }, /persisted agent reply/i],
    ["a real provider was called", { externalProviderCalls: 1 }, /external provider/i],
  ])("aborts immediately when %s", async (_case, options, error) => {
    const harness = makeHarness(options);
    await expect(runSystemOpsLabPersona({
      runId,
      clinicId: labId,
      persona: twoTurnPersona,
      dependencies: harness.dependencies,
    })).rejects.toThrow(error);
    expect(harness.calls).not.toContain("persist-inbound:2");
  });

  it("fails closed when the exact process or send job cannot be claimed", async () => {
    const harness = makeHarness();
    harness.dependencies.jobQueue.claimNextJob = vi.fn().mockResolvedValue(null);
    await expect(runSystemOpsLabPersona({
      runId,
      clinicId: labId,
      persona: twoTurnPersona,
      dependencies: harness.dependencies,
    })).rejects.toThrow(/exact message\.process job/i);
  });

  it("returns a failed process claim to the canonical retry lifecycle", async () => {
    const harness = makeHarness({ processThrows: true });
    await expect(runSystemOpsLabPersona({
      runId,
      clinicId: labId,
      persona: twoTurnPersona,
      dependencies: harness.dependencies,
    })).rejects.toThrow(/process failed/i);

    expect(harness.jobs[0]).toMatchObject({
      queue: "message.process",
      status: "pending",
      lockedBy: null,
    });
    expect(harness.events.get("turn-1")?.processingStatus).toBe("pending");
  });

  it("releases a deferred send claim and never starts the next turn", async () => {
    const harness = makeHarness({ sendResult: "deferred" });
    await expect(runSystemOpsLabPersona({
      runId,
      clinicId: labId,
      persona: twoTurnPersona,
      dependencies: harness.dependencies,
    })).rejects.toThrow(/deferred/i);

    expect(harness.jobs.find((job) => job.queue === "message.send")).toMatchObject({
      status: "pending",
      lockedBy: null,
    });
    expect(harness.calls).not.toContain("persist-inbound:2");
  });

  it("fails the send job instead of stranding it when capture evidence is missing", async () => {
    const harness = makeHarness({ capture: false });
    await expect(runSystemOpsLabPersona({
      runId,
      clinicId: labId,
      persona: twoTurnPersona,
      dependencies: harness.dependencies,
    })).rejects.toThrow(/capture/i);

    expect(harness.jobs.find((job) => job.queue === "message.send")).toMatchObject({
      status: "pending",
      lockedBy: null,
    });
    expect(harness.outbounds.get("outbound-1")).toMatchObject({
      status: "pending",
      lastError: "systemops_lab_persona_send_failed",
    });
  });

  it("fails closed when the exact send job cannot be claimed", async () => {
    const harness = makeHarness();
    const claim = harness.dependencies.jobQueue.claimNextJob.bind(harness.dependencies.jobQueue);
    harness.dependencies.jobQueue.claimNextJob = vi.fn(async (input) =>
      input.queues.includes("message.send") ? null : claim(input));
    await expect(runSystemOpsLabPersona({
      runId,
      clinicId: labId,
      persona: twoTurnPersona,
      dependencies: harness.dependencies,
    })).rejects.toThrow(/exact message\.send job/i);
  });

  it("keeps dry-run free of database, model, channel, and approval reads", async () => {
    const loadPersona = vi.fn().mockResolvedValue(twoTurnPersona);
    const execute = vi.fn();
    const readApproval = vi.fn();
    const write = vi.fn();
    await runSystemOpsLabPersonaCommand({
      mode: "dry-run",
      runId,
      clinicId: labId,
      personaPath: "evals/systemops-lab/personas/price-scheduling.json",
      approvalFile: "/dev/null",
      resultFile: null,
    }, {
      loadPersona,
      execute,
      readApproval,
      reserveResultFile: vi.fn(),
      write,
    });

    expect(loadPersona).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(readApproval).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(expect.stringMatching(/"turnCount":2/));
    expect(write.mock.calls.flat().join("\n")).not.toMatch(/Quanto|5511|@lid|approval/i);
  });

  it("writes the full execute result only to the protected handoff file", async () => {
    const write = vi.fn();
    const publish = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const reserveResultFile = vi.fn().mockResolvedValue({ publish, release });
    const result = await runSystemOpsLabPersonaCommand({
      mode: "execute",
      runId,
      clinicId: labId,
      personaPath: "evals/systemops-lab/personas/price-scheduling.json",
      approvalFile: "/approval.json",
      resultFile: "/tmp/systemops-lab-run-result.json",
    }, {
      loadPersona: vi.fn().mockResolvedValue(twoTurnPersona),
      readApproval: vi.fn().mockResolvedValue("signed-approval"),
      execute: vi.fn().mockResolvedValue(completedRunResult),
      reserveResultFile,
      write,
    });

    expect(result).toEqual(completedRunResult);
    expect(reserveResultFile).toHaveBeenCalledWith("/tmp/systemops-lab-run-result.json");
    expect(publish).toHaveBeenCalledWith(completedRunResult);
    expect(release).toHaveBeenCalledOnce();
    const stdout = write.mock.calls.flat().join("\n");
    expect(stdout).toContain('"turnCount":2');
    expect(stdout).not.toMatch(/lead-message|agent-message|outbound-|conversation-|"turns"/i);
  });

  it("does not execute when the protected handoff destination cannot be reserved", async () => {
    const execute = vi.fn();
    await expect(runSystemOpsLabPersonaCommand({
      mode: "execute",
      runId,
      clinicId: labId,
      personaPath: "evals/systemops-lab/personas/price-scheduling.json",
      approvalFile: "/approval.json",
      resultFile: "/tmp/systemops-lab-run-result.json",
    }, {
      loadPersona: vi.fn().mockResolvedValue(twoTurnPersona),
      readApproval: vi.fn().mockResolvedValue("signed-approval"),
      execute,
      reserveResultFile: vi.fn().mockRejectedValue(new Error("run result destination reserved")),
      write: vi.fn(),
    })).rejects.toThrow(/reserved/i);

    expect(execute).not.toHaveBeenCalled();
  });
});
