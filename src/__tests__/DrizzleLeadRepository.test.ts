import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "@/domain/entities/lead";

const dbMock = vi.hoisted(() => ({
  query: {
    leads: {
      findFirst: vi.fn(),
    },
  },
  update: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

// A leitura materializada (Task 5/6) é um efeito colateral best-effort do
// write, não a coisa sendo testada aqui — mockado para isolar o
// comportamento de upsert de lead do restante da suíte. A propriedade "uma
// falha no bump não derruba a escrita" é garantida estruturalmente por
// bumpInboxVersion ser void (não uma Promise) — coberta uma vez em
// ClinicReadVersion.test.ts, não repetida em cada repositório chamador.
const bumpInboxVersionMock = vi.hoisted(() => vi.fn());
vi.mock("@/application/read-versions/clinic-read-version", () => ({
  bumpInboxVersion: bumpInboxVersionMock,
}));

import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";

function lead(overrides: Partial<Lead> = {}): Lead {
  const now = new Date("2026-07-18T00:00:00.000Z");
  return {
    id: "lead-1",
    clinicId: "clinic-1",
    name: "Pamela",
    phone: "5511999999999",
    whatsappLid: "123456789@lid",
    email: null,
    channel: "whatsapp",
    campaignId: null,
    treatmentInterest: null,
    profilePicUrl: null,
    status: "waiting_response",
    temperature: "warm",
    assignedToUserId: null,
    nextActionAt: null,
    lostReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function updateChain() {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
}

describe("DrizzleLeadRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("atualiza o lead encontrado por LID quando o webhook traz telefone novo e LID existente", async () => {
    const existingByLid = lead({
      id: "lead-by-lid",
      phone: null,
      whatsappLid: "123456789@lid",
    });
    const update = updateChain();
    dbMock.query.leads.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingByLid);
    dbMock.update.mockReturnValue(update);

    await new DrizzleLeadRepository().save(lead({ id: "incoming-lead" }));

    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(dbMock.update).toHaveBeenCalledOnce();
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "5511999999999",
        whatsappLid: "123456789@lid",
        status: "waiting_response",
      }),
    );
  });

  it("caso Américo: o lead recebido JÁ carrega o id existente — atualiza, nunca insere", async () => {
    // Bug real (Ximendes, 22/07): o resolvedor enriquece o lead existente e reusa o
    // id dele, então lead.id === byLid.id. O guard antigo `byLid.id !== lead.id`
    // pulava o update e caía num insert que colidia no PK/índice do @lid → o job
    // message.process morria e a mensagem do lead (pergunta quente) sumia.
    const existingByLid = lead({
      id: "amrico",
      phone: null,
      whatsappLid: "257547881697439@lid",
    });
    const update = updateChain();
    dbMock.query.leads.findFirst
      .mockResolvedValueOnce(null) // byPhone: ninguém com esse telefone ainda
      .mockResolvedValueOnce(existingByLid); // byLid: o lead só-LID já existe
    dbMock.update.mockReturnValue(update);

    // Mesmo id do lead existente — o cenário que o teste anterior não cobria.
    await new DrizzleLeadRepository().save(
      lead({ id: "amrico", phone: "5511976898360", whatsappLid: "257547881697439@lid" }),
    );

    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(dbMock.update).toHaveBeenCalledOnce();
    expect(update.set).toHaveBeenCalledWith(expect.objectContaining({ phone: "5511976898360" }));
  });

  it("lead genuinamente novo é inserido", async () => {
    dbMock.query.leads.findFirst
      .mockResolvedValueOnce(null) // byPhone
      .mockResolvedValueOnce(null); // byLid
    const insertChain = { values: vi.fn().mockReturnThis(), onConflictDoUpdate: vi.fn().mockResolvedValue([]) };
    dbMock.insert.mockReturnValue(insertChain);

    await new DrizzleLeadRepository().save(lead({ id: "novo", phone: "5511900000000" }));

    expect(dbMock.insert).toHaveBeenCalledOnce();
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("marca a versão da inbox da clínica após salvar o lead", async () => {
    const existingByLid = lead({ id: "lead-by-lid", phone: null, whatsappLid: "123456789@lid" });
    const update = updateChain();
    dbMock.query.leads.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(existingByLid);
    dbMock.update.mockReturnValue(update);

    await new DrizzleLeadRepository().save(lead({ id: "incoming-lead", clinicId: "clinic-42" }));

    expect(bumpInboxVersionMock).toHaveBeenCalledWith("clinic-42");
  });
});
