import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import {
  parseCorpusCase,
  type CorpusCase,
  type Journey,
} from "@/application/corpus/corpus-case";
import type { ProseLabel } from "@/application/corpus/review-checklist";

/**
 * Carga e verificação do corpus em disco.
 *
 * O formato é um shard JSONL por jornada, um caso por linha. É greppável,
 * diffável, e dois revisores em jornadas diferentes não conflitam em merge —
 * que é o requisito para o corpus crescer de 60 para milhares sem virar um
 * arquivo intratável.
 */

export const CORPUS_INDEX_VERSION = "corpus-index.v1" as const;

export type LoadedCorpus = {
  root: string;
  cases: CorpusCase[];
  /** Casos agrupados por shard, na ordem em que aparecem no arquivo. */
  shards: Partial<Record<Journey, CorpusCase[]>>;
};

export type CorpusIndex = {
  version: typeof CORPUS_INDEX_VERSION;
  totalCases: number;
  countsByJourney: Partial<Record<Journey, number>>;
  countsBySourceKind: Record<CorpusCase["source"]["kind"], number>;
  countsByAiProseLabel: Record<ProseLabel, number>;
  countsByHumanProseLabel: Record<ProseLabel, number>;
  countsByBetterResponder: Record<
    CorpusCase["labels"]["betterResponder"],
    number
  >;
  requestVocabulary: Record<string, number>;
  regressionTags: string[];
  shardHashes: Partial<Record<Journey, string>>;
};

export function loadCorpus(root: string): LoadedCorpus {
  const casesDirectory = join(root, "cases");
  if (!existsSync(casesDirectory)) {
    throw new Error(`corpus has no cases directory at ${casesDirectory}`);
  }

  const cases: CorpusCase[] = [];
  const shards: Partial<Record<Journey, CorpusCase[]>> = {};
  const seenIds = new Map<string, string>();

  const files = readdirSync(casesDirectory)
    .filter((entry) => entry.endsWith(".jsonl"))
    .sort();

  for (const file of files) {
    const shardJourney = basename(file, ".jsonl");
    const contents = readFileSync(join(casesDirectory, file), "utf8");
    const lines = contents.split("\n").filter((line) => line.trim().length > 0);
    const shardCases: CorpusCase[] = [];

    lines.forEach((line, index) => {
      const location = `${file}:${index + 1}`;
      let parsed: CorpusCase;
      try {
        parsed = parseCorpusCase(JSON.parse(line));
      } catch (error) {
        throw new Error(
          `${location}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (parsed.journey !== shardJourney) {
        throw new Error(
          `${location}: case ${parsed.caseId} has journey ${parsed.journey} but lives in the ${shardJourney} shard`,
        );
      }
      const previous = seenIds.get(parsed.caseId);
      if (previous) {
        throw new Error(
          `${location}: duplicate caseId ${parsed.caseId}, already defined in ${previous}`,
        );
      }
      seenIds.set(parsed.caseId, location);
      shardCases.push(parsed);
      cases.push(parsed);
    });

    shards[shardJourney as Journey] = shardCases;
  }

  return { root, cases, shards };
}

export function hashShard(shardCases: CorpusCase[]): string {
  const canonical = shardCases.map((entry) => JSON.stringify(entry)).join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function buildCorpusIndex(corpus: LoadedCorpus): CorpusIndex {
  const countsByJourney: Partial<Record<Journey, number>> = {};
  const countsBySourceKind = {
    historical: 0,
    curated_demo: 0,
    synthetic_regression: 0,
  };
  const emptyLabelCounts = (): Record<ProseLabel, number> => ({
    golden: 0,
    acceptable: 0,
    "anti-pattern": 0,
  });
  const countsByAiProseLabel = emptyLabelCounts();
  const countsByHumanProseLabel = emptyLabelCounts();
  const countsByBetterResponder = {
    ai: 0,
    human: 0,
    tie: 0,
    not_applicable: 0,
  };
  const requestVocabulary: Record<string, number> = {};
  const regressionTags = new Set<string>();

  for (const entry of corpus.cases) {
    countsByJourney[entry.journey] = (countsByJourney[entry.journey] ?? 0) + 1;
    countsBySourceKind[entry.source.kind] += 1;
    if (entry.labels.prose.ai) {
      countsByAiProseLabel[entry.labels.prose.ai.label] += 1;
    }
    if (entry.labels.prose.human) {
      countsByHumanProseLabel[entry.labels.prose.human.label] += 1;
    }
    countsByBetterResponder[entry.labels.betterResponder] += 1;
    const request = entry.labels.understanding.request;
    requestVocabulary[request] = (requestVocabulary[request] ?? 0) + 1;
    for (const tag of entry.tags) {
      if (tag.startsWith("regression:")) regressionTags.add(tag);
    }
  }

  const shardHashes: Partial<Record<Journey, string>> = {};
  for (const [journey, shardCases] of Object.entries(corpus.shards)) {
    shardHashes[journey as Journey] = hashShard(shardCases ?? []);
  }

  return {
    version: CORPUS_INDEX_VERSION,
    totalCases: corpus.cases.length,
    countsByJourney,
    countsBySourceKind,
    countsByAiProseLabel,
    countsByHumanProseLabel,
    countsByBetterResponder,
    requestVocabulary,
    regressionTags: [...regressionTags].sort(),
    shardHashes,
  };
}
