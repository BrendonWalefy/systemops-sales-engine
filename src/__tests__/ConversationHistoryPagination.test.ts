import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

// `db` é mockado abaixo, então listConversationMessages nunca toca em um banco
// real. Os testes aqui verificam a *forma* da query que ele monta — SQL
// (where/orderBy/limit) renderizado via PgDialect sem conexão — e o
// comportamento de paginação sobre linhas fake devolvidas pelo mock, não o
// comportamento real do Postgres (índice usado, plano de execução).

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

import { CONVERSATION_PAGE_SIZE, listConversationMessages } from "@/application/inbox/list-messages";

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

function fakeRow(id: string, sentAt: string) {
  return {
    id,
    conversationId: "conv-1",
    author: "lead",
    body: `msg ${id}`,
    mediaUrl: null,
    mediaType: null,
    sentAt: new Date(sentAt),
    externalId: null,
    intent: null,
    deliveryFormat: null,
    simulated: false,
    createdAt: new Date(sentAt),
  };
}

describe("conversation history pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the 60-message initial window from the spec", () => {
    expect(CONVERSATION_PAGE_SIZE).toBe(60);
  });

  it("scopes the query by clinicId through the conversations join, not by conversationId alone", async () => {
    const chain = selectChain([]);
    dbMock.select.mockReturnValue(chain);

    await listConversationMessages({ conversationId: "conv-1", clinicId: "clinic-42" });

    expect(chain.innerJoin).toHaveBeenCalledOnce();
    expect(chain.where).toHaveBeenCalledOnce();
    const rendered = renderFragment(chain.where.mock.calls[0][0]);
    expect(rendered.sql).toBe(
      '("conversations"."organization_id" = $1 and "messages"."conversation_id" = $2)',
    );
    expect(rendered.params).toEqual(["clinic-42", "conv-1"]);
  });

  it("does not leak another clinic's messages: a conversationId that resolves under a different clinicId still filters on both columns", async () => {
    // A prova de que o isolamento é real (e não decorativo) está no SQL
    // acima: mesmo que conversationId já identifique a conversa de forma
    // única, o predicado sempre inclui clinicId — não há caminho de query
    // que devolva linhas de outra clínica.
    const chain = selectChain([]);
    dbMock.select.mockReturnValue(chain);

    await listConversationMessages({ conversationId: "conv-1", clinicId: "clinic-a" });
    const renderedA = renderFragment(chain.where.mock.calls[0][0]);

    vi.clearAllMocks();
    const chain2 = selectChain([]);
    dbMock.select.mockReturnValue(chain2);
    await listConversationMessages({ conversationId: "conv-1", clinicId: "clinic-b" });
    const renderedB = renderFragment(chain2.where.mock.calls[0][0]);

    expect(renderedA.params).toEqual(["clinic-a", "conv-1"]);
    expect(renderedB.params).toEqual(["clinic-b", "conv-1"]);
    expect(renderedA.params).not.toEqual(renderedB.params);
  });

  it("orders by sentAt desc, id desc — newest first, to find the reverse-pagination cut", async () => {
    const chain = selectChain([]);
    dbMock.select.mockReturnValue(chain);

    await listConversationMessages({ conversationId: "conv-1", clinicId: "clinic-1" });

    expect(chain.orderBy).toHaveBeenCalledOnce();
    const [firstArg, secondArg] = chain.orderBy.mock.calls[0];
    expect(renderFragment(firstArg).sql).toBe('"messages"."sent_at" desc');
    expect(renderFragment(secondArg).sql).toBe('"messages"."id" desc');
  });

  it("requests CONVERSATION_PAGE_SIZE + 1 rows (61), not 60, to detect hasMore without a second query", async () => {
    const chain = selectChain([]);
    dbMock.select.mockReturnValue(chain);

    await listConversationMessages({ conversationId: "conv-1", clinicId: "clinic-1" });

    expect(chain.limit).toHaveBeenCalledWith(61);
  });

  it("returns hasMore: false and the full page in chronological order when there is no 61st row", async () => {
    // O mock devolve as linhas já na ordem desc(sentAt) que o orderBy pediria
    // de um banco real — id-1 é a mais nova, id-3 a mais velha.
    const rows = [
      fakeRow("id-1", "2026-08-03T00:00:00.000Z"),
      fakeRow("id-2", "2026-08-02T00:00:00.000Z"),
      fakeRow("id-3", "2026-08-01T00:00:00.000Z"),
    ];
    const chain = selectChain(rows);
    dbMock.select.mockReturnValue(chain);

    const result = await listConversationMessages({ conversationId: "conv-1", clinicId: "clinic-1" });

    expect(result.hasMore).toBe(false);
    expect(result.messages.map((m) => m.id)).toEqual(["id-3", "id-2", "id-1"]);
  });

  it("selects the newest CONVERSATION_PAGE_SIZE+1 but returns only the newest 60, oldest-first, with hasMore true when the 61st row exists", async () => {
    // Simula 61 linhas devolvidas pelo banco em desc(sentAt): a mais nova é
    // "id-000", a mais velha (linha de sentinela só para detectar hasMore) é
    // "id-060" — ela NÃO deve aparecer no resultado.
    const rows = Array.from({ length: 61 }, (_, i) => {
      const idx = String(i).padStart(3, "0");
      const day = 61 - i; // linha 0 (mais nova) = dia 61, linha 60 (mais velha) = dia 1
      return fakeRow(`id-${idx}`, `2026-06-${String(day).padStart(2, "0")}T00:00:00.000Z`);
    });
    const chain = selectChain(rows);
    dbMock.select.mockReturnValue(chain);

    const result = await listConversationMessages({ conversationId: "conv-1", clinicId: "clinic-1" });

    expect(result.hasMore).toBe(true);
    expect(result.messages).toHaveLength(60);
    // A sentinela (a mais velha, linha 60 do array desc) foi cortada.
    expect(result.messages.some((m) => m.id === "id-060")).toBe(false);
    // A mais nova selecionada (id-000) é o último elemento — cronológico.
    expect(result.messages.at(-1)?.id).toBe("id-000");
    // A mais velha mantida (id-059) é o primeiro elemento.
    expect(result.messages[0]?.id).toBe("id-059");
    // Ordem estritamente cronológica: sentAt crescente ao longo do array.
    const timestamps = result.messages.map((m) => m.sentAt.getTime());
    const sorted = [...timestamps].sort((a, b) => a - b);
    expect(timestamps).toEqual(sorted);
  });

  it("narrows to an older keyset when `before` is given — strictly older sentAt, or same sentAt with a smaller id", async () => {
    const chain = selectChain([]);
    dbMock.select.mockReturnValue(chain);
    const beforeAt = new Date("2026-08-05T09:00:00.000Z");

    await listConversationMessages({
      conversationId: "conv-1",
      clinicId: "clinic-1",
      before: { sentAt: beforeAt, id: "cursor-id" },
    });

    const rendered = renderFragment(chain.where.mock.calls[0][0]);
    expect(rendered.sql).toBe(
      '("conversations"."organization_id" = $1 and "messages"."conversation_id" = $2 and ' +
        '("messages"."sent_at" < $3 or ("messages"."sent_at" = $4 and "messages"."id" < $5)))',
    );
    expect(rendered.params).toEqual(["clinic-1", "conv-1", beforeAt.toISOString(), beforeAt.toISOString(), "cursor-id"]);
  });
});
