// Guards derivados de validação sanitizada; contrato em docs/architecture/replay-fidelity-contract.md:
// N1 — interesse genérico → conteúdo curado sem prosa LLM (caso Nathan)
// J7 — CTA de avaliação/foto não repete quando ignorado (caso João Vitor)
// J5 — markdown de mídia inventado pelo LLM nunca chega cru ao lead
import { describe, expect, it } from "vitest";
import {
  canAppendQaFollowUpContent,
  buildConversationReentryAcknowledgment,
  collectPreviousAgentTurnBodies,
  isGenericTreatmentInterestMessage,
  isRepeatedConversationalReply,
  shouldSuppressNextStepCta,
} from "@/core/pipeline/ConversationOrchestrator";
import { buildActionContext, rescueMarkdownMediaSyntax } from "@/core/intelligence/ResponseComposer";
import type { Treatment } from "@/domain/entities/treatment";

function treatment(name: string, overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    clinicId: "clinic-1",
    name,
    durationMinutes: 60,
    description: null,
    requiresEvaluationFirst: false,
    keywordMatchEnabled: true,
    aliases: [],
    isAesthetic: false,
    pipelineSteps: null,
    priceCents: null,
    minPriceCents: null,
    maxPriceCents: null,
    priceQuotableInChat: false,
    priceKind: "from",
    priceUnit: null,
    priceDeductible: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const lenses = treatment("Lentes de resina composta", { aliases: ["lentes", "resina"] });

describe("reinício de conversa sem resposta duplicada", () => {
  it("detecta o mesmo starter apesar de espaçamento e pontuação", () => {
    expect(
      isRepeatedConversationalReply(
        "Boa noite, Lead! Tudo bem?",
        "  Boa noite Lead. Tudo bem?  ",
      ),
    ).toBe(true);
  });

  it("permite uma nova abertura quando o conteúdo realmente mudou", () => {
    expect(
      isRepeatedConversationalReply(
        "Boa noite, Lead! Tudo bem?",
        "Oi! Que bom falar com você novamente.",
      ),
    ).toBe(false);
  });

  it("responde uma saudação de retorno sem reiniciar o atendimento", () => {
    expect(buildConversationReentryAcknowledgment("Olá, Gleice")).toBe("Oi! 😊");
    expect(buildConversationReentryAcknowledgment("Boa tarde")).toBe("Boa tarde! 😊");
  });
});

describe("N1 — isGenericTreatmentInterestMessage", () => {
  it("caso Nathan: interesse genérico com typo e 'valores' é genérico", () => {
    expect(
      isGenericTreatmentInterestMessage(
        "quero enteder um pouco mais como funciona e valores também",
        lenses,
      ),
    ).toBe(true);
  });

  it("opener de anúncio é genérico", () => {
    expect(
      isGenericTreatmentInterestMessage(
        "Olá! Quero saber como posso transformar meu sorriso com as lentes  de resina?",
        lenses,
      ),
    ).toBe(true);
  });

  it("pergunta específica de manutenção NÃO é genérica", () => {
    expect(isGenericTreatmentInterestMessage("Como que seria a manutenção?", lenses)).toBe(false);
  });

  it("pedido de casos/trabalhos NÃO é genérico", () => {
    expect(
      isGenericTreatmentInterestMessage("Queria ver um pouco do trabalho de vocês", lenses),
    ).toBe(false);
  });

  it("pergunta clínica (bruxismo) NÃO é genérica", () => {
    expect(
      isGenericTreatmentInterestMessage("eu sofro de bruxismo, queria saber se resiste", lenses),
    ).toBe(false);
  });

  it("pergunta de parcelamento NÃO é genérica", () => {
    expect(isGenericTreatmentInterestMessage("vocês parcelam esse valor?", lenses)).toBe(false);
  });

  it("mensagem vazia não é genérica", () => {
    expect(isGenericTreatmentInterestMessage("", lenses)).toBe(false);
  });
});

describe("J7 — gate de ritmo de CTA", () => {
  const ctaTurn = [
    "Entendo seu interesse em ver o trabalho que realizamos! Além disso, que tal agendarmos uma avaliação para discutir suas expectativas?",
  ];

  it("caso João Vitor: CTA ignorado + nova pergunta sem sinal → suprime", () => {
    expect(
      shouldSuppressNextStepCta({
        previousAgentMessages: ctaTurn,
        currentLeadMessage: "Queria ver um pouco do trabalho de vocês",
      }),
    ).toBe(true);
  });

  it("pedido de foto ignorado também suprime", () => {
    expect(
      shouldSuppressNextStepCta({
        previousAgentMessages: ["Se quiser, pode me enviar uma foto do seu sorriso 😊"],
        currentLeadMessage: "20 lentes",
      }),
    ).toBe(true);
  });

  it("lead engajou com o convite → não suprime", () => {
    expect(
      shouldSuppressNextStepCta({
        previousAgentMessages: ctaTurn,
        currentLeadMessage: "Pode ser! Quando tem horário?",
      }),
    ).toBe(false);
  });

  it("turno anterior sem CTA → não suprime", () => {
    expect(
      shouldSuppressNextStepCta({
        previousAgentMessages: ["Nosso endereço é Av. Adolfo Pinheiro, 1.029 - Santo Amaro."],
        currentLeadMessage: "Queria ver o trabalho de vocês",
      }),
    ).toBe(false);
  });

  it("coleta apenas o turno do agente desde a mensagem anterior do lead (operador conta)", () => {
    const bodies = collectPreviousAgentTurnBodies([
      { author: "lead", body: "Valores e onde é o consultório" },
      { author: "agent", body: "Ficamos em Santo Amaro. Que tal agendarmos uma avaliação?" },
      { author: "clinic_user", body: "Qualquer dúvida estou aqui!" },
      { author: "lead", body: "20 lentes" },
      { author: "lead", body: "Queria ver um pouco do trabalho de vocês" },
    ]);
    expect(bodies).toEqual([
      "Qualquer dúvida estou aqui!",
      "Ficamos em Santo Amaro. Que tal agendarmos uma avaliação?",
    ]);
  });

  it("prompt com supressão troca condução ativa por regra de ritmo", () => {
    const suppressed = buildActionContext(
      { type: "general_question", clinicContext: "Lead perguntou sobre casos." },
      "concierge",
      null,
      true,
    );
    expect(suppressed).toContain("REGRA DE RITMO — CTA JÁ FEITO");
    expect(suppressed).not.toContain("conduza ativamente");

    const normal = buildActionContext(
      { type: "general_question", clinicContext: "Lead perguntou sobre casos." },
      "concierge",
      null,
      false,
    );
    expect(normal).toContain("conduza ativamente");
  });
});

describe("J8 — pedido de foto no Q&A só com sinal de prontidão", () => {
  it("pergunta de descoberta com mídia por keyword NÃO puxa o pedido de foto", () => {
    expect(
      canAppendQaFollowUpContent({
        nextContentIsPhotoInstruction: true,
        keywordMediaMatched: true,
        leadMessage: "me mostra as cores",
      }),
    ).toBe(false);
  });

  it("afirmativa curta libera o pedido de foto", () => {
    expect(
      canAppendQaFollowUpContent({
        nextContentIsPhotoInstruction: true,
        keywordMediaMatched: false,
        leadMessage: "Sim, pode",
      }),
    ).toBe(true);
  });

  it("conteúdo comum continua anexável no momento de keyword", () => {
    expect(
      canAppendQaFollowUpContent({
        nextContentIsPhotoInstruction: false,
        keywordMediaMatched: true,
        leadMessage: "me mostra as cores",
      }),
    ).toBe(true);
  });

  it("conteúdo comum sem keyword nem afirmativa fica para o próximo momento", () => {
    expect(
      canAppendQaFollowUpContent({
        nextContentIsPhotoInstruction: false,
        keywordMediaMatched: false,
        leadMessage: "e a manutenção, como funciona?",
      }),
    ).toBe(false);
  });
});

describe("J5 — rescueMarkdownMediaSyntax", () => {
  const validIds = new Set(["5d383eb4-7dce-4fe3-a14a-5fad569fe6a7"]);

  it("caso João Vitor: uuid válido em pseudo-URL vira token [MEDIA:id]", () => {
    const raw =
      "Vou te enviar uma imagem que ilustra as cores.\n\nAqui está a imagem:\n\n![Cores](https://media.5d383eb4-7dce-4fe3-a14a-5fad569fe6a7)\n\nPosso te ajudar com mais alguma coisa?";
    const rescued = rescueMarkdownMediaSyntax(raw, validIds);
    expect(rescued).toContain("[MEDIA:5d383eb4-7dce-4fe3-a14a-5fad569fe6a7]");
    expect(rescued).not.toContain("![");
    expect(rescued).not.toContain("https://media.");
  });

  it("uuid desconhecido: sintaxe some junto com a frase-promessa", () => {
    const raw =
      "Temos ótimos casos!\n\nAqui está a imagem:\n\n![Casos](https://media.00000000-0000-0000-0000-000000000000)\n\nFicou alguma dúvida?";
    const rescued = rescueMarkdownMediaSyntax(raw, validIds);
    expect(rescued).not.toContain("![");
    expect(rescued).not.toContain("00000000");
    expect(rescued).not.toMatch(/aqui está a imagem/i);
    expect(rescued).toContain("Temos ótimos casos!");
    expect(rescued).toContain("Ficou alguma dúvida?");
  });

  it("markdown de imagem sem uuid também é removido", () => {
    const raw = "Segue a foto:\n\n![Sorriso](https://exemplo.com/sorriso.png)\n\nO que achou?";
    const rescued = rescueMarkdownMediaSyntax(raw, validIds);
    expect(rescued).not.toContain("![");
    expect(rescued).not.toMatch(/segue a foto/i);
    expect(rescued).toContain("O que achou?");
  });

  it("texto sem markdown passa intacto", () => {
    const raw = "Nós somos especialistas em lentes de resina composta. [MEDIA:5d383eb4-7dce-4fe3-a14a-5fad569fe6a7]";
    expect(rescueMarkdownMediaSyntax(raw, validIds)).toBe(raw);
  });
});
