// Cursor keyset para paginação do Inbox (Task 3). Codifica o par
// (lastMessageAt, id) da última linha da página anterior em base64url,
// para retomar a leitura exatamente onde parou sem OFFSET.
export const INBOX_PAGE_SIZE = 40;

export type InboxCursor = { lastMessageAt: Date | null; id: string };

export function encodeInboxCursor(row: InboxCursor): string {
  const payload = { t: row.lastMessageAt ? row.lastMessageAt.toISOString() : null, id: row.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeInboxCursor(raw: string | null): InboxCursor | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;

    const { t, id } = parsed as { t?: unknown; id?: unknown };
    if (typeof id !== "string" || id.length === 0) return null;
    if (t === null || t === undefined) return { lastMessageAt: null, id };
    if (typeof t !== "string") return null;

    const at = new Date(t);
    if (Number.isNaN(at.getTime())) return null;

    return { lastMessageAt: at, id };
  } catch {
    return null;
  }
}
