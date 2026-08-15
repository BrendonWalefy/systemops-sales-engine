import { describe, expect, it } from "vitest";
import { buildCorpusIndex, loadCorpus } from "@/application/corpus/corpus-index";

/**
 * O corpus versionado é o instrumento; se ele parar de carregar, toda medição
 * posterior mede outra coisa sem avisar. Este teste roda em CI a cada PR.
 */
const corpus = loadCorpus("evals/corpus");
const index = buildCorpusIndex(corpus);

describe("integridade do corpus commitado", () => {
  it("carrega todos os shards e valida cada caso contra o schema", () => {
    expect(index.totalCases).toBeGreaterThanOrEqual(60);
  });

  it("cobre as três origens de caso", () => {
    expect(index.countsBySourceKind.historical).toBeGreaterThan(0);
    expect(index.countsBySourceKind.curated_demo).toBeGreaterThan(0);
    expect(index.countsBySourceKind.synthetic_regression).toBeGreaterThan(0);
  });

  // Cada bug histórico da lista do ciclo tem de estar representado. Sem isso,
  // "a V2 não regride" seria promessa em vez de teste.
  it("representa cada bug histórico exigido pelo ciclo", () => {
    const required = [
      "regression:segunda-falso-indisponivel",
      "regression:horario-falso-como-funciona",
      "regression:preco-ambiguo-entre-servicos",
      "regression:preco-transplantado",
      "regression:servico-inventado",
      "regression:video-loop",
      "regression:objecao-ignorada",
      "regression:cta-repetido",
      "regression:handoff-por-estilo",
      "regression:prompt-injection-pelo-nome",
      "regression:recovery-inventa-fato",
      "regression:servico-inventado-sem-catalogo",
    ];
    expect(index.regressionTags).toEqual(expect.arrayContaining(required));
  });

  it("não deixa caso sem entendimento rotulado", () => {
    const missing = corpus.cases.filter(
      (entry) => !entry.labels.understanding.request,
    );
    expect(missing).toEqual([]);
  });

  it("aponta toda config de tenant para uma fixture existente", async () => {
    const { existsSync } = await import("node:fs");
    const missing = corpus.cases
      .map((entry) => entry.input.tenantConfigRef)
      .filter(
        (ref) => !existsSync(`evals/corpus/tenant-configs/${ref}.json`),
      );
    expect([...new Set(missing)]).toEqual([]);
  });
});
