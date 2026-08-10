import type { ConvRow } from "./InboxClient";
import { compareInboxRecency } from "@/application/inbox/inbox-segmentation";

export type InboxFilter = "all" | "attention";
export type LiveInboxTabFilter = "all" | "hot" | "attention" | "pending" | "paused" | "cold";

export function filterBySearch(rows: ConvRow[], search: string): ConvRow[] {
  if (!search.trim()) return rows;
  const q = search.toLowerCase();
  return rows.filter(
    (r) =>
      r.leadName?.toLowerCase().includes(q) ||
      r.leadPhone?.toLowerCase().includes(q),
  );
}

// Mesma chave que o servidor usa pra decidir quais conversas cabem na página
// (lastMessageAt DESC NULLS LAST, id DESC — Task 2 index, list-conversations.ts,
// inbox-segmentation.ts). Não é uma reordenação "defensiva" independente: é
// uma RESTATEMENT da ordem do servidor, reaplicada no cliente só porque um
// filtro local (busca em andamento, por exemplo) pode ter embaralhado a
// ordem das linhas já carregadas. Divergir daqui faria o cliente mostrar uma
// ordem diferente da que decidiu quais conversas entraram na página.
export function sortInboxRowsByRecency(rows: ConvRow[]): ConvRow[] {
  return [...rows].sort(compareInboxRecency);
}

export function resolveEmConversa(
  handoffRows: ConvRow[],
  activeRows: ConvRow[],
  filter: InboxFilter,
  search: string,
): ConvRow[] {
  const source = filter === "attention" ? handoffRows : [...handoffRows, ...activeRows];
  return sortInboxRowsByRecency(filterBySearch(source, search));
}
