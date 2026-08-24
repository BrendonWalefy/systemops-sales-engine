import { and, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  appointments,
  conversationStates,
  conversations,
  humanReviewRequests,
  leads,
  messages,
} from "@/infrastructure/db/schema";
import {
  buildSegmentIndex,
  type InboxSegmentIndex,
  type InboxSegmentScan,
  type SegmentAppointmentRow,
  type SegmentInputRow,
} from "./inbox-segmentation";

// Varredura clinic-wide *estreita*: carrega, para toda conversa da clínica,
// apenas o que os predicados de aba leem. Nenhum corpo de mensagem, nome,
// telefone, foto de perfil ou resumo entra aqui — esses só são lidos para a
// página de no máximo INBOX_PAGE_SIZE conversas da aba selecionada.
//
// LIMITAÇÃO CONHECIDA: esta varredura continua linear no número de conversas
// (e, no join de mensagens/estados, nas mensagens das conversas comerciais).
// Trocá-la por um read model materializado é trabalho da Fase 3B; o que esta
// task garante é que o custo *por linha* aqui é pequeno e fixo.
export async function loadInboxSegmentIndex(params: {
  clinicId: string;
  now?: Date;
  // Busca por nome/telefone do lead (Fix round 1 — Critical #1): filtra a
  // varredura ANTES da segmentação, então a busca vale pra clínica inteira,
  // não só pra página de até INBOX_PAGE_SIZE que seria montada a partir
  // dela. `leads.name`/`leads.phone` entram só no WHERE, nunca no SELECT —
  // não voltam pra aplicação, então a varredura continua sem PII no payload.
  search?: string;
}): Promise<InboxSegmentScan> {
  const { clinicId } = params;
  const now = params.now ?? new Date();
  const search = params.search?.trim();

  // UMA rodada de ida e volta, não duas.
  //
  // As cinco leituras de enriquecimento eram disparadas depois de `await` na
  // varredura de conversas, como se dependessem dela. Nenhuma depende: todas
  // filtram por `clinicId` (as de mensagem/estado pelo join com
  // `conversations`), e o único uso de `salesLeadIds` é filtrar em memória
  // DEPOIS que as linhas voltam. Em fila isso custava 2 idas ao Postgres;
  // juntas, custa 1. Numa função serverless que não está na mesma região do
  // banco, cada ida dessas é ~130 ms de rede pura.
  const [
    conversationRows,
    lastMessageRows,
    upcomingAppointmentRows,
    latestOutcomeRows,
    latestStateRows,
    pendingReviewRows,
  ] = await Promise.all([
    db
      .select({
        convId: conversations.id,
        leadId: conversations.leadId,
        conversationCategory: conversations.category,
        aiPaused: conversations.aiPaused,
        needsAttention: conversations.needsAttention,
        attentionReason: conversations.attentionReason,
        takeoverExpiresAt: conversations.takeoverExpiresAt,
        lastMessageAt: conversations.lastMessageAt,
        leadStatus: leads.status,
        leadTemperature: leads.temperature,
      })
      .from(conversations)
      .innerJoin(leads, eq(conversations.leadId, leads.id))
      .where(
        search
          ? and(
              eq(conversations.clinicId, clinicId),
              or(ilike(leads.name, `%${search}%`), ilike(leads.phone, `%${search}%`)),
            )
          : eq(conversations.clinicId, clinicId),
      )
      // Mesma chave e mesma colocação de nulos da página (list-conversations.ts)
      // e do índice: `desc(col)` sozinho seria `DESC NULLS FIRST` e faria o
      // planner ordenar por cima do índice em vez de ler na ordem dele.
      .orderBy(
        sql`${conversations.lastMessageAt} desc nulls last`,
        sql`${conversations.id} desc nulls last`,
      ),
    db
      .selectDistinctOn([messages.conversationId], {
        conversationId: messages.conversationId,
        author: messages.author,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(eq(conversations.clinicId, clinicId), eq(conversations.category, "sales")))
      .orderBy(messages.conversationId, desc(messages.sentAt)),
    // `startsAt` entra no SELECT porque a página monta a partir daqui o
    // horário do próximo agendamento — antes ela repetia esta mesma consulta,
    // já restrita aos leads da página, só para ganhar essa coluna.
    db
      .selectDistinctOn([appointments.leadId], {
        leadId: appointments.leadId,
        status: appointments.status,
        startsAt: appointments.startsAt,
        updatedAt: appointments.updatedAt,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          inArray(appointments.status, ["scheduled", "confirmed"]),
          gte(appointments.endsAt, now),
        ),
      )
      .orderBy(appointments.leadId, appointments.startsAt),
    db
      .selectDistinctOn([appointments.leadId], {
        leadId: appointments.leadId,
        status: appointments.status,
        startsAt: appointments.startsAt,
        updatedAt: appointments.updatedAt,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          inArray(appointments.status, ["cancelled", "completed", "no_show"]),
        ),
      )
      .orderBy(appointments.leadId, desc(appointments.updatedAt), desc(appointments.startsAt)),
    db
      .selectDistinctOn([conversationStates.conversationId], {
        conversationId: conversationStates.conversationId,
        state: conversationStates.state,
        expiresAt: conversationStates.expiresAt,
      })
      .from(conversationStates)
      .innerJoin(conversations, eq(conversationStates.conversationId, conversations.id))
      .where(and(eq(conversations.clinicId, clinicId), eq(conversations.category, "sales")))
      .orderBy(conversationStates.conversationId, desc(conversationStates.createdAt)),
    db
      .select({ conversationId: humanReviewRequests.conversationId })
      .from(humanReviewRequests)
      .where(
        and(
          eq(humanReviewRequests.clinicId, clinicId),
          eq(humanReviewRequests.status, "pending"),
          or(isNull(humanReviewRequests.expiresAt), gte(humanReviewRequests.expiresAt, now)),
        ),
      ),
  ]);

  // Só conversas comerciais entram nas abas (categoryRows(..., "sales")), então
  // o enriquecimento caro é restrito a elas em memória.
  const salesLeadIdSet = new Set(
    conversationRows
      .filter((row) => row.conversationCategory === "sales")
      .map((row) => row.leadId),
  );

  const lastMessageAuthorByConversation = new Map<string, string>();
  for (const row of lastMessageRows) {
    if (!lastMessageAuthorByConversation.has(row.conversationId)) {
      lastMessageAuthorByConversation.set(row.conversationId, row.author ?? "");
    }
  }

  const appointmentStatusByLead = new Map<string, { status: string; updatedAt: Date | null }>();
  for (const appointment of [...upcomingAppointmentRows, ...latestOutcomeRows]) {
    if (!appointment.leadId || !salesLeadIdSet.has(appointment.leadId)) continue;
    if (appointmentStatusByLead.has(appointment.leadId)) continue;
    appointmentStatusByLead.set(appointment.leadId, {
      status: appointment.status,
      updatedAt: appointment.updatedAt ?? null,
    });
  }

  const stateByConversation = new Map(latestStateRows.map((state) => [state.conversationId, state]));
  const pendingReviewConversationIds = new Set(pendingReviewRows.map((review) => review.conversationId));

  const segmentRowsInput: SegmentInputRow[] = conversationRows.map((row) => {
    const appointment = appointmentStatusByLead.get(row.leadId);
    const state = stateByConversation.get(row.convId);
    return {
      convId: row.convId,
      conversationCategory: row.conversationCategory,
      aiPaused: row.aiPaused,
      needsAttention: row.needsAttention,
      attentionReason: row.attentionReason,
      takeoverExpiresAt: row.takeoverExpiresAt,
      lastMessageAt: row.lastMessageAt,
      leadStatus: row.leadStatus,
      leadTemperature: row.leadTemperature,
      lastMessageAuthor: lastMessageAuthorByConversation.get(row.convId) ?? null,
      latestAppointmentStatus: appointment?.status ?? null,
      latestAppointmentUpdatedAt: appointment?.updatedAt ?? null,
      latestConversationState: state?.state ?? null,
      latestStateExpiresAt: state?.expiresAt ?? null,
      hasPendingHumanReview: pendingReviewConversationIds.has(row.convId),
    };
  });

  const index: InboxSegmentIndex = buildSegmentIndex(segmentRowsInput, now);

  // O que a varredura já pagou fica disponível para a página, em vez de ser
  // relido depois restrito aos ids da página. Nada aqui é PII: ids, status e
  // datas.
  return {
    ...index,
    reads: {
      leadIdByConversation: new Map(conversationRows.map((row) => [row.convId, row.leadId])),
      upcomingAppointments: upcomingAppointmentRows as SegmentAppointmentRow[],
      latestOutcomeAppointments: latestOutcomeRows as SegmentAppointmentRow[],
      pendingReviewConversationIds,
    },
  };
}
