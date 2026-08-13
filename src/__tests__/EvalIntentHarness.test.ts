// Harness de eval de intenção — módulos puros. Nenhum teste aqui chama a API:
// a medição contra o modelo real vive no runner (scripts/eval-intent.ts).
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyConfusion } from "../../evals/intent/severity";
import { loadEvalCases } from "../../evals/intent/load-cases";

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
