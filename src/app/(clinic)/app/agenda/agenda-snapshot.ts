type DateLike = Date | string | null | undefined;

export type AgendaSnapshotRow = {
  id: string;
  startsAt: DateLike;
  endsAt: DateLike;
  status: string | null;
  professionalId: string | null;
  updatedAt: DateLike;
};

function serializeDate(value: DateLike): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function buildAgendaSnapshotSignature(rows: AgendaSnapshotRow[]): string {
  return [...rows]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => [
      row.id,
      serializeDate(row.startsAt),
      serializeDate(row.endsAt),
      row.status ?? "",
      row.professionalId ?? "",
      serializeDate(row.updatedAt),
    ].join("|"))
    .join("\n");
}
