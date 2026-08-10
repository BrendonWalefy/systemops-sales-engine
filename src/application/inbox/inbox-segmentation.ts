import type { ConversationCategory } from "@/domain/value-objects/conversation-category";
import {
  hoursWaitingSince,
  isRecoveryCandidate,
  type InboxLastMessage,
  type InboxPresentationRow,
} from "@/app/(clinic)/app/inbox/inbox-presentation";
import {
  resolveInboxPendingAction,
  type InboxPendingAction,
} from "@/app/(clinic)/app/inbox/inbox-pending";

// Abas do inbox comercial. A membership e a contagem de cada uma dependem de
// enriquecimento (autor da última mensagem, ciclo de vida do agendamento,
// pendências), então continuam sendo decididas por estes predicados em
// TypeScript — nunca por um WHERE equivalente em SQL, que viraria um segundo
// dono das mesmas regras (docs/architecture/sources-of-truth.md).
export type InboxTabKey =
  | "all"
  | "hot"
  | "attention"
  | "pending"
  | "paused"
  | "cold"
  | "recovery";

export const INBOX_TAB_KEYS: readonly InboxTabKey[] = [
  "all",
  "hot",
  "attention",
  "pending",
  "paused",
  "cold",
  "recovery",
];

export const INBOX_SCOPE_KEYS: readonly ConversationCategory[] = [
  "sales",
  "operational",
  "vendor",
  "spam",
  "archived",
];

type SegmentableRow = InboxPresentationRow & { convId: string };

// Movido de InboxClient.tsx sem alterar a lógica: o comportamento existente é a
// especificação. Genérico porque agora roda tanto sobre as linhas estreitas do
// servidor quanto sobre as linhas completas do cliente.
export function segmentRows<T extends SegmentableRow>(
  rows: T[],
  lastMsgMap: Record<string, InboxLastMessage>,
) {
  const handoff  = rows.filter((r) => r.needsAttention && r.leadStatus !== "lost" && r.leadStatus !== "won");
  const active   = rows.filter((r) => !r.aiPaused && !r.needsAttention && !isRecoveryCandidate(r, lastMsgMap[r.convId]) && r.leadStatus !== "lost" && r.leadStatus !== "won");
  const paused   = rows.filter((r) => r.aiPaused && !r.needsAttention && !isRecoveryCandidate(r, lastMsgMap[r.convId]) && r.leadStatus !== "lost" && r.leadStatus !== "won");
  const closed   = rows.filter((r) => r.leadStatus === "won" || r.leadStatus === "lost");
  const recovery = rows.filter((r) => isRecoveryCandidate(r, lastMsgMap[r.convId]));
  return { handoff, active, paused, closed, recovery };
}

export function categoryRows<T extends { conversationCategory: ConversationCategory }>(
  rows: T[],
  category: ConversationCategory,
): T[] {
  return rows.filter((row) => row.conversationCategory === category);
}

// Linha estreita da varredura clinic-wide: só o que os predicados leem.
// Sem corpo de mensagem, nome, telefone, foto ou resumo.
export type SegmentInputRow = {
  convId: string;
  conversationCategory: ConversationCategory;
  aiPaused: boolean;
  needsAttention: boolean;
  attentionReason: string | null;
  takeoverExpiresAt: Date | null;
  lastMessageAt: Date | null;
  leadStatus: string;
  leadTemperature: string | null;
  lastMessageAuthor: string | null;
  latestAppointmentStatus: string | null;
  latestAppointmentUpdatedAt: Date | null;
  latestConversationState: string | null;
  latestStateExpiresAt: Date | null;
  hasPendingHumanReview: boolean;
};

export type InboxSegmentIndex = {
  counts: Record<InboxTabKey, number>;
  idsByTab: Record<InboxTabKey, string[]>;
  scopeCounts: Record<ConversationCategory, number>;
  idsByScope: Record<ConversationCategory, string[]>;
  // Cabeçalho "N conversas ativas" = handoff + active (pausadas não contam).
  activeCount: number;
  // Total de conversas da clínica em todas as categorias — só decide o empty
  // state ("nenhuma conversa ainda"), não a membership de nenhuma aba.
  totalConversations: number;
};

type EnrichedRow = SegmentInputRow & {
  hoursWaiting: number;
  pendingAction: InboxPendingAction | null;
};

// Mesma ordenação da página: lastMessageAt DESC NULLS LAST, id DESC.
function compareInboxRecency(a: SegmentInputRow, b: SegmentInputRow): number {
  const at = a.lastMessageAt?.getTime() ?? null;
  const bt = b.lastMessageAt?.getTime() ?? null;

  if (at === null && bt !== null) return 1;
  if (bt === null && at !== null) return -1;
  if (at !== null && bt !== null && at !== bt) return bt - at;

  if (a.convId === b.convId) return 0;
  return a.convId < b.convId ? 1 : -1;
}

function idsOf(rows: { convId: string }[]): string[] {
  return rows.map((row) => row.convId);
}

export function buildSegmentIndex(
  rows: SegmentInputRow[],
  now: Date = new Date(),
): InboxSegmentIndex {
  const ordered = [...rows].sort(compareInboxRecency);

  const lastMsgMap: Record<string, InboxLastMessage> = {};
  for (const row of ordered) {
    lastMsgMap[row.convId] = { author: row.lastMessageAuthor ?? "" };
  }

  const enriched: EnrichedRow[] = ordered.map((row) => ({
    ...row,
    hoursWaiting: hoursWaitingSince(row.lastMessageAt, now),
    pendingAction: resolveInboxPendingAction({
      latestConversationState: row.latestConversationState,
      latestStateExpiresAt: row.latestStateExpiresAt,
      hasPendingHumanReview: row.hasPendingHumanReview,
      attentionReason: row.attentionReason,
      now,
    }),
  }));

  const salesRows = categoryRows(enriched, "sales");
  const { handoff, active, paused, recovery } = segmentRows(salesRows, lastMsgMap);

  // handoff/active/paused são concatenados na UI; refiltrar por membership
  // devolve a ordem global de recência em vez da ordem de concatenação.
  const liveIds = new Set(idsOf([...handoff, ...active, ...paused]));
  const allLive = salesRows.filter((row) => liveIds.has(row.convId));

  const idsByTab: Record<InboxTabKey, string[]> = {
    all: idsOf(allLive),
    hot: idsOf(allLive.filter((r) => r.leadTemperature === "hot")),
    attention: idsOf(salesRows.filter((r) => r.needsAttention)),
    pending: idsOf(
      salesRows.filter(
        (r) => r.pendingAction !== null && r.leadStatus !== "lost" && r.leadStatus !== "won",
      ),
    ),
    paused: idsOf(paused),
    cold: idsOf(allLive.filter((r) => r.leadTemperature === "cold")),
    recovery: idsOf(recovery),
  };

  const idsByScope = {} as Record<ConversationCategory, string[]>;
  for (const scope of INBOX_SCOPE_KEYS) {
    idsByScope[scope] = idsOf(categoryRows(enriched, scope));
  }

  // counts saem de idsByTab/idsByScope: uma contagem nunca é calculada por um
  // caminho diferente da lista que ela descreve.
  const counts = {} as Record<InboxTabKey, number>;
  for (const tab of INBOX_TAB_KEYS) counts[tab] = idsByTab[tab].length;

  const scopeCounts = {} as Record<ConversationCategory, number>;
  for (const scope of INBOX_SCOPE_KEYS) scopeCounts[scope] = idsByScope[scope].length;

  return {
    counts,
    idsByTab,
    scopeCounts,
    idsByScope,
    activeCount: handoff.length + active.length,
    totalConversations: ordered.length,
  };
}
