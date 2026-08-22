// A latência do Inbox não é dominada pelo custo das consultas — é dominada
// pela PROFUNDIDADE da fila delas. A função serverless roda em `iad1` e o
// Postgres em `aws-sa-east-1`; medido em 22/08/2026 contra produção, cada ida
// e volta ao banco custa ~131 ms de rede (p50 de `/api/health`, 2 rodadas,
// 444 ms, contra 182 ms de uma rota da mesma origem que não toca no banco).
// Uma leitura a mais na MESMA rodada é ~0 ms; uma rodada a mais é ~131 ms.
//
// Por isso estes testes olham QUANDO cada consulta é disparada, não quantas
// são nem que forma têm. Uma consulta que só é construída depois de um `await`
// em outra que não a alimenta é uma regressão de UX mesmo quando o SQL fica
// idêntico — e é invisível para todo teste que só verifica o resultado.

import { beforeEach, describe, expect, it, vi } from "vitest";

const CLINIC_ID = "00000000-0000-0000-0000-0000000000aa";
const CONVERSATION_ID = "11111111-1111-1111-1111-111111111111";
const LEAD_ID = "22222222-2222-2222-2222-222222222222";

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  selectDistinctOn: vi.fn(),
}));
vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

vi.mock("@/infrastructure/observability/performance-logger", () => ({
  measureServerOperation: (_input: unknown, work: () => Promise<unknown>) => work(),
}));

/**
 * Barreira de dispatch: toda consulta registra que saiu e fica pendente até
 * `releaseAll()`. Se o código estiver em fila, só a primeira sai — e a
 * asserção falha com um número, não com um timeout.
 */
function createQueryBarrier() {
  const dispatched: string[] = [];
  const releases: Array<() => void> = [];

  function chainFor(label: string, rows: unknown[]) {
    const settle = () =>
      new Promise<unknown[]>((resolve) => {
        dispatched.push(label);
        releases.push(() => resolve(rows));
      });
    let pending: Promise<unknown[]> | null = null;
    const execute = () => (pending ??= settle());
    const chain: Record<string, unknown> = {
      execute,
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        execute().then(onFulfilled, onRejected),
      catch: (onRejected: (reason: unknown) => unknown) => execute().catch(onRejected),
    };
    for (const method of ["from", "innerJoin", "where", "orderBy", "limit", "groupBy"]) {
      chain[method] = vi.fn(() => chain);
    }
    return chain;
  }

  return {
    dispatched,
    chainFor,
    releaseAll: () => {
      for (const release of releases.splice(0)) release();
    },
    /** Deixa a fila de microtasks drenar sem resolver consulta nenhuma. */
    settleMicrotasks: async () => {
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    },
  };
}

describe("loadInboxSegmentIndex — profundidade da varredura", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispara as seis leituras clinic-wide na MESMA rodada", async () => {
    const barrier = createQueryBarrier();
    dbMock.select
      .mockReturnValueOnce(barrier.chainFor("conversations", []))
      .mockReturnValueOnce(barrier.chainFor("humanReviewRequests", []));
    dbMock.selectDistinctOn
      .mockReturnValueOnce(barrier.chainFor("messages", []))
      .mockReturnValueOnce(barrier.chainFor("appointments.upcoming", []))
      .mockReturnValueOnce(barrier.chainFor("appointments.outcome", []))
      .mockReturnValueOnce(barrier.chainFor("conversationStates", []));

    const { loadInboxSegmentIndex } = await import("@/application/inbox/segment-index");
    const pending = loadInboxSegmentIndex({ clinicId: CLINIC_ID, now: new Date() });
    await barrier.settleMicrotasks();

    // Nenhuma consulta respondeu ainda. Se o enriquecimento dependesse da
    // varredura de conversas, aqui haveria exatamente 1.
    expect(barrier.dispatched.sort()).toEqual([
      "appointments.outcome",
      "appointments.upcoming",
      "conversationStates",
      "conversations",
      "humanReviewRequests",
      "messages",
    ]);

    barrier.releaseAll();
    await pending;
  });
});

describe("página da conversa — profundidade da leitura", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("dispara lead, mensagens, agendamento, clínica e estado do sinal na MESMA rodada", async () => {
    const barrier = createQueryBarrier();

    const listConversationMessagesMock = vi.fn(async () => {
      barrier.dispatched.push("messages");
      await new Promise<void>((resolve) => barrier.dispatched.length && resolve());
      return { messages: [], hasMore: false };
    });
    vi.doMock("@/application/inbox/list-messages", () => ({
      listConversationMessages: listConversationMessagesMock,
      CONVERSATION_PAGE_SIZE: 60,
    }));
    vi.doMock("@/application/messaging/attach-inbox-previews", () => ({
      attachInboxPreviews: async (rows: unknown[]) => rows,
    }));
    vi.doMock("@/core/conversation/ConversationStateMachine", () => ({
      ConversationStateMachine: class {
        async getDepositState() {
          barrier.dispatched.push("depositState");
          return null;
        }
      },
    }));

    const conversationRow = {
      id: CONVERSATION_ID,
      clinicId: CLINIC_ID,
      leadId: LEAD_ID,
      category: "sales",
      aiPaused: false,
      takeoverExpiresAt: null,
      lastReadAt: null,
    };

    dbMock.select
      // 1) a conversa — é dela que saem clinicId e leadId
      .mockReturnValueOnce(barrier.chainFor("conversation", [conversationRow]))
      .mockReturnValueOnce(barrier.chainFor("lead", [{ id: LEAD_ID, name: "Lead", phone: "1" }]))
      .mockReturnValueOnce(barrier.chainFor("appointment", []))
      .mockReturnValueOnce(barrier.chainFor("clinic", [{ timezone: "America/Sao_Paulo" }]));

    const page = await import("@/app/(clinic)/app/inbox/[conversationId]/page");
    const pending = page.default({ params: Promise.resolve({ conversationId: CONVERSATION_ID }) });

    await barrier.settleMicrotasks();
    expect(barrier.dispatched).toEqual(["conversation"]);

    barrier.releaseAll();
    await barrier.settleMicrotasks();

    // Tudo que só depende de `conv` saiu junto. Em fila, aqui haveria uma
    // consulta só — e a página pagaria cinco RTT em vez de um.
    expect([...barrier.dispatched].sort()).toEqual([
      "appointment",
      "clinic",
      "conversation",
      "depositState",
      "lead",
      "messages",
    ]);

    barrier.releaseAll();
    await pending.catch(() => {
      // O render React em si não é o objeto deste teste.
    });
  });
});
