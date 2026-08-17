import { eq } from "drizzle-orm";
import type { ConversationEnginePolicyReader } from "@/application/ports/conversation-engine-policy-reader";
import {
  CONVERSATION_ENGINES,
  type ConversationEngine,
  type ConversationEnginePolicy,
} from "@/application/conversation-v2/engine-selection";
import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";

function isConversationEngine(value: unknown): value is ConversationEngine {
  return typeof value === "string"
    && (CONVERSATION_ENGINES as readonly string[]).includes(value);
}

export class DrizzleConversationEnginePolicyReader
implements ConversationEnginePolicyReader {
  async getConversationEnginePolicy(
    clinicId: string,
  ): Promise<ConversationEnginePolicy> {
    const [row] = await db
      .select({
        engine: organizations.conversationEngine,
        isTest: organizations.isTest,
      })
      .from(organizations)
      .where(eq(organizations.id, clinicId))
      .limit(1);

    return Object.freeze({
      clinicId,
      engine: isConversationEngine(row?.engine) ? row.engine : "v1",
      isTest: row?.isTest === true,
    });
  }
}
