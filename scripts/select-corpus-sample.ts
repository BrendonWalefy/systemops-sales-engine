import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  guessJourneyForSampling,
  type CorpusCandidate,
  type StratifiedCandidate,
} from "@/application/corpus/candidate-stratification";
import type { Journey } from "@/application/corpus/corpus-case";

/**
 * Seleção determinística da amostra que vai à revisão.
 *
 * Lê os arquivos de candidatos produzidos por `export-corpus-candidates.ts` —
 * que vivem fora do repositório — e escolhe, por jornada, uma mistura
 * deliberada de contrastes. Não toca o banco.
 *
 * Determinismo importa: a mesma entrada tem de produzir a mesma amostra, senão
 * "o corpus mudou" e "a amostra mudou" viram a mesma coisa e nenhum baseline é
 * comparável. A ordenação é por hash estável do candidato, nunca `Math.random`.
 */

/**
 * Cota por jornada, calibrada contra a distribuição real medida em 15/08 sobre
 * 7.720 turnos, e não contra a tabela otimista do plano. Jornada que o banco
 * quase não tem entra com 1 — forçar número produziria caso fabricado.
 */
const QUOTA: Partial<Record<Journey, number>> = {
  price: 6,
  other: 5,
  "first-contact": 4,
  objection: 3,
  burst: 3,
  media: 3,
  availability: 3,
  scheduling: 2,
  location: 2,
  procedure: 2,
  discount: 2,
  audio: 2,
  reschedule: 1,
  comparison: 1,
  ambiguity: 1,
  handoff: 1,
};

export type ContrastKind =
  | "ai_and_human"
  | "human_only"
  | "ai_only"
  | "unanswered";

const CONTRAST_ORDER: ContrastKind[] = [
  "ai_and_human",
  "human_only",
  "ai_only",
  "unanswered",
];

export function contrastKind(candidate: CorpusCandidate): ContrastKind {
  if (candidate.aiResponse && candidate.humanResponse) return "ai_and_human";
  if (candidate.humanResponse) return "human_only";
  if (candidate.aiResponse) return "ai_only";
  return "unanswered";
}

export function selectSample(
  candidates: StratifiedCandidate[],
  quota: Partial<Record<Journey, number>>,
): StratifiedCandidate[] {
  const byJourney = new Map<Journey, StratifiedCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byJourney.get(candidate.journey) ?? [];
    bucket.push(candidate);
    byJourney.set(candidate.journey, bucket);
  }

  const selected: StratifiedCandidate[] = [];
  for (const [journey, wanted] of Object.entries(quota) as Array<
    [Journey, number]
  >) {
    const byContrast = new Map<ContrastKind, StratifiedCandidate[]>();
    for (const candidate of byJourney.get(journey) ?? []) {
      const kind = contrastKind(candidate);
      const entries = byContrast.get(kind) ?? [];
      entries.push(candidate);
      byContrast.set(kind, entries);
    }
    for (const entries of byContrast.values()) {
      entries.sort((a, b) =>
        stableRank(a.candidateId).localeCompare(stableRank(b.candidateId)),
      );
    }

    // Rodízio pelos contrastes: a cota se reparte entre "IA e humano", "só
    // humano", "só IA" e "sem resposta" em vez de esgotar o mais abundante.
    // Como 48,8% dos turnos reais ficaram sem resposta em duas horas, sem o
    // rodízio a amostra sairia quase toda de conversa que ninguém respondeu.
    const taken: StratifiedCandidate[] = [];
    for (let round = 0; taken.length < wanted; round += 1) {
      let progressed = false;
      for (const kind of CONTRAST_ORDER) {
        if (taken.length >= wanted) break;
        const entry = byContrast.get(kind)?.[round];
        if (entry) {
          taken.push(entry);
          progressed = true;
        }
      }
      if (!progressed) break;
    }
    selected.push(...taken);
  }

  return selected;
}

function stableRank(candidateId: string): string {
  return createHash("sha256").update(candidateId).digest("hex");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const inputDirectory = requiredValue(argv, "--in-dir");
  const outputPath = requiredValue(argv, "--out");

  const files = (await readdir(inputDirectory)).filter((entry) =>
    entry.endsWith(".candidates.json"),
  );
  if (files.length === 0) {
    throw new Error(`no candidate files in ${inputDirectory}`);
  }

  const all: StratifiedCandidate[] = [];
  for (const file of files) {
    const parsed = JSON.parse(
      await readFile(path.join(inputDirectory, file), "utf8"),
    ) as { candidates: CorpusCandidate[] };
    for (const candidate of parsed.candidates) {
      all.push({ ...candidate, journey: guessJourneyForSampling(candidate) });
    }
  }

  const selected = selectSample(all, QUOTA);
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalCandidates: all.length,
        selectedCount: selected.length,
        quota: QUOTA,
        selected,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  const byJourney: Record<string, number> = {};
  const byContrast: Record<string, number> = {};
  for (const entry of selected) {
    byJourney[entry.journey] = (byJourney[entry.journey] ?? 0) + 1;
    const kind = contrastKind(entry);
    byContrast[kind] = (byContrast[kind] ?? 0) + 1;
  }
  console.log(
    JSON.stringify({
      outputPath,
      selectedCount: selected.length,
      byJourney,
      byContrast,
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
