import { describe, expect, it } from "vitest";
import { resolveAdMediaContext } from "@/core/pipeline/ConversationOrchestrator";

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
      hasAnyAgentMessage: false,
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
      hasAnyAgentMessage: false,
      totalConversationMessages: 1,
      history: [leadMessage("image-1", "Olá! Vi o anúncio e quero saber mais.")],
      now,
    });

    expect(context).toEqual({
      isAdMedia: true,
      contextText: "Olá! Vi o anúncio e quero saber mais.",
    });
  });

  it("não classifica foto clínica como anúncio depois que a IA já respondeu", () => {
    const context = resolveAdMediaContext({
      currentMessageId: "image-3",
      currentMessageText: "[imagem recebida]",
      hasAnyAgentMessage: true,
      totalConversationMessages: 3,
      history: [
        leadMessage("text-1", "Oi, quero saber sobre lentes."),
        { id: "agent-2", author: "agent", body: "Claro! Pode me enviar uma foto do seu sorriso?", sentAt: new Date(now - 30_000) },
        leadMessage("image-3", "[imagem recebida]", now),
      ],
      now,
    });

    expect(context).toEqual({ isAdMedia: false, contextText: null });
  });

  it("não infere anúncio sem legenda ou texto comercial próximo", () => {
    const context = resolveAdMediaContext({
      currentMessageId: "image-1",
      currentMessageText: "[imagem recebida]",
      hasAnyAgentMessage: false,
      totalConversationMessages: 1,
      history: [leadMessage("image-1", "[imagem recebida]")],
      now,
    });

    expect(context).toEqual({ isAdMedia: false, contextText: null });
  });
});
