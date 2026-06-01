import type { ConvRow } from "./InboxClient";

export type InboxFilter = "all" | "attention";

export function filterBySearch(rows: ConvRow[], search: string): ConvRow[] {
  if (!search.trim()) return rows;
  const q = search.toLowerCase();
  return rows.filter(
    (r) =>
      r.leadName?.toLowerCase().includes(q) ||
      r.leadPhone?.toLowerCase().includes(q),
  );
}

export function resolveEmConversa(
  handoffRows: ConvRow[],
  activeRows: ConvRow[],
  filter: InboxFilter,
  search: string,
): ConvRow[] {
  const source = filter === "attention" ? handoffRows : [...handoffRows, ...activeRows];
  return filterBySearch(source, search);
}
