export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { clinics, conversations, leads, messages, appointments } from "@/infrastructure/db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { InboxPoller } from "./InboxPoller";
import { EnableNotificationsButton } from "@/components/enable-notifications-button";
import { InboxClient, type ConvRow } from "./InboxClient";

export default async function InboxPage() {
  const clinicId = process.env.PILOT_CLINIC_ID ?? "";

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
        leadName: leads.name,
        leadPhone: leads.phone,
        leadStatus: leads.status,
        leadTemperature: leads.temperature,
      })
      .from(conversations)
      .innerJoin(leads, eq(conversations.leadId, leads.id))
      .where(eq(conversations.clinicId, clinicId))
      .orderBy(desc(conversations.lastMessageAt)),
  ]);

  const autoReplyEnabled = clinicRows[0]?.autoReplyEnabled ?? false;

  // Busca appointments para todos os leads agendados (badge dentro do card)
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

  const withAppointment = (r: typeof rows[number]): ConvRow => ({
    ...r,
    appointmentStartsAt: appointmentMap[r.leadId] ?? null,
  });

  // Em Conversa: todos os leads ativos (inclui agendados) — scheduled leads aparecem
  // aqui com o badge de data dentro do próprio card
  const handoffRows: ConvRow[] = rows
    .filter((r) => r.aiPaused && r.needsAttention)
    .map(withAppointment);

  const activeRows: ConvRow[] = rows
    .filter((r) => !r.aiPaused && r.leadStatus !== "lost" && r.leadStatus !== "won")
    .map(withAppointment);

  const pausedRows: ConvRow[] = rows
    .filter((r) => r.aiPaused && !r.needsAttention && r.leadStatus !== "lost" && r.leadStatus !== "won")
    .map(withAppointment);

  const closedRows: ConvRow[] = rows
    .filter((r) => r.leadStatus === "won" || r.leadStatus === "lost")
    .map(withAppointment);

  return (
    <div className="inbox-shell">
      <InboxPoller />
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "16px 28px 0" }}>
        <EnableNotificationsButton />
      </div>
      <InboxClient
        activeRows={activeRows}
        handoffRows={handoffRows}
        pausedRows={pausedRows}
        closedRows={closedRows}
        lastMsgMap={lastMsgMap}
        autoReplyEnabled={autoReplyEnabled}
      />
    </div>
  );
}
