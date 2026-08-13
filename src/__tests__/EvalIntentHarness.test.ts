// Harness de eval de intenção — módulos puros. Nenhum teste aqui chama a API:
// a medição contra o modelo real vive no runner (scripts/eval-intent.ts).
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyConfusion } from "../../evals/intent/severity";
import { loadEvalCases } from "../../evals/intent/load-cases";
import { buildReport } from "../../evals/intent/report";
import type { CaseOutcome } from "../../evals/intent/types";

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
