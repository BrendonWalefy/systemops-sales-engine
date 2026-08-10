// Cenário exato da review final: uma clínica com 137 conversas vivas mostrava
// "137" na pilha "Todas", renderizava 40 linhas, e as conversas 41 a 137 não
// tinham NENHUMA rota de acesso — nem "carregar mais", nem gatilho de scroll,
// nem parâmetro de página. Antes desta branch, todas as 137 renderizavam.
//
// A interação que agrava: import-calendar-events.ts cria lead+conversa sem
// mensagem nenhuma, então `lastMessageAt` é null e, sob NULLS LAST, essas
// linhas ordenam POR ÚLTIMO — ou seja, são exatamente as que caíam fora da
// primeira página. Vitalli e Ximendes usam import de calendário.
//
// Este arquivo roda prepareInboxPage de verdade (com o banco, o scan de
// segmentação e a listagem mockados) e observa QUAIS ids foram pedidos à
// leitura cara para cada valor de `page`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxSegmentIndex } from "@/application/inbox/inbox-segmentation";
import { INBOX_PAGE_SIZE } from "@/application/inbox/inbox-cursor";

const CLINIC_ID = "00000000-0000-0000-0000-0000000000aa";

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  selectDistinctOn: vi.fn(),
}));
vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

const loadInboxSegmentIndexMock = vi.hoisted(() => vi.fn());
vi.mock("@/application/inbox/segment-index", () => ({
  loadInboxSegmentIndex: loadInboxSegmentIndexMock,
}));

const listClinicConversationsMock = vi.hoisted(() => vi.fn());
vi.mock("@/application/inbox/list-conversations", () => ({
  listClinicConversations: listClinicConversationsMock,
}));

const getInboxVersionMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/(clinic)/app/inbox/get-inbox-version", () => ({
  getInboxVersion: getInboxVersionMock,
}));

vi.mock("@/infrastructure/observability/performance-logger", () => ({
  measureServerOperation: (_input: unknown, work: () => Promise<unknown>) => work(),
}));

vi.mock("@/app/(clinic)/app/inbox/InboxPoller", () => ({ InboxPoller: () => null }));
vi.mock("@/app/(clinic)/app/inbox/InboxClient", () => ({
  InboxClient: () => null,
}));
vi.mock("@/app/(clinic)/app/inbox/TreatmentGapBanner", () => ({ TreatmentGapBanner: () => null }));
vi.mock("@/components/performance/content-ready-reporter", () => ({
  ContentReadyReporter: () => null,
}));

import { prepareInboxPage } from "@/app/(clinic)/app/inbox/page";
import { InboxClient } from "@/app/(clinic)/app/inbox/InboxClient";
import type { InboxPageWindow } from "@/application/inbox/inbox-page-window";

// prepareInboxPage devolve a árvore de elementos; as props que o servidor
// entrega ao cliente são lidas dessa árvore, não de um render — é exatamente
// o que a página passa adiante.
function inboxClientPropsOf(tree: unknown): Record<string, unknown> {
  const element = tree as { props?: { children?: unknown } };
  const children = element.props?.children;
  const list = Array.isArray(children) ? children : [children];
  const match = list.find(
    (child) => (child as { type?: unknown } | null)?.type === InboxClient,
  ) as { props: Record<string, unknown> } | undefined;
  if (!match) throw new Error("InboxClient não foi renderizado pela página");
  return match.props;
}

function conversationIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `conv-${index + 1}`);
}

function segmentIndexWithLiveConversations(allIds: string[]): InboxSegmentIndex {
  return {
    counts: {
      all: allIds.length,
      hot: 0,
      attention: 0,
      pending: 0,
      paused: 0,
      cold: 0,
      recovery: 0,
    },
    idsByTab: {
      all: allIds,
      hot: [],
      attention: [],
      pending: [],
      paused: [],
      cold: [],
      recovery: [],
    },
    scopeCounts: {
      sales: allIds.length,
      operational: 0,
      vendor: 0,
      spam: 0,
      archived: 0,
    },
    idsByScope: {
      sales: allIds,
      operational: [],
      vendor: [],
      spam: [],
      archived: [],
    },
    activeCount: allIds.length,
    totalConversations: allIds.length,
  };
}

function emptyChain(rows: unknown[] = []) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(rows),
    limit: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(rows),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function requestedIds(): string[] {
  const call = listClinicConversationsMock.mock.calls.at(-1);
  return (call?.[0] as { ids: string[] }).ids;
}

let lastTree: unknown = null;

async function renderPage(params: Record<string, string>): Promise<void> {
  lastTree = await prepareInboxPage(CLINIC_ID, params);
}

function renderedWindow(): InboxPageWindow {
  return inboxClientPropsOf(lastTree).pageWindow as InboxPageWindow;
}

describe("continuação da lista do Inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastTree = null;
    dbMock.select.mockImplementation(() => emptyChain([{ autoReplyEnabled: true, updatedAt: new Date() }]));
    dbMock.selectDistinctOn.mockImplementation(() => emptyChain([]));
    getInboxVersionMock.mockResolvedValue("1");
    listClinicConversationsMock.mockResolvedValue({ rows: [], nextCursor: null });
  });

  it("página 1 pede as 40 primeiras conversas da aba — comportamento de sempre", async () => {
    loadInboxSegmentIndexMock.mockResolvedValue(
      segmentIndexWithLiveConversations(conversationIds(137)),
    );

    await renderPage({});

    expect(requestedIds()).toHaveLength(INBOX_PAGE_SIZE);
    expect(requestedIds()[0]).toBe("conv-1");
    expect(requestedIds().at(-1)).toBe("conv-40");
  });

  it("página 2 pede a conversa 41 em diante — a linha que era inalcançável", async () => {
    loadInboxSegmentIndexMock.mockResolvedValue(
      segmentIndexWithLiveConversations(conversationIds(137)),
    );

    await renderPage({ page: "2" });

    expect(requestedIds()[0]).toBe("conv-41");
    expect(requestedIds()).toHaveLength(INBOX_PAGE_SIZE);
  });

  it("a última página alcança a conversa 137 — nenhuma conversa fica fora de alcance", async () => {
    loadInboxSegmentIndexMock.mockResolvedValue(
      segmentIndexWithLiveConversations(conversationIds(137)),
    );

    await renderPage({ page: "4" });

    expect(requestedIds().at(-1)).toBe("conv-137");
  });

  it("cada passo continua limitado a INBOX_PAGE_SIZE — a continuação não desfaz o bounding", async () => {
    loadInboxSegmentIndexMock.mockResolvedValue(
      segmentIndexWithLiveConversations(conversationIds(500)),
    );

    for (const page of ["1", "2", "7", "13"]) {
      await renderPage({ page });
      expect(requestedIds().length).toBeLessThanOrEqual(INBOX_PAGE_SIZE);
    }
  });

  it("o cliente recebe a janela para renderizar o 'carregar mais'", async () => {
    loadInboxSegmentIndexMock.mockResolvedValue(
      segmentIndexWithLiveConversations(conversationIds(137)),
    );

    await renderPage({ page: "2" });

    expect(renderedWindow()).toEqual(
      expect.objectContaining({
        page: 2,
        pageCount: 4,
        firstIndex: 41,
        lastIndex: 80,
        totalIds: 137,
        hasMore: true,
        hasPrevious: true,
      }),
    );
  });

  it("clínica pequena não ganha rodapé de continuação", async () => {
    loadInboxSegmentIndexMock.mockResolvedValue(
      segmentIndexWithLiveConversations(conversationIds(12)),
    );

    await renderPage({});

    expect(renderedWindow().hasMore).toBe(false);
    expect(renderedWindow().hasPrevious).toBe(false);
  });

  it("a paginação vale por ABA: a página 2 de 'Atenção' é a lista de 'Atenção', não a de 'Todas'", async () => {
    const index = segmentIndexWithLiveConversations(conversationIds(137));
    const attentionIds = Array.from({ length: 60 }, (_, i) => `att-${i + 1}`);
    loadInboxSegmentIndexMock.mockResolvedValue({
      ...index,
      counts: { ...index.counts, attention: attentionIds.length },
      idsByTab: { ...index.idsByTab, attention: attentionIds },
    });

    await renderPage({ filter: "attention", page: "2" });

    expect(requestedIds()[0]).toBe("att-41");
    expect(requestedIds()).toHaveLength(20);
    expect(renderedWindow().totalIds).toBe(60);
  });

  it("uma página além do fim cai na última em vez de renderizar aba vazia", async () => {
    loadInboxSegmentIndexMock.mockResolvedValue(
      segmentIndexWithLiveConversations(conversationIds(137)),
    );

    await renderPage({ page: "99" });

    expect(requestedIds().at(-1)).toBe("conv-137");
    expect(renderedWindow().page).toBe(4);
  });

  it("a busca também pagina, e sobre os resultados dela — não sobre a lista sem busca", async () => {
    const unfiltered = segmentIndexWithLiveConversations(conversationIds(137));
    const matches = Array.from({ length: 90 }, (_, i) => `hit-${i + 1}`);
    loadInboxSegmentIndexMock.mockImplementation(
      async (params: { search?: string }) =>
        params.search
          ? { ...unfiltered, idsByTab: { ...unfiltered.idsByTab, all: matches } }
          : unfiltered,
    );

    await renderPage({ q: "ana", page: "2" });

    expect(requestedIds()[0]).toBe("hit-41");
    expect(renderedWindow().totalIds).toBe(90);
  });
});
