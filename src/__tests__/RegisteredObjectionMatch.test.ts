// Bug garantia jul/2026: quando o lead pergunta algo coberto por uma OBJEÇÃO
// cadastrada (ex.: "as lentes têm garantia? e a manutenção?"), a IA ignorava a
// resposta cadastrada e caía no handoff genérico ("manda foto, equipe notificada").
// A causa é de roteamento: garantia/manutenção viram needs_human ANTES de a
// objeção ser consultada. matchRegisteredObjection é o que permite honrar a
// resposta que a clínica JÁ cadastrou — de forma conservadora, sem sequestrar
// casos legítimos que devem ir ao humano.
//
// As objeções abaixo são as REAIS da Vitalli (bundled numa linha só) — o caso que
// o replay de produção validou. O gatilho de garantia junta 3 perguntas.

import { describe, it, expect } from "vitest";
import { matchRegisteredObjection } from "@/core/pipeline/ConversationOrchestrator";

// Amostra fiel do playbook ativo da Vitalli (jul/2026).
const objections = [
  { objection: "Qual o valor do tratamento?", response: "O investimento varia conforme a técnica…" },
  { objection: "Precisa desgastar muito os dentes?", response: "A nossa abordagem é conservadora…" },
  { objection: "Quanto tempo dura? Tem garantia e como é a manutenção?", response: "Damos garantia de 2 anos caso a lente descole, e 30 dias contra pigmentação…" },
  { objection: "Vocês fazem somente as lentes inferiores?", response: "Fazemos sim! Mas recomendamos avaliar todo o sorriso…" },
  { objection: "O procedimento demora quanto tempo?", response: "O procedimento leva de 3 a 4 horas…" },
];

// Nomes de tratamento genéricos do nicho (aparecem em quase tudo).
const treatmentNames = ["Lentes em Resina Composta", "Lente em Resina Premium", "Avaliação Clínica Inicial"];

describe("matchRegisteredObjection", () => {
  it("casa a pergunta de garantia com a objeção COMPOSTA de garantia (caso real Vitalli)", () => {
    const m = matchRegisteredObjection("as lentes têm garantia? e a manutenção?", objections, treatmentNames);
    expect(m?.objection).toBe("Quanto tempo dura? Tem garantia e como é a manutenção?");
  });

  it("casa uma pergunta de garantia isolada pela palavra distintiva 'garantia'", () => {
    const m = matchRegisteredObjection("vocês dão garantia nas lentes?", objections, treatmentNames);
    expect(m?.objection).toBe("Quanto tempo dura? Tem garantia e como é a manutenção?");
  });

  it("casa 'manutenção' com a mesma objeção composta", () => {
    const m = matchRegisteredObjection("e a manutenção, como funciona?", objections, treatmentNames);
    expect(m?.objection).toBe("Quanto tempo dura? Tem garantia e como é a manutenção?");
  });

  it("NÃO casa por um nome de produto genérico ('lentes')", () => {
    // "lentes" aparece num gatilho mas é nome de tratamento → não distingue objeção.
    expect(matchRegisteredObjection("as lentes são boas mesmo?", objections, treatmentNames)).toBeNull();
  });

  it("NÃO casa por um token que aparece em várias objeções ('tempo')", () => {
    // "tempo" está em duas objeções (dura/demora) → não é distintivo, não casa.
    expect(matchRegisteredObjection("isso leva muito tempo?", objections, treatmentNames)).toBeNull();
  });

  it("casa 'desgastar' com a objeção de desgaste (token forte e único)", () => {
    const m = matchRegisteredObjection("vai precisar desgastar meus dentes?", objections, treatmentNames);
    expect(m?.objection).toBe("Precisa desgastar muito os dentes?");
  });

  it("retorna null quando não há objeção de garantia cadastrada", () => {
    const semGarantia = objections.filter((o) => !o.objection.includes("garantia"));
    expect(matchRegisteredObjection("as lentes têm garantia?", semGarantia, treatmentNames)).toBeNull();
  });

  it("é seguro para listas vazias, nulas e objeções malformadas", () => {
    expect(matchRegisteredObjection("garantia?", null)).toBeNull();
    expect(matchRegisteredObjection("garantia?", [])).toBeNull();
    expect(matchRegisteredObjection("garantia?", [{ objection: "", response: "x" }])).toBeNull();
    expect(matchRegisteredObjection("garantia?", [{ objection: "garantia", response: "" }])).toBeNull();
    expect(matchRegisteredObjection("", objections, treatmentNames)).toBeNull();
  });
});
