// "Primeiro contato" media a coisa errada.
//
// `isFirstMessage` conta quantas mensagens NÃO-lead existem. Zero significa
// "ninguém respondeu ainda" — não "é a primeira mensagem do lead". Quem manda
// quatro mensagens sem ser atendido continua sendo primeiro contato e recebe a
// saudação de abertura no lugar da resposta.
//
// Medido em produção (21/07): 123 primeiras respostas do agente saíram com o
// lead já tendo 2+ mensagens sem resposta; 69 (56%) abriram com apresentação.
// Um lead da Vitalli chegou a 14 mensagens nessa condição.
//
// A separação: `isFirstMessage` continua governando a APRESENTAÇÃO (saudação
// rica, nome da clínica dito uma vez) — quem nunca foi atendido merece isso na
// 1ª ou na 4ª mensagem. `isConversationOpening` governa a ABERTURA enlatada
// (menu inicial / starter concierge), que substitui o conteúdo em vez de
// responder a ele. Ver docs/architecture/current.md.

import { describe, expect, it } from "vitest";
import {
  shouldShowInitialMenu,
  shouldSendConciergeStarter,
} from "@/core/pipeline/ConversationOrchestrator";

type Msg = { author: "lead" | "agent" | "clinic_user" };

// Espelha o cálculo do orquestrador sobre o histórico já carregado.
function resolveOpeningFlags(allMessages: Msg[]) {
  const isFirstMessage = allMessages.filter((m) => m.author !== "lead").length === 0;
  const leadMessageCount = allMessages.filter((m) => m.author === "lead").length;
  return { isFirstMessage, isConversationOpening: isFirstMessage && leadMessageCount <= 1 };
}

const lead = (): Msg => ({ author: "lead" });
const agent = (): Msg => ({ author: "agent" });
const operador = (): Msg => ({ author: "clinic_user" });

describe("isConversationOpening x isFirstMessage", () => {
  it("lead com UMA mensagem e ninguém respondeu: abre e se apresenta", () => {
    const flags = resolveOpeningFlags([lead()]);
    expect(flags.isFirstMessage).toBe(true);
    expect(flags.isConversationOpening).toBe(true);
  });

  it("lead com DUAS mensagens sem resposta: ainda se apresenta, mas NÃO abre", () => {
    // O coração do item #2. Antes, os dois eram true e a 2ª mensagem recebia o
    // menu/starter em vez de resposta.
    const flags = resolveOpeningFlags([lead(), lead()]);
    expect(flags.isFirstMessage).toBe(true);
    expect(flags.isConversationOpening).toBe(false);
  });

  it("o caso extremo real: 14 mensagens do lead sem resposta", () => {
    const flags = resolveOpeningFlags(Array.from({ length: 14 }, lead));
    expect(flags.isFirstMessage).toBe(true);
    expect(flags.isConversationOpening).toBe(false);
  });

  it("resposta do OPERADOR também encerra o primeiro contato", () => {
    // clinic_user conta como não-lead: se o Victor respondeu à mão, a IA não
    // pode chegar depois se apresentando do zero.
    const flags = resolveOpeningFlags([lead(), operador(), lead()]);
    expect(flags.isFirstMessage).toBe(false);
    expect(flags.isConversationOpening).toBe(false);
  });

  it("depois de qualquer resposta do agente, nenhum dos dois vale", () => {
    const flags = resolveOpeningFlags([lead(), agent(), lead()]);
    expect(flags.isFirstMessage).toBe(false);
    expect(flags.isConversationOpening).toBe(false);
  });
});

describe("o que a abertura substituiria", () => {
  // O gate de abertura só dispara nesses intents — é por isso que o sintoma
  // aparece com "Olá boa tarde" e não com "quanto custa?".
  it.each(["greeting", "acknowledgment", "unclear"] as const)(
    "intent %s dispara o starter concierge",
    (intent) => {
      expect(shouldSendConciergeStarter("concierge", intent)).toBe(true);
    },
  );

  it.each(["price_inquiry", "book_appointment", "needs_human"] as const)(
    "intent %s nunca vira abertura — já responde conteúdo",
    (intent) => {
      expect(shouldSendConciergeStarter("concierge", intent)).toBe(false);
      expect(shouldShowInitialMenu("menu_first", intent)).toBe(false);
    },
  );

  it("menu_first e concierge são mutuamente exclusivos na abertura", () => {
    expect(shouldShowInitialMenu("concierge", "greeting")).toBe(false);
    expect(shouldSendConciergeStarter("menu_first", "greeting")).toBe(false);
  });
});
