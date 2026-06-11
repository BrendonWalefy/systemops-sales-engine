import type { ConvRow } from "./InboxClient";

export type InboxFilter = "all" | "attention";
export type LiveInboxTabFilter = "all" | "hot" | "attention" | "paused" | "cold";

export function filterBySearch(rows: ConvRow[], search: string): ConvRow[] {
  if (!search.trim()) return rows;
  const q = search.toLowerCase();
  return rows.filter(
    (r) =>
      r.leadName?.toLowerCase().includes(q) ||
      r.leadPhone?.toLowerCase().includes(q),
  );
}

export function sortInboxRowsByRecency(rows: ConvRow[]): ConvRow[] {
  return [...rows].sort((a, b) => {
    const diff = (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0);
    if (diff !== 0) return diff;

    return a.convId.localeCompare(b.convId);
  });
}

export function filterLiveRowsByTab(rows: ConvRow[], tab: LiveInboxTabFilter): ConvRow[] {
  if (tab === "hot") return rows.filter((r) => r.leadTemperature === "hot");
  if (tab === "attention") return rows.filter((r) => r.needsAttention);
  if (tab === "paused") return rows.filter((r) => r.aiPaused && !r.needsAttention);
  if (tab === "cold") return rows.filter((r) => r.leadTemperature === "cold");
  return rows;
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
