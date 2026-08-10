"use server";
import { db } from "@/infrastructure/db/client";
import { leads } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { bumpInboxVersion } from "@/application/read-versions/clinic-read-version";

export async function assumeConversation(leadId: string, conversationId: string) {
  const [updated] = await db
    .update(leads)
    .set({ status: "in_conversation", updatedAt: new Date() })
    .where(eq(leads.id, leadId))
    .returning({ clinicId: leads.clinicId });
  // `leads.status` decide membership de aba no Inbox (won/lost saem das abas
  // vivas) e o badge da linha. Sem bump, a versão materializada não muda e a
  // mudança fica invisível para qualquer Inbox já aberto.
  if (updated) bumpInboxVersion(updated.clinicId);
  revalidatePath(`/inbox/${conversationId}`);
}
