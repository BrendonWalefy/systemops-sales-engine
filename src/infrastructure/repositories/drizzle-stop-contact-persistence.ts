import { eq } from "drizzle-orm";
import type { StopContactDecision } from "@/application/channel-safety/stop-contact-policy";
import { db } from "@/infrastructure/db/client";
import { conversations, leads } from "@/infrastructure/db/schema";

/** Shared V1/V2 mutation for the existing durable stop-contact semantics. */
export async function persistStopContactDecision(input: Readonly<{
  leadId: string;
  conversationId: string;
  decision: StopContactDecision;
}>): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(leads)
      .set({
        contactConsentRevokedAt: input.decision.revokedAt,
        contactConsentSource: input.decision.source,
        updatedAt: input.decision.revokedAt,
      })
      .where(eq(leads.id, input.leadId));
    await tx
      .update(conversations)
      .set({
        needsAttention: true,
        attentionReason: input.decision.attentionReason,
        updatedAt: input.decision.revokedAt,
      })
      .where(eq(conversations.id, input.conversationId));
  });
}
