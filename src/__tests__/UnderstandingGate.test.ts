import { describe, expect, it } from "vitest";
import { summarizeCycleFUnderstanding } from "@/application/corpus/eval-understanding-gate";

const manifest = {
  version: "cycle-f-dental.v1" as const,
  population: "cycle-f-supported-dental-corpus" as const,
  cases: [{ caseId: "price-0001", requiredAxes: ["request", "dialogueMove", "entities.service"] as const, critical: true }],
  exclusions: [{ requests: ["service-information"], reason: "out of scope" }],
};
const expected = {
  "price-0001": { request: "price-of-service", dialogueMove: "repeats", entities: { service: "lentes" } },
};

describe("relatório comportamental do Ciclo F", () => {
  it("reporta cada eixo sem transformar erro probabilístico em falha arquitetural", () => {
    const report = summarizeCycleFUnderstanding({
      manifest, expected, model: "model-x", modelVersion: "2026-08-01",
      promptVersion: "dental-understanding.v1", runCount: 2, skipped: 34,
      observations: [
        { caseId: "price-0001", run: 1, actual: expected["price-0001"] },
        { caseId: "price-0001", run: 2, actual: { request: "book-appointment", dialogueMove: "repeats", entities: { service: "lentes" } } },
      ],
    });

    expect(report.axes).toEqual([
      { axis: "request", numerator: 1, denominator: 2 },
      { axis: "dialogueMove", numerator: 2, denominator: 2 },
      { axis: "entities.service", numerator: 2, denominator: 2 },
    ]);
    expect(report.architecturalGate).toEqual({ passed: true, criticalErrors: 0 });
    expect(report.skipped).toBe(34);
  });

  it("mantém erro crítico como gate absoluto e recusa medição incompleta", () => {
    expect(summarizeCycleFUnderstanding({
      manifest, expected, model: "model-x", modelVersion: "v1",
      promptVersion: "dental-understanding.v1", runCount: 1, skipped: 34,
      observations: [{ caseId: "price-0001", run: 1, actual: expected["price-0001"], criticalError: "unsafe output" }],
    }).architecturalGate.passed).toBe(false);

    expect(() => summarizeCycleFUnderstanding({
      manifest, expected, model: "model-x", modelVersion: "v1",
      promptVersion: "dental-understanding.v1", runCount: 2, skipped: 34,
      observations: [{ caseId: "price-0001", run: 1, actual: expected["price-0001"] }],
    })).toThrow(/incomplete/);
  });
});
