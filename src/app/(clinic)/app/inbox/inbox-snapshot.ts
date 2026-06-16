type DateLike = Date | string | null | undefined;

export type InboxSnapshotRow = {
  convId: string;
  conversationUpdatedAt: DateLike;
  leadUpdatedAt: DateLike;
  lastMessageAt: DateLike;
  lastReadAt: DateLike;
  aiPaused: boolean;
  needsAttention: boolean;
  takeoverExpiresAt: DateLike;
  leadStatus: string | null;
  leadTemperature: string | null;
  appointmentStartsAt: DateLike;
};

function serializeDate(value: DateLike): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function buildInboxSnapshotSignature(
  rows: InboxSnapshotRow[],
  meta?: { autoReplyEnabled?: boolean | null; clinicUpdatedAt?: DateLike },
): string {
  const clinicPart = [
    meta?.autoReplyEnabled ? "1" : "0",
    serializeDate(meta?.clinicUpdatedAt),
  ].join("|");

  const rowParts = [...rows]
    .sort((a, b) => a.convId.localeCompare(b.convId))
    .map((row) => [
      row.convId,
      serializeDate(row.conversationUpdatedAt),
      serializeDate(row.leadUpdatedAt),
      serializeDate(row.lastMessageAt),
      serializeDate(row.lastReadAt),
      row.aiPaused ? "1" : "0",
      row.needsAttention ? "1" : "0",
      serializeDate(row.takeoverExpiresAt),
      row.leadStatus ?? "",
      row.leadTemperature ?? "",
      serializeDate(row.appointmentStartsAt),
    ].join("|"));

  return [clinicPart, ...rowParts].join("\n");
}
