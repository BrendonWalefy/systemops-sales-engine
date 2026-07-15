/**
 * Testes do builder de trechos da Revisão de Conversas pelo Cliente
 * (docs/product/revisao-conversas-plano.md, seções 7 e 8 — PR 1).
 *
 * Cobertura exigida pelo plano: conversa de outra clínica → erro;
 * anonimização aplicada no snapshot; roles mapeados; `system` descartada;
 * mídia vira placeholder (Apêndice C); ordem por sentAt; limites do
 * Apêndice H respeitados.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { select: vi.fn() },
}));

vi.mock("@/infrastructure/db/client", () => ({ db: mocks.db }));

import {
  assembleExcerpt,
  buildExcerpt,
  type ExcerptSourceMessage,
} from "@/application/conversation-review/build-excerpt";

/** Linha crua de mensagem com defaults de texto simples. */
function row(overrides: Partial<ExcerptSourceMessage> & { id: string }): ExcerptSourceMessage {
  return {
    author: "lead",
    body: "Olá, tudo bem?",
    mediaType: null,
    deliveryFormat: null,
    sentAt: new Date("2026-07-10T12:00:00Z"),
    ...overrides,
  };
}

/** Mock do lookup de conversa (select → from → innerJoin → where → limit). */
function mockConversationLookup(result: Array<{ id: string; leadName: string | null }>) {
  mocks.db.select.mockReturnValueOnce({
    from: () => ({
      innerJoin: () => ({
        where: () => ({ limit: async () => result }),
      }),
    }),
  });
}

/** Mock do lookup de mensagens (select → from → where → orderBy). */
function mockMessagesLookup(result: ExcerptSourceMessage[]) {
  mocks.db.select.mockReturnValueOnce({
    from: () => ({
      where: () => ({ orderBy: async () => result }),
    }),
  });
}

describe("buildExcerpt (guarda de tenant)", () => {
  beforeEach(() => {
    mocks.db.select.mockReset();
  });

  it("conversa de outra clínica (ou inexistente) → erro, nunca vazamento", async () => {
    // WHERE (id, organizationId) não encontra nada → a conversa não é desta clínica.
    mockConversationLookup([]);

    await expect(
      buildExcerpt("clinic-A", "conv-de-outra-clinica", ["m1", "m2", "m3"]),
    ).rejects.toThrow(/não encontrada/i);
    expect(mocks.db.select).toHaveBeenCalledTimes(1); // nem chegou a ler mensagens
  });

  it("monta o snapshot congelado com anonimização quando a conversa é da clínica", async () => {
    mockConversationLookup([{ id: "conv-1", leadName: "Cintia Iorio" }]);
    mockMessagesLookup([
      row({ id: "m1", author: "lead", body: "Oi, aqui é a Cintia. Meu número é 11987654321", sentAt: new Date("2026-07-10T12:00:00Z") }),
      row({ id: "m2", author: "agent", body: "Olá, Cintia! Como posso ajudar?", sentAt: new Date("2026-07-10T12:01:00Z") }),
      row({ id: "m3", author: "lead", body: "Quanto custa a avaliação?", sentAt: new Date("2026-07-10T12:02:00Z") }),
    ]);

    const excerpt = await buildExcerpt("clinic-A", "conv-1", ["m1", "m2", "m3"]);

    expect(excerpt.sourceConversationId).toBe("conv-1");
    expect(excerpt.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(excerpt.messages).toHaveLength(3);
    expect(excerpt.messages[0].body).toBe("Oi, aqui é a [PACIENTE]. Meu número é [TELEFONE]");
    expect(excerpt.messages[1].body).toBe("Olá, [PACIENTE]! Como posso ajudar?");
    // Nenhuma mensagem carrega o nome ou telefone crus.
    for (const m of excerpt.messages) {
      expect(m.body).not.toMatch(/Cintia|11987654321/);
    }
  });

  it("rejeita seleção vazia antes de consultar mensagens", async () => {
    mockConversationLookup([{ id: "conv-1", leadName: null }]);

    await expect(buildExcerpt("clinic-A", "conv-1", [])).rejects.toThrow(/ao menos 3/i);
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
  });
});

describe("assembleExcerpt (builder puro)", () => {
  const base = {
    conversationId: "conv-1",
    leadName: null as string | null,
  };

  it("mapeia roles: lead→lead, agent→ia, clinic_user→clinica", () => {
    const excerpt = assembleExcerpt({
      ...base,
      requestedMessageIds: ["m1", "m2", "m3"],
      rows: [
        row({ id: "m1", author: "lead", sentAt: new Date("2026-07-10T12:00:00Z") }),
        row({ id: "m2", author: "agent", body: "Posso ajudar!", sentAt: new Date("2026-07-10T12:01:00Z") }),
        row({ id: "m3", author: "clinic_user", body: "Aqui é da clínica.", sentAt: new Date("2026-07-10T12:02:00Z") }),
      ],
    });

    expect(excerpt.messages.map((m) => m.role)).toEqual(["lead", "ia", "clinica"]);
  });

  it("descarta mensagens de system (e elas não contam para o limite)", () => {
    const excerpt = assembleExcerpt({
      ...base,
      requestedMessageIds: ["m1", "m2", "m3", "m4"],
      rows: [
        row({ id: "m1", author: "lead", sentAt: new Date("2026-07-10T12:00:00Z") }),
        row({ id: "m2", author: "system", body: "Conversa marcada como lida.", sentAt: new Date("2026-07-10T12:00:30Z") }),
        row({ id: "m3", author: "agent", body: "Olá!", sentAt: new Date("2026-07-10T12:01:00Z") }),
        row({ id: "m4", author: "lead", body: "Oi!", sentAt: new Date("2026-07-10T12:02:00Z") }),
      ],
    });

    expect(excerpt.messages).toHaveLength(3);
    expect(excerpt.messages.every((m) => m.body !== "Conversa marcada como lida.")).toBe(true);
  });

  it("ignora mensagens fora dos ids solicitados", () => {
    const excerpt = assembleExcerpt({
      ...base,
      requestedMessageIds: ["m1", "m2", "m3"],
      rows: [
        row({ id: "m1", sentAt: new Date("2026-07-10T12:00:00Z") }),
        row({ id: "m2", author: "agent", body: "Oi!", sentAt: new Date("2026-07-10T12:01:00Z") }),
        row({ id: "m3", body: "Certo.", sentAt: new Date("2026-07-10T12:02:00Z") }),
        row({ id: "fora-da-selecao", body: "Não fui selecionada.", sentAt: new Date("2026-07-10T12:03:00Z") }),
      ],
    });

    expect(excerpt.messages).toHaveLength(3);
    expect(excerpt.messages.every((m) => m.body !== "Não fui selecionada.")).toBe(true);
  });

  it("aplica anonimização no snapshot (nome do lead e telefone)", () => {
    const excerpt = assembleExcerpt({
      conversationId: "conv-1",
      leadName: "João Silva",
      requestedMessageIds: ["m1", "m2", "m3"],
      rows: [
        row({ id: "m1", body: "Oi, sou o João Silva", sentAt: new Date("2026-07-10T12:00:00Z") }),
        row({ id: "m2", author: "agent", body: "Bem-vindo, João!", sentAt: new Date("2026-07-10T12:01:00Z") }),
        row({ id: "m3", body: "Me liga no (11) 98765-4321", sentAt: new Date("2026-07-10T12:02:00Z") }),
      ],
    });

    expect(excerpt.messages[0].body).toBe("Oi, sou o [PACIENTE]");
    expect(excerpt.messages[1].body).toBe("Bem-vindo, [PACIENTE]!");
    expect(excerpt.messages[2].body).toBe("Me liga no [TELEFONE]");
  });

  it("mídia vira placeholder do Apêndice C (+ body se houver), sem mediaUrl", () => {
    const excerpt = assembleExcerpt({
      ...base,
      requestedMessageIds: ["m1", "m2", "m3", "m4"],
      rows: [
        row({ id: "m1", mediaType: "image", body: "Antes e depois", sentAt: new Date("2026-07-10T12:00:00Z") }),
        row({ id: "m2", author: "agent", mediaType: "video", body: "", sentAt: new Date("2026-07-10T12:01:00Z") }),
        row({ id: "m3", mediaType: "audio", body: "", sentAt: new Date("2026-07-10T12:02:00Z") }),
        row({ id: "m4", author: "clinic_user", mediaType: "document", body: "Orçamento", sentAt: new Date("2026-07-10T12:03:00Z") }),
      ],
    });

    expect(excerpt.messages[0].body).toBe("[foto] 📷 Antes e depois");
    expect(excerpt.messages[1].body).toBe("[vídeo] 🎬");
    expect(excerpt.messages[2].body).toBe("[áudio] 🎤");
    expect(excerpt.messages[3].body).toBe("[documento] 📄 Orçamento");
  });

  it("deliveryFormat=audio com corpo de texto → texto com marcador wasAudio", () => {
    const excerpt = assembleExcerpt({
      ...base,
      requestedMessageIds: ["m1", "m2", "m3"],
      rows: [
        row({ id: "m1", sentAt: new Date("2026-07-10T12:00:00Z") }),
        row({ id: "m2", author: "agent", body: "A avaliação custa R$ 150.", deliveryFormat: "audio", sentAt: new Date("2026-07-10T12:01:00Z") }),
        row({ id: "m3", body: "Perfeito!", sentAt: new Date("2026-07-10T12:02:00Z") }),
      ],
    });

    expect(excerpt.messages[1].body).toBe("A avaliação custa R$ 150.");
    expect(excerpt.messages[1].wasAudio).toBe(true);
    expect(excerpt.messages[0].wasAudio).toBeUndefined();
  });

  it("ordena o snapshot por sentAt mesmo recebendo linhas fora de ordem", () => {
    const excerpt = assembleExcerpt({
      ...base,
      requestedMessageIds: ["m1", "m2", "m3"],
      rows: [
        row({ id: "m3", body: "terceira", sentAt: new Date("2026-07-10T12:02:00Z") }),
        row({ id: "m1", body: "primeira", sentAt: new Date("2026-07-10T12:00:00Z") }),
        row({ id: "m2", body: "segunda", sentAt: new Date("2026-07-10T12:01:00Z") }),
      ],
    });

    expect(excerpt.messages.map((m) => m.body)).toEqual(["primeira", "segunda", "terceira"]);
    expect(excerpt.messages[0].sentAt).toBe("2026-07-10T12:00:00.000Z");
  });

  it("rejeita trecho com menos de 3 mensagens úteis (Apêndice H)", () => {
    expect(() =>
      assembleExcerpt({
        ...base,
        requestedMessageIds: ["m1", "m2"],
        rows: [
          row({ id: "m1", sentAt: new Date("2026-07-10T12:00:00Z") }),
          row({ id: "m2", author: "agent", body: "Oi!", sentAt: new Date("2026-07-10T12:01:00Z") }),
        ],
      }),
    ).toThrow(/ao menos 3/i);
  });

  it("descartes (system) podem derrubar a seleção abaixo do mínimo → erro", () => {
    expect(() =>
      assembleExcerpt({
        ...base,
        requestedMessageIds: ["m1", "m2", "m3"],
        rows: [
          row({ id: "m1", sentAt: new Date("2026-07-10T12:00:00Z") }),
          row({ id: "m2", author: "system", body: "evento interno", sentAt: new Date("2026-07-10T12:01:00Z") }),
          row({ id: "m3", author: "agent", body: "Oi!", sentAt: new Date("2026-07-10T12:02:00Z") }),
        ],
      }),
    ).toThrow(/ao menos 3/i);
  });

  it("rejeita trecho com mais de 15 mensagens (Apêndice H)", () => {
    const ids = Array.from({ length: 16 }, (_, i) => `m${i}`);
    const rows = ids.map((id, i) =>
      row({
        id,
        body: `mensagem ${i}`,
        sentAt: new Date(Date.UTC(2026, 6, 10, 12, i)),
      }),
    );

    expect(() =>
      assembleExcerpt({ ...base, requestedMessageIds: ids, rows }),
    ).toThrow(/no máximo 15/i);
  });
});
