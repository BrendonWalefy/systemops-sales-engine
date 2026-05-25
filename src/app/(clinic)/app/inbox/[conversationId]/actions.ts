"use server";
import { db } from "@/infrastructure/db/client";
import { conversations, leads } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function pauseAi(conversationId: string, leadId: string) {
  await db
    .update(conversations)
    .set({ aiPaused: true, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
  await db
    .update(leads)
    .set({ status: "in_conversation", updatedAt: new Date() })
    .where(eq(leads.id, leadId));
  revalidatePath(`/app/inbox/${conversationId}`);
}

export async function resumeAi(conversationId: string) {
  await db
    .update(conversations)
    .set({
      aiPaused: false,
      needsAttention: false,
      attentionReason: null,
      consecutiveUnclearCount: 0,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
  revalidatePath(`/app/inbox/${conversationId}`);
}
