"use server";
import { db } from "@/infrastructure/db/client";
import { conversations, leads } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { ConversationCategory } from "@/domain/value-objects/conversation-category";

export async function pauseAi(conversationId: string, leadId: string) {
  // Pause manual via dashboard — sem TTL (operador decide quando retomar)
  await db
    .update(conversations)
    .set({ aiPaused: true, takeoverExpiresAt: null, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
  await db
    .update(leads)
    .set({ status: "in_conversation", updatedAt: new Date() })
    .where(eq(leads.id, leadId));
  revalidatePath("/app/inbox");
  revalidatePath(`/app/inbox/${conversationId}`);
}

export async function resumeAi(conversationId: string) {
  const now = new Date();
  await db
    .update(conversations)
    .set({
      aiPaused: false,
      takeoverExpiresAt: null,
      needsAttention: false,
      attentionReason: null,
      consecutiveUnclearCount: 0,
      aiResumedAt: now,
      updatedAt: now,
    })
    .where(eq(conversations.id, conversationId));
  revalidatePath("/app/inbox");
  revalidatePath(`/app/inbox/${conversationId}`);
}

// Limpa o flag de atenção sem retomar a IA — usado quando o operador já atendeu
// o lead manualmente e quer remover o aviso do inbox sem mudar o controle da IA.
export async function clearAttention(conversationId: string) {
  const now = new Date();
  await db
    .update(conversations)
    .set({
      needsAttention: false,
      attentionReason: null,
      updatedAt: now,
    })
    .where(eq(conversations.id, conversationId));
  revalidatePath("/app/inbox");
  revalidatePath(`/app/inbox/${conversationId}`);
}

export async function setConversationCategory(
  conversationId: string,
  category: ConversationCategory,
) {
  const [conversation] = await db
    .select({ clinicId: conversations.clinicId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conversation) throw new Error("Conversa não encontrada");

  const now = new Date();
  const isSales = category === "sales";

  await db
    .update(conversations)
    .set({
      category,
      aiPaused: !isSales,
      takeoverExpiresAt: null,
      needsAttention: false,
      attentionReason: null,
      consecutiveUnclearCount: 0,
      updatedAt: now,
    })
    .where(eq(conversations.id, conversationId));

  revalidatePath("/app/inbox");
  revalidatePath(`/app/inbox/${conversationId}`);
  revalidatePath("/app/dashboard");
  revalidatePath("/owner");
  revalidatePath(`/owner/clinics/${conversation.clinicId}`);
}
