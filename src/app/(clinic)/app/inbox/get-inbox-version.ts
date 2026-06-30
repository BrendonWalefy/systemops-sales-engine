import { count, eq, max } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { appointments, organizations, conversations, leads } from "@/infrastructure/db/schema";

function serializeDate(value: Date | null | undefined): string {
  return value ? value.toISOString() : "";
}

export async function getInboxVersion(clinicId: string): Promise<string> {
  const [clinicResult, conversationResult, leadResult, appointmentResult] = await Promise.all([
    db
      .select({
        updatedAt: organizations.updatedAt,
        autoReplyEnabled: organizations.autoReplyEnabled,
      })
      .from(organizations)
      .where(eq(organizations.id, clinicId))
      .limit(1),
    db
      .select({
        total: count(),
        updatedAt: max(conversations.updatedAt),
        lastMessageAt: max(conversations.lastMessageAt),
        lastReadAt: max(conversations.lastReadAt),
      })
      .from(conversations)
      .where(eq(conversations.clinicId, clinicId)),
    db
      .select({
        total: count(),
        updatedAt: max(leads.updatedAt),
      })
      .from(leads)
      .where(eq(leads.clinicId, clinicId)),
    db
      .select({
        total: count(),
        updatedAt: max(appointments.updatedAt),
      })
      .from(appointments)
      .where(eq(appointments.clinicId, clinicId)),
  ]);

  return [
    clinicResult[0]?.autoReplyEnabled ? "1" : "0",
    serializeDate(clinicResult[0]?.updatedAt),
    String(conversationResult[0]?.total ?? 0),
    serializeDate(conversationResult[0]?.updatedAt ?? null),
    serializeDate(conversationResult[0]?.lastMessageAt ?? null),
    serializeDate(conversationResult[0]?.lastReadAt ?? null),
    String(leadResult[0]?.total ?? 0),
    serializeDate(leadResult[0]?.updatedAt ?? null),
    String(appointmentResult[0]?.total ?? 0),
    serializeDate(appointmentResult[0]?.updatedAt ?? null),
  ].join("|");
}
