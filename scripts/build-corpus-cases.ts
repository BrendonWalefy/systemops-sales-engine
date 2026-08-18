import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  parseCorpusCase,
  type CorpusCase,
  type Journey,
} from "@/application/corpus/corpus-case";
import {
  deriveBetterResponder,
  deriveProseLabel,
  type ReviewChecklist,
} from "@/application/corpus/review-checklist";
import type { StratifiedCandidate } from "@/application/corpus/candidate-stratification";
import { buildCorpusIndex, loadCorpus } from "@/application/corpus/corpus-index";

/**
 * Converte a amostra revisada em shards JSONL do corpus.
 *
 * O revisor autora só o julgamento — as quatro respostas do checklist, os eixos
 * de entendimento, o `ActionResult` esperado e as tags. Texto, hashes e
 * carimbos vêm do arquivo de candidatos, e o rótulo de prosa e a comparação
 * IA × humano são derivados aqui pelas mesmas funções que o parse cobra. Não há
 * caminho para escrever um rótulo à mão.
 */

type ChecklistTuple = [boolean, boolean, boolean, boolean];

type LabelEntry = {
  index: number;
  journey: Journey;
  understanding: CorpusCase["labels"]["understanding"];
  expectedActionResult: { type: string; [key: string]: unknown };
  ai: { checklist: ChecklistTuple; rationale: string } | null;
  human: { checklist: ChecklistTuple; rationale: string } | null;
  tags: string[];
};

type LabelFile = {
  reviewer: string;
  reviewedAt: string;
  tenantConfigByHash: Record<string, string>;
  cases: LabelEntry[];
};

function toChecklist(tuple: ChecklistTuple): ReviewChecklist {
  return {
    factuallyCorrect: tuple[0],
    addressedWhatTheLeadRaised: tuple[1],
    advancedTheJourney: tuple[2],
    wouldRepeatToday: tuple[3],
  };
}

function assess(
  entry: { checklist: ChecklistTuple; rationale: string } | null,
) {
  if (!entry) return null;
  const checklist = toChecklist(entry.checklist);
  return {
    checklist,
    label: deriveProseLabel(checklist),
    rationale: entry.rationale,
  };
}

/**
 * Casos escritos à mão: a demo curada e as regressões sintéticas.
 *
 * A demo curada entra como `humanResponse` porque foi escrita por uma pessoa
 * como referência — nunca existiu resposta da IA nesses turnos, e gravá-la como
 * `aiResponse` inventaria uma medição da V1 que não aconteceu.
 *
 * A regressão sintética entra ao contrário: `aiResponse` carrega o defeito
 * reconstruído, e o rótulo sai `anti-pattern` pelo mesmo checklist de todo mundo.
 */
type AuthoredEntry = {
  kind: "curated_demo" | "synthetic_regression";
  journey: Journey;
  tenantConfigRef: string;
  capturedAt: string;
  sourceRef: string;
  leadMessage: string;
  history: CorpusCase["input"]["history"];
  reference?: string;
  buggyAiResponse?: string;
  understanding: CorpusCase["labels"]["understanding"];
  expectedActionResult: { type: string; [key: string]: unknown };
  checklist: ChecklistTuple;
  rationale: string;
  tags: string[];
};

type AuthoredFile = {
  reviewer: string;
  reviewedAt: string;
  cases: AuthoredEntry[];
};

export function buildAuthoredCases(params: {
  authored: AuthoredFile;
  counters: Map<Journey, number>;
}): CorpusCase[] {
  return params.authored.cases.map((entry) => {
    const sequence = (params.counters.get(entry.journey) ?? 0) + 1;
    params.counters.set(entry.journey, sequence);

    const assessment = assess({
      checklist: entry.checklist,
      rationale: entry.rationale,
    });
    const isCurated = entry.kind === "curated_demo";

    return parseCorpusCase({
      schemaVersion: "corpus-case.v1",
      caseId: `${entry.journey}-${String(sequence).padStart(4, "0")}`,
      journey: entry.journey,
      source: {
        kind: entry.kind,
        tenantHash: syntheticHash(entry.tenantConfigRef),
        conversationHash: syntheticHash(entry.sourceRef),
        turnIndex: entry.history.length,
        capturedAt: entry.capturedAt,
      },
      input: {
        leadMessage: entry.leadMessage,
        history: entry.history,
        state: null,
        tenantConfigRef: entry.tenantConfigRef,
      },
      observed: {
        aiResponse: isCurated ? null : (entry.buggyAiResponse ?? null),
        humanResponse: isCurated ? (entry.reference ?? null) : null,
      },
      labels: {
        understanding: entry.understanding,
        expectedActionResult: entry.expectedActionResult,
        prose: {
          ai: isCurated ? null : assessment,
          human: isCurated ? assessment : null,
        },
        betterResponder: "not_applicable",
      },
      provenance: {
        reviewer: params.authored.reviewer,
        reviewedAt: params.authored.reviewedAt,
      },
      tags: entry.tags,
    });
  });
}

function syntheticHash(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

export function buildCases(params: {
  candidates: StratifiedCandidate[];
  labels: LabelFile;
  counters?: Map<Journey, number>;
}): CorpusCase[] {
  const counters = params.counters ?? new Map<Journey, number>();
  const cases: CorpusCase[] = [];

  for (const label of params.labels.cases) {
    const candidate = params.candidates[label.index];
    if (!candidate) {
      throw new Error(`label points at missing candidate index ${label.index}`);
    }
    const tenantConfigRef = params.labels.tenantConfigByHash[candidate.tenantHash];
    if (!tenantConfigRef) {
      throw new Error(`no tenant config mapped for hash ${candidate.tenantHash}`);
    }

    const sequence = (counters.get(label.journey) ?? 0) + 1;
    counters.set(label.journey, sequence);

    const ai = assess(label.ai);
    const human = assess(label.human);

    cases.push(
      parseCorpusCase({
        schemaVersion: "corpus-case.v1",
        caseId: `${label.journey}-${String(sequence).padStart(4, "0")}`,
        journey: label.journey,
        source: {
          kind: "historical",
          tenantHash: candidate.tenantHash,
          conversationHash: candidate.conversationHash,
          turnIndex: candidate.turnIndex,
          capturedAt: candidate.capturedAt,
        },
        input: {
          leadMessage: candidate.leadMessage,
          history: candidate.history,
          state: null,
          tenantConfigRef,
        },
        observed: {
          aiResponse: candidate.aiResponse,
          humanResponse: candidate.humanResponse,
        },
        labels: {
          understanding: label.understanding,
          expectedActionResult: label.expectedActionResult,
          prose: { ai, human },
          betterResponder: deriveBetterResponder(
            ai?.label ?? null,
            human?.label ?? null,
          ),
        },
        provenance: {
          reviewer: params.labels.reviewer,
          reviewedAt: params.labels.reviewedAt,
        },
        tags: label.tags,
      }),
    );
  }

  return cases;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const samplePath = requiredValue(argv, "--sample");
  const labelsPath = requiredValue(argv, "--labels");
  const authoredPath = requiredValue(argv, "--authored");
  const outputDirectory = requiredValue(argv, "--out-dir");

  const sample = JSON.parse(await readFile(samplePath, "utf8")) as {
    selected: StratifiedCandidate[];
  };
  const labels = JSON.parse(await readFile(labelsPath, "utf8")) as LabelFile;
  const authored = JSON.parse(await readFile(authoredPath, "utf8")) as AuthoredFile;

  // Contadores compartilhados: histórico numera primeiro, autorado continua a
  // sequência. caseId nunca é recontado depois de publicado.
  const counters = new Map<Journey, number>();
  const cases = [
    ...buildCases({ candidates: sample.selected, labels, counters }),
    ...buildAuthoredCases({ authored, counters }),
  ];

  const shards = new Map<Journey, CorpusCase[]>();
  for (const entry of cases) {
    const bucket = shards.get(entry.journey) ?? [];
    bucket.push(entry);
    shards.set(entry.journey, bucket);
  }

  await mkdir(outputDirectory, { recursive: true });
  for (const [journey, bucket] of shards) {
    const lines = bucket.map((entry) => JSON.stringify(entry)).join("\n");
    await writeFile(path.join(outputDirectory, `${journey}.jsonl`), `${lines}\n`, "utf8");
  }

  // O índice carrega hash por shard: edição à mão num JSONL aparece no diff do
  // índice em vez de passar como se o corpus não tivesse mudado.
  const corpusRoot = path.dirname(outputDirectory);
  const index = buildCorpusIndex(loadCorpus(corpusRoot));
  await writeFile(
    path.join(corpusRoot, "index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8",
  );

  console.log(
    JSON.stringify({
      outputDirectory,
      caseCount: cases.length,
      shards: Object.fromEntries(
        [...shards].map(([journey, bucket]) => [journey, bucket.length]),
      ),
    }),
  );
}

function requiredValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : null;
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

if (process.env.VITEST !== "true") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
