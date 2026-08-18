import { readFileSync, writeFileSync } from "node:fs";
import { loadCorpus } from "@/application/corpus/corpus-index";
import type { CorpusCase } from "@/application/corpus/corpus-case";
import { expectedV1Intent } from "@/application/corpus/v1-understanding-adapter";
import {
  KEYWORD_PREDICATE_REGISTRY,
  type KeywordPredicate,
} from "@/core/observability/KeywordPredicateRegistry";
import {
  coerceBusinessIntent,
  detectAppointmentConfirmation,
  detectPatientArrivalText,
  didAgentAskToShowAvailability,
  isBusinessHoursQuestion,
  isClinicalTreatmentPlanJudgmentRequest,
  isDirectAddressQuestion,
  isEvaluationPriceRequest,
  isMediaClarificationRequest,
  isProcedureCatalogRequest,
  isRemotePreEvaluationRequest,
  isSaturdayQuestionForOperatingClinic,
  isSchedulingRequestText,
  isShortAffirmativeReply,
  isShowcaseRequestText,
  isSimplePaymentPolicyQuestion,
  isSocialProfileRequest,
} from "@/core/pipeline/ConversationOrchestrator";
import { normalizeFreeText } from "@/core/conversation/conversation-response-parts";
import { parseBusinessHours } from "@/core/scheduling/ClinicTimezone";

/**
 * Relatório do Ciclo D — o que cada predicado de keyword decide, medido sobre o
 * corpus inteiro.
 *
 * ## Por que não chama o classificador
 *
 * O D0 mediu que o classificador oscila entre execuções com a mesma entrada e
 * `temperature: 0`: cinco casos trocam de rótulo, e a amplitude dentro de uma
 * sessão é 1,6 ponto. Se este relatório chamasse o modelo, cada execução daria
 * um número diferente e creditaria a predicados divergências que são churn do
 * classificador — o erro que a pré-condição do Ciclo D existe para impedir.
 *
 * A referência usada é o **rótulo do corpus**, traduzido para o vocabulário da
 * V1 por `expectedV1Intent`. É determinístico, roda em CI, custa zero, e é a
 * mesma régua com que o baseline foi medido.
 *
 * ## O que "disparo" significa aqui
 *
 * O predicado é avaliado **isoladamente**, sobre a mensagem do caso. Isso mede
 * o poder discriminativo dele, não a frequência com que a produção o alcança —
 * vários só rodam sob guarda (`coerceBusinessIntent` exige intent conversacional).
 * A coluna `reachable` reporta separadamente quantos casos chegariam à coerção.
 *
 * Saída: `evals/corpus/predicate-overrides.json` e uma tabela no stdout,
 * ordenada por dano.
 */

const CORPUS_ROOT = "evals/corpus";
const STABILITY_FILE = `${CORPUS_ROOT}/measurement-stability-d0.json`;
const OUTPUT_FILE = `${CORPUS_ROOT}/predicate-overrides.json`;

/** Casos que o D0 mediu como instáveis entre execuções do MESMO sistema. */
function unstableCaseIds(): Set<string> {
  const stability = JSON.parse(readFileSync(STABILITY_FILE, "utf8")) as {
    unstableAcrossRuns: string[];
  };
  return new Set(stability.unstableAcrossRuns);
}

/** Saída do classificador guardada pelo D0, por caso. Cobre 22 dos 66. */
function storedClassifierIntents(): Map<string, string> {
  const stability = JSON.parse(readFileSync(STABILITY_FILE, "utf8")) as {
    perCase: Array<{ caseId: string; currentV1: string }>;
  };
  return new Map(stability.perCase.map((entry) => [entry.caseId, entry.currentV1]));
}

function lastAgentMessage(corpusCase: CorpusCase): string | null {
  for (let i = corpusCase.input.history.length - 1; i >= 0; i--) {
    const turn = corpusCase.input.history[i];
    if (turn.author === "agent" || turn.author === "operator") return turn.body;
  }
  return null;
}

/**
 * Como rodar cada predicado sobre um caso.
 *
 * Só entram os predicados alcançáveis a partir da superfície exportada. Os
 * demais ficam declarados como `null` e o relatório os reporta como não
 * sondáveis, em vez de silenciá-los — um predicado invisível ao instrumento é
 * um achado, não uma omissão.
 */
const PROBES: Record<
  string,
  ((corpusCase: CorpusCase) => boolean) | null
> = {
  // ── Sondáveis diretamente ────────────────────────────────────────────────
  isBusinessHoursQuestion: (c) => isBusinessHoursQuestion(c.input.leadMessage),
  isSchedulingRequestText: (c) => isSchedulingRequestText(normalizeFreeText(c.input.leadMessage)),
  isSimplePaymentPolicyQuestion: (c) => isSimplePaymentPolicyQuestion(c.input.leadMessage),
  isProcedureCatalogRequest: (c) => isProcedureCatalogRequest(c.input.leadMessage),
  isDirectAddressQuestion: (c) => isDirectAddressQuestion(c.input.leadMessage),
  isSocialProfileRequest: (c) => isSocialProfileRequest(c.input.leadMessage),
  isMediaClarificationRequest: (c) => isMediaClarificationRequest(c.input.leadMessage),
  detectPatientArrivalText: (c) => detectPatientArrivalText(c.input.leadMessage),
  detectAppointmentConfirmation: (c) =>
    detectAppointmentConfirmation(c.input.leadMessage) !== "ambiguous",
  isSaturdayQuestionForOperatingClinic: (c) =>
    isSaturdayQuestionForOperatingClinic(
      c.input.leadMessage,
      parseBusinessHours("Seg-Sex 09:00-18:00, Sáb 09:00-13:00"),
    ),
  didAgentAskToShowAvailability: (c) => didAgentAskToShowAvailability(lastAgentMessage(c)),
  isShortAffirmativeReply: (c) => isShortAffirmativeReply(c.input.leadMessage),
  isRemotePreEvaluationRequest: (c) => isRemotePreEvaluationRequest(c.input.leadMessage),
  isShowcaseRequestText: (c) => isShowcaseRequestText(c.input.leadMessage),
  isEvaluationPriceRequest: (c) => isEvaluationPriceRequest(c.input.leadMessage),
  isClinicalTreatmentPlanJudgmentRequest: (c) =>
    isClinicalTreatmentPlanJudgmentRequest(c.input.leadMessage),

  // ── Sondáveis pelo efeito, via a coerção que os encadeia ─────────────────
  // Não são exportados isoladamente. A sonda os observa pelo callback do
  // Ciclo D: roda a coerção com intent conversacional e lê qual disparou.
  isPriceRequestText: (c) => firedInsideCoercion(c, "isPriceRequestText"),
  isWarrantyQuestion: (c) => firedInsideCoercion(c, "isWarrantyQuestion"),
  isMaintenanceInquiryText: (c) => firedInsideCoercion(c, "isMaintenanceInquiryText"),
  isClinicNameOrAddressChangeQuestion: (c) =>
    firedInsideCoercion(c, "isClinicNameOrAddressChangeQuestion"),

  // ── Não sondáveis pelo corpus, e por quê ────────────────────────────────
  // Entrada estruturada: o corpus é de linguagem natural e não contém turnos de
  // menu numerado, então medir disparo aqui seria medir a ausência da fixture.
  isResetCommand: null,
  resolveMenuSelection: null,
  isMenuRerequest: null,
  // Lêem texto do próprio agente em posição que o corpus não reconstrói.
  messageOffersConcreteSlot: null,
  didAgentAskForProcedure: null,
  agentMessageEndsWithCta: null,
  leadEngagesWithCta: null,
  // Agregador: medido pelos predicados que encadeia, não por si.
  coerceBusinessIntent: null,
  // Dependem de estado de oferta pendente que o corpus não carrega.
  normalizeSchedulingIntentForMissingPendingOffer: null,
  // Exigem catálogo do tenant carregado; o corpus aponta para fixture de config.
  detectUncataloguedMaintenanceInquiry: null,
  // Wrappers de predicados já sondados, com a mesma decisão.
  isLocationRequest: null,
  isLocationRequestText: null,
  isProcedureCatalogRequestText: null,
  isUrgencyRequestText: null,
  isHumanRequestText: null,
  isPeriodPreferenceText: null,
  isIsolatedGreeting: null,
};

/** Roda a coerção com intent conversacional e diz se o predicado nomeado disparou. */
function firedInsideCoercion(corpusCase: CorpusCase, predicateName: string): boolean {
  let fired = false;
  coerceBusinessIntent({
    message: corpusCase.input.leadMessage,
    intent: "greeting",
    treatments: [],
    isClinicSegment: true,
    onPredicateEvaluated: (evaluation) => {
      if (evaluation.predicateName === predicateName && evaluation.predicateFired) {
        fired = true;
      }
    },
  });
  return fired;
}

type PredicateReport = {
  name: KeywordPredicate["name"];
  module: KeywordPredicate["module"];
  classification: KeywordPredicate["classification"];
  runtimeGate: KeywordPredicate["runtimeGate"];
  impliedIntent: string | null;
  probed: boolean;
  /** Casos estáveis em que o predicado dispara. */
  fires: number;
  /** Dispara e o intent que impõe bate com o rótulo do corpus. */
  agreesWithGold: number;
  /** Dispara e o intent que impõe contraria o rótulo do corpus. É o dano. */
  contradictsGold: number;
  /** Dispara em caso que o D0 mediu como instável — nunca creditado. */
  firesOnUnstable: number;
  /** Dispara e contraria a saída guardada do classificador (22 casos com dado). */
  divergesFromStoredClassifier: number;
  contradictedCaseIds: string[];
};

function main(): void {
  const corpus = loadCorpus(CORPUS_ROOT);
  const unstable = unstableCaseIds();
  const stored = storedClassifierIntents();

  const stableCases = corpus.cases.filter((c) => !unstable.has(c.caseId));

  const reports: PredicateReport[] = KEYWORD_PREDICATE_REGISTRY.map((predicate) => {
    const probe = PROBES[predicate.name];
    if (!probe) {
      return {
        name: predicate.name,
        module: predicate.module,
        classification: predicate.classification,
        runtimeGate: predicate.runtimeGate,
        impliedIntent: predicate.impliedIntent,
        probed: false,
        fires: 0,
        agreesWithGold: 0,
        contradictsGold: 0,
        firesOnUnstable: 0,
        divergesFromStoredClassifier: 0,
        contradictedCaseIds: [],
      };
    }

    let fires = 0;
    let agreesWithGold = 0;
    let contradictsGold = 0;
    let divergesFromStoredClassifier = 0;
    const contradictedCaseIds: string[] = [];

    for (const corpusCase of stableCases) {
      if (!probe(corpusCase)) continue;
      fires++;

      const gold = expectedV1Intent(corpusCase.labels.understanding.request);
      if (predicate.impliedIntent && gold) {
        if (predicate.impliedIntent === gold) agreesWithGold++;
        else {
          contradictsGold++;
          contradictedCaseIds.push(corpusCase.caseId);
        }
      }

      const classified = stored.get(corpusCase.caseId);
      if (classified && predicate.impliedIntent && predicate.impliedIntent !== classified) {
        divergesFromStoredClassifier++;
      }
    }

    const firesOnUnstable = corpus.cases.filter(
      (c) => unstable.has(c.caseId) && probe(c),
    ).length;

    return {
      name: predicate.name,
      module: predicate.module,
      classification: predicate.classification,
      runtimeGate: predicate.runtimeGate,
      impliedIntent: predicate.impliedIntent,
      probed: true,
      fires,
      agreesWithGold,
      contradictsGold,
      firesOnUnstable,
      divergesFromStoredClassifier,
      contradictedCaseIds,
    };
  });

  // Ordem por dano, como o plano pede.
  const byDamage = [...reports].sort(
    (a, b) => b.contradictsGold - a.contradictsGold || b.fires - a.fires,
  );

  const output = {
    generatedAt: new Date().toISOString(),
    corpus: {
      totalCases: corpus.cases.length,
      stableCases: stableCases.length,
      unstableExcluded: [...unstable].sort(),
    },
    reference: {
      kind: "corpus-gold-label",
      rationale:
        "O classificador não é chamado: o D0 mediu que ele oscila com a mesma entrada, e creditar essa oscilação a um predicado é o erro que a pré-condição do Ciclo D proíbe.",
      storedClassifierCoverage: stored.size,
    },
    registrySize: KEYWORD_PREDICATE_REGISTRY.length,
    damageByGate: {
      ungated: reports.filter((r) => r.runtimeGate === "ungated")
        .reduce((sum, r) => sum + r.contradictsGold, 0),
      intentGated: reports.filter((r) => r.runtimeGate === "intent-gated")
        .reduce((sum, r) => sum + r.contradictsGold, 0),
      stateGated: reports.filter((r) => r.runtimeGate === "state-gated")
        .reduce((sum, r) => sum + r.contradictsGold, 0),
    },
    counts: {
      feature: KEYWORD_PREDICATE_REGISTRY.filter((p) => p.classification === "feature").length,
      scar: KEYWORD_PREDICATE_REGISTRY.filter((p) => p.classification === "scar").length,
      probed: reports.filter((r) => r.probed).length,
      notProbed: reports.filter((r) => !r.probed).length,
    },
    predicates: byDamage,
  };

  writeFileSync(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`);

  console.log(`\ncorpus: ${corpus.cases.length} casos, ${stableCases.length} estáveis`);
  console.log(`registro: ${KEYWORD_PREDICATE_REGISTRY.length} predicados `
    + `(${output.counts.feature} feature, ${output.counts.scar} cicatriz)`);
  console.log(`sondados: ${output.counts.probed} · não sondáveis: ${output.counts.notProbed}\n`);

  const header = "predicado".padEnd(40) + "cls".padEnd(9) + "gate".padEnd(14)
    + "disp".padStart(5) + "acerta".padStart(8) + "erra".padStart(6) + "instv".padStart(7);
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of byDamage) {
    if (!r.probed) continue;
    console.log(
      r.name.padEnd(40)
      + (r.classification === "scar" ? "cicatriz" : "feature").padEnd(9)
      + r.runtimeGate.padEnd(14)
      + String(r.fires).padStart(5)
      + String(r.agreesWithGold).padStart(8)
      + String(r.contradictsGold).padStart(6)
      + String(r.firesOnUnstable).padStart(7),
    );
  }

  const notProbed = byDamage.filter((r) => !r.probed).map((r) => r.name);
  console.log(`\nnão sondáveis pelo corpus (${notProbed.length}): ${notProbed.join(", ")}`);
  console.log(`\nescrito em ${OUTPUT_FILE}\n`);
}

main();
