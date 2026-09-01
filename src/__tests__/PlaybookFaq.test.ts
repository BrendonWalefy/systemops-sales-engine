import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrequentlyAskedQuestions } from "@/application/config/faq-config";
import { playbookVersions } from "@/infrastructure/db/schema";

describe("structured playbook FAQ", () => {
  it("normalizes complete rows and removes fully empty draft rows", () => {
    expect(parseFrequentlyAskedQuestions([
      { question: "  Preciso de avaliação?  ", answer: "  Sim, para confirmar a indicação.  " },
      { question: "", answer: "" },
    ])).toEqual([
      { question: "Preciso de avaliação?", answer: "Sim, para confirmar a indicação." },
    ]);
  });

  it("rejects partial, duplicate, unsafe and over-budget entries", () => {
    expect(() => parseFrequentlyAskedQuestions([
      { question: "Preciso de avaliação?", answer: "" },
    ])).toThrow(/incompleta/i);
    expect(() => parseFrequentlyAskedQuestions([
      { question: "Tem garantia?", answer: "A equipe explica as condições." },
      { question: "  TEM GARANTIA? ", answer: "Outra resposta." },
    ])).toThrow(/duplicada/i);
    expect(() => parseFrequentlyAskedQuestions([
      { question: "Pergunta", answer: "Resposta\u0000oculta" },
    ])).toThrow(/inválid/i);
    expect(() => parseFrequentlyAskedQuestions(Array.from({ length: 21 }, (_, index) => ({
      question: `Pergunta ${index}`,
      answer: `Resposta ${index}`,
    })))).toThrow(/20/);
    expect(() => parseFrequentlyAskedQuestions([
      { question: "Q".repeat(121), answer: "Resposta" },
    ])).toThrow(/120/);
    expect(() => parseFrequentlyAskedQuestions([
      { question: "Pergunta", answer: "R".repeat(241) },
    ])).toThrow(/240/);
  });

  it("exposes one generated non-null JSONB FAQ column with an empty-list default", () => {
    expect(playbookVersions.faqs.notNull).toBe(true);
    expect(playbookVersions.faqs.hasDefault).toBe(true);
    expect(playbookVersions.faqs.dataType).toBe("json");
  });

  it("keeps save tenant-scoped and exposes FAQ in the existing editor", () => {
    const actions = readFileSync(join(
      process.cwd(),
      "src/app/(clinic)/app/settings/playbook/playbook-version-actions.ts",
    ), "utf8");
    const page = readFileSync(join(
      process.cwd(),
      "src/app/(clinic)/app/settings/playbook/[id]/page.tsx",
    ), "utf8");
    const editor = readFileSync(join(
      process.cwd(),
      "src/app/(clinic)/app/settings/playbook/[id]/editor-client.tsx",
    ), "utf8");

    expect(actions).toContain("parseFrequentlyAskedQuestions");
    expect(actions).toMatch(/eq\(playbookVersions\.clinicId, CLINIC_ID\)/);
    expect(page).toContain("faqs: version.faqs");
    expect(editor).toContain("Perguntas frequentes");
    expect(editor).toContain("data.faqs");
  });
});
