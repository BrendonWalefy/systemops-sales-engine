import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { appointments, clinics, conversations, leads, messages } from "@/infrastructure/db/schema";
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
        conversationCategory: conversations.category,
        leadStatus: leads.status,
        leadTemperature: leads.temperature,
      })
      .from(conversations)
      .innerJoin(leads, eq(conversations.leadId, leads.id))
      .where(eq(conversations.clinicId, clinicId)),
  ]);

  const now = new Date();
  const salesLeadIds = rows
    .filter((row) => row.conversationCategory === "sales")
    .map((row) => row.leadId);
  const conversationIds = rows.map((row) => row.convId);

  const [lastMessageRows, upcomingAppointmentRows, latestOutcomeRows] = await Promise.all([
    conversationIds.length > 0
      ? db
          .selectDistinctOn([messages.conversationId], {
            conversationId: messages.conversationId,
            author: messages.author,
            sentAt: messages.sentAt,
          })
          .from(messages)
          .where(inArray(messages.conversationId, conversationIds))
          .orderBy(messages.conversationId, desc(messages.sentAt))
      : Promise.resolve([]),
    salesLeadIds.length > 0
      ? db
          .selectDistinctOn([appointments.leadId], {
            leadId: appointments.leadId,
            status: appointments.status,
            startsAt: appointments.startsAt,
            updatedAt: appointments.updatedAt,
          })
          .from(appointments)
          .where(
            and(
              inArray(appointments.leadId, salesLeadIds),
              inArray(appointments.status, ["scheduled", "confirmed"]),
              gte(appointments.endsAt, now),
            ),
          )
          .orderBy(appointments.leadId, appointments.startsAt)
      : Promise.resolve([]),
    salesLeadIds.length > 0
      ? db
          .selectDistinctOn([appointments.leadId], {
            leadId: appointments.leadId,
            status: appointments.status,
            startsAt: appointments.startsAt,
            updatedAt: appointments.updatedAt,
          })
          .from(appointments)
          .where(
            and(
              inArray(appointments.leadId, salesLeadIds),
              inArray(appointments.status, ["cancelled", "completed", "no_show"]),
            ),
          )
          .orderBy(appointments.leadId, desc(appointments.updatedAt), desc(appointments.startsAt))
      : Promise.resolve([]),
  ]);

  const lastMessageMap: Record<string, { author: string | null; sentAt: Date | null }> = {};
  for (const message of lastMessageRows) {
    if (!lastMessageMap[message.conversationId]) {
      lastMessageMap[message.conversationId] = {
        author: message.author ?? null,
        sentAt: message.sentAt ?? null,
      };
    }
  }

  const appointmentMap: Record<string, Date> = {};
  const latestAppointmentStatusMap: Record<string, string> = {};
  const latestAppointmentUpdatedAtMap: Record<string, Date> = {};

  for (const appointment of upcomingAppointmentRows) {
    if (appointment.leadId && !appointmentMap[appointment.leadId]) {
      appointmentMap[appointment.leadId] = appointment.startsAt;
      latestAppointmentStatusMap[appointment.leadId] = appointment.status;
      latestAppointmentUpdatedAtMap[appointment.leadId] = appointment.updatedAt;
    }
  }

  for (const appointment of latestOutcomeRows) {
    if (appointment.leadId && !latestAppointmentStatusMap[appointment.leadId]) {
      latestAppointmentStatusMap[appointment.leadId] = appointment.status;
      latestAppointmentUpdatedAtMap[appointment.leadId] = appointment.updatedAt;
    }
  }

  const snapshotRows: InboxSnapshotRow[] = rows.map((row) => ({
    convId: row.convId,
    conversationUpdatedAt: row.conversationUpdatedAt,
    leadUpdatedAt: row.leadUpdatedAt,
    lastMessageAt: row.lastMessageAt,
    latestMessageAt: lastMessageMap[row.convId]?.sentAt ?? row.lastMessageAt,
    latestMessageAuthor: lastMessageMap[row.convId]?.author ?? null,
    lastReadAt: row.lastReadAt,
    aiPaused: row.aiPaused,
    needsAttention: row.needsAttention,
    takeoverExpiresAt: row.takeoverExpiresAt,
    conversationCategory: row.conversationCategory,
    leadStatus: row.leadStatus,
    leadTemperature: row.leadTemperature,
    appointmentStartsAt: appointmentMap[row.leadId] ?? null,
    latestAppointmentStatus: latestAppointmentStatusMap[row.leadId] ?? null,
    latestAppointmentUpdatedAt: latestAppointmentUpdatedAtMap[row.leadId] ?? null,
  }));

  return buildInboxSnapshotSignature(snapshotRows, {
    autoReplyEnabled: clinicRows[0]?.autoReplyEnabled ?? false,
    clinicUpdatedAt: clinicRows[0]?.updatedAt ?? null,
  });
}
