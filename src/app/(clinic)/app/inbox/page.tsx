export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { redirect } from "next/navigation";
import { clinics, conversations, leads, messages, appointments } from "@/infrastructure/db/schema";
import { and, eq, desc, inArray, between, isNotNull, lt } from "drizzle-orm";
import { InboxPoller } from "./InboxPoller";
import { EnableNotificationsButton } from "@/components/enable-notifications-button";
import { InboxClient, type ConvRow } from "./InboxClient";
import { getAppointmentBadgeWindow } from "./inbox-visibility";

export default async function InboxPage() {
  const clinicId = await getSessionClinicId();
  if (!clinicId) redirect("/login");

  const [clinicRows, rows] = await Promise.all([
    db.select({ autoReplyEnabled: clinics.autoReplyEnabled })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1),
    db
      .select({
        convId: conversations.id,
        leadId: leads.id,
        lastMessageAt: conversations.lastMessageAt,
        needsAttention: conversations.needsAttention,
        attentionReason: conversations.attentionReason,
        aiPaused: conversations.aiPaused,
        takeoverExpiresAt: conversations.takeoverExpiresAt,
        lastReadAt: conversations.lastReadAt,
        leadName: leads.name,
        leadPhone: leads.phone,
        leadStatus: leads.status,
        leadTemperature: leads.temperature,
        leadTreatmentInterest: leads.treatmentInterest,
        leadProfilePicUrl: leads.profilePicUrl,
      })
      .from(conversations)
      .innerJoin(leads, eq(conversations.leadId, leads.id))
      .where(eq(conversations.clinicId, clinicId))
      .orderBy(desc(conversations.lastMessageAt)),
  ]);

  const autoReplyEnabled = clinicRows[0]?.autoReplyEnabled ?? false;
  const appointmentBadgeWindow = getAppointmentBadgeWindow();

  // Badge de agenda no inbox: só o lembrete operacional perto da consulta.
  const scheduledLeadIds = rows
    .filter((r) => r.leadStatus === "appointment_scheduled")
    .map((r) => r.leadId);

  const [lastMessages, appointmentRows] = await Promise.all([
    Promise.all(
      rows.map(async (r) => {
        const [msg] = await db
          .select({ body: messages.body, author: messages.author })
          .from(messages)
          .where(eq(messages.conversationId, r.convId))
          .orderBy(desc(messages.sentAt))
          .limit(1);
        return { convId: r.convId, body: msg?.body ?? "", author: msg?.author ?? "" };
      }),
    ),
    scheduledLeadIds.length > 0
      ? db
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
      : Promise.resolve([]),
  ]);

  const lastMsgMap = Object.fromEntries(lastMessages.map((m) => [m.convId, { body: m.body, author: m.author }]));

  const appointmentMap: Record<string, Date> = {};
  for (const appt of appointmentRows) {
    if (appt.leadId && !appointmentMap[appt.leadId]) {
      appointmentMap[appt.leadId] = appt.startsAt;
    }
  }

  const now = new Date();
  const allRows: ConvRow[] = rows.map((r) => ({
    ...r,
    appointmentStartsAt: appointmentMap[r.leadId] ?? null,
    hoursWaiting: r.lastMessageAt
      ? (now.getTime() - new Date(r.lastMessageAt).getTime()) / 3_600_000
      : 0,
  }));

  return (
    <div className="inbox-shell">
      <InboxPoller />
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "16px 28px 0" }}>
        <EnableNotificationsButton />
      </div>
      <InboxClient
        rows={allRows}
        lastMsgMap={lastMsgMap}
        autoReplyEnabled={autoReplyEnabled}
      />
    </div>
  );
}
