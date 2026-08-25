import { and, eq } from "drizzle-orm";
import type { V2ConversationHandoffStore } from "@/application/conversation-v2/v2-conversation-handoff";
import { bumpInboxVersion } from "@/application/read-versions/clinic-read-version";
import { db } from "@/infrastructure/db/client";
import { conversations } from "@/infrastructure/db/schema";

export class DrizzleV2ConversationHandoffStore implements V2ConversationHandoffStore {
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
}
