import type { ClinicAutomationPolicyReader } from "@/application/ports/clinic-automation-policy-reader";
import type { InboundEventStore } from "@/application/ports/inbound-event-store";
import type { JobRecord } from "@/application/ports/job-queue";
import {
  resolveLeadInboundContent,
  type ResolvedLeadInboundContent,
} from "@/infrastructure/adapters/channels/whatsapp/zapi-webhook-content";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";
import { createLogger } from "@/infrastructure/logging/logger";

type ConversationHandler = {
  handle(input: {
    clinicId: string;
    phone: string;
    whatsappLid?: string | null;
    messageText: string;
    messageId: string;
    senderName?: string;
    senderPhoto?: string | null;
    timestamp: Date;
    replyEnabled?: boolean;
    mediaUrl?: string;
    mediaType?: "image" | "video" | "audio" | "document";
  }): Promise<{ replied: boolean }>;
};

export type JobResult = {
  outcome: "processed" | "ignored";
  inboundEventId: string | null;
};

export type ProcessMessageJobDependencies = {
  inboundEventStore: InboundEventStore;
  automationPolicy: ClinicAutomationPolicyReader;
  conversationHandler: ConversationHandler;
  resolveInboundContent?: (params: {
    payload: ZApiInboundPayload;
    replyEnabled: boolean;
    transcribeAudio: (audioUrl: string, mimeType: string) => Promise<string>;
  }) => Promise<ResolvedLeadInboundContent>;
  transcribeAudio: (audioUrl: string, mimeType: string) => Promise<string>;
};

export class ProcessMessageJobHandler {
  private readonly resolveInboundContent: NonNullable<
    ProcessMessageJobDependencies["resolveInboundContent"]
  >;

  constructor(private readonly deps: ProcessMessageJobDependencies) {
    this.resolveInboundContent = deps.resolveInboundContent ?? resolveLeadInboundContent;
  }

  async processJob(job: JobRecord): Promise<JobResult> {
    if (job.queue !== "message.process") {
      throw new Error(`ProcessMessageJobHandler cannot process queue=${job.queue}`);
    }

    const inboundEventId = getInboundEventId(job);
    if (!inboundEventId) {
      throw new Error(`message.process job ${job.id} has no inboundEventId`);
    }

    const log = createLogger({
      scope: "ProcessMessageJob",
      jobId: job.id,
      queue: job.queue,
      traceId: inboundEventId,
    });
    const startedAt = Date.now();

    const event = await this.deps.inboundEventStore.findInboundEvent(inboundEventId);
    if (!event || event.processingStatus === "processed" || event.processingStatus === "ignored") {
      log.info("job.ignored", { reason: "event_terminal_or_missing", durationMs: Date.now() - startedAt });
      return { outcome: "ignored", inboundEventId };
    }

    const eventLog = log.child({
      clinicId: event.clinicId,
      correlationId: event.providerMessageId,
    });

    const payload = event.provider === "z_api" ? normalizeZApiInboundPayload(event.payload) : null;
    if (!payload) {
      await this.deps.inboundEventStore.markInboundEventIgnored(event.id);
      eventLog.warn("job.ignored", { reason: "unsupported_provider_payload", durationMs: Date.now() - startedAt });
      return { outcome: "ignored", inboundEventId: event.id };
    }
    if (payload.fromMe || payload.isGroupMsg || payload.isStatusReply) {
      await this.deps.inboundEventStore.markInboundEventIgnored(event.id);
      eventLog.info("job.ignored", { reason: "non_lead_message", durationMs: Date.now() - startedAt });
      return { outcome: "ignored", inboundEventId: event.id };
    }

    await this.deps.inboundEventStore.markInboundEventProcessing(event.id);
    const replyEnabled = await this.deps.automationPolicy.canSendAutomatedReply(event.clinicId);
    const content = await this.resolveInboundContent({
      payload,
      replyEnabled,
      transcribeAudio: this.deps.transcribeAudio,
    });

    if (!content) {
      await this.deps.inboundEventStore.markInboundEventIgnored(event.id);
      eventLog.info("job.ignored", { reason: "unsupported_content", durationMs: Date.now() - startedAt });
      return { outcome: "ignored", inboundEventId: event.id };
    }

    await this.deps.conversationHandler.handle({
      clinicId: event.clinicId,
      phone: payload.phone,
      whatsappLid: payload.chatLid ?? null,
      messageText: content.messageText,
      messageId: payload.messageId,
      senderName: payload.senderName || undefined,
      senderPhoto: payload.senderPhoto ?? null,
      timestamp: event.receivedAt,
      replyEnabled: content.shouldReply,
      mediaUrl: content.mediaUrl,
      mediaType: content.mediaType,
    });

    await this.deps.inboundEventStore.markInboundEventProcessed(event.id);
    eventLog.info("job.processed", { durationMs: Date.now() - startedAt });
    return { outcome: "processed", inboundEventId: event.id };
  }
}

export function getInboundEventId(job: JobRecord): string | null {
  if (!job.payload || typeof job.payload !== "object") return null;
  const value = (job.payload as Record<string, unknown>).inboundEventId;
  return typeof value === "string" && value ? value : null;
}

function normalizeZApiInboundPayload(payload: unknown): ZApiInboundPayload | null {
  const parsed = parseJsonObject(payload);
  if (!parsed) return null;

  const phone = coerceNonEmptyString(parsed.phone);
  const instanceId = coerceNonEmptyString(parsed.instanceId);
  const messageId = coerceNonEmptyString(parsed.messageId);

  if (!phone || !instanceId || !messageId) return null;

  return {
    ...(parsed as Partial<ZApiInboundPayload>),
    phone,
    instanceId,
    messageId,
    fromMe: coerceBoolean(parsed.fromMe) ?? false,
    isGroupMsg: coerceBoolean(parsed.isGroupMsg) ?? false,
    isStatusReply: coerceBoolean(parsed.isStatusReply) ?? false,
    isEdit: coerceBoolean(parsed.isEdit) ?? false,
  };
}

function parseJsonObject(payload: unknown): Record<string, unknown> | null {
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

function coerceNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
}
