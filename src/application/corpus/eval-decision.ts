import type { CorpusCase } from "@/application/corpus/corpus-case";

/**
 * Camada 2 — Decision.
 *
 * Entrada: Understanding + estado + configuração. Esperado: `ActionResult`.
 * Determinística, sem modelo, roda inteira em CI — é a régua mais importante
 * para a V2, e é por isso que ela não pode depender de rede nem de banco.
 *
 * ## Por que a V1 não aparece aqui como sistema medido
 *
 * A V1 não expõe uma função de decisão. O `ActionResult` é construído inline
 * dentro de `ConversationOrchestrator.handle()`, misturado com leitura de agenda,
 * de catálogo e de estado, e o sink de trace é `noop` em produção — então também
 * não existe registro histórico de qual `ActionResult` a V1 produziu. Medir a
 * decisão da V1 exige replay com banco e calendário, que é caro e não roda em CI.
 *
 * Escrever aqui uma reimplementação das regras da V1 mediria a reimplementação.
 * O relatório diz "não separável" e mostra por quê; a inseparabilidade é o achado.
 *
 * ## O que esta camada mede então
 *
 * Quanto da decisão é **decidível sem I/O**. Cada caso do corpus é classificado
 * como `pure` (o `ActionResult` esperado sai de Understanding + estado + config)
 * ou `requires_io` (depende de agenda, catálogo dinâmico ou histórico externo).
 * Esse número é o orçamento de pureza que a V2 tem de respeitar, e o decisor de
 * referência prova que os casos `pure` fecham sem nenhuma chamada externa.
 */

export type DecisionInput = {
  understanding: CorpusCase["labels"]["understanding"];
  state: string | null;
  config: { hasCatalog: boolean; hasSchedule: boolean };
};

export type DecisionOutput = { type: string } | null;

export type Decider = {
  id: string;
  decide(input: DecisionInput): DecisionOutput;
};

/**
 * `ActionResult` que só existe depois de ler agenda ou catálogo dinâmico.
 * Nenhum decisor puro pode produzi-los, e cobrá-los seria cobrar adivinhação.
 */
export const IO_DEPENDENT_ACTIONS = new Set([
  "slots_found",
  "no_slots_available",
  "appointment_confirmed",
  "appointment_cancelled",
  "appointment_rescheduled",
  "appointments_listed",
  "no_appointments",
  "slots_expired",
  "slot_taken_reoffered",
  "evaluation_redirect",
  "appointment_reminder",
  "appointment_reminder_with_confirmation",
  "appointment_confirmation_accepted",
  "appointment_confirmation_rejected",
  "patient_arrived",
  "reengagement",
  "conversation_recovery",
  "video_sent_followup",
]);

export type DecisionCaseResult = {
  caseId: string;
  expected: string;
  got: string | null;
  purity: "pure" | "requires_io";
  correct: boolean;
};

export type DecisionReport = {
  deciderId: string;
  total: number;
  pureCases: number;
  ioCases: number;
  /** Acertos sobre os casos puros — os únicos que um decisor sem I/O pode acertar. */
  pureAccuracy: number;
  failures: DecisionCaseResult[];
};

export function runDecisionEval(params: {
  cases: CorpusCase[];
  decider: Decider;
  configByRef: Record<string, { hasCatalog: boolean; hasSchedule: boolean }>;
}): DecisionReport {
  const results: DecisionCaseResult[] = params.cases.map((corpusCase) => {
    const expected = corpusCase.labels.expectedActionResult.type;
    const purity = IO_DEPENDENT_ACTIONS.has(expected) ? "requires_io" : "pure";
    const got = params.decider.decide({
      understanding: corpusCase.labels.understanding,
      state: corpusCase.input.state,
      config: params.configByRef[corpusCase.input.tenantConfigRef] ?? {
        hasCatalog: true,
        hasSchedule: true,
      },
    });

    return {
      caseId: corpusCase.caseId,
      expected,
      got: got?.type ?? null,
      purity,
      correct: purity === "pure" && got?.type === expected,
    };
  });

  const pure = results.filter((result) => result.purity === "pure");
  return {
    deciderId: params.decider.id,
    total: results.length,
    pureCases: pure.length,
    ioCases: results.length - pure.length,
    pureAccuracy:
      pure.length === 0
        ? 0
        : pure.filter((result) => result.correct).length / pure.length,
    failures: pure.filter((result) => !result.correct),
  };
}

/**
 * Decisor de referência: mapeia `request` para `ActionResult` sem nenhuma leitura
 * externa. Existe para provar que os casos `pure` fecham de fato sem I/O — não é
 * candidato a produção nem modelo da V1.
 */
export const referenceDecider: Decider = {
  id: "reference-pure",
  decide({ understanding }) {
    if (understanding.safety.requestsHuman) {
      return { type: "handoff_requested" };
    }
    if (understanding.ambiguity) {
      return { type: "price_inquiry" };
    }

    switch (understanding.request) {
      case "price-of-service":
      case "price-objection":
      case "installment-terms":
      case "challenge-claim":
        return { type: "price_inquiry" };
      case "discount-request":
      case "reach-person":
        return { type: "handoff_requested" };
      case "clinical-suitability":
      case "clinical-advice":
        return understanding.request === "clinical-advice"
          ? { type: "handoff_requested" }
          : { type: "clinical_evaluation_required" };
      case "send-media":
        return { type: "media_received" };
      case "chitchat":
      case "confirm-intent":
      case "defer-answer":
      case "postpone":
      case "future-interest":
        return { type: "acknowledgment" };
      case "referral-intro":
        return { type: "clarification_needed" };
      case "service-information":
      case "service-availability":
      case "compare-services":
      case "procedure-duration":
      case "procedure-safety":
      case "treatment-timeline":
      case "clinic-address":
      case "clinic-city":
      case "evaluation-cost":
        return { type: "general_question" };
      case "check-availability":
        return { type: "clarification_needed" };
      default:
        return null;
    }
  },
};
