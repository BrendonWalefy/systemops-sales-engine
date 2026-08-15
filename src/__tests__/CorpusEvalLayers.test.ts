import { describe, expect, it } from "vitest";
import { loadCorpus } from "@/application/corpus/corpus-index";
import { scoreUnderstanding } from "@/application/corpus/eval-understanding";
import {
  IO_DEPENDENT_ACTIONS,
  referenceDecider,
  runDecisionEval,
} from "@/application/corpus/eval-decision";
import {
  aggregateProse,
  measureProse,
  parseQuotedPrices,
  repeatsPreviousBlock,
} from "@/application/corpus/eval-prose";
import { expectedV1Intent } from "@/application/corpus/v1-understanding-adapter";

const corpus = loadCorpus("evals/corpus");

describe("eval de Understanding", () => {
  // A regra do ciclo: reportar por eixo. Um sistema que acerta o pedido e erra o
  // movimento de diálogo não pode sair com a mesma nota de um que erra os dois.
  it("reporta por eixo, e não uma nota única de caso", () => {
    const scores = scoreUnderstanding(
      corpus.cases.map((corpusCase) => ({
        corpusCase,
        produced: { request: corpusCase.labels.understanding.request },
      })),
    );

    const request = scores.find((score) => score.axis === "request");
    const move = scores.find((score) => score.axis === "dialogueMove");
    expect(request?.accuracy).toBe(1);
    expect(move?.produced).toBe(0);
    expect(move?.accuracy).toBe(0);
  });

  it("distingue eixo não produzido de eixo produzido errado", () => {
    const [first] = corpus.cases;
    const notProduced = scoreUnderstanding([{ corpusCase: first!, produced: {} }]);
    const producedWrong = scoreUnderstanding([
      { corpusCase: first!, produced: { request: "coisa-errada" } },
    ]);

    expect(notProduced.find((s) => s.axis === "request")?.produced).toBe(0);
    expect(producedWrong.find((s) => s.axis === "request")?.produced).toBe(1);
    expect(producedWrong.find((s) => s.axis === "request")?.correct).toBe(0);
  });

  it("traduz todo request do corpus para a régua da V1", () => {
    const untranslated = [
      ...new Set(corpus.cases.map((entry) => entry.labels.understanding.request)),
    ].filter((request) => expectedV1Intent(request) === null);

    expect(untranslated).toEqual([]);
  });
});

describe("eval de Decision", () => {
  const configByRef = Object.fromEntries(
    [...new Set(corpus.cases.map((entry) => entry.input.tenantConfigRef))].map(
      (ref) => [ref, { hasCatalog: true, hasSchedule: true }],
    ),
  );

  it("roda sem rede e sem banco", () => {
    const report = runDecisionEval({
      cases: corpus.cases,
      decider: referenceDecider,
      configByRef,
    });

    expect(report.total).toBe(corpus.cases.length);
    expect(report.pureCases + report.ioCases).toBe(corpus.cases.length);
  });

  // Cobrar de um decisor puro um ActionResult que só existe depois de ler a
  // agenda seria cobrar adivinhação, e o número resultante não mediria decisão.
  it("separa o que depende de I/O do que é decidível sem ele", () => {
    const report = runDecisionEval({
      cases: corpus.cases,
      decider: referenceDecider,
      configByRef,
    });

    expect(report.ioCases).toBeGreaterThan(0);
    expect(IO_DEPENDENT_ACTIONS.has("slots_found")).toBe(true);
    expect(IO_DEPENDENT_ACTIONS.has("price_inquiry")).toBe(false);
    for (const failure of report.failures) {
      expect(failure.purity).toBe("pure");
    }
  });

  // Em vez de um limiar escolhido depois de ver o número — que seria ajustar a
  // régua ao resultado —, o teste fixa a *forma* do que sobra. Os seis casos que
  // o decisor de referência não fecha caem todos em causas nomeadas, e cada uma
  // é um requisito da V2, não um defeito do decisor:
  //
  //  - `greeting` × `general_question` depende de ser a primeira mensagem;
  //  - `pipeline_photo_received` × `media_received` depende do estado do pipeline,
  //    e o corpus histórico tem `state: null` porque a V1 não o persiste por turno;
  //  - `clarification_needed` depende de consultar o catálogo do tenant, que é
  //    config e não Understanding.
  it("o que o decisor de referência não fecha tem causa nomeada", () => {
    const report = runDecisionEval({
      cases: corpus.cases,
      decider: referenceDecider,
      configByRef,
    });

    const known = new Set(["greeting", "pipeline_photo_received", "clarification_needed"]);
    const unexplained = report.failures.filter(
      (failure) => !known.has(failure.expected),
    );

    expect(unexplained).toEqual([]);
    expect(report.pureCases).toBeGreaterThan(report.ioCases);
  });
});

describe("eval de prosa — parte determinística", () => {
  it("lê valores em reais no formato brasileiro", () => {
    expect(parseQuotedPrices("fica R$ 2.000 ou R$ 1.700,00")).toEqual([
      200000, 170000,
    ]);
    expect(parseQuotedPrices("R$ 150")).toEqual([15000]);
  });

  it("acusa preço que não está no catálogo autorizado", () => {
    const metrics = measureProse({
      text: "A lente fica R$ 1.800.",
      history: [],
      authorizedPriceCents: [200000, 170000],
    });

    expect(metrics.unauthorizedPriceCents).toEqual([180000]);
  });

  // O bug do vídeo em loop e o do "Recebi sua foto" reenviado são a mesma
  // família: bloco já dito que volta inteiro.
  it("detecta bloco já dito voltando no turno seguinte", () => {
    const previous = [
      {
        author: "agent" as const,
        body: "Você poderia me encaminhar uma foto do seu sorriso? Assim fazemos uma pré-avaliação por aqui.",
      },
    ];

    expect(
      repeatsPreviousBlock(
        "Estamos na Rua Exemplo. Você poderia me encaminhar uma foto do seu sorriso? Assim fazemos uma pré-avaliação por aqui.",
        previous,
      ),
    ).toBe(true);
    expect(repeatsPreviousBlock("Estamos na Rua Exemplo, 100.", previous)).toBe(
      false,
    );
  });

  it("agrega mediana e contagens sobre um conjunto de respostas", () => {
    const aggregate = aggregateProse([
      measureProse({ text: "curta", history: [], authorizedPriceCents: [] }),
      measureProse({
        text: `${"x".repeat(500)}? e?`,
        history: [],
        authorizedPriceCents: [],
      }),
      measureProse({ text: "[MIDIA:IMAGE]", history: [], authorizedPriceCents: [] }),
    ]);

    expect(aggregate.responses).toBe(3);
    expect(aggregate.responsesOver400Characters).toBe(1);
    expect(aggregate.responsesWithTwoOrMoreQuestions).toBe(1);
    expect(aggregate.mediaOnlyResponses).toBe(1);
  });
});
