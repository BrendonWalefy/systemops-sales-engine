import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCorpusIndex, loadCorpus } from "@/application/corpus/corpus-index";

/**
 * O corpus versionado é o instrumento; se ele parar de carregar, toda medição
 * posterior mede outra coisa sem avisar. Este teste roda em CI a cada PR.
 */
const corpus = loadCorpus("evals/corpus");
const index = buildCorpusIndex(corpus);

type TenantFixture = {
  ref: string;
  facts?: Record<string, { status: string; value: string | null; source: string | null }>;
  services?: Array<{ name: string; description?: string }>;
  catalogCompleteness?: { status: "closed" | "unknown"; source: string };
};

const fixtures: TenantFixture[] = readdirSync("evals/corpus/tenant-configs")
  .filter((file) => file.endsWith(".json"))
  .map((file) =>
    JSON.parse(readFileSync(`evals/corpus/tenant-configs/${file}`, "utf8")),
  );

/**
 * Texto longo que termina sem fechar a frase é corte, não conteúdo.
 *
 * A política comercial do `dental-a` tem 1818 caracteres e a fixture guardava
 * 600; "21x / 5% no Pix" está na posição 744. O revisor marcou a resposta como
 * sem lastro porque o lastro tinha sido cortado fora — e os dois lados estavam
 * certos sobre coisas diferentes.
 */
function pareceTruncado(value: string): boolean {
  return value.length >= 100 && !/[.!?…)\]"']\s*$/.test(value);
}

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

  it("não guarda fato de tenant cortado no meio da frase", () => {
    const cortados: string[] = [];
    for (const fixture of fixtures) {
      for (const [key, fact] of Object.entries(fixture.facts ?? {})) {
        if (fact.value && pareceTruncado(fact.value)) {
          cortados.push(`${fixture.ref}.facts.${key}`);
        }
      }
      for (const service of fixture.services ?? []) {
        if (service.description && pareceTruncado(service.description)) {
          cortados.push(`${fixture.ref}.services["${service.name}"].description`);
        }
      }
    }
    expect(cortados).toEqual([]);
  });

  // Contagem de mídia não diz o que a mídia mostra, e foi por isso que duas
  // afirmações sobre o conteúdo do vídeo ficaram sem como ser julgadas. Ou a
  // fixture nomeia os assets, ou declara que o conteúdo é desconhecido.
  it("descreve a mídia disponível ou declara que o conteúdo é desconhecido", () => {
    const semProvenance: string[] = [];
    for (const fixture of fixtures) {
      const media = fixture.facts?.mediaLibrary;
      if (!media || media.status !== "known") continue;
      const value = media.value ?? "";
      const nomeia = /"/.test(value);
      const declaraDesconhecido = /conteúdo não registrado|título não registrado/i.test(value);
      if (!nomeia && !declaraDesconhecido) semProvenance.push(fixture.ref);
    }
    expect(semProvenance).toEqual([]);
  });

  // Ausência no catálogo só prova inexistência se o catálogo for completo. Sem
  // essa declaração, "não trabalhamos com porcelana" e "vocês fazem porcelana?"
  // são julgados por réguas opostas conforme quem lê.
  it("declara se o catálogo do tenant é fechado ou de completude desconhecida", () => {
    for (const fixture of fixtures) {
      expect(fixture.catalogCompleteness, fixture.ref).toBeDefined();
      expect(["closed", "unknown"]).toContain(
        fixture.catalogCompleteness!.status,
      );
      expect(fixture.catalogCompleteness!.source.length).toBeGreaterThan(0);
    }
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
