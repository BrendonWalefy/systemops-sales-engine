// Estas são Server Actions ("use server"): o id da conversa chega do cliente
// e é confiável apenas na medida em que o servidor o valide. Sem o predicado
// de clínica no WHERE, um operador da clínica A pode passar o id de uma
// conversa da clínica B e pausar a IA dela — e, de quebra, invalidar o Inbox
// da B (bump cross-tenant). Os irmãos no mesmo arquivo
// (setConversationCategoryBulk, deleteConversationsBulk) já escopam por
// requireSessionClinicId(); estes quatro não escapavam.
//
// O teste renderiza o WHERE real via PgDialect (sem banco) e checa que o
// predicado de clínica está lá com o id da SESSÃO — não com o do cliente — e
// que um alvo de outra clínica não escreve nem invalida nada.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const SESSION_CLINIC = "00000000-0000-0000-0000-00000000aaaa";
const OTHER_CLINIC = "00000000-0000-0000-0000-00000000bbbb";
const OTHER_CLINIC_CONVERSATION = "11111111-1111-1111-1111-111111111111";

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

const requireSessionClinicIdMock = vi.hoisted(() => vi.fn());
vi.mock("@/application/tenancy/resolve-clinic", () => ({
  requireSessionClinicId: requireSessionClinicIdMock,
}));

const bumpInboxVersionMock = vi.hoisted(() => vi.fn());
vi.mock("@/application/read-versions/clinic-read-version", () => ({
  bumpInboxVersion: bumpInboxVersionMock,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  clearAttention,
  pauseAi,
  resumeAi,
  setConversationCategory,
} from "@/app/(clinic)/app/inbox/[conversationId]/actions";

const dialect = new PgDialect();

function renderFragment(fragment: unknown) {
  return dialect.sqlToQuery(fragment as Parameters<PgDialect["sqlToQuery"]>[0]);
}

// Cada `db.update(...)` devolve uma cadeia nova e registra o WHERE que
// recebeu, para o teste inspecionar depois qual predicado foi realmente
// enviado. `rowsPerUpdate` decide quantas linhas cada update "atinge".
function mockUpdates(rowsPerUpdate: unknown[][]) {
  const whereFragments: unknown[] = [];
  let index = 0;

  dbMock.update.mockImplementation(() => {
    const rows = rowsPerUpdate[index] ?? [];
    index += 1;
    const chain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation((fragment: unknown) => {
        whereFragments.push(fragment);
        return {
          ...chain,
          returning: vi.fn().mockResolvedValue(rows),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
        };
      }),
      returning: vi.fn().mockResolvedValue(rows),
    };
    return chain;
  });

  return whereFragments;
}

function expectScopedBySessionClinic(fragment: unknown, table: string) {
  const rendered = renderFragment(fragment);
  expect(rendered.sql).toContain(`"${table}"."organization_id" = $`);
  expect(rendered.params).toContain(SESSION_CLINIC);
}

describe("Server Actions do Inbox — escopo de tenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionClinicIdMock.mockResolvedValue(SESSION_CLINIC);
  });

  it("pauseAi escopa a conversa E o lead pela clínica da sessão", async () => {
    const wheres = mockUpdates([[{ clinicId: SESSION_CLINIC }], [{ clinicId: SESSION_CLINIC }]]);

    await pauseAi("conv-1", "lead-1");

    expect(wheres).toHaveLength(2);
    expectScopedBySessionClinic(wheres[0], "conversations");
    expectScopedBySessionClinic(wheres[1], "leads");
  });

  it("resumeAi escopa pela clínica da sessão", async () => {
    const wheres = mockUpdates([[{ clinicId: SESSION_CLINIC }]]);

    await resumeAi("conv-1");

    expect(wheres).toHaveLength(1);
    expectScopedBySessionClinic(wheres[0], "conversations");
  });

  it("clearAttention escopa pela clínica da sessão", async () => {
    const wheres = mockUpdates([[{ clinicId: SESSION_CLINIC }]]);

    await clearAttention("conv-1");

    expect(wheres).toHaveLength(1);
    expectScopedBySessionClinic(wheres[0], "conversations");
  });

  it("setConversationCategory escopa pela clínica da sessão", async () => {
    const wheres = mockUpdates([[{ clinicId: SESSION_CLINIC }]]);

    await setConversationCategory("conv-1", "archived");

    expect(wheres).toHaveLength(1);
    expectScopedBySessionClinic(wheres[0], "conversations");
  });

  it("uma conversa de outra clínica não é escrita nem invalida o Inbox dela", async () => {
    // Este mock SIMULA o Postgres em vez de devolver [] de graça: a linha
    // alvo pertence a OTHER_CLINIC, então ela só "casa" se o WHERE enviado
    // NÃO tiver o predicado da clínica da sessão. Com o bug (WHERE só por
    // id) o update atinge a linha, `returning()` devolve OTHER_CLINIC e o
    // bump dispara na clínica alheia — o teste falha. Com o predicado, o
    // update não atinge nada.
    const targetRow = { clinicId: OTHER_CLINIC, id: OTHER_CLINIC_CONVERSATION };

    const matchesSessionScope = (fragment: unknown) =>
      !renderFragment(fragment).params.includes(SESSION_CLINIC);

    dbMock.update.mockImplementation(() => {
      const chain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation((fragment: unknown) => {
          const rows = matchesSessionScope(fragment) ? [targetRow] : [];
          return {
            returning: vi.fn().mockResolvedValue(rows),
            then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
          };
        }),
      };
      return chain;
    });
    dbMock.select.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([targetRow]),
    });

    await pauseAi(OTHER_CLINIC_CONVERSATION, "lead-de-outra-clinica");
    await resumeAi(OTHER_CLINIC_CONVERSATION);
    await clearAttention(OTHER_CLINIC_CONVERSATION);
    await setConversationCategory(OTHER_CLINIC_CONVERSATION, "spam").catch(() => {});

    expect(bumpInboxVersionMock).not.toHaveBeenCalled();
  });
});
