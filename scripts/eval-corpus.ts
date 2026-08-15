import { readFileSync, writeFileSync } from "node:fs";
import { loadCorpus } from "@/application/corpus/corpus-index";
import type { CorpusCase } from "@/application/corpus/corpus-case";
import { scoreUnderstanding } from "@/application/corpus/eval-understanding";
import {
  expectedV1Intent,
  v1Understanding,
} from "@/application/corpus/v1-understanding-adapter";
import { referenceDecider, runDecisionEval } from "@/application/corpus/eval-decision";
import { aggregateProse, measureProse } from "@/application/corpus/eval-prose";
import type { Message } from "@/domain/entities/conversation";

/**
 * Baseline da V1 nas três camadas, sobre o corpus revisado.
 *
 * Understanding chama o classificador real da V1 — é a única parte que gasta
 * API. Decision e prosa determinística rodam sem rede. O judge par a par é
 * opcional (`--judge`) e usa família de modelo diferente do composer.
 *
 * Nada aqui altera a V1. Bug encontrado vira caso de corpus, não correção.
 */

type TenantConfig = {
  services?: Array<{ name: string; priceCents: number | null }>;
};

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function toMessages(corpusCase: CorpusCase): Message[] {
  return corpusCase.input.history.map((turn, index) => ({
    id: `${corpusCase.caseId}-h${index}`,
    conversationId: corpusCase.caseId,
    author: turn.author === "operator" ? "clinic_user" : turn.author,
    body: turn.body,
    sentAt: new Date(corpusCase.source.capturedAt),
    externalId: null,
  })) as Message[];
}

function authorizedPrices(ref: string): number[] {
  const config = JSON.parse(
    readFileSync(`evals/corpus/tenant-configs/${ref}.json`, "utf8"),
  ) as TenantConfig;
  return (config.services ?? [])
    .map((service) => service.priceCents)
    .filter((value): value is number => value !== null);
}

async function main(): Promise<void> {
  const corpus = loadCorpus("evals/corpus");
  const startedAt = Date.now();

  // ── Camada 1: Understanding, chamando a V1 de verdade ────────────────────
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY ausente — rode via npm run eval:corpus");
  }
  const { IntentClassifier } = await import("@/core/intelligence/IntentClassifier");
  const classifier = new IntentClassifier();
  const model = process.env.OPENAI_CLASSIFIER_MODEL?.trim() || "gpt-4o-mini";

  const understandingResults: Array<{
    corpusCase: CorpusCase;
    produced: ReturnType<typeof v1Understanding>;
  }> = [];
  const intentOutcomes: Array<{
    caseId: string;
    expected: string | null;
    got: string | null;
    error: string | null;
  }> = [];
  let latencyTotalMs = 0;
  let classifierCalls = 0;

  for (const corpusCase of corpus.cases) {
    const expected = expectedV1Intent(corpusCase.labels.understanding.request);
    const treatments = (
      JSON.parse(
        readFileSync(
          `evals/corpus/tenant-configs/${corpusCase.input.tenantConfigRef}.json`,
          "utf8",
        ),
      ) as { services?: Array<{ name: string }> }
    ).services?.map((service) => ({ name: service.name, aliases: [] })) ?? [];

    // Turno iniciado pela clínica não tem mensagem de lead para classificar.
    if (!corpusCase.input.leadMessage.trim()) {
      understandingResults.push({ corpusCase, produced: {} });
      intentOutcomes.push({
        caseId: corpusCase.caseId,
        expected,
        got: null,
        error: "no_lead_message",
      });
      continue;
    }

    const callStartedAt = Date.now();
    try {
      const classification = await classifier.classify(
        corpusCase.input.leadMessage,
        toMessages(corpusCase),
        false,
        treatments as never,
      );
      latencyTotalMs += Date.now() - callStartedAt;
      classifierCalls += 1;
      understandingResults.push({
        corpusCase,
        produced: v1Understanding(classification.intent),
      });
      intentOutcomes.push({
        caseId: corpusCase.caseId,
        expected,
        got: classification.intent,
        error: null,
      });
    } catch (error) {
      understandingResults.push({ corpusCase, produced: {} });
      intentOutcomes.push({
        caseId: corpusCase.caseId,
        expected,
        got: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const comparable = intentOutcomes.filter(
    (outcome) => outcome.expected && outcome.got && !outcome.error,
  );
  const intentAccuracy =
    comparable.length === 0
      ? 0
      : comparable.filter((outcome) => outcome.expected === outcome.got).length /
        comparable.length;

  // A pontuação por eixo usa o vocabulário do corpus; a V1 responde em intent,
  // então o eixo `request` é comparado na régua dela e os demais aparecem com
  // produção zero — que é o retrato honesto do que a V1 entrega.
  const axisScores = scoreUnderstanding(
    understandingResults.map((result) => ({
      corpusCase: result.corpusCase,
      produced: result.produced.request
        ? {
            request:
              expectedV1Intent(result.corpusCase.labels.understanding.request) ===
              result.produced.request
                ? result.corpusCase.labels.understanding.request
                : `v1:${result.produced.request}`,
          }
        : {},
    })),
  );

  // ── Camada 2: Decision ───────────────────────────────────────────────────
  const configByRef = Object.fromEntries(
    [...new Set(corpus.cases.map((entry) => entry.input.tenantConfigRef))].map(
      (ref) => [ref, { hasCatalog: true, hasSchedule: true }],
    ),
  );
  const decision = runDecisionEval({
    cases: corpus.cases,
    decider: referenceDecider,
    configByRef,
  });

  // ── Camada 3: prosa determinística ───────────────────────────────────────
  const proseFor = (pick: (entry: CorpusCase) => string | null) =>
    aggregateProse(
      corpus.cases
        .map((entry) => {
          const text = pick(entry);
          if (!text) return null;
          return measureProse({
            text,
            history: entry.input.history,
            authorizedPriceCents: authorizedPrices(entry.input.tenantConfigRef),
          });
        })
        .filter((value): value is NonNullable<typeof value> => value !== null),
    );

  const baseline = {
    generatedAt: new Date().toISOString(),
    corpus: {
      totalCases: corpus.cases.length,
      shardHashes: Object.fromEntries(
        Object.entries(corpus.shards).map(([journey, cases]) => [
          journey,
          cases?.length ?? 0,
        ]),
      ),
    },
    understanding: {
      systemUnderTest: "v1-intent-classifier",
      model,
      axes: axisScores,
      intentAccuracyOnV1Vocabulary: intentAccuracy,
      comparableCases: comparable.length,
      skipped: intentOutcomes.filter((outcome) => outcome.error).length,
      confusions: comparable
        .filter((outcome) => outcome.expected !== outcome.got)
        .map((outcome) => ({
          caseId: outcome.caseId,
          expected: outcome.expected,
          got: outcome.got,
        })),
    },
    decision: {
      systemUnderTest: "reference-pure",
      v1Measurable: false,
      v1NotMeasurableReason:
        "A V1 não expõe função de decisão: o ActionResult é construído inline em ConversationOrchestrator.handle() junto com leitura de agenda e catálogo, e o sink de trace é noop em produção, então também não há registro histórico. Medir exigiria replay com banco e calendário, que não roda em CI.",
      ...decision,
    },
    prose: {
      v1Responses: proseFor((entry) => entry.observed.aiResponse),
      humanResponses: proseFor((entry) =>
        entry.source.kind === "curated_demo" ? null : entry.observed.humanResponse,
      ),
      curatedReferences: proseFor((entry) =>
        entry.source.kind === "curated_demo" ? entry.observed.humanResponse : null,
      ),
      judge: flag("judge") ? await runJudge(corpus.cases) : null,
    },
    cost: {
      classifierCalls,
      averageClassifierLatencyMs:
        classifierCalls === 0 ? 0 : Math.round(latencyTotalMs / classifierCalls),
      wallClockMs: Date.now() - startedAt,
    },
  };

  writeFileSync(
    "evals/corpus/baseline-v1.json",
    `${JSON.stringify(baseline, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(baseline, null, 2));
}

/**
 * Judge par a par, com o controle de viés de posição da spec já aprovada: cada
 * par é julgado duas vezes com a ordem invertida, e veredito que muda ao inverter
 * conta como empate, nunca como vitória.
 */
async function runJudge(cases: CorpusCase[]) {
  if (!process.env.ANTHROPIC_API_KEY) return { skipped: "no ANTHROPIC_API_KEY" };
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const judgeModel = process.env.CORPUS_JUDGE_MODEL?.trim() || "claude-sonnet-5";

  const pairs = cases.filter(
    (entry) => entry.observed.aiResponse && entry.observed.humanResponse,
  );

  let aiWins = 0;
  let humanWins = 0;
  let ties = 0;
  let unstable = 0;
  let errors = 0;
  let aiCharacters = 0;
  let humanCharacters = 0;
  let longerWon = 0;
  let firstError: string | null = null;

  for (const entry of pairs) {
    const verdicts: string[] = [];
    for (const flipped of [false, true]) {
      const first = flipped ? entry.observed.humanResponse! : entry.observed.aiResponse!;
      const second = flipped ? entry.observed.aiResponse! : entry.observed.humanResponse!;
      try {
        const response = await client.messages.create({
          model: judgeModel,
          max_tokens: 16,
          messages: [
            {
              role: "user",
              content: `Você julga qual das duas respostas de WhatsApp serve melhor ao lead nesta clínica.

Critérios, nesta ordem: (1) trata o que o lead levantou; (2) não afirma fato não autorizado; (3) leva a conversa a um próximo passo concreto; (4) tom natural e conciso para WhatsApp.

Contexto anterior:
${entry.input.history.map((turn) => `${turn.author}: ${turn.body}`).join("\n") || "(sem histórico)"}

Mensagem do lead:
${entry.input.leadMessage || "(turno iniciado pela clínica)"}

RESPOSTA A:
${first}

RESPOSTA B:
${second}

Responda exatamente uma palavra: A, B ou EMPATE.`,
            },
          ],
        });
        const block = response.content[0];
        const text = block && block.type === "text" ? block.text.trim().toUpperCase() : "";
        verdicts.push(
          flipped
            ? text === "A"
              ? "human"
              : text === "B"
                ? "ai"
                : "tie"
            : text === "A"
              ? "ai"
              : text === "B"
                ? "human"
                : "tie",
        );
      } catch (error) {
        errors += 1;
        firstError ??= error instanceof Error ? error.message : String(error);
        verdicts.push("error");
      }
    }

    aiCharacters += entry.observed.aiResponse!.length;
    humanCharacters += entry.observed.humanResponse!.length;

    if (verdicts.includes("error")) continue;
    if (verdicts[0] !== verdicts[1]) {
      unstable += 1;
      ties += 1;
      continue;
    }
    if (verdicts[0] === "ai") {
      aiWins += 1;
      if (entry.observed.aiResponse!.length > entry.observed.humanResponse!.length) {
        longerWon += 1;
      }
    } else if (verdicts[0] === "human") {
      humanWins += 1;
      if (entry.observed.humanResponse!.length > entry.observed.aiResponse!.length) {
        longerWon += 1;
      }
    } else {
      ties += 1;
    }
  }

  // Judge que não conseguiu julgar nenhum par não produziu medição nenhuma, e
  // reportar "0 vitórias" seria apresentar ausência de dado como resultado.
  if (errors >= pairs.length * 2 && pairs.length > 0) {
    return {
      model: judgeModel,
      blocked: true,
      reason: firstError?.slice(0, 300) ?? "unknown",
      pairs: pairs.length,
    };
  }

  const decided = aiWins + humanWins;
  return {
    model: judgeModel,
    pairs: pairs.length,
    judgements: pairs.length * 2,
    aiWins,
    humanWins,
    ties,
    unstableVerdicts: unstable,
    unstableRate: pairs.length === 0 ? 0 : unstable / pairs.length,
    longerAnswerWonRate: decided === 0 ? 0 : longerWon / decided,
    averageAiCharacters: pairs.length === 0 ? 0 : Math.round(aiCharacters / pairs.length),
    averageHumanCharacters:
      pairs.length === 0 ? 0 : Math.round(humanCharacters / pairs.length),
    errors,
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
