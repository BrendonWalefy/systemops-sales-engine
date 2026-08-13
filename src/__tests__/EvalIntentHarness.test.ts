// Harness de eval de intenção — módulos puros. Nenhum teste aqui chama a API:
// a medição contra o modelo real vive no runner (scripts/eval-intent.ts).
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyConfusion } from "../../evals/intent/severity";
import { loadEvalCases } from "../../evals/intent/load-cases";
import { buildReport } from "../../evals/intent/report";
import { compareToBaseline, type Baseline } from "../../evals/intent/baseline";
import type { CaseOutcome } from "../../evals/intent/types";

function baseline(over: Partial<Baseline> = {}): Baseline {
  return {
    model: "gpt-4o-mini",
    recordedAt: "2026-08-12T00:00:00.000Z",
    runs: 3,
    strata: {
      incident: {
        total: 21, accuracyMean: 0.6, accuracySpread: 0.05,
        severityCounts: { none: 13, low: 0, medium: 2, high: 6, critical: 0 },
      },
      prompt_rule: {
        total: 0, accuracyMean: 0, accuracySpread: 0,
        severityCounts: { none: 0, low: 0, medium: 0, high: 0, critical: 0 },
      },
    },
    ...over,
  };
}

function outcome(over: Partial<CaseOutcome> = {}): CaseOutcome {
  return {
    caseId: "c",
    stratum: "incident",
    expected: "price_inquiry",
    got: "price_inquiry",
    severity: "none",
    executionError: null,
    ...over,
  };
}

describe("classifyConfusion", () => {
  it("acerto não tem severidade", () => {
    expect(classifyConfusion("price_inquiry", "price_inquiry")).toBe("none");
  });

  it("perder stop_contact é crítico", () => {
    expect(classifyConfusion("stop_contact", "farewell")).toBe("critical");
  });

  it("perder clinical_urgency é crítico", () => {
    expect(classifyConfusion("clinical_urgency", "general_question")).toBe("critical");
  });

  it("pergunta de preço lida como saudação é alta", () => {
    expect(classifyConfusion("price_inquiry", "greeting")).toBe("high");
  });

  it("needs_human falso-positivo é média", () => {
    expect(classifyConfusion("general_question", "needs_human")).toBe("medium");
  });

  it("greeting trocado com acknowledgment é baixa", () => {
    expect(classifyConfusion("greeting", "acknowledgment")).toBe("low");
  });

  it("par sem entrada na matriz cai em média, nunca em none", () => {
    expect(classifyConfusion("list_appointments", "reschedule_appointment")).toBe("medium");
  });
});

describe("loadEvalCases", () => {
  function writeCases(lines: string): string {
    const dir = mkdtempSync(join(tmpdir(), "evalcases-"));
    const file = join(dir, "cases.jsonl");
    writeFileSync(file, lines, "utf8");
    return file;
  }

  const valid = JSON.stringify({
    id: "c1",
    stratum: "incident",
    message: "quanto custa",
    expected: "price_inquiry",
    source: "t.ts:1",
    context: { hasPendingSlotOffer: false, isClinicSegment: true, treatments: [] },
    history: [],
  });

  it("carrega caso válido e ignora linha vazia", () => {
    const cases = loadEvalCases(writeCases(`${valid}\n\n`));
    expect(cases).toHaveLength(1);
    expect(cases[0].expected).toBe("price_inquiry");
  });

  it("rejeita intent inexistente em vez de ignorar", () => {
    const bad = JSON.stringify({ ...JSON.parse(valid), expected: "comprar_pizza" });
    expect(() => loadEvalCases(writeCases(bad))).toThrow(/expected inválido/);
  });

  it("rejeita caso sem isClinicSegment", () => {
    const bad = JSON.parse(valid);
    delete bad.context.isClinicSegment;
    expect(() => loadEvalCases(writeCases(JSON.stringify(bad)))).toThrow(/isClinicSegment/);
  });

  it("rejeita id duplicado", () => {
    expect(() => loadEvalCases(writeCases(`${valid}\n${valid}\n`))).toThrow(/duplicado/);
  });

  it("rejeita estrato desconhecido", () => {
    const bad = JSON.stringify({ ...JSON.parse(valid), stratum: "chute" });
    expect(() => loadEvalCases(writeCases(bad))).toThrow(/stratum/);
  });
});

describe("buildReport", () => {
  it("separa os estratos e nunca os soma", () => {
    const report = buildReport([[
      outcome({ caseId: "a", stratum: "incident" }),
      outcome({ caseId: "b", stratum: "prompt_rule" }),
      outcome({ caseId: "c", stratum: "prompt_rule" }),
    ]]);

    expect(report.strata.incident.total).toBe(1);
    expect(report.strata.prompt_rule.total).toBe(2);
  });

  it("calcula média e dispersão da acurácia entre rodadas", () => {
    const hit = outcome({ caseId: "a", got: "price_inquiry", severity: "none" });
    const miss = outcome({ caseId: "a", got: "greeting", severity: "high" });
    const report = buildReport([[hit], [miss], [hit]]);

    expect(report.strata.incident.accuracyMean).toBeCloseTo(2 / 3, 5);
    expect(report.strata.incident.accuracySpread).toBeGreaterThan(0);
  });

  it("dispersão é zero quando todas as rodadas concordam", () => {
    const hit = outcome({ caseId: "a" });
    expect(buildReport([[hit], [hit]]).strata.incident.accuracySpread).toBe(0);
  });

  it("conta severidade e ordena confusões por frequência", () => {
    const report = buildReport([[
      outcome({ caseId: "a", expected: "price_inquiry", got: "greeting", severity: "high" }),
      outcome({ caseId: "b", expected: "price_inquiry", got: "greeting", severity: "high" }),
      outcome({ caseId: "c", expected: "stop_contact", got: "farewell", severity: "critical" }),
    ]]);

    expect(report.strata.incident.severityCounts.high).toBe(2);
    expect(report.strata.incident.severityCounts.critical).toBe(1);
    expect(report.strata.incident.confusions[0]).toEqual({
      expected: "price_inquiry", got: "greeting", count: 2,
    });
  });

  it("erro de execução não conta como acerto nem como erro de classificação", () => {
    const report = buildReport([[
      outcome({ caseId: "a" }),
      outcome({ caseId: "b", got: null, severity: "medium", executionError: "429" }),
    ]]);

    expect(report.executionErrors).toBe(1);
    expect(report.strata.incident.total).toBe(1);
    expect(report.strata.incident.accuracyMean).toBe(1);
  });
});

describe("compareToBaseline", () => {
  it("sem baseline não reprova — a primeira rodada é a que cria a referência", () => {
    const diff = compareToBaseline(buildReport([[outcome()]]), null);
    expect(diff.failed).toBe(false);
    expect(diff.reasons.join(" ")).toMatch(/sem baseline/i);
  });

  it("mais falha crítica que a baseline reprova", () => {
    const current = buildReport([[
      outcome({ caseId: "a", expected: "stop_contact", got: "farewell", severity: "critical" }),
    ]]);
    const diff = compareToBaseline(current, baseline());
    expect(diff.failed).toBe(true);
    expect(diff.reasons.join(" ")).toMatch(/critical/);
  });

  it("mais falha alta que a baseline reprova", () => {
    const run = Array.from({ length: 7 }, (_, i) =>
      outcome({ caseId: `h${i}`, expected: "price_inquiry", got: "greeting", severity: "high" }),
    );
    const diff = compareToBaseline(buildReport([run]), baseline());
    expect(diff.failed).toBe(true);
    expect(diff.reasons.join(" ")).toMatch(/high/);
  });

  it("acurácia plana caindo não reprova sozinha", () => {
    const run = [
      outcome({ caseId: "a", expected: "greeting", got: "acknowledgment", severity: "low" }),
      outcome({ caseId: "b", expected: "farewell", got: "acknowledgment", severity: "low" }),
    ];
    const diff = compareToBaseline(buildReport([run]), baseline());
    expect(diff.failed).toBe(false);
    expect(diff.reasons.join(" ")).toMatch(/informativo/);
  });

  it("compara por rodada, não por soma, para --repeat não gerar falso positivo", () => {
    const run = Array.from({ length: 2 }, (_, i) =>
      outcome({ caseId: `h${i}`, expected: "price_inquiry", got: "greeting", severity: "high" }),
    );
    // 6 falhas high em 3 rodadas na baseline = 2 por rodada. Duas rodadas com
    // 2 cada também é 2 por rodada: mesmo patamar, não reprova.
    const diff = compareToBaseline(buildReport([run, run]), baseline());
    expect(diff.failed).toBe(false);
  });
});
