import { describe, expect, it } from "vitest";
import {
  compareProseLabels,
  deriveBetterResponder,
  deriveProseLabel,
  type ReviewChecklist,
} from "@/application/corpus/review-checklist";

const allTrue = {
  factuallyCorrect: true,
  addressedWhatTheLeadRaised: true,
  advancedTheJourney: true,
  wouldRepeatToday: true,
} satisfies ReviewChecklist;

describe("derivação de rótulo de prosa", () => {
  // A regra existe para impedir que uma resposta humana vire referência só por
  // ser humana: se o dado dito estava errado, nada mais compensa.
  it("erro de fato nunca é golden, mesmo com todo o resto bom", () => {
    expect(deriveProseLabel({ ...allTrue, factuallyCorrect: false })).toBe(
      "anti-pattern",
    );
  });

  it("golden exige as quatro afirmativas", () => {
    expect(deriveProseLabel(allTrue)).toBe("golden");
  });

  it("resposta correta que não avança a jornada é acceptable, não golden", () => {
    expect(
      deriveProseLabel({ ...allTrue, advancedTheJourney: false }),
    ).toBe("acceptable");
  });

  // A pergunta 2 cobre objeção e declaração, não só pergunta literal. Sem isso o
  // bug conhecido "IA ignora objeção cadastrada e pivota para avaliação" seria
  // rotulado golden: o lead não perguntou nada, então a pergunta antiga
  // ("respondeu a pergunta?") era vacuamente verdadeira.
  it("ignorar a objeção levantada derruba o rótulo de golden", () => {
    expect(
      deriveProseLabel({ ...allTrue, addressedWhatTheLeadRaised: false }),
    ).toBe("acceptable");
  });

  // Segundo achado do C2, contra caso real: no turno em que o lead perguntou o
  // valor pela segunda vez, a IA respondeu o menu de saudação. Não disse nada
  // falso, então a regra de fato não pega; não tratou o que foi levantado e não
  // avançou nada. Turno morto é "nunca faça isso", não "aceitável".
  it("turno que não trata nem avança é anti-pattern, não acceptable", () => {
    expect(
      deriveProseLabel({
        ...allTrue,
        addressedWhatTheLeadRaised: false,
        advancedTheJourney: false,
      }),
    ).toBe("anti-pattern");
  });
});

describe("comparação entre respondentes", () => {
  it("ordena os rótulos do pior para o melhor", () => {
    expect(compareProseLabels("golden", "acceptable")).toBeGreaterThan(0);
    expect(compareProseLabels("acceptable", "anti-pattern")).toBeGreaterThan(0);
    expect(compareProseLabels("golden", "golden")).toBe(0);
  });

  // O contraste IA × humano é o sinal mais rico do corpus, e é derivado dos
  // rótulos — ninguém escolhe "o humano foi melhor" na mão.
  it("deriva quem foi melhor a partir dos rótulos, sem escolha do revisor", () => {
    expect(deriveBetterResponder("golden", "acceptable")).toBe("ai");
    expect(deriveBetterResponder("acceptable", "golden")).toBe("human");
    expect(deriveBetterResponder("golden", "golden")).toBe("tie");
  });

  it("sem uma das respostas não há comparação a fazer", () => {
    expect(deriveBetterResponder("golden", null)).toBe("not_applicable");
    expect(deriveBetterResponder(null, "anti-pattern")).toBe("not_applicable");
    expect(deriveBetterResponder(null, null)).toBe("not_applicable");
  });
});
