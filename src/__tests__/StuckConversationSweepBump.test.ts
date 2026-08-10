// O sweep de conversas travadas escreve `needsAttention`/`attentionReason` —
// duas colunas que o Inbox mostra (badge "Atenção" e a aba homônima). Com a
// versão do Inbox agora BUMP-DRIVEN (Task 6), uma escrita sem bump não é um
// atraso: é obsolescência permanente. Este cron roda a cada 5 minutos em
// produção e é o único produtor daquele badge, então sem bump o operador
// nunca vê a conversa entrar na aba — que é a razão de o cron existir.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

vi.mock("@/app/api/cron/_auth", () => ({
  requireCronAuthorization: vi.fn().mockReturnValue(null),
}));

const bumpInboxVersionMock = vi.hoisted(() => vi.fn());
vi.mock("@/application/read-versions/clinic-read-version", () => ({
  bumpInboxVersion: bumpInboxVersionMock,
}));

const notifyMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/application/use-cases/notifications/notify-clinic-operators", () => ({
  NotifyClinicOperators: class {
    execute = notifyMock;
  },
}));
vi.mock("@/infrastructure/repositories/drizzle-push-subscription-repository", () => ({
  DrizzlePushSubscriptionRepository: class {},
}));
vi.mock("@/infrastructure/adapters/push/web-push-gateway", () => ({
  WebPushGateway: class {},
}));

import { GET } from "@/app/api/cron/stuck-conversation-sweep/route";

type CandidateRow = {
  conversationId: string;
  clinicId: string;
};

// A última mensagem precisa ser do lead e mais velha que o threshold de 3min
// para `findStuckConversationAlerts` (real, não mockado) gerar o alerta.
const STUCK_SENT_AT = new Date(Date.now() - 10 * 60_000);

function mockScan(rows: CandidateRow[]) {
  const conversationRows = rows.map((row) => ({
    conversationId: row.conversationId,
    clinicId: row.clinicId,
    leadName: "Maria",
    leadPhone: "5511999999999",
    autoReplyEnabled: true,
    operationalStatus: "active",
    aiResumedAt: null,
  }));

  let call = 0;
  dbMock.select.mockImplementation(() => {
    const isScan = call === 0;
    call += 1;
    const chain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(),
    };
    if (isScan) {
      chain.where = vi.fn().mockResolvedValue(conversationRows);
    } else {
      chain.where = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockResolvedValue([
        { author: "lead", sentAt: STUCK_SENT_AT, body: "Quanto custa?" },
      ]);
    }
    return chain;
  });

  dbMock.update.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  }));
}

function cronRequest(): NextRequest {
  return new NextRequest("https://systemops.invalid/api/cron/stuck-conversation-sweep");
}

describe("stuck-conversation-sweep invalidação do Inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bumpa a versão do Inbox da clínica cujas conversas foram marcadas como 'Atenção'", async () => {
    mockScan([{ conversationId: "conv-1", clinicId: "clinic-a" }]);

    const response = await GET(cronRequest());
    expect(await response.json()).toEqual({ checked: 1, flagged: 1 });

    expect(bumpInboxVersionMock).toHaveBeenCalledWith("clinic-a");
  });

  it("bumpa uma vez por clínica, não uma vez por conversa marcada", async () => {
    mockScan([
      { conversationId: "conv-1", clinicId: "clinic-a" },
      { conversationId: "conv-2", clinicId: "clinic-a" },
      { conversationId: "conv-3", clinicId: "clinic-a" },
    ]);

    await GET(cronRequest());

    expect(bumpInboxVersionMock).toHaveBeenCalledTimes(1);
    expect(bumpInboxVersionMock).toHaveBeenCalledWith("clinic-a");
  });

  it("bumpa cada clínica afetada quando a varredura cruza várias", async () => {
    mockScan([
      { conversationId: "conv-1", clinicId: "clinic-a" },
      { conversationId: "conv-2", clinicId: "clinic-b" },
    ]);

    await GET(cronRequest());

    expect(bumpInboxVersionMock).toHaveBeenCalledTimes(2);
    expect(bumpInboxVersionMock.mock.calls.map((call) => call[0]).sort()).toEqual([
      "clinic-a",
      "clinic-b",
    ]);
  });

  it("não bumpa clínica nenhuma quando a varredura não marca ninguém", async () => {
    mockScan([]);

    const response = await GET(cronRequest());
    expect(await response.json()).toEqual({ checked: 0, flagged: 0 });

    expect(bumpInboxVersionMock).not.toHaveBeenCalled();
  });
});
