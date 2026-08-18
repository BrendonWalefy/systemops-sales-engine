/**
 * Uma avaliação isolada de um predicado da camada de keyword.
 *
 * Existe porque a camada cresceu sem medição: cada bug de produção virou mais
 * um `if` no orquestrador, e nunca se soube quantas vezes um predicado dispara
 * nem quantas dessas vezes ele contraria o classificador. O Ciclo D mede antes
 * de qualquer remoção — a ordem inversa foi o que criou a camada.
 *
 * O registro é técnico por construção: nome de predicado, booleano e nomes de
 * intent. Nenhum campo carrega texto de conversa, e é isso que permite o
 * estágio atravessar o trace sem virar vazamento de PII.
 */
export type KeywordPredicateEvaluation = {
  /** Nome da função, exatamente como declarada no código. */
  predicateName: string;
  predicateFired: boolean;
  /** O que o classificador havia dito antes de qualquer coerção. */
  classifiedIntent: string;
  /** O intent que o predicado impõe ao disparar; `null` quando não impõe. */
  predicateIntent: string | null;
  /**
   * O predicado disparou **e** o intent que ele impõe difere do classificado.
   * É a única contagem que interessa para separar feature de cicatriz: um
   * predicado que só concorda com o classificador não está decidindo nada.
   */
  divergedFromClassifier: boolean;
};

export type KeywordPredicateObserver = (
  evaluation: KeywordPredicateEvaluation,
) => void;

/**
 * Monta a avaliação e deriva a divergência num lugar só, para que nenhum call
 * site possa registrar "disparou" e "divergiu" de forma inconsistente.
 */
export function evaluateKeywordPredicate(params: {
  predicateName: string;
  fired: boolean;
  classifiedIntent: string;
  predicateIntent: string | null;
}): KeywordPredicateEvaluation {
  const { predicateName, fired, classifiedIntent, predicateIntent } = params;
  return {
    predicateName,
    predicateFired: fired,
    classifiedIntent,
    predicateIntent,
    divergedFromClassifier:
      fired && predicateIntent !== null && predicateIntent !== classifiedIntent,
  };
}
