import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { decodeInboxCursor, encodeInboxCursor, INBOX_PAGE_SIZE } from "@/application/inbox/inbox-cursor";

// `db` é mockado abaixo, então listClinicConversations nunca toca em um banco
// real. Os testes aqui verificam a *forma* da query que ele monta — SQL
// (where/orderBy/limit) renderizado via PgDialect sem conexão, e o
// comportamento de paginação sobre linhas fake devolvidas pelo mock — não o
// comportamento real do Postgres (índice usado, plano de execução, NULLS
// LAST de verdade). Isso permanece não verificado sem um ambiente de
// integração; ver o relatório da task para detalhes.

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

import { listClinicConversations } from "@/application/inbox/list-conversations";

const dialect = new PgDialect();

function renderFragment(fragment: unknown) {
  return dialect.sqlToQuery(fragment as Parameters<PgDialect["sqlToQuery"]>[0]);
}

type Chain = {
  from: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

function selectChain(rows: unknown[]): Chain {
  const chain = {} as Chain;
  chain.from = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(rows);
  return chain;
}

function fakeRow(overrides: Partial<{ convId: string; lastMessageAt: Date | null }> = {}) {
  return {
    convId: "conv-1",
    leadId: "lead-1",
    lastMessageAt: new Date("2026-08-01T10:00:00.000Z"),
    needsAttention: false,
    attentionReason: null,
    aiPaused: false,
    conversationCategory: "sales",
    takeoverExpiresAt: null,
    lastReadAt: null,
    leadName: "Fulana",
    leadPhone: "5511999999999",
    leadStatus: "waiting_response",
    leadTemperature: "warm",
    leadTreatmentInterest: null,
    leadProfilePicUrl: null,
    leadUpdatedAt: new Date("2026-08-01T10:00:00.000Z"),
    conversationUpdatedAt: new Date("2026-08-01T10:00:00.000Z"),
    ...overrides,
  };
}

describe("listClinicConversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("orders by lastMessageAt desc nulls last, id desc — matching the Task 2 index column order exactly", async () => {
    const chain = selectChain([]);
    dbMock.select.mockReturnValue(chain);

    await listClinicConversations({ clinicId: "clinic-1" });

    expect(chain.orderBy).toHaveBeenCalledOnce();
    const [firstArg, secondArg] = chain.orderBy.mock.calls[0];
    expect(renderFragment(firstArg).sql).toBe('"conversations"."last_message_at" desc nulls last');
    expect(renderFragment(secondArg).sql).toBe('"conversations"."id" desc');
  });

  it("scopes every query by clinicId, even with no cursor", async () => {
    const chain = selectChain([]);
    dbMock.select.mockReturnValue(chain);

    await listClinicConversations({ clinicId: "clinic-42" });

    expect(chain.where).toHaveBeenCalledOnce();
    const rendered = renderFragment(chain.where.mock.calls[0][0]);
    expect(rendered.sql).toBe('"conversations"."organization_id" = $1');
    expect(rendered.params).toEqual(["clinic-42"]);
  });

  it("requests exactly limit + 1 rows to detect a next page, defaulting to INBOX_PAGE_SIZE", async () => {
    const chain = selectChain([]);
    dbMock.select.mockReturnValue(chain);

    await listClinicConversations({ clinicId: "clinic-1" });

    expect(chain.limit).toHaveBeenCalledWith(INBOX_PAGE_SIZE + 1);
  });

  it("honors an explicit limit override", async () => {
    const chain = selectChain([]);
    dbMock.select.mockReturnValue(chain);

    await listClinicConversations({ clinicId: "clinic-1", limit: 5 });

    expect(chain.limit).toHaveBeenCalledWith(6);
  });

  it("builds a keyset predicate — clinicId AND (older timestamp OR same-timestamp-smaller-id OR any null row) — from a timestamped cursor", async () => {
    const chain = selectChain([]);
    dbMock.select.mockReturnValue(chain);
    const cursorAt = new Date("2026-08-05T09:00:00.000Z");
    const cursor = encodeInboxCursor({ lastMessageAt: cursorAt, id: "cursor-id" });

    await listClinicConversations({ clinicId: "clinic-1", cursor });

    const rendered = renderFragment(chain.where.mock.calls[0][0]);
    expect(rendered.sql).toBe(
      '("conversations"."organization_id" = $1 and ' +
        '("conversations"."last_message_at" < $2 or ' +
        '("conversations"."last_message_at" = $3 and "conversations"."id" < $4) or ' +
        '"conversations"."last_message_at" is null))',
    );
    expect(rendered.params).toEqual(["clinic-1", cursorAt.toISOString(), cursorAt.toISOString(), "cursor-id"]);
  });

  it("builds a null-only keyset predicate — clinicId AND (null row with smaller id) — from a null cursor, once the page has crossed into the NULL tail", async () => {
    const chain = selectChain([]);
    dbMock.select.mockReturnValue(chain);
    const cursor = encodeInboxCursor({ lastMessageAt: null, id: "cursor-id" });

    await listClinicConversations({ clinicId: "clinic-1", cursor });

    const rendered = renderFragment(chain.where.mock.calls[0][0]);
    expect(rendered.sql).toBe(
      '("conversations"."organization_id" = $1 and ' +
        '("conversations"."last_message_at" is null and "conversations"."id" < $2))',
    );
    expect(rendered.params).toEqual(["clinic-1", "cursor-id"]);
  });

  it("applies no keyset predicate — only the clinicId scope — when there is no cursor", async () => {
    const chain = selectChain([]);
    dbMock.select.mockReturnValue(chain);

    await listClinicConversations({ clinicId: "clinic-1" });

    const rendered = renderFragment(chain.where.mock.calls[0][0]);
    expect(rendered.sql).toBe('"conversations"."organization_id" = $1');
    expect(rendered.params).toEqual(["clinic-1"]);
  });

  it("returns all rows and a null nextCursor when the page is not full (last page)", async () => {
    const rows = [fakeRow({ convId: "conv-1" }), fakeRow({ convId: "conv-2" })];
    const chain = selectChain(rows);
    dbMock.select.mockReturnValue(chain);

    const result = await listClinicConversations({ clinicId: "clinic-1", limit: 5 });

    expect(result.rows).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it("slices off the lookahead row and returns a nextCursor built from the last row of the page — timestamp boundary", async () => {
    const rows = [
      fakeRow({ convId: "conv-1", lastMessageAt: new Date("2026-08-03T00:00:00.000Z") }),
      fakeRow({ convId: "conv-2", lastMessageAt: new Date("2026-08-02T00:00:00.000Z") }),
      // linha extra pedida só pra detectar se existe próxima página
      fakeRow({ convId: "conv-3", lastMessageAt: new Date("2026-08-01T00:00:00.000Z") }),
    ];
    const chain = selectChain(rows);
    dbMock.select.mockReturnValue(chain);

    const result = await listClinicConversations({ clinicId: "clinic-1", limit: 2 });

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.convId)).toEqual(["conv-1", "conv-2"]);
    expect(result.nextCursor).not.toBeNull();
    expect(decodeInboxCursor(result.nextCursor)).toEqual({
      lastMessageAt: new Date("2026-08-02T00:00:00.000Z"),
      id: "conv-2",
    });
  });

  it("crosses the NULL boundary correctly: nextCursor carries lastMessageAt: null when the page's last row has no messages yet", async () => {
    const rows = [
      fakeRow({ convId: "conv-1", lastMessageAt: new Date("2026-08-03T00:00:00.000Z") }),
      fakeRow({ convId: "conv-2", lastMessageAt: null }),
      fakeRow({ convId: "conv-3", lastMessageAt: null }),
    ];
    const chain = selectChain(rows);
    dbMock.select.mockReturnValue(chain);

    const result = await listClinicConversations({ clinicId: "clinic-1", limit: 2 });

    expect(result.rows.map((r) => r.convId)).toEqual(["conv-1", "conv-2"]);
    expect(decodeInboxCursor(result.nextCursor)).toEqual({ lastMessageAt: null, id: "conv-2" });
  });

  it("resolving that nextCursor produces the null-only keyset predicate — proving the boundary hand-off between page fetch and next predicate is consistent", async () => {
    const rows = [
      fakeRow({ convId: "conv-1", lastMessageAt: new Date("2026-08-03T00:00:00.000Z") }),
      fakeRow({ convId: "conv-2", lastMessageAt: null }),
      fakeRow({ convId: "conv-3", lastMessageAt: null }),
    ];
    const firstChain = selectChain(rows);
    dbMock.select.mockReturnValueOnce(firstChain);
    const { nextCursor } = await listClinicConversations({ clinicId: "clinic-1", limit: 2 });

    const secondChain = selectChain([]);
    dbMock.select.mockReturnValueOnce(secondChain);
    await listClinicConversations({ clinicId: "clinic-1", cursor: nextCursor, limit: 2 });

    const rendered = renderFragment(secondChain.where.mock.calls[0][0]);
    expect(rendered.sql).toBe(
      '("conversations"."organization_id" = $1 and ' +
        '("conversations"."last_message_at" is null and "conversations"."id" < $2))',
    );
    expect(rendered.params).toEqual(["clinic-1", "conv-2"]);
  });
});
