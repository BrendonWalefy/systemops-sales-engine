import type {
  ConversationAuthorityStore,
  ConversationAuthorityVersion,
} from "@/application/ports/conversation-authority-store";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversationAuthority } from "@/infrastructure/db/schema";

export class DrizzleConversationAuthorityStore implements ConversationAuthorityStore {
  async getVersion(clinicId: string): Promise<ConversationAuthorityVersion> {
    const [row] = await db.select({ version: conversationAuthority.version })
      .from(conversationAuthority)
      .where(eq(conversationAuthority.clinicId, clinicId))
      .limit(1);
    return (row?.version ?? 0) as ConversationAuthorityVersion;
  }

  async compareAndSetVersion(
    input: Parameters<ConversationAuthorityStore["compareAndSetVersion"]>[0],
  ): Promise<boolean> {
    if (input.nextVersion < input.expectedVersion) {
      throw new Error("conversation authority version cannot be downgraded");
    }
    if (input.nextVersion === input.expectedVersion) return false;
    if (input.nextVersion !== input.expectedVersion + 1) {
      throw new Error("conversation authority versions must advance one step at a time");
    }
    const activation = input.nextVersion >= 2
      ? { activatedAt: input.now, activatedBy: input.actor }
      : { activatedAt: null, activatedBy: input.actor };
    if (input.expectedVersion === 0) {
      if (input.nextVersion !== 1) {
        throw new Error("conversation authority must enter compatibility version 1 first");
      }
      const inserted = await db.insert(conversationAuthority).values({
        clinicId: input.clinicId,
        version: input.nextVersion,
        ...activation,
        updatedAt: input.now,
      }).onConflictDoNothing().returning({ clinicId: conversationAuthority.clinicId });
      return inserted.length === 1;
    }
    const updated = await db.update(conversationAuthority).set({
      version: input.nextVersion,
      ...activation,
      updatedAt: input.now,
    }).where(and(
      eq(conversationAuthority.clinicId, input.clinicId),
      eq(conversationAuthority.version, input.expectedVersion),
    )).returning({ clinicId: conversationAuthority.clinicId });
    return updated.length === 1;
  }
}
