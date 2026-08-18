import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CALIBRATED_QUESTIONS_DIGEST,
  REVIEW_CHECKLIST_QUESTIONS,
  REVIEW_CHECKLIST_VERSION,
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
  // A régua foi calibrada no C.9 e está congelada: 91,7 / 91,7 / 87,5 / 87,5 de
  // concordância entre dois revisores independentes. Mudar o texto de uma
  // pergunta invalida essa medida e todos os rótulos derivados dela, então a
  // mudança tem de vir acompanhada de nova versão — e de nova calibração.
  it("mantém as perguntas congeladas na versão calibrada", () => {
    expect(REVIEW_CHECKLIST_VERSION).toBe("review-checklist.v2-calibrada");
    expect(
      createHash("sha256")
        .update(REVIEW_CHECKLIST_QUESTIONS.map((q) => `${q.field}:${q.question}`).join("\n"))
        .digest("hex"),
    ).toBe(CALIBRATED_QUESTIONS_DIGEST);
  });

  // Duas respostas idênticas em forma foram julgadas de modos opostos porque a
  // rubrica não dizia se catálogo ausente prova inexistência. A regra tem de
  // estar escrita na pergunta, não na cabeça de quem julga.
  it("a pergunta de lastro diz quando catálogo ausente prova inexistência", () => {
    const question = REVIEW_CHECKLIST_QUESTIONS.find(
      (item) => item.field === "factuallyCorrect",
    )!.question;

    expect(question).toMatch(/fechado|completo/);
    expect(question).toContain("ausência");
  });

  // "Parafusada", "não sai do lugar" e "voltar a comer carne" saíram de uma
  // descrição que só fala em prótese sobre implantes. Paráfrase que acrescenta
  // mecanismo, garantia ou resultado deixa de ser a fonte.
  it("a pergunta de lastro limita a paráfrase ao que a fonte implica", () => {
    const question = REVIEW_CHECKLIST_QUESTIONS.find(
      (item) => item.field === "factuallyCorrect",
    )!.question;

    expect(question).toMatch(/paráfrase|parafrase/i);
    expect(question).toMatch(/mecanismo/);
    expect(question).toMatch(/garantia/);
  });

  // A pergunta 2 estava sendo lida como "resolveu?" por um revisor e
  // "engajou?" pelo outro, e foi a única que regrediu na rodada do C.8.
  it("a pergunta de tratamento mede engajamento, não acerto", () => {
    const question = REVIEW_CHECKLIST_QUESTIONS.find(
      (item) => item.field === "addressedWhatTheLeadRaised",
    )!.question;

    expect(question).toMatch(/clarifica/i);
    expect(question).toMatch(/relevância, não acerto|independe|mesmo que/i);
    expect(question).toMatch(/pergunta 1|factual/i);
  });

  // A pergunta é a régua: se ela não distingue reconhecer de avançar, dois
  // revisores honestos divergem para sempre. Foi a única divergência que sobrou
  // depois de corrigir régua e renderer no C.7.
  it("a pergunta de avanço distingue reconhecer de aproximar de um passo", () => {
    const question = REVIEW_CHECKLIST_QUESTIONS.find(
      (item) => item.field === "advancedTheJourney",
    )!.question;

    expect(question).toContain("reduz");
    expect(question).toMatch(/reconhecimento|saudação|encerramento social/);
    expect(question).toMatch(/clarificação|clarifica/);
    expect(question).toContain("fabricad");
  });

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
