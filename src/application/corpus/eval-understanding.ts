import type { CorpusCase } from "@/application/corpus/corpus-case";

/**
 * Camada 1 — Understanding.
 *
 * A regra do ciclo é reportar **por eixo**, nunca "acertou/errou tudo". Um
 * sistema que acerta o pedido e erra o movimento de diálogo é diferente de um
 * que erra os dois, e a média de caso esconde exatamente essa diferença.
 *
 * A V1 só produz um eixo — o intent do classificador. Os outros quatro não têm
 * produtor nenhum na V1, e isso é **resultado**, não limitação do instrumento:
 * o relatório reporta cobertura zero neles em vez de fingir uma nota.
 */

export const UNDERSTANDING_AXES = [
  "request",
  "dialogueMove",
  "entities.service",
  "entities.date",
  "signals.objection",
  "safety.requestsHuman",
  "ambiguity",
] as const;

export type UnderstandingAxis = (typeof UNDERSTANDING_AXES)[number];

/** Saída de um sistema sob teste. Eixo ausente = "este sistema não produz". */
export type ProducedUnderstanding = Partial<{
  request: string;
  dialogueMove: string;
  entities: { service?: string; date?: string };
  signals: { objection?: string };
  safety: { requestsHuman?: boolean };
  ambiguity: { kind: string; candidates: string[] } | null;
}>;

export type AxisScore = {
  axis: UnderstandingAxis;
  /** Casos em que o eixo é esperado (o corpus o preencheu). */
  expected: number;
  /** Casos em que o sistema produziu algum valor para o eixo. */
  produced: number;
  correct: number;
  /** Acertos sobre casos esperados. Zero produção = 0. */
  accuracy: number;
};

function expectedValue(
  corpusCase: CorpusCase,
  axis: UnderstandingAxis,
): string | null {
  const understanding = corpusCase.labels.understanding;
  switch (axis) {
    case "request":
      return understanding.request;
    case "dialogueMove":
      return understanding.dialogueMove;
    case "entities.service":
      return understanding.entities.service ?? null;
    case "entities.date":
      return understanding.entities.date ?? null;
    case "signals.objection":
      return understanding.signals.objection ?? null;
    case "safety.requestsHuman":
      return understanding.safety.requestsHuman === undefined
        ? null
        : String(understanding.safety.requestsHuman);
    case "ambiguity":
      return understanding.ambiguity ? understanding.ambiguity.kind : null;
  }
}

function producedValue(
  produced: ProducedUnderstanding,
  axis: UnderstandingAxis,
): string | null {
  switch (axis) {
    case "request":
      return produced.request ?? null;
    case "dialogueMove":
      return produced.dialogueMove ?? null;
    case "entities.service":
      return produced.entities?.service ?? null;
    case "entities.date":
      return produced.entities?.date ?? null;
    case "signals.objection":
      return produced.signals?.objection ?? null;
    case "safety.requestsHuman":
      return produced.safety?.requestsHuman === undefined
        ? null
        : String(produced.safety.requestsHuman);
    case "ambiguity":
      return produced.ambiguity ? produced.ambiguity.kind : null;
  }
}

/**
 * Comparação por eixo. `entities.service` e `signals.objection` são texto livre,
 * então a comparação é por contenção normalizada — exigir string idêntica mediria
 * redação, não entendimento.
 */
function matches(axis: UnderstandingAxis, expected: string, got: string): boolean {
  if (axis === "entities.service" || axis === "signals.objection") {
    const a = normalize(expected);
    const b = normalize(got);
    return a.includes(b) || b.includes(a);
  }
  return normalize(expected) === normalize(got);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function scoreUnderstanding(
  results: Array<{ corpusCase: CorpusCase; produced: ProducedUnderstanding }>,
): AxisScore[] {
  return UNDERSTANDING_AXES.map((axis) => {
    let expected = 0;
    let produced = 0;
    let correct = 0;

    for (const result of results) {
      const want = expectedValue(result.corpusCase, axis);
      const got = producedValue(result.produced, axis);
      if (want !== null) expected += 1;
      if (got !== null) produced += 1;
      if (want !== null && got !== null && matches(axis, want, got)) correct += 1;
    }

    return {
      axis,
      expected,
      produced,
      correct,
      accuracy: expected === 0 ? 0 : correct / expected,
    };
  });
}
