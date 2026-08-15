import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadCorpus } from "@/application/corpus/corpus-index";
import { parseCorpusCase, type CorpusCase } from "@/application/corpus/corpus-case";
import {
  deriveBetterResponder,
  deriveProseLabel,
  type ReviewChecklist,
} from "@/application/corpus/review-checklist";

/**
 * Re-deriva o checklist dos casos depois de uma mudança na **definição** das
 * perguntas.
 *
 * Existe porque mudar a régua e editar só as divergências produziria um corpus
 * meio antigo e meio novo, sem ninguém saber qual metade é qual. O arquivo de
 * revisão traz o checklist inteiro de cada lado que muda; rótulo e comparação
 * IA × humano continuam derivados, e a proveniência guarda quem julgou primeiro.
 *
 * Não escreve rótulo à mão e não toca em caso marcado como inválido.
 */
type Revision = {
  revisedAt: string;
  reason: string;
  cases: Record<
    string,
    {
      ai?: [boolean, boolean, boolean, boolean] | null;
      human?: [boolean, boolean, boolean, boolean] | null;
      rationale?: { ai?: string; human?: string };
      validity?: { status: "fixture-invalid" | "corpus-invalid"; reason: string };
      tags?: string[];
    }
  >;
};

function toChecklist(t: [boolean, boolean, boolean, boolean]): ReviewChecklist {
  return {
    factuallyCorrect: t[0],
    addressedWhatTheLeadRaised: t[1],
    advancedTheJourney: t[2],
    wouldRepeatToday: t[3],
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const revisionPath = required(argv, "--revision");
  const revision = JSON.parse(readFileSync(revisionPath, "utf8")) as Revision;
  const corpus = loadCorpus("evals/corpus");

  let changed = 0;
  const updated = corpus.cases.map((entry): CorpusCase => {
    const patch = revision.cases[entry.caseId];
    if (!patch) return entry;
    changed += 1;

    const side = (
      which: "ai" | "human",
    ): CorpusCase["labels"]["prose"]["ai"] => {
      const tuple = patch[which];
      if (tuple === null) return null;
      if (tuple === undefined) return entry.labels.prose[which];
      const checklist = toChecklist(tuple);
      return {
        checklist,
        label: deriveProseLabel(checklist),
        rationale:
          patch.rationale?.[which] ?? entry.labels.prose[which]?.rationale ??
          "Re-derivado sob a definição revisada das perguntas.",
      };
    };

    const ai = side("ai");
    const human = side("human");

    return parseCorpusCase({
      ...entry,
      ...(patch.validity ? { validity: patch.validity } : {}),
      tags: patch.tags ?? entry.tags,
      labels: {
        ...entry.labels,
        prose: { ai, human },
        betterResponder: deriveBetterResponder(
          ai?.label ?? null,
          human?.label ?? null,
        ),
      },
      provenance: {
        ...entry.provenance,
        revisedAt: revision.revisedAt,
        revisionReason: revision.reason,
      },
    });
  });

  const byJourney = new Map<string, CorpusCase[]>();
  for (const entry of updated) {
    const bucket = byJourney.get(entry.journey) ?? [];
    bucket.push(entry);
    byJourney.set(entry.journey, bucket);
  }
  for (const [journey, bucket] of byJourney) {
    writeFileSync(
      path.join("evals/corpus/cases", `${journey}.jsonl`),
      `${bucket.map((e) => JSON.stringify(e)).join("\n")}\n`,
      "utf8",
    );
  }
  console.log(JSON.stringify({ revised: changed, total: updated.length }));
}

function required(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : null;
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

main();
