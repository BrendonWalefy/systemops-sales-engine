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
 *
 * `--require-full-coverage` exige que **todo** caso válido do corpus apareça no
 * arquivo de revisão, com checklist explícito para cada lado que existe. É a
 * prova que separa "a régua nova foi aplicada ao corpus" de "a régua nova foi
 * aplicada aos casos que alguém lembrou de olhar" — que foi como o corpus ficou
 * com 25 casos julgados por uma definição e 41 por outra, sem ninguém saber
 * qual metade era qual. Caso fora da revisão só é aceito se ele próprio
 * declarar invalidez.
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

  if (argv.includes("--require-full-coverage")) {
    assertFullCoverage(corpus.cases, revision);
  }

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
  const invalid = updated.filter((entry) => entry.validity).length;
  console.log(
    JSON.stringify({
      revised: changed,
      total: updated.length,
      declaredInvalid: invalid,
      coverage: `${changed}/${updated.length - invalid} casos válidos`,
    }),
  );
}

/**
 * Recusa a revisão que não considerou o corpus inteiro, nomeando o que faltou.
 *
 * Um lado ausente conta como falta: `undefined` faz o patch herdar o checklist
 * antigo em silêncio, que é exatamente a mistura de réguas que este modo existe
 * para impedir. Sair sem lado nenhum (`null` dos dois) também é decisão, e
 * precisa estar escrita.
 */
function assertFullCoverage(cases: readonly CorpusCase[], revision: Revision): void {
  const missing: string[] = [];
  for (const entry of cases) {
    const patch = revision.cases[entry.caseId];
    const declaredInvalid = entry.validity ?? patch?.validity;
    if (!patch) {
      if (!declaredInvalid) missing.push(`${entry.caseId}: ausente da revisão`);
      continue;
    }
    for (const which of ["ai", "human"] as const) {
      if (entry.labels.prose[which] && patch[which] === undefined) {
        missing.push(`${entry.caseId}: lado "${which}" existe e não foi julgado`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `revisão incompleta — ${missing.length} pendência(s):\n  ${missing.join("\n  ")}`,
    );
  }
}

function required(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : null;
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

main();
