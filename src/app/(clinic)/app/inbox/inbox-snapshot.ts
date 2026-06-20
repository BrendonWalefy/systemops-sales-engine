type DateLike = Date | string | null | undefined;

export type InboxSnapshotRow = {
  convId: string;
  conversationUpdatedAt: DateLike;
  leadUpdatedAt: DateLike;
  lastMessageAt: DateLike;
  latestMessageAt?: DateLike;
  latestMessageAuthor?: string | null;
  lastReadAt: DateLike;
  aiPaused: boolean;
  needsAttention: boolean;
  takeoverExpiresAt: DateLike;
  conversationCategory: string | null;
  leadStatus: string | null;
  leadTemperature: string | null;
  appointmentStartsAt: DateLike;
  latestAppointmentStatus: string | null;
  latestAppointmentUpdatedAt: DateLike;
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
      serializeDate(row.latestMessageAt),
      row.latestMessageAuthor ?? "",
      serializeDate(row.lastReadAt),
      row.aiPaused ? "1" : "0",
      row.needsAttention ? "1" : "0",
      serializeDate(row.takeoverExpiresAt),
      row.conversationCategory ?? "",
      row.leadStatus ?? "",
      row.leadTemperature ?? "",
      serializeDate(row.appointmentStartsAt),
      row.latestAppointmentStatus ?? "",
      serializeDate(row.latestAppointmentUpdatedAt),
    ].join("|"));

  return [clinicPart, ...rowParts].join("\n");
}
