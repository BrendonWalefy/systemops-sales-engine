import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { INBOX_PAGE_SIZE } from "@/application/inbox/inbox-cursor";
import {
  buildSegmentIndex,
  INBOX_TAB_KEYS,
  resolveActiveInboxTab,
  selectSegmentedConversationIds,
  type SegmentInputRow,
} from "@/application/inbox/inbox-segmentation";

// `db` é mockado: os testes da varredura verificam a *forma* da query (colunas
// selecionadas e escopo por clínica), não o comportamento real do Postgres.
const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  selectDistinctOn: vi.fn(),
}));

vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

import { loadInboxSegmentIndex } from "@/application/inbox/segment-index";

// `now` fixo: hoursWaiting e a expiração de estado/takeover entram nos
// predicados, então o índice precisa ser determinístico no teste.
const NOW = new Date("2026-08-09T12:00:00.000Z");

function minutesBefore(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

function row(overrides: Partial<SegmentInputRow> & { convId: string }): SegmentInputRow {
  return {
    conversationCategory: "sales",
    aiPaused: false,
    needsAttention: false,
    attentionReason: null,
    takeoverExpiresAt: null,
    lastMessageAt: NOW,
    leadStatus: "in_conversation",
    leadTemperature: "warm",
    lastMessageAuthor: "assistant",
    latestAppointmentStatus: null,
    latestAppointmentUpdatedAt: null,
    latestConversationState: null,
    latestStateExpiresAt: null,
    hasPendingHumanReview: false,
    ...overrides,
  };
}

describe("buildSegmentIndex", () => {
  // isRecoveryCandidate compara takeoverExpiresAt com `new Date()` (relógio real),
  // então o relógio do teste precisa ser o mesmo `now` passado ao índice.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mantém em 'attention' uma conversa que precisa de atenção fora das 40 mais recentes", () => {
    // Regressão exata que esta task existe para impedir: com a página limitada
    // a INBOX_PAGE_SIZE, a 50ª conversa mais recente sumia da aba Atenção.
    const rows = Array.from({ length: 50 }, (_, i) =>
      row({
        convId: `conv-${String(i).padStart(2, "0")}`,
        lastMessageAt: minutesBefore(i),
        needsAttention: i === 49,
      }),
    );

    const index = buildSegmentIndex(rows, NOW);

    expect(index.idsByTab.all).toHaveLength(50);
    expect(index.idsByTab.all.indexOf("conv-49")).toBe(49);
    expect(index.idsByTab.all.slice(0, INBOX_PAGE_SIZE)).not.toContain("conv-49");
    expect(index.idsByTab.attention).toEqual(["conv-49"]);
    expect(index.counts.attention).toBe(1);
  });

  it("separa hot e cold por leadTemperature", () => {
    const index = buildSegmentIndex(
      [
        row({ convId: "conv-hot", leadTemperature: "hot", lastMessageAt: minutesBefore(1) }),
        row({ convId: "conv-cold", leadTemperature: "cold", lastMessageAt: minutesBefore(2) }),
        row({ convId: "conv-warm", leadTemperature: "warm", lastMessageAt: minutesBefore(3) }),
      ],
      NOW,
    );

    expect(index.idsByTab.hot).toEqual(["conv-hot"]);
    expect(index.counts.hot).toBe(1);
    expect(index.idsByTab.cold).toEqual(["conv-cold"]);
    expect(index.counts.cold).toBe(1);
    expect(index.idsByTab.all).toEqual(["conv-hot", "conv-cold", "conv-warm"]);
    expect(index.counts.all).toBe(3);
  });

  it("põe em 'recovery' o follow_up_due cuja última mensagem não é do lead", () => {
    const index = buildSegmentIndex(
      [
        row({
          convId: "conv-follow-ia",
          leadStatus: "follow_up_due",
          lastMessageAuthor: "assistant",
          lastMessageAt: minutesBefore(1),
        }),
        row({
          convId: "conv-follow-lead",
          leadStatus: "follow_up_due",
          lastMessageAuthor: "lead",
          lastMessageAt: minutesBefore(2),
        }),
      ],
      NOW,
    );

    expect(index.idsByTab.recovery).toEqual(["conv-follow-ia"]);
    expect(index.counts.recovery).toBe(1);
  });

  it("tira de 'paused' a conversa pausada que já é candidata a recuperação", () => {
    const index = buildSegmentIndex(
      [
        row({
          convId: "conv-pausada",
          aiPaused: true,
          takeoverExpiresAt: new Date(NOW.getTime() + 3_600_000),
          lastMessageAt: minutesBefore(1),
        }),
        row({
          convId: "conv-takeover-expirado",
          aiPaused: true,
          takeoverExpiresAt: minutesBefore(60),
          lastMessageAt: minutesBefore(2),
        }),
      ],
      NOW,
    );

    expect(index.idsByTab.paused).toEqual(["conv-pausada"]);
    expect(index.counts.paused).toBe(1);
    expect(index.idsByTab.recovery).toEqual(["conv-takeover-expirado"]);
    expect(index.counts.recovery).toBe(1);
  });

  it("exclui won e lost de 'all'", () => {
    const index = buildSegmentIndex(
      [
        row({ convId: "conv-won", leadStatus: "won", lastMessageAt: minutesBefore(1) }),
        row({ convId: "conv-lost", leadStatus: "lost", lastMessageAt: minutesBefore(2) }),
        row({ convId: "conv-viva", lastMessageAt: minutesBefore(3) }),
      ],
      NOW,
    );

    expect(index.idsByTab.all).toEqual(["conv-viva"]);
    expect(index.counts.all).toBe(1);
    expect(index.idsByTab.recovery).toEqual([]);
    expect(index.counts.recovery).toBe(0);
  });

  it("usa resolveInboxPendingAction para a aba de pendências", () => {
    const index = buildSegmentIndex(
      [
        row({
          convId: "conv-comprovante",
          latestConversationState: "awaiting_deposit_proof",
          latestStateExpiresAt: new Date(NOW.getTime() + 3_600_000),
          lastMessageAt: minutesBefore(1),
        }),
        row({
          convId: "conv-estado-expirado",
          latestConversationState: "awaiting_deposit_proof",
          latestStateExpiresAt: minutesBefore(60),
          lastMessageAt: minutesBefore(2),
        }),
        row({
          convId: "conv-revisao-doutor",
          hasPendingHumanReview: true,
          lastMessageAt: minutesBefore(3),
        }),
        row({
          convId: "conv-ganha-com-revisao",
          leadStatus: "won",
          hasPendingHumanReview: true,
          lastMessageAt: minutesBefore(4),
        }),
      ],
      NOW,
    );

    expect(index.idsByTab.pending).toEqual(["conv-comprovante", "conv-revisao-doutor"]);
    expect(index.counts.pending).toBe(2);
  });

  it("ignora conversas fora da categoria sales nas abas e as conta por escopo", () => {
    const index = buildSegmentIndex(
      [
        row({ convId: "conv-sales", lastMessageAt: minutesBefore(1) }),
        row({
          convId: "conv-arquivada",
          conversationCategory: "archived",
          needsAttention: true,
          leadTemperature: "hot",
          lastMessageAt: minutesBefore(2),
        }),
        row({
          convId: "conv-spam",
          conversationCategory: "spam",
          lastMessageAt: minutesBefore(3),
        }),
      ],
      NOW,
    );

    expect(index.idsByTab.all).toEqual(["conv-sales"]);
    expect(index.idsByTab.attention).toEqual([]);
    expect(index.idsByTab.hot).toEqual([]);
    expect(index.scopeCounts.archived).toBe(1);
    expect(index.idsByScope.archived).toEqual(["conv-arquivada"]);
    expect(index.scopeCounts.spam).toBe(1);
    expect(index.idsByScope.spam).toEqual(["conv-spam"]);
    expect(index.totalConversations).toBe(3);
  });

  it("conta como ativas apenas handoff + active (sem pausadas)", () => {
    const index = buildSegmentIndex(
      [
        row({ convId: "conv-atencao", needsAttention: true, lastMessageAt: minutesBefore(1) }),
        row({ convId: "conv-ativa", lastMessageAt: minutesBefore(2) }),
        row({
          convId: "conv-pausada",
          aiPaused: true,
          takeoverExpiresAt: new Date(NOW.getTime() + 3_600_000),
          lastMessageAt: minutesBefore(3),
        }),
      ],
      NOW,
    );

    expect(index.activeCount).toBe(2);
    expect(index.counts.all).toBe(3);
    expect(index.counts.paused).toBe(1);
  });

  it("ordena cada aba por lastMessageAt desc com nulls no fim e id desc no empate", () => {
    const tie = minutesBefore(5);
    const index = buildSegmentIndex(
      [
        row({ convId: "conv-sem-mensagem", lastMessageAt: null }),
        row({ convId: "conv-antiga", lastMessageAt: minutesBefore(90) }),
        row({ convId: "conv-empate-a", lastMessageAt: tie }),
        row({ convId: "conv-recente", lastMessageAt: minutesBefore(1) }),
        row({ convId: "conv-empate-b", lastMessageAt: tie }),
      ],
      NOW,
    );

    expect(index.idsByTab.all).toEqual([
      "conv-recente",
      "conv-empate-b",
      "conv-empate-a",
      "conv-antiga",
      "conv-sem-mensagem",
    ]);
  });

  it("mantém counts iguais ao tamanho de idsByTab em todas as abas", () => {
    const index = buildSegmentIndex(
      [
        row({ convId: "conv-1", needsAttention: true, leadTemperature: "hot", lastMessageAt: minutesBefore(1) }),
        row({ convId: "conv-2", leadTemperature: "cold", lastMessageAt: minutesBefore(2) }),
        row({ convId: "conv-3", aiPaused: true, lastMessageAt: minutesBefore(3) }),
        row({ convId: "conv-4", leadStatus: "follow_up_due", lastMessageAt: minutesBefore(4) }),
        row({ convId: "conv-5", hasPendingHumanReview: true, lastMessageAt: minutesBefore(5) }),
        row({ convId: "conv-6", leadStatus: "won", lastMessageAt: minutesBefore(6) }),
        row({ convId: "conv-7", conversationCategory: "operational", lastMessageAt: minutesBefore(7) }),
      ],
      NOW,
    );

    for (const tab of INBOX_TAB_KEYS) {
      expect(index.counts[tab]).toBe(index.idsByTab[tab].length);
    }
    // allLive = handoff(conv-1) + active(conv-2, conv-5) + paused(conv-3).
    // conv-4 é só recuperação, conv-6 é won e conv-7 não é sales.
    expect(index.counts.all).toBe(4);
    expect(index.counts.hot).toBe(1);
    expect(index.counts.cold).toBe(1);
    expect(index.counts.attention).toBe(1);
    expect(index.counts.pending).toBe(1);
    expect(index.counts.paused).toBe(1);
    expect(index.counts.recovery).toBe(1);
  });
});

const dialect = new PgDialect();

type QueryChain = PromiseLike<unknown> & {
  from: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
};

const chains: QueryChain[] = [];

function queryChain(rows: unknown[]): QueryChain {
  const chain = {} as QueryChain;
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.then = ((onFulfilled: never, onRejected: never) =>
    Promise.resolve(rows).then(onFulfilled, onRejected)) as QueryChain["then"];
  chains.push(chain);
  return chain;
}

function renderParams(fragment: unknown): unknown[] {
  return dialect.sqlToQuery(fragment as Parameters<PgDialect["sqlToQuery"]>[0]).params;
}

function selectedPhysicalColumns(columns: unknown): string[] {
  return Object.values(columns as Record<string, { name?: unknown }>)
    .map((column) => (typeof column?.name === "string" ? column.name : ""))
    .filter((name) => name.length > 0);
}

const CLINIC_ID = "00000000-0000-0000-0000-0000000000aa";

// Colunas que carregam payload caro ou PII e que a varredura clinic-wide não
// pode arrastar: nenhum predicado de aba lê qualquer uma delas.
const FORBIDDEN_PHYSICAL_COLUMNS = ["body", "name", "phone", "profile_pic_url", "summary"];

function scanConversationRow(overrides: Record<string, unknown> = {}) {
  return {
    convId: "conv-1",
    leadId: "lead-1",
    conversationCategory: "sales",
    aiPaused: false,
    needsAttention: false,
    attentionReason: null,
    takeoverExpiresAt: null,
    lastMessageAt: NOW,
    leadStatus: "in_conversation",
    leadTemperature: "warm",
    ...overrides,
  };
}

describe("loadInboxSegmentIndex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chains.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function primeScan(options: {
    conversations?: unknown[];
    messages?: unknown[];
    states?: unknown[];
    reviews?: unknown[];
  } = {}) {
    dbMock.select
      .mockReturnValueOnce(queryChain(options.conversations ?? []))
      .mockReturnValueOnce(queryChain(options.reviews ?? []));
    dbMock.selectDistinctOn
      .mockReturnValueOnce(queryChain(options.messages ?? []))
      .mockReturnValueOnce(queryChain([]))
      .mockReturnValueOnce(queryChain([]))
      .mockReturnValueOnce(queryChain(options.states ?? []));
  }

  it("seleciona só as colunas que os predicados leem", async () => {
    primeScan({ conversations: [scanConversationRow()] });

    await loadInboxSegmentIndex({ clinicId: CLINIC_ID, now: NOW });

    expect(Object.keys(dbMock.select.mock.calls[0][0]).sort()).toEqual([
      "aiPaused",
      "attentionReason",
      "convId",
      "conversationCategory",
      "lastMessageAt",
      "leadId",
      "leadStatus",
      "leadTemperature",
      "needsAttention",
      "takeoverExpiresAt",
    ]);
  });

  it("nunca seleciona corpo de mensagem, nome, telefone, foto ou resumo", async () => {
    primeScan({ conversations: [scanConversationRow()] });

    await loadInboxSegmentIndex({ clinicId: CLINIC_ID, now: NOW });

    const selected = [
      ...dbMock.select.mock.calls.map((call) => call[0]),
      ...dbMock.selectDistinctOn.mock.calls.map((call) => call[1]),
    ].flatMap(selectedPhysicalColumns);

    expect(selected.length).toBeGreaterThan(0);
    for (const forbidden of FORBIDDEN_PHYSICAL_COLUMNS) {
      expect(selected).not.toContain(forbidden);
    }
  });

  it("escopa todas as consultas da varredura pela clínica", async () => {
    primeScan({ conversations: [scanConversationRow()] });

    await loadInboxSegmentIndex({ clinicId: CLINIC_ID, now: NOW });

    expect(chains).toHaveLength(6);
    for (const chain of chains) {
      expect(chain.where).toHaveBeenCalledTimes(1);
      expect(renderParams(chain.where.mock.calls[0][0])).toContain(CLINIC_ID);
    }
  });

  it("constrói o índice a partir das linhas varridas", async () => {
    primeScan({
      conversations: [
        scanConversationRow({ convId: "conv-atencao", needsAttention: true }),
        scanConversationRow({
          convId: "conv-follow",
          leadId: "lead-2",
          leadStatus: "follow_up_due",
          lastMessageAt: new Date(NOW.getTime() - 60_000),
        }),
        scanConversationRow({
          convId: "conv-arquivada",
          leadId: "lead-3",
          conversationCategory: "archived",
          lastMessageAt: new Date(NOW.getTime() - 120_000),
        }),
      ],
      messages: [
        { conversationId: "conv-atencao", author: "lead" },
        { conversationId: "conv-follow", author: "assistant" },
      ],
    });

    const index = await loadInboxSegmentIndex({ clinicId: CLINIC_ID, now: NOW });

    expect(index.idsByTab.attention).toEqual(["conv-atencao"]);
    expect(index.idsByTab.recovery).toEqual(["conv-follow"]);
    expect(index.counts.all).toBe(1);
    expect(index.scopeCounts.archived).toBe(1);
    expect(index.idsByScope.archived).toEqual(["conv-arquivada"]);
    expect(index.totalConversations).toBe(3);
  });

  it("sem busca, a varredura base continua com o WHERE de sempre — só clinicId", async () => {
    primeScan({ conversations: [scanConversationRow()] });

    await loadInboxSegmentIndex({ clinicId: CLINIC_ID, now: NOW });

    expect(renderParams(chains[0].where.mock.calls[0][0])).toEqual([CLINIC_ID]);
  });

  it("com busca, filtra a varredura base por nome OU telefone do lead — clínica inteira, não a página", async () => {
    // Fix round 1 — Critical #1: antes desta task, o campo de busca filtrava
    // só as até 40 linhas já carregadas no cliente. Isso prova que o filtro
    // agora entra na consulta que varre a clínica inteira, antes de qualquer
    // corte de página.
    primeScan({ conversations: [scanConversationRow()] });

    await loadInboxSegmentIndex({ clinicId: CLINIC_ID, now: NOW, search: "Ana Silva" });

    const rendered = chains[0].where.mock.calls[0][0];
    expect(renderParams(rendered)).toEqual([CLINIC_ID, "%Ana Silva%", "%Ana Silva%"]);
  });

  it("uma busca que só bate numa conversa fora das 40 mais recentes ainda aparece no índice", async () => {
    // Mesma regressão que a aba "attention" já cobre, agora para busca: o
    // índice não teria como saber disso se a busca filtrasse depois do
    // corte de página em vez de antes da segmentação.
    primeScan({
      conversations: [
        scanConversationRow({ convId: "conv-distante", leadId: "lead-distante" }),
      ],
    });

    const index = await loadInboxSegmentIndex({ clinicId: CLINIC_ID, now: NOW, search: "silva" });

    expect(index.idsByTab.all).toEqual(["conv-distante"]);
  });

  it("busca só com espaços é tratada como ausência de busca", async () => {
    primeScan({ conversations: [scanConversationRow()] });

    await loadInboxSegmentIndex({ clinicId: CLINIC_ID, now: NOW, search: "   " });

    expect(renderParams(chains[0].where.mock.calls[0][0])).toEqual([CLINIC_ID]);
  });
});

describe("resolveActiveInboxTab", () => {
  it("escopo sales preserva a aba pedida", () => {
    expect(resolveActiveInboxTab("sales", "hot")).toBe("hot");
    expect(resolveActiveInboxTab("sales", "recovery")).toBe("recovery");
  });

  it("fora de sales não existe sub-aba: sempre 'all'", () => {
    expect(resolveActiveInboxTab("archived", "hot")).toBe("all");
    expect(resolveActiveInboxTab("operational", "attention")).toBe("all");
  });
});

describe("selectSegmentedConversationIds", () => {
  // Cada chave do fixture tem uma lista DIFERENTE — se o seletor trocar
  // "sales"+aba por idsByScope, ou um escopo por idsByTab, o teste vê uma
  // lista errada em vez de, por coincidência, a mesma lista.
  const index = {
    idsByTab: {
      all: ["all-1"],
      hot: ["hot-1"],
      attention: ["attention-1"],
      pending: ["pending-1"],
      paused: ["paused-1"],
      cold: ["cold-1"],
      recovery: ["recovery-1"],
      closed: [],
    },
    idsByScope: {
      sales: ["scope-sales-1"],
      operational: ["scope-operational-1"],
      vendor: ["scope-vendor-1"],
      spam: ["scope-spam-1"],
      archived: ["scope-archived-1"],
    },
  };

  it("escopo sales lê de idsByTab, na aba pedida", () => {
    expect(selectSegmentedConversationIds(index, "sales", "hot")).toEqual(["hot-1"]);
    expect(selectSegmentedConversationIds(index, "sales", "all")).toEqual(["all-1"]);
  });

  it("escopo não-sales lê de idsByScope, ignorando a aba", () => {
    expect(selectSegmentedConversationIds(index, "archived", "hot")).toEqual(["scope-archived-1"]);
    expect(selectSegmentedConversationIds(index, "operational", "recovery")).toEqual(["scope-operational-1"]);
  });
});
