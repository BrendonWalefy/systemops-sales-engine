// A página da conversa (server component) recebe o UUID pela URL. Sem
// predicado de clínica na leitura, qualquer usuário autenticado que conheça
// (ou adivinhe) um UUID de outro tenant baixa a conversa inteira — nome,
// telefone e histórico do lead. As Server Actions irmãs em ./actions.ts já
// escopam por requireSessionClinicId(); o caminho de leitura precisa vir pro
// mesmo padrão. Este teste renderiza o componente com o `db`/tenancy
// mockados e observa (a) que a página consulta a clínica da sessão (o helper
// existente), e (b) que uma conversa de outro tenant termina em notFound()
// — indistinguível de UUID inexistente.

import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_CLINIC = "00000000-0000-0000-0000-00000000aaaa";
const OTHER_CLINIC = "00000000-0000-0000-0000-00000000bbbb";
const CONVERSATION_ID = "11111111-1111-1111-1111-111111111111";
const LEAD_ID = "22222222-2222-2222-2222-222222222222";

// notFound() em Next.js lança para interromper a renderização. Um sentinela
// próprio impede que uma exceção downstream (ex.: JSX quebrado num mock)
// seja confundida com "denied".
const NOT_FOUND_SENTINEL = "__CONV_PAGE_NOT_FOUND__";
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("__CONV_PAGE_NOT_FOUND__");
  }),
);
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));

const dbMock = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

const requireSessionClinicIdMock = vi.hoisted(() => vi.fn());
vi.mock("@/application/tenancy/resolve-clinic", () => ({
  requireSessionClinicId: requireSessionClinicIdMock,
}));

vi.mock("@/infrastructure/observability/performance-logger", () => ({
  measureServerOperation: (_input: unknown, work: () => Promise<unknown>) => work(),
}));

vi.mock("@/application/messaging/attach-inbox-previews", () => ({
  attachInboxPreviews: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/application/inbox/list-messages", () => ({
  listConversationMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
}));

vi.mock("@/core/conversation/ConversationStateMachine", () => ({
  ConversationStateMachine: class {
    async getDepositState() {
      return null;
    }
  },
}));

import ConversationPage from "@/app/(clinic)/app/inbox/[conversationId]/page";

type SelectRows = unknown[];

// Cada `db.select()` devolve uma cadeia nova; o teste alimenta rowsPerCall na
// ordem em que a página consulta (conversations, leads, appointments,
// organizations). O primeiro item já basta pra provar a guarda.
function mockSelects(rowsPerCall: SelectRows[]) {
  let i = 0;
  dbMock.select.mockImplementation(() => {
    const rows = rowsPerCall[i] ?? [];
    i += 1;
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve(rows)),
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(rows).then(resolve, reject),
    });
    return chain;
  });
}

function convRow(clinicId: string) {
  return {
    id: CONVERSATION_ID,
    clinicId,
    leadId: LEAD_ID,
    channel: "whatsapp",
    category: "sales",
    externalThreadId: null,
    summary: null,
    aiPaused: false,
    takeoverExpiresAt: null,
    needsAttention: false,
    attentionReason: null,
    consecutiveUnclearCount: 0,
    processingUntil: null,
    nextOutboundSequence: 0,
    lastMessageAt: null,
    lastReadAt: null,
    aiResumedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function leadRow() {
  return {
    id: LEAD_ID,
    clinicId: SESSION_CLINIC,
    name: "Paciente",
    phone: "+5511900000000",
    profilePicUrl: null,
    temperature: "hot",
    status: "in_conversation",
    channel: "whatsapp",
    treatmentInterest: null,
    createdAt: new Date(),
  };
}

function clinicRow() {
  return {
    timezone: "America/Sao_Paulo",
    defaultAppointmentDurationMinutes: 60,
    autoReplyEnabled: true,
  };
}

async function callPage() {
  return ConversationPage({
    params: Promise.resolve({ conversationId: CONVERSATION_ID }),
  });
}

describe("Página da conversa — escopo de tenant na leitura", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionClinicIdMock.mockResolvedValue(SESSION_CLINIC);
  });

  it("UUID de outra clínica termina em notFound() — mesma resposta de UUID inexistente", async () => {
    mockSelects([[convRow(OTHER_CLINIC)]]);

    const err = await callPage().then(
      () => null,
      (e: Error) => e,
    );

    expect(err).not.toBeNull();
    expect(err?.message).toBe(NOT_FOUND_SENTINEL);
    expect(notFoundMock).toHaveBeenCalled();
    expect(requireSessionClinicIdMock).toHaveBeenCalled();
  });

  it("clinic_admin abrindo conversa da própria clínica: guarda passa (usa requireSessionClinicId, não chama notFound)", async () => {
    // Alimenta as leituras downstream em ordem: conv, lead, appointment, clinic.
    mockSelects([[convRow(SESSION_CLINIC)], [leadRow()], [], [clinicRow()]]);

    // A renderização do JSX pode explodir por mocks minimalistas — o que
    // importa aqui é a guarda: notFound NÃO deve ter sido chamado e o helper
    // de tenancy SIM.
    await callPage().catch(() => {});

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(requireSessionClinicIdMock).toHaveBeenCalled();
  });

  it("owner com sops_active_clinic apontando pra clínica X abre conversas de X (helper resolve, página confia)", async () => {
    // Owner com clínica ativa selecionada: requireSessionClinicId() devolve o
    // id da clínica escolhida via cookie. A página não replica essa lógica —
    // ela consulta o helper. Simulamos aqui devolvendo OTHER_CLINIC como
    // "clínica ativa do owner"; a conversa também está em OTHER_CLINIC.
    requireSessionClinicIdMock.mockResolvedValue(OTHER_CLINIC);
    mockSelects([[convRow(OTHER_CLINIC)], [leadRow()], [], [clinicRow()]]);

    await callPage().catch(() => {});

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(requireSessionClinicIdMock).toHaveBeenCalled();
  });
});
