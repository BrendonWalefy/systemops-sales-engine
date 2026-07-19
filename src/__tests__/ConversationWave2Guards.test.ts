// Wave 2 do mapeamento 18/07 (doc 06) — cenários reais João Vitor/Barbara:
// J2 — afirmativa curta após oferta aberta = aceite (não re-saudação stale)
// J4 — quantidade pedida no burst obriga o valor exato na resposta
// J6 — pedido de vitrine tem rota determinística para mídias de resultado
import { describe, expect, it } from "vitest";
import {
  collectCurrentLeadBurstBodies,
  hasExplicitPipelineTreatmentTrigger,
  isAffirmativeReplyToOpenOffer,
  isShowcaseRequestText,
  pickShowcaseMedia,
  stripPriceProseWhenSystemQuoted,
} from "@/core/pipeline/ConversationOrchestrator";
import { resolveQuantityPriceQuery } from "@/core/intelligence/quantity-price";
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

const RECOVERY_OFFER =
  "Olá! Que bom que você está interessado em transformar seu sorriso com as lentes de resina! Posso te ajudar com informações sobre esse tratamento e os valores.";

describe("J2 — aceite de oferta aberta", () => {
  it("caso João Vitor: 'Boa noite pode sim' após oferta é aceite", () => {
    expect(
      isAffirmativeReplyToOpenOffer({
        lastAgentMessage: RECOVERY_OFFER,
        message: "Boa noite pode sim",
      }),
    ).toBe(true);
  });

  it("afirmativa após pergunta aberta (termina em ?) é aceite", () => {
    expect(
      isAffirmativeReplyToOpenOffer({
        lastAgentMessage: "Me conta, você quer entender melhor como funciona, ver valores ou já procurar um horário para avaliação?",
        message: "Quero sim",
      }),
    ).toBe(true);
  });

  it("mensagem com conteúdo próprio não é tratada como aceite", () => {
    expect(
      isAffirmativeReplyToOpenOffer({
        lastAgentMessage: RECOVERY_OFFER,
        message: "Valores e onde é o consultório",
      }),
    ).toBe(false);
  });

  it("afirmativa sem oferta anterior não vira aceite", () => {
    expect(
      isAffirmativeReplyToOpenOffer({
        lastAgentMessage: "Seu agendamento está confirmado para segunda às 9h.",
        message: "pode sim",
      }),
    ).toBe(false);
  });

  it("aceite de oferta que menciona o tratamento abre o pipeline", () => {
    const lenses = treatment("Lentes de resina composta", {
      aliases: ["lentes", "faceta"],
      pipelineSteps: [{ type: "content", label: "Apresentação", blocks: [] }],
    });
    expect(
      hasExplicitPipelineTreatmentTrigger({
        message: "Boa noite pode sim",
        treatments: [lenses],
        lastAgentMessage: RECOVERY_OFFER,
        treatment: lenses,
      }),
    ).toBe(true);
  });

  it("aceite de oferta SEM menção ao tratamento continua bloqueado", () => {
    const lenses = treatment("Clareamento dental", {
      aliases: ["clareamento"],
      pipelineSteps: [{ type: "content", label: "Apresentação", blocks: [] }],
    });
    expect(
      hasExplicitPipelineTreatmentTrigger({
        message: "pode sim",
        treatments: [lenses],
        lastAgentMessage: "Posso te ajudar com qualquer dúvida que você tiver!",
        treatment: lenses,
      }),
    ).toBe(false);
  });
});

describe("J4 — quantidade no burst", () => {
  const lenses = treatment("Lente em Resina Premium", {
    aliases: ["lentes"],
    priceQuotableInChat: true,
    quantityPrices: [
      { quantity: 10, priceCents: 170000, scope: "total" },
      { quantity: 20, priceCents: 200000, scope: "total" },
    ],
  });

  it("coleta o burst atual do lead em ordem cronológica, parando no turno do agente", () => {
    expect(
      collectCurrentLeadBurstBodies([
        { author: "lead", body: "Valores e onde é o consultório" },
        { author: "agent", body: "Estamos em Santo Amaro..." },
        { author: "lead", body: "20 lentes" },
        { author: "lead", body: "Queria ver um pouco do trabalho de vocês" },
      ]),
    ).toEqual(["20 lentes", "Queria ver um pouco do trabalho de vocês"]);
  });

  it("prosa LLM com R$ é limpa quando o sistema já cotou (replay D2 real)", () => {
    const llm =
      "Para 20 lentes, o investimento é de R$ 2.500 na técnica de Lente em Resina Estratificada e R$ 2.000 na técnica de Lente em Resina Premium.\n\nQual dessas técnicas chamou mais a sua atenção? Posso te ajudar a agendar uma avaliação!";
    expect(stripPriceProseWhenSystemQuoted(llm)).toBe(
      "Qual dessas técnicas chamou mais a sua atenção? Posso te ajudar a agendar uma avaliação!",
    );
    expect(stripPriceProseWhenSystemQuoted("Só parágrafo com R$ 2.000 aqui.")).toBe("");
    expect(stripPriceProseWhenSystemQuoted("Texto sem valores.")).toBe("Texto sem valores.");
  });

  it("anúncio órfão de valores sai junto com o parágrafo removido (replay D3 real)", () => {
    const llm =
      "Para 20 lentes, os valores são:\n\n- Lente em Resina Estratificada: R$ 2.500\n- Lente em Resina Premium: R$ 2.000\n\nQual das duas técnicas chamou mais a sua atenção?";
    expect(stripPriceProseWhenSystemQuoted(llm)).toBe("Qual das duas técnicas chamou mais a sua atenção?");

    const orphanAtEnd = "Qual técnica prefere?\n\nPara 20 lentes, os valores são:\n\nSegue: R$ 2.000";
    expect(stripPriceProseWhenSystemQuoted(orphanAtEnd)).toBe("Qual técnica prefere?");
  });

  it("caso João Vitor: '20 lentes' no burst resolve o valor exato do pacote", () => {
    const burst = ["20 lentes", "Queria ver um pouco do trabalho de vocês"];
    const resolution = burst
      .map((body) => resolveQuantityPriceQuery(body, [lenses]))
      .find((r) => r?.kind === "exact");
    expect(resolution).toEqual({
      kind: "exact",
      quantity: 20,
      scope: "total",
      lines: ["Lente em Resina Premium: R$ 2.000"],
    });
  });
});

describe("J6 — rota determinística de vitrine", () => {
  it("detecta pedidos reais de ver casos/trabalhos", () => {
    expect(isShowcaseRequestText("Queria ver um pouco do trabalho de vocês")).toBe(true);
    expect(isShowcaseRequestText("vocês têm fotos de resultados?")).toBe(true);
    expect(isShowcaseRequestText("quero ver o antes e depois")).toBe(true);
  });

  it("perguntas comuns não disparam vitrine", () => {
    expect(isShowcaseRequestText("quero saber os valores")).toBe(false);
    expect(isShowcaseRequestText("como funciona o tratamento?")).toBe(false);
    expect(isShowcaseRequestText("me mostra as cores")).toBe(false);
  });

  it("seleciona só mídias de resultado, com escopo de tratamento e limite", () => {
    const library = [
      { id: "a", title: "Resultado Técnica Estratificada", treatmentId: "lentes" },
      { id: "b", title: "Valores Lente em Resina Premium", treatmentId: "lentes" },
      { id: "c", title: "Resultado Clareamento", treatmentId: "clareamento" },
      { id: "d", title: "Caso real — antes e depois", treatmentId: null },
      { id: "e", title: "Resultado Técnica Premium", treatmentId: "lentes" },
    ];
    expect(pickShowcaseMedia(library, "lentes").map((m) => m.id)).toEqual(["a", "d"]);
    expect(pickShowcaseMedia(library, null).map((m) => m.id)).toEqual(["a", "c"]);
  });
});
