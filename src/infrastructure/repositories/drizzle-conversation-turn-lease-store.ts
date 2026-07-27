import { and, eq, isNull, lt, or } from "drizzle-orm";
import type {
  AcquireConversationTurnLeaseInput,
  ConversationTurnLeaseStore,
} from "@/application/ports/conversation-turn-lease-store";
import { db } from "@/infrastructure/db/client";
import { conversations } from "@/infrastructure/db/schema";

export class DrizzleConversationTurnLeaseStore
  implements ConversationTurnLeaseStore
{
  async tryAcquire(
    input: AcquireConversationTurnLeaseInput,
  ): Promise<boolean> {
    const rows = await db
      .update(conversations)
      .set({ processingUntil: input.leaseUntil })
      .where(
        and(
          eq(conversations.id, input.conversationId),
          or(
            isNull(conversations.processingUntil),
            lt(conversations.processingUntil, input.now),
          ),
        ),
      )
      .returning({ id: conversations.id });
    return rows.length === 1;
  }

  async release(conversationId: string): Promise<void> {
    await db
      .update(conversations)
      .set({ processingUntil: null })
      .where(eq(conversations.id, conversationId));
  }
}
