import { describe, expect, it } from "vitest";
import { hasAgentRequestedPhoto, resolveAdMediaContext } from "@/core/pipeline/ConversationOrchestrator";

const now = new Date("2026-07-18T18:00:00.000Z").getTime();

function leadMessage(id: string, body: string, sentAt = now): {
  id: string;
  author: "lead";
  body: string;
  sentAt: Date;
} {
  return { id, author: "lead", body, sentAt: new Date(sentAt) };
}

describe("detecção de criativo de anúncio no inbound", () => {
  it("reconhece imagem separada do texto do anúncio e recupera o contexto comercial", () => {
    const context = resolveAdMediaContext({
      currentMessageId: "image-2",
      currentMessageText: "[imagem recebida]",
      agentRequestedPhoto: false,
      totalConversationMessages: 2,
      history: [
        leadMessage("text-1", "Olá! Quero saber como posso transformar meu sorriso com as lentes de resina."),
        leadMessage("image-2", "[imagem recebida]", now + 1_000),
      ],
      now: now + 1_000,
    });

    expect(context).toEqual({
      isAdMedia: true,
      contextText: "Olá! Quero saber como posso transformar meu sorriso com as lentes de resina.",
    });
  });

  it("mantém suporte para anúncio com legenda na própria mídia", () => {
    const context = resolveAdMediaContext({
      currentMessageId: "image-1",
      currentMessageText: "Olá! Vi o anúncio e quero saber mais.",
      agentRequestedPhoto: false,
      totalConversationMessages: 1,
      history: [leadMessage("image-1", "Olá! Vi o anúncio e quero saber mais.")],
      now,
    });

    expect(context).toEqual({
      isAdMedia: true,
      contextText: "Olá! Vi o anúncio e quero saber mais.",
    });
  });

  // T2 (caso Barbara): a saudação já ter saído NÃO desativa a detecção — o lead
  // encaminha o criativo depois de receber a saudação o tempo todo. A proteção
  // real é o pedido de foto pela equipe.
  it("reconhece criativo encaminhado depois da saudação, antes de a equipe pedir foto", () => {
    const context = resolveAdMediaContext({
      currentMessageId: "image-3",
      currentMessageText: "[imagem recebida]",
      agentRequestedPhoto: false,
      totalConversationMessages: 3,
      history: [
        leadMessage("text-1", "Olá! Quero saber como posso transformar meu sorriso com as lentes de resina.", now - 20_000),
        { id: "agent-2", author: "agent" as const, body: "Boa tarde! Me chamo Gleice, sou da Clínica Aurora. Me conta, você quer entender melhor como funciona?", sentAt: new Date(now - 10_000) },
        leadMessage("image-3", "[imagem recebida]", now),
      ],
      now,
    });

    expect(context).toEqual({
      isAdMedia: true,
      contextText: "Olá! Quero saber como posso transformar meu sorriso com as lentes de resina.",
    });
  });

  it("não classifica foto como anúncio depois que a equipe pediu foto", () => {
    const context = resolveAdMediaContext({
      currentMessageId: "image-3",
      currentMessageText: "[imagem recebida]",
      agentRequestedPhoto: true,
      totalConversationMessages: 3,
      history: [
        leadMessage("text-1", "Oi, quero saber sobre lentes."),
        { id: "agent-2", author: "agent" as const, body: "Claro! Pode me enviar uma foto do seu sorriso?", sentAt: new Date(now - 30_000) },
        leadMessage("image-3", "[imagem recebida]", now),
      ],
      now,
    });

    expect(context).toEqual({ isAdMedia: false, contextText: null });
  });

  it("não classifica mídia como anúncio em conversa madura (mais de 5 mensagens)", () => {
    const context = resolveAdMediaContext({
      currentMessageId: "image-9",
      currentMessageText: "[imagem recebida]",
      agentRequestedPhoto: false,
      totalConversationMessages: 9,
      history: [
        leadMessage("text-8", "Olá! Quero saber como posso transformar meu sorriso com as lentes de resina.", now - 5_000),
        leadMessage("image-9", "[imagem recebida]", now),
      ],
      now,
    });

    expect(context).toEqual({ isAdMedia: false, contextText: null });
  });

  it("não infere anúncio sem legenda ou texto comercial próximo", () => {
    const context = resolveAdMediaContext({
      currentMessageId: "image-1",
      currentMessageText: "[imagem recebida]",
      agentRequestedPhoto: false,
      totalConversationMessages: 1,
      history: [leadMessage("image-1", "[imagem recebida]")],
      now,
    });

    expect(context).toEqual({ isAdMedia: false, contextText: null });
  });
});

describe("hasAgentRequestedPhoto", () => {
  it("detecta pedido de foto do agente e do operador", () => {
    expect(
      hasAgentRequestedPhoto([
        { author: "agent", body: "Você poderia me encaminhar uma foto ou um vídeo curto do seu sorriso?" },
      ]),
    ).toBe(true);
    expect(
      hasAgentRequestedPhoto([
        { author: "clinic_user", body: "Você poderia nos encaminhar uma foto ou vídeo do seu sorriso para realizar uma pré avaliação?" },
      ]),
    ).toBe(true);
  });

  it("saudação e conteúdo comercial não contam como pedido de foto", () => {
    expect(
      hasAgentRequestedPhoto([
        { author: "agent", body: "Me chamo Gleice, sou da Clínica Aurora. Quer entender melhor como funciona, ver valores ou já procurar um horário?" },
        { author: "lead", body: "Quero ver valores" },
      ]),
    ).toBe(false);
  });
});
