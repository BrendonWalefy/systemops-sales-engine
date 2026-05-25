"use server";
import { db } from "@/infrastructure/db/client";
import { leads } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

export async function assumeConversation(leadId: string, conversationId: string) {
  await db
    .update(leads)
    .set({ status: "in_conversation", updatedAt: new Date() })
    .where(eq(leads.id, leadId));
  redirect(`/app/inbox/${conversationId}`);
}
