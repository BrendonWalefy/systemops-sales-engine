import { and, between, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { appointments, clinics, conversations, leads } from "@/infrastructure/db/schema";
import { getAppointmentBadgeWindow } from "@/app/(clinic)/app/inbox/inbox-visibility";
import { buildInboxSnapshotSignature, type InboxSnapshotRow } from "@/app/(clinic)/app/inbox/inbox-snapshot";

export async function getInboxSnapshotSignature(clinicId: string): Promise<string> {
  const [clinicRows, rows] = await Promise.all([
    db
      .select({
        autoReplyEnabled: clinics.autoReplyEnabled,
        updatedAt: clinics.updatedAt,
      })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1),
    db
      .select({
        convId: conversations.id,
        leadId: leads.id,
        conversationUpdatedAt: conversations.updatedAt,
        leadUpdatedAt: leads.updatedAt,
        lastMessageAt: conversations.lastMessageAt,
        lastReadAt: conversations.lastReadAt,
        aiPaused: conversations.aiPaused,
        needsAttention: conversations.needsAttention,
        takeoverExpiresAt: conversations.takeoverExpiresAt,
        leadStatus: leads.status,
        leadTemperature: leads.temperature,
      })
      .from(conversations)
      .innerJoin(leads, eq(conversations.leadId, leads.id))
      .where(eq(conversations.clinicId, clinicId)),
  ]);

  const appointmentBadgeWindow = getAppointmentBadgeWindow();
  const scheduledLeadIds = rows
    .filter((row) => row.leadStatus === "appointment_scheduled")
    .map((row) => row.leadId);

  const appointmentRows = scheduledLeadIds.length > 0
    ? await db
        .select({ leadId: appointments.leadId, startsAt: appointments.startsAt })
        .from(appointments)
        .where(
          and(
            inArray(appointments.leadId, scheduledLeadIds),
            inArray(appointments.status, ["scheduled", "confirmed"]),
            between(appointments.startsAt, appointmentBadgeWindow.startsAtFrom, appointmentBadgeWindow.startsAtTo),
          ),
        )
        .orderBy(desc(appointments.startsAt))
    : [];

  const appointmentMap: Record<string, Date> = {};
  for (const appointment of appointmentRows) {
    if (appointment.leadId && !appointmentMap[appointment.leadId]) {
      appointmentMap[appointment.leadId] = appointment.startsAt;
    }
  }

  const snapshotRows: InboxSnapshotRow[] = rows.map((row) => ({
    convId: row.convId,
    conversationUpdatedAt: row.conversationUpdatedAt,
    leadUpdatedAt: row.leadUpdatedAt,
    lastMessageAt: row.lastMessageAt,
    lastReadAt: row.lastReadAt,
    aiPaused: row.aiPaused,
    needsAttention: row.needsAttention,
    takeoverExpiresAt: row.takeoverExpiresAt,
    leadStatus: row.leadStatus,
    leadTemperature: row.leadTemperature,
    appointmentStartsAt: appointmentMap[row.leadId] ?? null,
  }));

  return buildInboxSnapshotSignature(snapshotRows, {
    autoReplyEnabled: clinicRows[0]?.autoReplyEnabled ?? false,
    clinicUpdatedAt: clinicRows[0]?.updatedAt ?? null,
  });
}
