type Axis = "request" | "dialogueMove" | "entities.service";

type LabeledUnderstanding = {
  request: string;
  dialogueMove: string;
  entities: Readonly<Record<string, string | number | readonly string[] | undefined>>;
};

type Observation = {
  caseId: string;
  run: number;
  actual: LabeledUnderstanding;
  criticalError?: string;
};

type Input = {
  manifest: {
    population: string;
    cases: readonly { caseId: string; requiredAxes: readonly Axis[]; critical: boolean }[];
  };
  expected: Readonly<Record<string, LabeledUnderstanding>>;
  observations: readonly Observation[];
  model: string;
  modelVersion: string;
  promptVersion: string;
  runCount: number;
  skipped: number;
};

function valueAt(axis: Axis, value: LabeledUnderstanding): unknown {
  if (axis === "entities.service") return value.entities.service;
  return value[axis];
}

export function summarizeCycleFUnderstanding(input: Input) {
  if (!Number.isInteger(input.runCount) || input.runCount < 1) {
    throw new Error("runCount must be a positive integer");
  }
  const byKey = new Map(input.observations.map((item) => [`${item.caseId}:${item.run}`, item]));
  if (byKey.size !== input.observations.length) throw new Error("duplicate Cycle F observation");

  for (const entry of input.manifest.cases) {
    if (!input.expected[entry.caseId]) throw new Error(`missing expected label for ${entry.caseId}`);
    for (let run = 1; run <= input.runCount; run += 1) {
      if (!byKey.has(`${entry.caseId}:${run}`)) {
        throw new Error(`incomplete Cycle F measurement: ${entry.caseId} run ${run}`);
      }
    }
  }

  const axes: Axis[] = ["request", "dialogueMove", "entities.service"];
  const scores = axes.map((axis) => {
    let numerator = 0;
    let denominator = 0;
    for (const entry of input.manifest.cases) {
      if (!entry.requiredAxes.includes(axis)) continue;
      const expected = input.expected[entry.caseId]!;
      for (let run = 1; run <= input.runCount; run += 1) {
        denominator += 1;
        const actual = byKey.get(`${entry.caseId}:${run}`)!.actual;
        if (valueAt(axis, actual) === valueAt(axis, expected)) numerator += 1;
      }
    }
    return { axis, numerator, denominator };
  }).filter(({ denominator }) => denominator > 0);

  const criticalErrors = input.observations.filter(({ criticalError }) => criticalError).length;
  return {
    population: input.manifest.population,
    unit: "required axis per case-run",
    model: input.model,
    modelVersion: input.modelVersion,
    promptVersion: input.promptVersion,
    runCount: input.runCount,
    skipped: input.skipped,
    axes: scores,
    architecturalGate: { passed: criticalErrors === 0, criticalErrors },
  };
}
