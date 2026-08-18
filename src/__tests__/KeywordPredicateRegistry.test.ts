import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  KEYWORD_PREDICATE_REGISTRY,
  KEYWORD_PREDICATE_SOURCES,
  predicatesDeclaredIn,
} from "@/core/observability/KeywordPredicateRegistry";

/**
 * O registro é o inventário do Ciclo D. Ele só vale se não puder derivar em
 * silêncio: a camada nasceu porque cada bug virou mais um `if`, e um inventário
 * que não trava é só uma foto que envelhece.
 *
 * Estes testes fazem o registro falhar quando alguém adicionar um predicado
 * novo sem registrá-lo — que é exatamente o momento em que a camada cresce.
 */
describe("registro de predicados de keyword", () => {
  it("cobre todo predicado declarado nos módulos sob inventário", () => {
    const unregistered: string[] = [];

    for (const source of KEYWORD_PREDICATE_SOURCES) {
      const declared = predicatesDeclaredIn(readFileSync(source.path, "utf8"));
      const registered = new Set(
        KEYWORD_PREDICATE_REGISTRY.filter((p) => p.module === source.module).map(
          (p) => p.name,
        ),
      );
      for (const name of declared) {
        if (!registered.has(name) && !source.exempt.includes(name)) {
          unregistered.push(`${source.module} → ${name}`);
        }
      }
    }

    expect(unregistered).toEqual([]);
  });

  it("não registra predicado que não existe mais no código", () => {
    // A varredura de `predicatesDeclaredIn` é deliberadamente conservadora e só
    // enxerga predicados booleanos. Aqui a pergunta é outra — "esta função
    // ainda existe?" — então basta procurar a declaração pelo nome, o que
    // também alcança os predicados registrados à mão que devolvem união.
    const sources = KEYWORD_PREDICATE_SOURCES.map((source) =>
      readFileSync(source.path, "utf8"),
    );

    const stale = KEYWORD_PREDICATE_REGISTRY.filter(
      (predicate) =>
        !sources.some((source) =>
          new RegExp(`^(?:export )?function ${predicate.name}\\s*[(<]`, "m").test(
            source,
          ),
        ),
    ).map((p) => p.name);

    expect(stale).toEqual([]);
  });

  it("dá a cada predicado um nome único", () => {
    const names = KEYWORD_PREDICATE_REGISTRY.map((p) => p.name);
    expect(names).toHaveLength(new Set(names).size);
  });

  it("exige evidência escrita para toda classificação", () => {
    const withoutEvidence = KEYWORD_PREDICATE_REGISTRY.filter(
      (p) => p.evidence.trim().length < 20,
    ).map((p) => p.name);

    expect(withoutEvidence).toEqual([]);
  });

  it("classifica como cicatriz todo predicado que reclassifica linguagem aberta", () => {
    // A régua do plano: *feature* é entrada estruturada (número, comando,
    // seleção de menu); *cicatriz* é reclassificar linguagem natural aberta.
    // Um predicado marcado `openLanguage` e classificado `feature` seria a
    // régua sendo contrariada em silêncio.
    const contradictions = KEYWORD_PREDICATE_REGISTRY.filter(
      (p) => p.readsOpenLanguage && p.classification === "feature",
    ).map((p) => p.name);

    expect(contradictions).toEqual([]);
  });
});
