export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { clinics, conversations, leads, messages } from "@/infrastructure/db/schema";
import { eq, desc } from "drizzle-orm";
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

  const lastMessages = await Promise.all(
    rows.map(async (r) => {
      const [msg] = await db
        .select({ body: messages.body })
        .from(messages)
        .where(eq(messages.conversationId, r.convId))
        .orderBy(desc(messages.sentAt))
        .limit(1);
      return { convId: r.convId, body: msg?.body ?? "" };
    }),
  );

  const lastMsgMap = Object.fromEntries(lastMessages.map((m) => [m.convId, m.body]));

  const handoffRows: ConvRow[] = rows.filter((r) => r.aiPaused && r.needsAttention);
  const activeRows: ConvRow[] = rows.filter(
    (r) =>
      !r.aiPaused &&
      r.leadStatus !== "appointment_scheduled" &&
      r.leadStatus !== "lost" &&
      r.leadStatus !== "won",
  );
  const scheduledRows: ConvRow[] = rows.filter(
    (r) =>
      r.leadStatus === "appointment_scheduled" ||
      r.leadStatus === "won" ||
      (r.aiPaused && !r.needsAttention),
  );

  return (
    <div>
      <InboxPoller />
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "16px 28px 0" }}>
        <EnableNotificationsButton />
      </div>
      <InboxClient
        activeRows={activeRows}
        handoffRows={handoffRows}
        scheduledRows={scheduledRows}
        lastMsgMap={lastMsgMap}
        autoReplyEnabled={autoReplyEnabled}
      />
    </div>
  );
}
