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
import { hoursWaitingSince } from "./inbox-presentation";
import { measureServerOperation } from "@/infrastructure/observability/performance-logger";
import { ContentReadyReporter } from "@/components/performance/content-ready-reporter";
import { listClinicConversations } from "@/application/inbox/list-conversations";
import { loadInboxSegmentIndex } from "@/application/inbox/segment-index";
import { resolveActiveInboxTab, selectSegmentedConversationIds } from "@/application/inbox/inbox-segmentation";
import { parseInboxPageParam, selectInboxPageWindow } from "@/application/inbox/inbox-page-window";

type InboxSearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function prepareInboxPage(clinicId: string, params: InboxSearchParams) {
  const now = new Date();

  // A aba/escopo/busca ativos decidem QUAIS conversas valem a leitura cara —
  // vêm dos mesmos search params de sempre, só que agora lidos antes da
  // página ser buscada, não depois.
  const filterParam = firstParam(params.filter);
  const scopeParam = firstParam(params.scope);
  const trimmedSearch = (firstParam(params.q) ?? "").trim();
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
  const activeTab = resolveActiveInboxTab(initialScope, initialTab);
  const requestedPage = parseInboxPageParam(firstParam(params.page));

  // Não depende da varredura de segmentação — dispara em paralelo com ela
  // em vez de esperar (Fix round 1 — Important #6). O query builder do
  // drizzle é um thenable PREGUIÇOSO (query-promise.js: `then()` chama
  // `execute()`) — só criar o objeto não manda nada pro Neon. `.execute()`
  // aqui é o que realmente dispara a requisição na hora; sem ele, a consulta
  // só saía quando o Promise.all de inbox_base_query desse `await` nela, ou
  // seja, só depois do scan de segmentação já ter resolvido (Fix round 2 —
  // Important #5: a "paralelização" da rodada 1 só movia onde o objeto era
  // CONSTRUÍDO, não onde a requisição saía).
  const clinicRowsPromise = db
    .select({
      autoReplyEnabled: organizations.autoReplyEnabled,
      updatedAt: organizations.updatedAt,
    })
    .from(organizations)
    .where(eq(organizations.id, clinicId))
    .limit(1)
    .execute();
  // Sem isso, uma falha aqui vira unhandledRejection assim que a promise
  // rejeita — antes do Promise.all de inbox_base_query (lá embaixo) chegar a
  // dar `await` nela, já que o scan de segmentação pode levar um tempo.
  // O catch aqui só marca a rejeição como "tratada"; quem trata de verdade
  // (e propaga o erro pra derrubar a página, como sempre) continua sendo
  // aquele await mais abaixo.
  clinicRowsPromise.catch(() => {});

  // Varredura estreita clinic-wide (Task 4b): decide membership e contagem
  // de TODAS as abas/escopos, mas só carrega as colunas que os predicados
  // leem — nunca corpo de mensagem, nome, telefone ou foto. Quando há busca,
  // roda uma SEGUNDA varredura (mesma forma, mesma clinicId) filtrada por
  // nome/telefone do lead — a busca precisa valer pra clínica inteira, não
  // só pra página de até 40 linhas já carregada (Fix round 1 — Critical #1).
  // As contagens/badges continuam vindo SEMPRE do índice sem busca: o
  // usuário busca dentro da clínica, os números das abas não mudam.
  const [segmentIndex, searchIndex] = await measureServerOperation(
    {
      clinicId,
      surface: "inbox_list",
      operation: "inbox_segment_scan",
    },
    () =>
      Promise.all([
        loadInboxSegmentIndex({ clinicId, now }),
        trimmedSearch
          ? loadInboxSegmentIndex({ clinicId, now, search: trimmedSearch })
          : Promise.resolve(null),
      ]),
  );

  // A lista de ids da aba vem COMPLETA do índice de segmentação, então a
  // continuação é aritmética sobre ela — não precisa de cursor de banco (o
  // keyset da Task 3 era clinic-wide e não sabia retomar a lista de UMA aba,
  // que foi o motivo de ele ter saído daqui). Só a leitura cara continua
  // limitada a INBOX_PAGE_SIZE por passo. Sem esta janela, a conversa 41 de
  // uma clínica com 137 não tinha rota de acesso nenhuma pela interface.
  const pageWindow = selectInboxPageWindow(
    selectSegmentedConversationIds(searchIndex ?? segmentIndex, initialScope, initialTab),
    requestedPage,
  );
  const pageIds = pageWindow.ids;

  const [clinicRows, page] = await measureServerOperation(
    {
      clinicId,
      surface: "inbox_list",
      operation: "inbox_base_query",
    },
    () => Promise.all([
      clinicRowsPromise,
      // Não é mais a página recente clinic-wide: são as até INBOX_PAGE_SIZE
      // conversas da aba/escopo (e, se houver busca, dos resultados dela),
      // na mesma ordem do índice de segmentação.
      listClinicConversations({ clinicId, ids: pageIds }),
    ]),
  );

  const autoReplyEnabled = clinicRows[0]?.autoReplyEnabled ?? false;

  const rows = page.rows;

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
      hoursWaiting: hoursWaitingSince(r.lastMessageAt, now),
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
        initialSearch={trimmedSearch}
        pageWindow={pageWindow}
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
