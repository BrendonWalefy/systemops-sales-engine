export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { redirect } from "next/navigation";
import { clinics, conversations, leads, messages, appointments } from "@/infrastructure/db/schema";
import { and, eq, desc, inArray, gte } from "drizzle-orm";
import { InboxPoller } from "./InboxPoller";
import { EnableNotificationsButton } from "@/components/enable-notifications-button";
import { InboxClient, type ConvRow } from "./InboxClient";
import { buildInboxSnapshotSignature, type InboxSnapshotRow } from "./inbox-snapshot";

export default async function InboxPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const clinicId = await getSessionClinicId();
  if (!clinicId) redirect("/login");

  const [clinicRows, rows] = await Promise.all([
    db.select({
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
        lastMessageAt: conversations.lastMessageAt,
        needsAttention: conversations.needsAttention,
        attentionReason: conversations.attentionReason,
        aiPaused: conversations.aiPaused,
        conversationCategory: conversations.category,
        takeoverExpiresAt: conversations.takeoverExpiresAt,
        lastReadAt: conversations.lastReadAt,
        leadName: leads.name,
        leadPhone: leads.phone,
        leadStatus: leads.status,
        leadTemperature: leads.temperature,
        leadTreatmentInterest: leads.treatmentInterest,
        leadProfilePicUrl: leads.profilePicUrl,
        leadUpdatedAt: leads.updatedAt,
        conversationUpdatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .innerJoin(leads, eq(conversations.leadId, leads.id))
      .where(eq(conversations.clinicId, clinicId))
      .orderBy(desc(conversations.lastMessageAt)),
  ]);

  const autoReplyEnabled = clinicRows[0]?.autoReplyEnabled ?? false;

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
            body: messages.body,
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

  const lastMsgMap: Record<string, { body: string; author: string }> = {};
  for (const msg of lastMessageRows) {
    if (!lastMsgMap[msg.conversationId]) {
      lastMsgMap[msg.conversationId] = {
        body: msg.body ?? "",
        author: msg.author ?? "",
      };
    }
  }

  const appointmentMap: Record<string, Date> = {};
  const latestAppointmentStatusMap: Record<string, ConvRow["latestAppointmentStatus"]> = {};
  const latestAppointmentUpdatedAtMap: Record<string, Date> = {};

  for (const appt of upcomingAppointmentRows) {
    if (appt.leadId && !appointmentMap[appt.leadId]) {
      appointmentMap[appt.leadId] = appt.startsAt;
      latestAppointmentStatusMap[appt.leadId] = appt.status as ConvRow["latestAppointmentStatus"];
      latestAppointmentUpdatedAtMap[appt.leadId] = appt.updatedAt;
    }
  }

  for (const appt of latestOutcomeRows) {
    if (appt.leadId && !latestAppointmentStatusMap[appt.leadId]) {
      latestAppointmentStatusMap[appt.leadId] = appt.status as ConvRow["latestAppointmentStatus"];
      latestAppointmentUpdatedAtMap[appt.leadId] = appt.updatedAt;
    }
  }

  const allRows: ConvRow[] = rows.map((r) => ({
    ...r,
    appointmentStartsAt: appointmentMap[r.leadId] ?? null,
    latestAppointmentStatus: latestAppointmentStatusMap[r.leadId] ?? null,
    latestAppointmentUpdatedAt: latestAppointmentUpdatedAtMap[r.leadId] ?? null,
    hoursWaiting: r.lastMessageAt
      ? (now.getTime() - new Date(r.lastMessageAt).getTime()) / 3_600_000
      : 0,
  }));

  const snapshotRows: InboxSnapshotRow[] = rows.map((row) => ({
    convId: row.convId,
    conversationUpdatedAt: row.conversationUpdatedAt,
    leadUpdatedAt: row.leadUpdatedAt,
    lastMessageAt: row.lastMessageAt,
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

  const initialSignature = buildInboxSnapshotSignature(snapshotRows, {
    autoReplyEnabled: clinicRows[0]?.autoReplyEnabled ?? false,
    clinicUpdatedAt: clinicRows[0]?.updatedAt ?? null,
  });

  const filter = Array.isArray(params.filter) ? params.filter[0] : params.filter;
  const scopeParam = Array.isArray(params.scope) ? params.scope[0] : params.scope;
  const initialScope =
    scopeParam === "operational" ||
    scopeParam === "vendor" ||
    scopeParam === "spam" ||
    scopeParam === "archived"
      ? scopeParam
      : "sales";
  const initialTab =
    filter === "attention" ||
    filter === "hot" ||
    filter === "paused" ||
    filter === "cold" ||
    filter === "recovery"
      ? filter
      : "all";

  return (
    <div className="inbox-shell">
      <InboxPoller initialSignature={initialSignature} />
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "16px 28px 0" }}>
        <EnableNotificationsButton />
      </div>
      <InboxClient
        rows={allRows}
        lastMsgMap={lastMsgMap}
        autoReplyEnabled={autoReplyEnabled}
        initialScope={initialScope}
        initialTab={initialScope === "sales" ? initialTab : "all"}
      />
    </div>
  );
}
