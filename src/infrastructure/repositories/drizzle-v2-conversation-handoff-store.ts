import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { V2ConversationHandoffStore } from "@/application/conversation-v2/v2-conversation-handoff";
import type { V2TerminalHandoffStore } from "@/application/conversation-v2/v2-terminal-failure-policy";
import { bumpInboxVersion } from "@/application/read-versions/clinic-read-version";
import { db } from "@/infrastructure/db/client";
import { conversations, inboundEvents, jobs, outboundMessages, whatsappStreams } from "@/infrastructure/db/schema";

export class DrizzleV2ConversationHandoffStore
implements V2ConversationHandoffStore, V2TerminalHandoffStore {
  async markRequired(input: Parameters<V2ConversationHandoffStore["markRequired"]>[0]): Promise<boolean> {
    const updated = await db
      .update(conversations)
      .set({
        aiPaused: true,
        takeoverExpiresAt: null,
        needsAttention: true,
        attentionReason: input.reason,
        updatedAt: input.now,
      })
      .where(and(
        eq(conversations.id, input.conversationId),
        eq(conversations.clinicId, input.clinicId),
      ))
      .returning({ id: conversations.id });
    if (updated.length !== 1) return false;
    bumpInboxVersion(input.clinicId);
    return true;
  }

  async markForInboundEvent(
    input: Parameters<V2TerminalHandoffStore["markForInboundEvent"]>[0],
  ): Promise<boolean> {
    const updated = await db
      .update(conversations)
      .set({
        aiPaused: true,
        takeoverExpiresAt: null,
        needsAttention: true,
        attentionReason: input.reason,
        updatedAt: input.now,
      })
      .from(inboundEvents)
      .innerJoin(whatsappStreams, and(
        eq(whatsappStreams.id, inboundEvents.streamId),
        eq(whatsappStreams.clinicId, inboundEvents.clinicId),
      ))
      .where(and(
        eq(inboundEvents.id, input.inboundEventId),
        eq(inboundEvents.clinicId, input.clinicId),
        eq(inboundEvents.claimJobId, input.claimJobId),
        isNotNull(inboundEvents.claimedAt),
        isNotNull(inboundEvents.claimJobId),
        isNotNull(inboundEvents.claimTokenDigest),
        eq(conversations.id, whatsappStreams.conversationId),
        eq(conversations.clinicId, input.clinicId),
      ))
      .returning({ id: conversations.id });
    if (updated.length !== 1) return false;
    bumpInboxVersion(input.clinicId);
    return true;
  }

  async markForOutboundMessage(
    input: Parameters<V2TerminalHandoffStore["markForOutboundMessage"]>[0],
  ): Promise<boolean> {
    const updated = await db
      .update(conversations)
      .set({
        aiPaused: true,
        takeoverExpiresAt: null,
        needsAttention: true,
        attentionReason: input.reason,
        updatedAt: input.now,
      })
      .from(outboundMessages)
      .innerJoin(jobs, and(
        eq(jobs.id, input.sendJobId),
        eq(jobs.queue, "message.send"),
        eq(jobs.status, "processing"),
        eq(jobs.lockedBy, input.workerId),
        eq(jobs.dedupeKey, `outbound-message:${input.outboundMessageId}`),
        sql`${jobs.payload}->>'outboundMessageId' = ${input.outboundMessageId}`,
      ))
      .innerJoin(inboundEvents, and(
        eq(inboundEvents.id, outboundMessages.authorizationInboundEventId),
        eq(inboundEvents.clinicId, outboundMessages.clinicId),
        eq(inboundEvents.streamId, outboundMessages.authorizationStreamId),
        eq(inboundEvents.streamGeneration, outboundMessages.authorizationGeneration),
        eq(inboundEvents.claimJobId, outboundMessages.authorizationClaimJobId),
        eq(inboundEvents.claimTokenDigest, outboundMessages.authorizationClaimTokenDigest),
        isNotNull(inboundEvents.claimedAt),
      ))
      .innerJoin(whatsappStreams, and(
        eq(whatsappStreams.id, inboundEvents.streamId),
        eq(whatsappStreams.clinicId, outboundMessages.clinicId),
        eq(whatsappStreams.conversationId, outboundMessages.conversationId),
      ))
      .where(and(
        eq(outboundMessages.id, input.outboundMessageId),
        eq(outboundMessages.authorizationKind, "live_stream_reply"),
        eq(outboundMessages.authorizationVersion, 2),
        isNotNull(outboundMessages.authorizationStreamId),
        isNotNull(outboundMessages.authorizationGeneration),
        isNotNull(outboundMessages.authorizationInboundEventId),
        isNotNull(outboundMessages.authorizationClaimJobId),
        isNotNull(outboundMessages.authorizationClaimTokenDigest),
        eq(conversations.id, outboundMessages.conversationId),
        eq(conversations.clinicId, outboundMessages.clinicId),
      ))
      .returning({ clinicId: conversations.clinicId });
    if (updated.length !== 1) return false;
    bumpInboxVersion(updated[0]!.clinicId);
    return true;
  }
}
