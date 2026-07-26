import { describe, expect, it } from "vitest";
import {
  inboundEventProcessingStatusEnum,
  inboundEvents,
  jobQueueEnum,
  jobStatusEnum,
  jobs,
  outboundMessageDeliveryKindEnum,
  outboundMessages,
  outboundMessageStatusEnum,
  conversationStates,
} from "@/infrastructure/db/schema";

describe("event-driven modernization schema contract", () => {
  it("keeps the checkpoint 1 enums stable", () => {
    expect(inboundEventProcessingStatusEnum.enumValues).toEqual([
      "pending",
      "processing",
      "processed",
      "failed",
      "ignored",
    ]);
    expect(jobQueueEnum.enumValues).toEqual([
      "message.process",
      "message.send",
      "followup.dispatch",
    ]);
    expect(jobStatusEnum.enumValues).toEqual([
      "pending",
      "processing",
      "done",
      "failed",
      "dead",
    ]);
    expect(outboundMessageDeliveryKindEnum.enumValues).toEqual([
      "text",
      "audio",
      "image",
      "video",
      "document",
    ]);
    expect(outboundMessageStatusEnum.enumValues).toEqual([
      "pending",
      "processing",
      "sent",
      "failed",
      "dead",
      "cancelled",
    ]);
  });

  it("exposes the key columns required by inbox, queue and outbox", () => {
    expect(inboundEvents.providerMessageId.name).toBe("provider_message_id");
    expect(inboundEvents.conversationKey.name).toBe("conversation_key");
    expect(inboundEvents.processingStatus.name).toBe("processing_status");

    expect(jobs.queue.name).toBe("queue");
    expect(jobs.runAt.name).toBe("run_at");
    expect(jobs.maxAttempts.name).toBe("max_attempts");

    expect(outboundMessages.conversationId.name).toBe("conversation_id");
    expect(outboundMessages.deliveryKind.name).toBe("delivery_kind");
    expect(outboundMessages.sequence.name).toBe("sequence");
    expect(outboundMessages.providerMessageId.name).toBe("provider_message_id");
    expect(conversationStates.supersedesStateId.name).toBe("supersedes_state_id");
  });
});
