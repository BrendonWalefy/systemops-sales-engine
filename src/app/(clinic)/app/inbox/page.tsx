export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { redirect } from "next/navigation";
import { organizations, messages, appointments, conversationStates, humanReviewRequests } from "@/infrastructure/db/schema";
import { and, eq, desc, inArray, gte, isNull, or } from "drizzle-orm";
import { InboxPoller } from "./InboxPoller";
import { InboxClient, type ConvRow, type InboxTabCounts } from "./InboxClient";
import { getInboxVersion } from "./get-inbox-version";
import { TreatmentGapBanner } from "./TreatmentGapBanner";
import { resolveInboxPendingAction } from "./inbox-pending";
import { measureServerOperation } from "@/infrastructure/observability/performance-logger";
import { ContentReadyReporter } from "@/components/performance/content-ready-reporter";
import { listClinicConversations } from "@/application/inbox/list-conversations";
import { loadInboxSegmentIndex } from "@/application/inbox/segment-index";
import { INBOX_PAGE_SIZE, encodeInboxCursor } from "@/application/inbox/inbox-cursor";

type InboxSearchParams = Record<string, string | string[] | undefined>;

async function prepareInboxPage(clinicId: string, params: InboxSearchParams) {
  const now = new Date();

  // A aba/escopo ativos decidem QUAIS conversas valem a leitura cara — vêm
  // dos mesmos search params de sempre, só que agora lidos antes da página
  // ser buscada, não depois.
  const filterParam = Array.isArray(params.filter) ? params.filter[0] : params.filter;
  const scopeParam = Array.isArray(params.scope) ? params.scope[0] : params.scope;
  const initialScope =
    scopeParam === "operational" ||
    scopeParam === "vendor" ||
    scopeParam === "spam" ||
    scopeParam === "archived"
      ? scopeParam
      : "sales";
  const initialTab =
    filterParam === "attention" ||
    filterParam === "pending" ||
    filterParam === "hot" ||
    filterParam === "paused" ||
    filterParam === "cold" ||
    filterParam === "recovery"
      ? filterParam
      : "all";
  const activeTab = initialScope === "sales" ? initialTab : "all";

  // Varredura estreita clinic-wide (Task 4b): decide membership e contagem
  // de TODAS as abas/escopos, mas só carrega as colunas que os predicados
  // leem — nunca corpo de mensagem, nome, telefone ou foto.
  const segmentIndex = await measureServerOperation(
    {
      clinicId,
      surface: "inbox_list",
      operation: "inbox_segment_scan",
    },
    () => loadInboxSegmentIndex({ clinicId, now }),
  );

  const activeIds =
    initialScope === "sales" ? segmentIndex.idsByTab[activeTab] : segmentIndex.idsByScope[initialScope];
  const pageIds = activeIds.slice(0, INBOX_PAGE_SIZE);

  const [clinicRows, page] = await measureServerOperation(
    {
      clinicId,
      surface: "inbox_list",
      operation: "inbox_base_query",
    },
    () => Promise.all([
      db.select({
        autoReplyEnabled: organizations.autoReplyEnabled,
        updatedAt: organizations.updatedAt,
      })
        .from(organizations)
        .where(eq(organizations.id, clinicId))
        .limit(1),
      // Não é mais a página recente clinic-wide: são as até INBOX_PAGE_SIZE
      // conversas da aba/escopo ativos, na mesma ordem do índice de segmentação.
      listClinicConversations({ clinicId, ids: pageIds }),
    ]),
  );

  const autoReplyEnabled = clinicRows[0]?.autoReplyEnabled ?? false;

  const rows = page.rows;
  // O cursor keyset original perde sentido aqui: a página não é mais "os
  // próximos N da clínica", é "os próximos N desta aba". O índice de
  // segmentação já sabe se sobra mais nesta aba; o cursor só carrega o
  // ponto de retomada para quando a Fase 3B ligar o "carregar mais".
  const hasMoreInActiveTab = pageIds.length < activeIds.length;
  const lastPageRow = rows.at(-1);
  const nextCursor =
    hasMoreInActiveTab && lastPageRow
      ? encodeInboxCursor({ lastMessageAt: lastPageRow.lastMessageAt, id: lastPageRow.convId })
      : null;

  const salesLeadIds = rows
    .filter((row) => row.conversationCategory === "sales")
    .map((row) => row.leadId);

  const conversationIds = rows.map((row) => row.convId);
  const [lastMessageRows, upcomingAppointmentRows, latestOutcomeRows, latestStateRows, pendingHumanReviewRows] = await measureServerOperation(
    {
      clinicId,
      surface: "inbox_list",
      operation: "inbox_enrichment_query",
    },
    () => Promise.all([
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
    ]),
  );

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

  // Contagens/badges das abas: vêm do índice de segmentação (varredura
  // clinic-wide), nunca de `allRows` — que agora é só a página da aba ativa.
  // Um único dono para cada número; ver InboxClient.tsx.
  const counts: InboxTabCounts = {
    tabs: segmentIndex.counts,
    scopes: segmentIndex.scopeCounts,
    activeCount: segmentIndex.activeCount,
    totalConversations: segmentIndex.totalConversations,
  };

  return (
    <div className="inbox-shell">
      <InboxPoller initialVersion={initialVersion} />
      <ContentReadyReporter surface="inbox_list" />
      <TreatmentGapBanner />
      <InboxClient
        rows={allRows}
        lastMsgMap={lastMsgMap}
        autoReplyEnabled={autoReplyEnabled}
        counts={counts}
        initialScope={initialScope}
        initialTab={activeTab}
        nextCursor={nextCursor}
      />
    </div>
  );
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams?: Promise<InboxSearchParams>;
}) {
  const params = searchParams ? await searchParams : {};
  let clinicId: string | null = null;

  return measureServerOperation(
    {
      getClinicId: () => clinicId,
      surface: "inbox_list",
      operation: "inbox_total",
    },
    async () => {
      clinicId = await getSessionClinicId();
      if (!clinicId) redirect("/login");
      return prepareInboxPage(clinicId, params);
    },
  );
}
