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

export default async function InboxPage() {
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

  // Busca a próxima consulta de todos os leads com appointment_scheduled — sem janela de tempo
  // restrita, para que o card mostre a data mesmo quando a consulta é semanas à frente.
  const scheduledLeadIds = rows
    .filter((r) => r.leadStatus === "appointment_scheduled")
    .map((r) => r.leadId);

  const now = new Date();

  // Janela retroativa de 48h: inclui consultas que acabaram de acontecer mas ainda não
  // tiveram o status do lead atualizado para "won".
  const recentPast = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const conversationIds = rows.map((row) => row.convId);

  const [lastMessageRows, appointmentRows] = await Promise.all([
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
    scheduledLeadIds.length > 0
      ? db
          .select({ leadId: appointments.leadId, startsAt: appointments.startsAt })
          .from(appointments)
          .where(
            and(
              inArray(appointments.leadId, scheduledLeadIds),
              inArray(appointments.status, ["scheduled", "confirmed"]),
              gte(appointments.startsAt, recentPast),
            ),
          )
          .orderBy(appointments.startsAt)
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
  for (const appt of appointmentRows) {
    if (appt.leadId && !appointmentMap[appt.leadId]) {
      appointmentMap[appt.leadId] = appt.startsAt;
    }
  }

  const allRows: ConvRow[] = rows.map((r) => ({
    ...r,
    appointmentStartsAt: appointmentMap[r.leadId] ?? null,
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
    leadStatus: row.leadStatus,
    leadTemperature: row.leadTemperature,
    appointmentStartsAt: appointmentMap[row.leadId] ?? null,
  }));

  const initialSignature = buildInboxSnapshotSignature(snapshotRows, {
    autoReplyEnabled: clinicRows[0]?.autoReplyEnabled ?? false,
    clinicUpdatedAt: clinicRows[0]?.updatedAt ?? null,
  });

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
      />
    </div>
  );
}
