import type {
  ConversationRuntimeControl,
  ConversationRuntimeControlStore,
} from "@/application/ports/conversation-runtime-control-store";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversationRuntimeControl } from "@/infrastructure/db/schema";

const GLOBAL_RUNTIME_CONTROL_KEY = "global";

export class DrizzleConversationRuntimeControlStore
implements ConversationRuntimeControlStore {
  async getGlobal(): Promise<ConversationRuntimeControl> {
    const rows = await db.select({
      liveOutboundEnabled: conversationRuntimeControl.liveOutboundEnabled,
      version: conversationRuntimeControl.version,
    }).from(conversationRuntimeControl)
      .where(eq(conversationRuntimeControl.key, GLOBAL_RUNTIME_CONTROL_KEY))
      .limit(2);

    if (rows.length !== 1) {
      return { liveOutboundEnabled: false, version: 0 };
    }
    return rows[0];
  }

  async compareAndSetGlobal(
    input: Parameters<ConversationRuntimeControlStore["compareAndSetGlobal"]>[0],
  ): Promise<boolean> {
    const nextVersion = input.expectedVersion + 1;
    if (input.expectedVersion === 0) {
      const inserted = await db.insert(conversationRuntimeControl).values({
        key: GLOBAL_RUNTIME_CONTROL_KEY,
        liveOutboundEnabled: input.liveOutboundEnabled,
        version: nextVersion,
        updatedAt: input.now,
        updatedBy: input.actor,
      }).onConflictDoNothing().returning({ key: conversationRuntimeControl.key });
      return inserted.length === 1;
    }

    const updated = await db.update(conversationRuntimeControl).set({
      liveOutboundEnabled: input.liveOutboundEnabled,
      version: nextVersion,
      updatedAt: input.now,
      updatedBy: input.actor,
    }).where(and(
      eq(conversationRuntimeControl.key, GLOBAL_RUNTIME_CONTROL_KEY),
      eq(conversationRuntimeControl.version, input.expectedVersion),
    )).returning({ key: conversationRuntimeControl.key });
    return updated.length === 1;
  }
}
