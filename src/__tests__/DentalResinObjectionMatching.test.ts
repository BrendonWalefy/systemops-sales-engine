import { describe, expect, it } from "vitest";
import { dentalResinV1 } from "@/application/templates/dental-resin-v1/manifest";
import { matchRegisteredObjection } from "@/core/pipeline/ConversationOrchestrator";

/**
 * O conteúdo autorizado só existe se o runtime conseguir alcançá-lo.
 *
 * `matchRegisteredObjection` casa a mensagem do lead contra o campo `objection`
 * de cada entrada cadastrada, por token distintivo: 5+ letras, fora da lista de
 * stopwords, fora dos genéricos do nicho (`preco`, `valor`, `dente`, `horario`,
 * `clinica`…), fora dos nomes de tratamento da clínica, e presente em UMA única
 * chave. Uma versão anterior deste template escrevia as chaves como taxonomia
 * ("Preço: o lead achou caro") e o resultado era 11 de 22 utterances casando —
 * todas as de preço falhavam, porque cinco chaves começavam com "Preço:" e
 * `preco` ainda por cima é genérico do nicho.
 *
 * Este arquivo roda o matcher REAL. Ele é a única prova que vale.
 */

/** Termos de tratamento da clínica: o matcher os descarta como genéricos. */
const TREATMENT_TERMS = [
  "Lentes de Resina",
  "Faceta de Resina",
  "Clareamento",
  "Manutenção Preventiva",
];

const objections = dentalResinV1.objections.map((o) => ({
  objection: o.objection,
  response: o.response,
}));

/** Fala realista do lead → índice da objeção que deve responder. */
const LEAD_UTTERANCES: Array<{ says: string; expects: number }> = [
  { says: "achei caro", expects: 0 },
  { says: "nossa, tá fora do meu orçamento agora", expects: 0 },
  { says: "quanto custa?", expects: 1 },
  { says: "e qual seria os valores?", expects: 1 },
  { says: "quanto vocês cobram nas lentes?", expects: 1 },
  { says: "minha amiga pagou 1800 nas 20", expects: 2 },
  { says: "vi mais barato em outro lugar", expects: 2 },
  { says: "tem desconto?", expects: 3 },
  { says: "vocês fazem alguma promoção esse mês?", expects: 3 },
  { says: "manda escrito aqui, não consegui ver a imagem", expects: 4 },
  { says: "da pra parcelar?", expects: 5 },
  { says: "aceita cartão de crédito?", expects: 5 },
  { says: "consigo dividir em quantas vezes?", expects: 5 },
  { says: "quanto tempo dura?", expects: 6 },
  { says: "qual a durabilidade disso?", expects: 6 },
  { says: "qual o prazo pra ficar pronto?", expects: 7 },
  { says: "demora muito?", expects: 7 },
  { says: "qual a diferença entre as duas opções?", expects: 8 },
  { says: "precisa desgastar o dente?", expects: 9 },
  { says: "tem anestesia? machuca muito?", expects: 9 },
  { says: "vou pensar melhor", expects: 10 },
  { says: "depois eu te chamo", expects: 10 },
  { says: "minha lente quebrou", expects: 11 },
  { says: "soltou uma faceta aqui", expects: 11 },
  { says: "fiz com vocês e descolou", expects: 12 },
  { says: "tem garantia?", expects: 12 },
];

describe("dental resin objections reach the runtime matcher", () => {
  it("matches every realistic lead utterance to the right objection", () => {
    const misses: string[] = [];
    for (const { says, expects } of LEAD_UTTERANCES) {
      const matched = matchRegisteredObjection(says, objections, TREATMENT_TERMS);
      if (matched?.objection !== objections[expects].objection) {
        misses.push(
          `"${says}" → ${matched ? `casou com "${matched.objection}"` : "NENHUMA"}` +
            ` (esperado "${objections[expects].objection}")`,
        );
      }
    }
    expect(misses, `${misses.length} de ${LEAD_UTTERANCES.length} falharam`).toEqual([]);
  });

  it("gives every authorized objection at least one utterance that reaches it", () => {
    // Sem isso, uma objeção pode ficar cadastrada e inalcançável para sempre.
    const reached = new Set(
      LEAD_UTTERANCES.map(
        ({ says }) => matchRegisteredObjection(says, objections, TREATMENT_TERMS)?.objection,
      ),
    );
    const unreachable = objections
      .map((o) => o.objection)
      .filter((key) => !reached.has(key));
    expect(unreachable).toEqual([]);
  });

  it("does not match an unrelated message", () => {
    // O matcher precisa continuar conservador: casar demais espalha a resposta
    // errada, que é como "Posso ver os horários de sexta?" já virou a objeção
    // de remarcação em produção.
    for (const noise of [
      "bom dia",
      "obrigada!",
      "qual o endereço de vocês?",
      "vocês atendem sábado?",
    ]) {
      expect(
        matchRegisteredObjection(noise, objections, TREATMENT_TERMS),
        `"${noise}" não deveria casar`,
      ).toBeNull();
    }
  });
});
