import { describe, expect, it } from "vitest";
import { composePlaybookText } from "@/application/config/editorial-config";

describe("EditorialNotesFlow", () => {
  it("notes appears at the top of playbookText when set", () => {
    const notes =
      "COMO CONDUZIR A CONVERSA:\n- Nunca pressionar.\n- Sempre mencionar o abatimento dos R$100.";
    const text = composePlaybookText({
      notes,
      procedureDescription: "Implante dentário e limpeza",
      differentials: ["Laboratório próprio"],
      objections: [],
    });

    expect(text.startsWith(notes)).toBe(true);
    expect(text).toContain("PROCEDIMENTOS OFERECIDOS:");
  });

  it("playbookText contains notes content before procedure section", () => {
    const notes = "REGRA: nunca citar preço por mensagem.";
    const text = composePlaybookText({
      notes,
      procedureDescription: "Clareamento dental",
      differentials: [],
      objections: [],
    });

    const notesIndex = text.indexOf(notes);
    const proceduresIndex = text.indexOf("PROCEDIMENTOS OFERECIDOS:");
    expect(notesIndex).toBeGreaterThanOrEqual(0);
    expect(notesIndex).toBeLessThan(proceduresIndex);
  });

  it("playbookText without notes does not include empty header", () => {
    const text = composePlaybookText({
      notes: null,
      procedureDescription: "Avaliação odontológica",
      differentials: [],
      objections: [],
    });

    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
    expect(text.startsWith("PROCEDIMENTOS")).toBe(true);
  });

  it("notes with only whitespace is ignored", () => {
    const text = composePlaybookText({
      notes: "   ",
      procedureDescription: "Limpeza dental",
      differentials: [],
      objections: [],
    });

    expect(text.startsWith("PROCEDIMENTOS")).toBe(true);
  });

  it("procedures list takes priority over procedureDescription when both provided", () => {
    const text = composePlaybookText({
      notes: "Orientação de comportamento.",
      procedureDescription: "Fallback description",
      procedures: [
        { name: "Implante", description: "Titânio biocompatível" },
        { name: "Limpeza", description: null },
      ],
      differentials: [],
      objections: [],
    });

    expect(text).toContain("• Implante — Titânio biocompatível");
    expect(text).toContain("• Limpeza");
    expect(text).not.toContain("Fallback description");
  });
});
