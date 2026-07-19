export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { redirect } from "next/navigation";
import { organizations, conversations, leads, messages, appointments, conversationStates, humanReviewRequests } from "@/infrastructure/db/schema";
import { and, eq, desc, inArray, gte, isNull, or } from "drizzle-orm";
import { InboxPoller } from "./InboxPoller";
import { InboxClient, type ConvRow } from "./InboxClient";
import { getInboxVersion } from "./get-inbox-version";
import { TreatmentGapBanner } from "./TreatmentGapBanner";
import { resolveInboxPendingAction } from "./inbox-pending";

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
      autoReplyEnabled: organizations.autoReplyEnabled,
      updatedAt: organizations.updatedAt,
    })
      .from(organizations)
      .where(eq(organizations.id, clinicId))
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
  const [lastMessageRows, upcomingAppointmentRows, latestOutcomeRows, latestStateRows, pendingHumanReviewRows] = await Promise.all([
    conversationIds.length > 0
      ? db
          .selectDistinctOn([messages.conversationId], {
            conversationId: messages.conversationId,
            body: messages.body,
            author: messages.author,
            sentAt: messages.sentAt,
            simulated: messages.simulated,
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
    conversationIds.length > 0
      ? db
          .selectDistinctOn([conversationStates.conversationId], {
            conversationId: conversationStates.conversationId,
            state: conversationStates.state,
            expiresAt: conversationStates.expiresAt,
          })
          .from(conversationStates)
          .where(inArray(conversationStates.conversationId, conversationIds))
          .orderBy(conversationStates.conversationId, desc(conversationStates.createdAt))
      : Promise.resolve([]),
    conversationIds.length > 0
      ? db
          .select({ conversationId: humanReviewRequests.conversationId })
          .from(humanReviewRequests)
          .where(
            and(
              eq(humanReviewRequests.clinicId, clinicId),
              eq(humanReviewRequests.status, "pending"),
              inArray(humanReviewRequests.conversationId, conversationIds),
              or(
                isNull(humanReviewRequests.expiresAt),
                gte(humanReviewRequests.expiresAt, now),
              ),
            ),
          )
      : Promise.resolve([]),
  ]);

  const lastMsgMap: Record<string, { body: string; author: string; sentAt: Date | null; simulated: boolean }> = {};
  for (const msg of lastMessageRows) {
    if (!lastMsgMap[msg.conversationId]) {
      lastMsgMap[msg.conversationId] = {
        body: msg.body ?? "",
        author: msg.author ?? "",
        sentAt: msg.sentAt ?? null,
        simulated: msg.simulated ?? false,
      };
    }
  }

  const appointmentMap: Record<string, Date> = {};
  const latestAppointmentStatusMap: Record<string, ConvRow["latestAppointmentStatus"]> = {};
  const latestAppointmentUpdatedAtMap: Record<string, Date> = {};
  const latestStateMap = new Map(
    latestStateRows.map((state) => [state.conversationId, state]),
  );
  const pendingHumanReviewConversationIds = new Set(
    pendingHumanReviewRows.map((review) => review.conversationId),
  );

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

  const allRows: ConvRow[] = rows.map((r) => {
    const latestState = latestStateMap.get(r.convId);
    return {
      ...r,
      appointmentStartsAt: appointmentMap[r.leadId] ?? null,
      latestAppointmentStatus: latestAppointmentStatusMap[r.leadId] ?? null,
      latestAppointmentUpdatedAt: latestAppointmentUpdatedAtMap[r.leadId] ?? null,
      latestMessageAt: lastMsgMap[r.convId]?.sentAt ?? r.lastMessageAt,
      hoursWaiting: r.lastMessageAt
        ? (now.getTime() - new Date(r.lastMessageAt).getTime()) / 3_600_000
        : 0,
      pendingAction: resolveInboxPendingAction({
        latestConversationState: latestState?.state ?? null,
        latestStateExpiresAt: latestState?.expiresAt ?? null,
        hasPendingHumanReview: pendingHumanReviewConversationIds.has(r.convId),
        attentionReason: r.attentionReason,
        now,
      }),
    };
  });

  const initialVersion = await getInboxVersion(clinicId);

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
    filter === "pending" ||
    filter === "hot" ||
    filter === "paused" ||
    filter === "cold" ||
    filter === "recovery"
      ? filter
      : "all";

  return (
    <div className="inbox-shell">
      <InboxPoller initialVersion={initialVersion} />
      <TreatmentGapBanner />
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
