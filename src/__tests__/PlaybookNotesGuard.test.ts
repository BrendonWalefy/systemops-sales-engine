import { describe, expect, it } from "vitest";
import { lintPlaybookNotes, blockingPlaybookNotesIssues } from "@/application/config/playbook-lint";

describe("blockingPlaybookNotesIssues — gate de publish", () => {
  it("BLOQUEIA quando o notes contém um valor de preço concreto", () => {
    const issues = blockingPlaybookNotesIssues(
      "Quando o lead perguntar de lentes, informe que é a partir de R$2.500.",
    );
    expect(issues.length).toBe(1);
    expect(issues[0]).toMatch(/Política Comercial/);
  });

  it("BLOQUEIA variações de formatação do valor (com espaço, centavos)", () => {
    expect(blockingPlaybookNotesIssues("custa R$ 100").length).toBe(1);
    expect(blockingPlaybookNotesIssues("R$5.000,00 para 20 elementos").length).toBe(1);
  });

  it("NÃO bloqueia notes limpo (só conduta comportamental)", () => {
    const issues = blockingPlaybookNotesIssues(
      "COMO CONDUZIR: seja consultivo, nunca pressione, uma ideia por mensagem.",
    );
    expect(issues).toEqual([]);
  });

  it("NÃO bloqueia menção comportamental a parcelamento/desconto sem valor concreto", () => {
    // Orientação legítima que só cita o termo — não é um preço plantado no lugar errado.
    const issues = blockingPlaybookNotesIssues(
      "Se o lead perguntar sobre parcelamento ou pedir desconto, direcione para a avaliação.",
    );
    expect(issues).toEqual([]);
  });

  it("NÃO bloqueia 'R$' solto sem dígito", () => {
    expect(blockingPlaybookNotesIssues("fale de valores em R$ na política, não aqui")).toEqual([]);
  });

  it("trata notes vazio/nulo como sem problema", () => {
    expect(blockingPlaybookNotesIssues(null)).toEqual([]);
    expect(blockingPlaybookNotesIssues("   ")).toEqual([]);
  });

  it("o bloqueio é subconjunto do aviso — preço concreto também aparece no lint", () => {
    const notes = "informe R$2.500";
    expect(blockingPlaybookNotesIssues(notes).length).toBe(1);
    // lintPlaybookNotes (avisos) também sinaliza o preço.
    expect(lintPlaybookNotes(notes).some((w) => /R\$/.test(w))).toBe(true);
  });
});
