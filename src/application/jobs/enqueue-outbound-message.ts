import type {
  CreateOutboundMessageInput,
  OutboundMessageStore,
} from "@/application/ports/outbound-message-store";
import type { JobQueue } from "@/application/ports/job-queue";
import { after } from "next/server";
import {
  requestSenderWorkerRun,
  scheduleSenderWorkerWake,
} from "@/application/jobs/worker-wake";
import { isV2ProactiveAutomationOutboundPayload } from "@/application/jobs/conversation-outbound-payload";
import {
  recordDecisionTrace,
  type DecisionTraceSink,
} from "@/core/observability/DecisionTrace";

type EnqueueOutboundMessageDependencies = {
  outboundMessageStore: OutboundMessageStore;
  jobQueue: JobQueue;
  requestSenderWake?: () => Promise<unknown>;
  scheduleSenderWake?: (task: () => Promise<void>) => void;
  decisionTraceSink?: DecisionTraceSink;
};

export async function enqueueOutboundMessage(
  input: CreateOutboundMessageInput,
  deps: EnqueueOutboundMessageDependencies,
): Promise<{ outboundMessageId: string; messageWasNew: boolean; jobWasNew: boolean }> {
  const turnId = getTurnId(input.payload);
  if (deps.outboundMessageStore.createOutboundMessageAndEnqueue) {
    const result = await deps.outboundMessageStore.createOutboundMessageAndEnqueue(input, { turnId });
    await recordProactiveEnqueue(input, result, deps.decisionTraceSink);
    wakeSenderAfterCommit(result.jobWasNew, deps);
    return result;
  }

  const created = await deps.outboundMessageStore.createOutboundMessage(input);
  const enqueued = await deps.jobQueue.enqueueJob({
    queue: "message.send",
    payload: {
      outboundMessageId: created.message.id,
      ...(turnId ? { turnId } : {}),
    },
    dedupeKey: `outbound-message:${created.message.id}`,
    maxAttempts: 10,
  });

  const result = {
    outboundMessageId: created.message.id,
    messageWasNew: created.isNew,
    jobWasNew: enqueued.isNew,
  };
  await recordProactiveEnqueue(input, result, deps.decisionTraceSink);
  wakeSenderAfterCommit(result.jobWasNew, deps);
  return result;
}

async function recordProactiveEnqueue(
  input: CreateOutboundMessageInput,
  result: { outboundMessageId: string; messageWasNew: boolean; jobWasNew: boolean },
  sink: DecisionTraceSink | undefined,
): Promise<void> {
  if (!sink || !isV2ProactiveAutomationOutboundPayload(input.payload)) return;
  await recordDecisionTrace(sink, {
    turnId: input.payload.turnId,
    stage: "outbound.enqueued",
    occurredAt: new Date().toISOString(),
    clinicId: input.clinicId,
    conversationId: input.conversationId,
    metadata: {
      outboundMessageId: result.outboundMessageId,
      messageWasNew: result.messageWasNew,
      jobWasNew: result.jobWasNew,
      category: input.category ?? "reply",
      authorizationKind: input.payload.authorizationKind,
    },
  });
}

function wakeSenderAfterCommit(
  jobWasNew: boolean,
  deps: Pick<EnqueueOutboundMessageDependencies, "requestSenderWake" | "scheduleSenderWake">,
): void {
  if (!jobWasNew) return;
  scheduleSenderWorkerWake(deps.scheduleSenderWake ?? after, {
    request: deps.requestSenderWake ?? (() => requestSenderWorkerRun()),
  });
}

function getTurnId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).turnId;
  return typeof value === "string" && value.trim() ? value : null;
}
