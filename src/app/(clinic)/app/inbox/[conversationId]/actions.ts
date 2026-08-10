"use server";
import { db } from "@/infrastructure/db/client";
import {
  agentRecommendations,
  conversations,
  conversationStates,
  leads,
  messages,
  outboundMessages,
  treatmentGapReports,
} from "@/infrastructure/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import type { ConversationCategory } from "@/domain/value-objects/conversation-category";
import { bumpInboxVersion } from "@/application/read-versions/clinic-read-version";

// Todas as ações deste arquivo recebem ids vindos do CLIENTE. O predicado de
// clínica entra no WHERE (nunca numa comparação depois da escrita) para que
// um id de outro tenant simplesmente não atinja linha nenhuma: sem escrita,
// sem `returning`, e portanto sem bump cross-tenant na versão do Inbox da
// clínica alheia. Mesmo padrão que setConversationCategoryBulk e
// deleteConversationsBulk já usavam mais abaixo.
export async function pauseAi(conversationId: string, leadId: string) {
  const clinicId = await requireSessionClinicId();
  // Pause manual via dashboard — sem TTL (operador decide quando retomar)
  const [updated] = await db
    .update(conversations)
    .set({ aiPaused: true, takeoverExpiresAt: null, updatedAt: new Date() })
    .where(and(eq(conversations.clinicId, clinicId), eq(conversations.id, conversationId)))
    .returning({ clinicId: conversations.clinicId });
  await db
    .update(leads)
    .set({ status: "in_conversation", updatedAt: new Date() })
    .where(and(eq(leads.clinicId, clinicId), eq(leads.id, leadId)));
  if (updated) bumpInboxVersion(updated.clinicId);
  revalidatePath("/app/inbox");
  revalidatePath(`/app/inbox/${conversationId}`);
}

export async function resumeAi(conversationId: string) {
  const clinicId = await requireSessionClinicId();
  const now = new Date();
  const [updated] = await db
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
    .where(and(eq(conversations.clinicId, clinicId), eq(conversations.id, conversationId)))
    .returning({ clinicId: conversations.clinicId });
  if (updated) bumpInboxVersion(updated.clinicId);
  revalidatePath("/app/inbox");
  revalidatePath(`/app/inbox/${conversationId}`);
}

// Limpa o flag de atenção sem retomar a IA — usado quando o operador já atendeu
// o lead manualmente e quer remover o aviso do inbox sem mudar o controle da IA.
export async function clearAttention(conversationId: string) {
  const clinicId = await requireSessionClinicId();
  const now = new Date();
  const [updated] = await db
    .update(conversations)
    .set({
      needsAttention: false,
      attentionReason: null,
      updatedAt: now,
    })
    .where(and(eq(conversations.clinicId, clinicId), eq(conversations.id, conversationId)))
    .returning({ clinicId: conversations.clinicId });
  if (updated) bumpInboxVersion(updated.clinicId);
  revalidatePath("/app/inbox");
  revalidatePath(`/app/inbox/${conversationId}`);
}

export async function setConversationCategory(
  conversationId: string,
  category: ConversationCategory,
) {
  const clinicId = await requireSessionClinicId();
  const now = new Date();
  const isSales = category === "sales";

  // O SELECT prévio que existia aqui só servia para descobrir a clínica da
  // conversa — o que a sessão já responde, e com autoridade. "Não encontrada"
  // agora significa "não existe DENTRO desta clínica", que é a resposta certa
  // tanto para um id inexistente quanto para um id de outro tenant.
  const [updated] = await db
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
    .where(and(eq(conversations.clinicId, clinicId), eq(conversations.id, conversationId)))
    .returning({ clinicId: conversations.clinicId });
  if (!updated) throw new Error("Conversa não encontrada");
  bumpInboxVersion(updated.clinicId);

  revalidatePath("/app/inbox");
  revalidatePath(`/app/inbox/${conversationId}`);
  revalidatePath("/app/dashboard");
  revalidatePath("/owner");
  revalidatePath(`/owner/clinics/${updated.clinicId}`);
}

export async function setConversationCategoryBulk(
  conversationIds: string[],
  category: ConversationCategory,
) {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  if (ids.length === 0) return;

  const clinicId = await requireSessionClinicId();
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
    .where(and(eq(conversations.clinicId, clinicId), inArray(conversations.id, ids)));
  bumpInboxVersion(clinicId);

  revalidatePath("/app/inbox");
  revalidatePath("/app/dashboard");
  revalidatePath("/owner");
  revalidatePath(`/owner/clinics/${clinicId}`);
}

export async function deleteConversationsBulk(conversationIds: string[]) {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  if (ids.length === 0) return;

  const clinicId = await requireSessionClinicId();
  const scopedConversations = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.clinicId, clinicId), inArray(conversations.id, ids)));
  const scopedIds = scopedConversations.map((conversation) => conversation.id);
  if (scopedIds.length === 0) return;

  await db.delete(outboundMessages).where(inArray(outboundMessages.conversationId, scopedIds));
  await db.delete(messages).where(inArray(messages.conversationId, scopedIds));
  await db.delete(conversationStates).where(inArray(conversationStates.conversationId, scopedIds));
  await db.delete(agentRecommendations).where(inArray(agentRecommendations.conversationId, scopedIds));
  await db.delete(treatmentGapReports).where(inArray(treatmentGapReports.conversationId, scopedIds));
  await db
    .delete(conversations)
    .where(and(eq(conversations.clinicId, clinicId), inArray(conversations.id, scopedIds)));
  bumpInboxVersion(clinicId);

  revalidatePath("/app/inbox");
  revalidatePath("/app/dashboard");
  revalidatePath("/owner");
  revalidatePath(`/owner/clinics/${clinicId}`);
}
