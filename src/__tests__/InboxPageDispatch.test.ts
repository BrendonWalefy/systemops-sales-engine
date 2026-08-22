// Fix round 2 (Important #5): a "paralelização" da rodada 1 só movia onde o
// query builder do drizzle era CONSTRUÍDO — não onde a requisição HTTP pro
// Neon realmente saía, porque QueryPromise é um thenable preguiçoso
// (drizzle-orm/query-promise.js: `then()` chama `execute()`; construir o
// objeto sozinho não dispara nada). Estes testes rodam prepareInboxPage de
// verdade (com `db`, a varredura de segmentação e a listagem de conversas
// mockados) e observam a ORDEM real de execução — não o formato do código —
// pra provar que a consulta de organizations sai antes do scan resolver.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyInboxSegmentReads,
  type InboxSegmentScan,
} from "@/application/inbox/inbox-segmentation";

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

// measureServerOperation passa direto pro work() — o que importa aqui é a
// ordem real de promises, não a telemetria em volta delas.
vi.mock("@/infrastructure/observability/performance-logger", () => ({
  measureServerOperation: (_input: unknown, work: () => Promise<unknown>) => work(),
}));

// Componentes React não entram no que este arquivo testa (só a ordem de
// dispatch das promises) — mockados pra este teste não precisar de DOM nem
// dos hooks de next/navigation que InboxClient.tsx usa.
vi.mock("@/app/(clinic)/app/inbox/InboxPoller", () => ({ InboxPoller: () => null }));
vi.mock("@/app/(clinic)/app/inbox/InboxClient", () => ({ InboxClient: () => null }));
vi.mock("@/app/(clinic)/app/inbox/TreatmentGapBanner", () => ({ TreatmentGapBanner: () => null }));
vi.mock("@/components/performance/content-ready-reporter", () => ({
  ContentReadyReporter: () => null,
}));

import { prepareInboxPage } from "@/app/(clinic)/app/inbox/page";

function fakeSegmentIndex(): InboxSegmentScan {
  return {
    reads: emptyInboxSegmentReads(),
    counts: { all: 0, hot: 0, attention: 0, pending: 0, paused: 0, cold: 0, recovery: 0, closed: 0 },
    idsByTab: { all: [], hot: [], attention: [], pending: [], paused: [], cold: [], recovery: [], closed: [] },
    scopeCounts: { sales: 0, operational: 0, vendor: 0, spam: 0, archived: 0 },
    idsByScope: { sales: [], operational: [], vendor: [], spam: [], archived: [] },
    activeCount: 0,
    totalConversations: 0,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Reproduz a forma real do QueryPromise do drizzle: só chamar `.execute()`
// (ou `.then()`/`.catch()`, que delegam pra `execute()`) dispara o trabalho —
// construir a cadeia sozinha (`.from().where().limit()`) não faz nada.
function makeOrgChain(outcome: { resolveWith?: unknown[]; rejectWith?: unknown }) {
  const state = { executeCalled: false };
  const settle = () =>
    outcome.rejectWith !== undefined
      ? Promise.reject(outcome.rejectWith)
      : Promise.resolve(outcome.resolveWith ?? []);
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    execute: vi.fn(() => {
      state.executeCalled = true;
      return settle();
    }),
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return chain.execute().then(onFulfilled, onRejected);
    },
    catch(onRejected: (reason: unknown) => unknown) {
      return chain.then((value) => value, onRejected);
    },
  };
  return { chain, state };
}

describe("prepareInboxPage — dispatch da consulta de organizations (Fix round 2, Important #5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInboxVersionMock.mockResolvedValue("v1");
    listClinicConversationsMock.mockResolvedValue({ rows: [], nextCursor: null });
  });

  it("dispara a consulta de organizations ANTES do scan de segmentação resolver — não depois dele", async () => {
    const { chain, state } = makeOrgChain({ resolveWith: [{ autoReplyEnabled: true, updatedAt: new Date() }] });
    dbMock.select.mockReturnValue(chain);

    const segmentDeferred = createDeferred<InboxSegmentScan>();
    loadInboxSegmentIndexMock.mockImplementation(() => segmentDeferred.promise);

    // prepareInboxPage roda de forma síncrona até o primeiro `await` real
    // (o `await measureServerOperation(...)` do scan, que fica pendente
    // porque segurAMOS a resolução dele). Tudo que roda ANTES desse ponto —
    // inclusive a construção e o dispatch de clinicRowsPromise — já
    // aconteceu quando a chamada abaixo retorna o controle pro teste.
    const resultPromise = prepareInboxPage(CLINIC_ID, {});
    resultPromise.catch(() => {});

    // Sem o fix (só construir a query, sem `.execute()`), `execute()` só
    // seria chamado dentro do Promise.all de inbox_base_query — que só roda
    // depois do `await` do scan resolver. Como o scan está deliberadamente
    // pendente aqui, essa asserção reprovaria sem o fix.
    expect(state.executeCalled).toBe(true);
    expect(chain.execute).toHaveBeenCalledTimes(1);

    segmentDeferred.resolve(fakeSegmentIndex());
    await resultPromise;
  });

  it("uma falha na consulta de organizations ainda derruba a página, sem virar unhandled rejection enquanto o scan está pendente", async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const boom = new Error("org lookup failed");
      const { chain, state } = makeOrgChain({ rejectWith: boom });
      dbMock.select.mockReturnValue(chain);

      const segmentDeferred = createDeferred<InboxSegmentScan>();
      loadInboxSegmentIndexMock.mockImplementation(() => segmentDeferred.promise);

      const resultPromise = prepareInboxPage(CLINIC_ID, {});
      // Suprime só a promise externa do teste (o que está sob teste é a
      // interna, clinicRowsPromise, que o fix precisa marcar como tratada
      // por conta própria).
      resultPromise.catch(() => {});

      expect(state.executeCalled).toBe(true);

      // Segura várias voltas do event loop com clinicRowsPromise já
      // rejeitada e o scan ainda pendente — a janela exata em que uma
      // rejeição sem `.catch()` viraria unhandledRejection.
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(unhandled).toEqual([]);

      segmentDeferred.resolve(fakeSegmentIndex());

      await expect(resultPromise).rejects.toThrow("org lookup failed");

      // Mais uma volta depois da rejeição final, pra garantir que o próprio
      // `await` do teste tratando `resultPromise` também não deixou nada
      // escapar.
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});
