/**
 * O rótulo de prosa é **derivado**, nunca escolhido.
 *
 * O revisor responde quatro perguntas objetivas sobre uma resposta observada; o
 * rótulo sai delas. Isso responde ao risco central do corpus: uma resposta
 * humana ruim virar `golden` só por ter sido escrita por uma pessoa, e uma
 * resposta boa da IA virar `anti-pattern` só por ter sido escrita por um modelo.
 *
 * Se o checklist der o rótulo errado num caso, a correção é consertar o
 * checklist e re-derivar tudo — nunca abrir exceção para aquele caso.
 */

export const REVIEW_CHECKLIST_VERSION = "review-checklist.v1" as const;

export type ReviewChecklist = {
  /** O dado afirmado estava correto no momento em que foi dito? */
  factuallyCorrect: boolean;
  /**
   * A resposta tratou o que o lead efetivamente levantou — a pergunta, a
   * objeção, a reclamação ou a foto?
   *
   * Formulada assim, e não como "respondeu a pergunta?", porque a maioria dos
   * turnos difíceis do histórico não tem pergunta nenhuma. Ver a nota de
   * self-review no fim deste arquivo.
   */
  addressedWhatTheLeadRaised: boolean;
  /**
   * A resposta aproximou a conversa de um próximo passo **válido, relevante e
   * executável** com os fatos e o estado disponíveis?
   *
   * Passo fabricado não é avanço. Oferecer horário realmente consultado pode
   * ser avanço; inventar horário não é. Oferecer desconto inexistente não é.
   * Responder à objeção e propor um próximo passo legítimo é.
   */
  advancedTheJourney: boolean;
  /** Você mandaria exatamente isso hoje, para este lead, neste ponto? */
  wouldRepeatToday: boolean;
};

export const REVIEW_CHECKLIST_QUESTIONS: ReadonlyArray<{
  field: keyof ReviewChecklist;
  question: string;
}> = [
  {
    field: "factuallyCorrect",
    question:
      "Toda afirmação factual ou operacional da resposta está sustentada pelos fatos disponíveis neste turno? (preço, desconto, pagamento, serviço e seus atributos, horário, disponibilidade, agendamento, endereço, garantia, condição comercial, ação que o sistema diz ter feito, capacidade prometida). Não demonstrado falso NÃO basta — sem evidência, responda N. Frase puramente social não precisa de lastro; frase social que promete capacidade operacional precisa.",
  },
  {
    field: "addressedWhatTheLeadRaised",
    question:
      "A resposta tratou o que o lead levantou — pergunta, objeção, reclamação ou mídia?",
  },
  {
    field: "advancedTheJourney",
    question:
      "A conversa ficou mais perto de um próximo passo válido, relevante e executável com os fatos e o estado disponíveis? Passo fabricado (horário inventado, desconto inexistente) NÃO conta como avanço.",
  },
  {
    field: "wouldRepeatToday",
    question: "Você mandaria exatamente isso hoje, neste ponto da conversa?",
  },
];

export type ProseLabel = "golden" | "acceptable" | "anti-pattern";

export type BetterResponder = "ai" | "human" | "tie" | "not_applicable";

export function deriveProseLabel(checklist: ReviewChecklist): ProseLabel {
  if (!checklist.factuallyCorrect) return "anti-pattern";
  // Turno morto: não tratou o que o lead levantou e não avançou nada. Sem esta
  // regra a única forma de chegar a anti-pattern era errar um fato, e a resposta
  // que ignora a pergunta e devolve menu de saudação saía como "aceitável".
  if (!checklist.addressedWhatTheLeadRaised && !checklist.advancedTheJourney) {
    return "anti-pattern";
  }
  if (
    checklist.addressedWhatTheLeadRaised &&
    checklist.advancedTheJourney &&
    checklist.wouldRepeatToday
  ) {
    return "golden";
  }
  return "acceptable";
}

const PROSE_LABEL_RANK: Record<ProseLabel, number> = {
  "anti-pattern": 0,
  acceptable: 1,
  golden: 2,
};

export function compareProseLabels(a: ProseLabel, b: ProseLabel): number {
  return PROSE_LABEL_RANK[a] - PROSE_LABEL_RANK[b];
}

/**
 * Quem respondeu melhor naquele turno, derivado dos rótulos das duas respostas.
 *
 * Existe porque o corpus precisa carregar os dois contrastes que o programa quer
 * medir — "IA melhor que humano" e "humano melhor que IA" — sem que alguém
 * escolha o vencedor no olho.
 */
export function deriveBetterResponder(
  aiLabel: ProseLabel | null,
  humanLabel: ProseLabel | null,
): BetterResponder {
  if (!aiLabel || !humanLabel) return "not_applicable";
  const comparison = compareProseLabels(aiLabel, humanLabel);
  if (comparison > 0) return "ai";
  if (comparison < 0) return "human";
  return "tie";
}

/**
 * ── Self-review das quatro perguntas (Ciclo C2) ──────────────────────────────
 *
 * Pergunta que o autor do programa mandou responder antes de congelar:
 * *"estas perguntas conseguem diferenciar uma resposta comercialmente excelente
 * de uma resposta apenas correta?"*
 *
 * **Não conseguem, e não deveriam.** Duas respostas ao mesmo "qual o valor das
 * lentes?" — "R$ 2.000 por unidade. Quer agendar uma avaliação?" e "R$ 2.000 por
 * unidade; no pacote de 10 sai R$ 1.800 cada, que é o que a maioria faz. Vejo um
 * horário essa semana?" — marcam as quatro afirmativas e saem as duas como
 * `golden`. A segunda é comercialmente melhor. O checklist é um **piso**
 * (isto pode ser imitado?), não um ranking; separar excelente de correto é
 * exatamente o trabalho do judge par a par, que é comparativo por construção.
 * Acrescentar aqui uma quinta pergunta de "excelência comercial" transformaria
 * uma pergunta objetiva num juízo de gosto, e é ele que o judge existe para dar.
 *
 * **Insuficiência concreta que existia, e o ajuste mínimo que ela obrigou.** A
 * pergunta 2 estava escrita como *"respondeu a pergunta?"*. Contra o bug real já
 * registrado no projeto — a IA ignora a objeção cadastrada e pivota para
 * "avaliação" — ela é vacuamente verdadeira: em "achei caro" o lead não fez
 * pergunta nenhuma. A resposta "Entendo! Temos parcelamento em até 12x. Quer
 * agendar uma avaliação?" marcaria as quatro e sairia **golden**, ou seja, o
 * checklist rotularia como referência um defeito conhecido. Trocar a pergunta
 * por "tratou o que o lead levantou?" fecha o buraco sem acrescentar campo:
 * mesmo custo de revisão, mesma derivação, e o turno sem pergunta passa a ser
 * avaliável. Nenhuma outra das quatro mostrou insuficiência demonstrável com
 * exemplo real, então nenhuma outra mudou.
 *
 * **Segunda insuficiência, achada rotulando o histórico real.** Com a regra
 * original, o único caminho para `anti-pattern` era errar um fato. No caso
 * `price-0001` — Ximendes, 15/06 — o lead pergunta o valor pela segunda vez e a
 * IA devolve o menu de saudação ("valores, agendamento ou algum serviço
 * específico?"). Nada falso foi dito, então a regra de fato não pega, e o turno
 * saía `acceptable`. Um turno que não trata o que o lead levantou **e** não
 * avança nada é "nunca faça isso", não "aceitável". A derivação ganhou essa
 * segunda regra; as quatro perguntas continuam as mesmas.
 */
