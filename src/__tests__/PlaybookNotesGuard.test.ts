import { describe, expect, it } from "vitest";
import { lintPlaybookNotes, blockingPlaybookNotesIssues, lintCommercialPolicy, blockingCommercialPolicyIssues, blockingTreatmentDescriptionIssues } from "@/application/config/playbook-lint";

describe("blockingPlaybookNotesIssues — gate de publish", () => {
  it("BLOQUEIA quando o notes contém um valor de preço concreto", () => {
    const issues = blockingPlaybookNotesIssues(
      "Quando o lead perguntar de lentes, informe que é a partir de R$2.500.",
    );
    expect(issues.length).toBe(1);
    // Item 3: o preço agora tem casa no cadastro do procedimento (a IA deriva dele).
    expect(issues[0]).toMatch(/cadastro do tratamento/);
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

  it.each([
    'Se o lead perguntar sobre cor, envie a imagem "Cores BL".',
    "Inicie o pipeline de lentes quando houver interesse.",
    "TRIGGER DE LENTES: quando mencionar facetas.",
    "Aguarde o lead escolher antes de informar a próxima etapa.",
  ])("BLOQUEIA comando de workflow em notes: %s", (notes) => {
    expect(blockingPlaybookNotesIssues(notes)).toEqual([
      expect.stringMatching(/pipeline estruturado/),
    ]);
  });

  it.each([
    "A clínica possui vídeos de antes e depois autorizados.",
    "Se o lead enviar uma foto, não faça diagnóstico por mensagem.",
    "Explique que cada etapa depende da avaliação presencial.",
  ])("NÃO bloqueia mera referência factual ou comportamental: %s", (notes) => {
    expect(blockingPlaybookNotesIssues(notes)).toEqual([]);
  });

  it("o bloqueio é subconjunto do aviso — preço concreto também aparece no lint", () => {
    const notes = "informe R$2.500";
    expect(blockingPlaybookNotesIssues(notes).length).toBe(1);
    // lintPlaybookNotes (avisos) também sinaliza o preço.
    expect(lintPlaybookNotes(notes).some((w) => /R\$/.test(w))).toBe(true);
  });
});

describe("lintCommercialPolicy — preço tem casa no cadastro (Item 3)", () => {
  it("AVISA (não bloqueia) quando a política carrega valor em R$ à mão", () => {
    const warnings = lintCommercialPolicy("Lentes a partir de R$ 2.500 para 20 elementos.");
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/procedimento/);
  });

  it("não avisa sobre enquadramento comercial sem valor concreto", () => {
    expect(lintCommercialPolicy("Parcelamos em até 12x; avaliação abatida do tratamento.")).toEqual([]);
  });

  it("trata política vazia/nula como sem problema", () => {
    expect(lintCommercialPolicy(null)).toEqual([]);
    expect(lintCommercialPolicy("   ")).toEqual([]);
  });
});

describe("blockingCommercialPolicyIssues — gate no publish (campanhas de preço)", () => {
  it("BLOQUEIA quando a política comercial contém um valor de preço concreto", () => {
    const issues = blockingCommercialPolicyIssues("Lentes a partir de R$ 2.500 para 20 elementos.");
    expect(issues.length).toBe(1);
    expect(issues[0]).toMatch(/Campanhas/);
  });

  it("NÃO bloqueia enquadramento comercial sem valor concreto", () => {
    expect(blockingCommercialPolicyIssues("Parcelamos em até 12x; avaliação abatida do tratamento.")).toEqual([]);
  });

  it("trata política vazia/nula como sem problema", () => {
    expect(blockingCommercialPolicyIssues(null)).toEqual([]);
    expect(blockingCommercialPolicyIssues("   ")).toEqual([]);
  });

  it("é o equivalente bloqueante do aviso de lintCommercialPolicy", () => {
    const policy = "Avaliação sai por R$ 100.";
    expect(blockingCommercialPolicyIssues(policy).length).toBe(1);
    expect(lintCommercialPolicy(policy).length).toBe(1);
  });
});

describe("blockingTreatmentDescriptionIssues — gate §6C no publish (Item 6)", () => {
  it("BLOQUEIA descrição de procedimento com valor em R$", () => {
    const issues = blockingTreatmentDescriptionIssues([
      { name: "Implante", description: "A partir de R$ 2.900. Titânio biocompatível." },
      { name: "Limpeza", description: "Profilaxia completa, sem cárie." },
    ]);
    expect(issues.length).toBe(1);
    expect(issues[0]).toMatch(/Implante/);
    expect(issues[0]).toMatch(/valor do procedimento/);
  });

  it("acumula um issue por procedimento com R$", () => {
    const issues = blockingTreatmentDescriptionIssues([
      { name: "A", description: "R$ 100" },
      { name: "B", description: "R$ 200" },
      { name: "C", description: "sem preço" },
    ]);
    expect(issues.length).toBe(2);
  });

  it("não bloqueia descrição factual sem valor concreto", () => {
    expect(
      blockingTreatmentDescriptionIssues([
        { name: "Canal", description: "Preserva o dente eliminando a infecção da polpa. Indolor." },
        { name: "Avaliação", description: null },
      ]),
    ).toEqual([]);
  });
});
