import type { ClinicAutomationPolicyReader } from "@/application/ports/clinic-automation-policy-reader";
import type { InboundEventStore } from "@/application/ports/inbound-event-store";
import type { JobRecord } from "@/application/ports/job-queue";
import {
  resolveLeadInboundContent,
  type ResolvedLeadInboundContent,
} from "@/infrastructure/adapters/channels/whatsapp/zapi-webhook-content";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";

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

    const event = await this.deps.inboundEventStore.findInboundEvent(inboundEventId);
    if (!event || event.processingStatus === "processed" || event.processingStatus === "ignored") {
      return { outcome: "ignored", inboundEventId };
    }

    if (event.provider !== "z_api" || !isZApiInboundPayload(event.payload)) {
      await this.deps.inboundEventStore.markInboundEventIgnored(event.id);
      return { outcome: "ignored", inboundEventId: event.id };
    }

    const payload = event.payload;
    if (payload.fromMe || payload.isGroupMsg || payload.isStatusReply) {
      await this.deps.inboundEventStore.markInboundEventIgnored(event.id);
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
    return { outcome: "processed", inboundEventId: event.id };
  }
}

export function getInboundEventId(job: JobRecord): string | null {
  if (!job.payload || typeof job.payload !== "object") return null;
  const value = (job.payload as Record<string, unknown>).inboundEventId;
  return typeof value === "string" && value ? value : null;
}

function isZApiInboundPayload(payload: unknown): payload is ZApiInboundPayload {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  return (
    typeof value.phone === "string" &&
    typeof value.instanceId === "string" &&
    typeof value.messageId === "string" &&
    typeof value.fromMe === "boolean" &&
    typeof value.isGroupMsg === "boolean" &&
    typeof value.isStatusReply === "boolean"
  );
}
