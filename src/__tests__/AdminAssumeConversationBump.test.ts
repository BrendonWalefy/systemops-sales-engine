// `assumeConversation` escreve `leads.status`, que o Inbox lê para decidir a
// membership das abas (`leadStatus !== "lost" && !== "won"` em segmentRows) e
// para o badge da linha. Mesma classe da varredura de conversas travadas: com
// a versão do Inbox bump-driven, uma escrita sem bump não atrasa, some.

import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

const bumpInboxVersionMock = vi.hoisted(() => vi.fn());
vi.mock("@/application/read-versions/clinic-read-version", () => ({
  bumpInboxVersion: bumpInboxVersionMock,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { assumeConversation } from "@/app/(admin)/inbox/[conversationId]/actions";

function mockUpdateReturning(rows: { clinicId: string }[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  dbMock.update.mockReturnValue({ set });
  return { set, where, returning };
}

describe("assumeConversation (admin) invalidação do Inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bumpa a versão do Inbox da clínica dona do lead escrito", async () => {
    mockUpdateReturning([{ clinicId: "clinic-a" }]);

    await assumeConversation("lead-1", "conv-1");

    expect(bumpInboxVersionMock).toHaveBeenCalledExactlyOnceWith("clinic-a");
  });

  it("não bumpa nada quando o update não atinge lead nenhum", async () => {
    mockUpdateReturning([]);

    await assumeConversation("lead-inexistente", "conv-1");

    expect(bumpInboxVersionMock).not.toHaveBeenCalled();
  });
});
