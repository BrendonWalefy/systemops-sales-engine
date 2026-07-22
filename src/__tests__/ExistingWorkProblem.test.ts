// #21 — relato de dano em trabalho existente. Mensagens reais das duas clínicas
// (Ximendes 27/05→20/07, Vitalli 09/07→20/07): 22 relatos no corpus, 1 único com
// consulta anterior registrada — e é justamente o caso que falhou em produção.
import { describe, expect, it } from "vitest";
import {
  detectExistingWorkProblem,
  detectSelfDeclaredPastWork,
} from "@/core/intelligence/objection-triage";
import {
  resolveMaintenancePriceLabel,
  shouldEngageDamageRail,
} from "@/core/pipeline/ConversationOrchestrator";
import type { Treatment } from "@/domain/entities/treatment";

function treatment(name: string, overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    clinicId: "clinic-1",
    name,
    durationMinutes: 60,
    description: null,
    requiresEvaluationFirst: false,
    keywordMatchEnabled: true,
    aliases: [],
    isAesthetic: false,
    pipelineSteps: null,
    priceCents: null,
    minPriceCents: null,
    maxPriceCents: null,
    priceQuotableInChat: true,
    priceKind: "from",
    priceUnit: null,
    priceDeductible: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("detectExistingWorkProblem — dano sobre trabalho instalado", () => {
  it("dano com substantivo de trabalho é relato por si só, sem precisar de histórico", () => {
    // Eduardo (Ximendes, 16/07) e Ewerson (Vitalli, 16/07)
    expect(detectExistingWorkProblem("Manutenção e uma lente quebrada")).toEqual({
      label: "lente quebrada",
      target: "work",
    });
    expect(detectExistingWorkProblem("Mas ainda alguns lentes quebrado meu dente")?.target).toBe("work");
  });

  it("o dano se refere ao substantivo mais próximo, mesmo perdendo um caso legítimo", () => {
    // Felipe (Ximendes, 14/07). O sujeito real de "quebrou" é a lente ("ela"), mas
    // o substantivo mais próximo é "dente" — resolver o pronome exigiria análise
    // sintática. Fica como "tooth", o que só significa que ele segue pelo caminho
    // atual (a LLM classificou clinical_urgency e a IA escalou — comportamento
    // correto). Preferir "work" por estar na frase reintroduziria dois falsos
    // positivos piores, que sequestram perguntas de venda: ver testes abaixo.
    expect(detectExistingWorkProblem("Então, eu tinha uma lente em um dente. E ela quebrou ontem :( Queria refazê-la com vocês")?.target)
      .toBe("tooth");
  });

  it("não sequestra pergunta de venda que cita lentes e dente quebrado juntos", () => {
    // ST (Vitalli, 19/07): quer lentes, terá que remover dentes quebrados.
    expect(detectExistingWorkProblem("no momento eu só quero fazer as lentes , mas eu tá frente terei que remover 2 dentes quebrados")?.target)
      .toBe("tooth");
    // Marta (Vitalli, 21/07): pergunta se as lentes resolvem o caso dela.
    expect(detectExistingWorkProblem("Eu tenho retração e restaurações nesses dentes, alem de um quebrado. Por isso o desejo das lentes. Nesse caso, as lentes resolvem isso?")?.target)
      .toBe("tooth");
  });

  it("caso Mô (Vitalli, 14/07): lentes de 9 meses quebrando", () => {
    const message =
      "Continua sendo do dr Victor né? Eu troquei minhas lentes de resina com vcs lá na av Sabará tem " +
      "aproximadamente 9 meses infelizmente a maioria das lentes estão quebrando";
    expect(detectExistingWorkProblem(message)?.target).toBe("work");
  });

  it("faceta que caiu ou saiu também é dano (Lays 09/07, Xtreme 19/07)", () => {
    expect(detectExistingWorkProblem("Eu só vi agora que caiu a faceta todinha")?.target).toBe("work");
    expect(detectExistingWorkProblem("duas facetas uma na frente um lateral q saiu")?.target).toBe("work");
  });

  it("caso Carla (Ximendes, 16/07): só 'dente' é alvo ambíguo, não trabalho", () => {
    // O intent da LLM foi reject_slots e a resposta foram 5 horários de segunda.
    // O alvo "tooth" só vira relato de dano quando há vínculo — quem decide isso
    // é o orquestrador, com o histórico de consultas na mão.
    expect(detectExistingWorkProblem("Um dos dentes quebrou")).toEqual({
      label: "dentes quebrou",
      target: "tooth",
    });
  });

  it("a janela de proximidade impede que 'resina' lá no início case com 'lascado' lá no fim", () => {
    // Caso Ana Paula (Vitalli, 18/07): pergunta de preço legítima. Sem a janela,
    // "resina" + "lascado" casariam como trabalho danificado e a venda morreria na
    // primeira resposta. Sobra o alvo ambíguo "dentes lascado", que o trilho
    // descarta por ser pergunta de preço — ver shouldEngageDamageRail.
    const message =
      "Queria saber o valor para fazer resina em 10 dentes superiores. Já tenho resina em alguns mas " +
      "queria harmonizar melhor e estou com um dia dentes lascado.";
    expect(detectExistingWorkProblem(message)?.target).toBe("tooth");
  });

  it("pergunta sobre desgaste do procedimento não é dano (Guilherme 06/07, Paula 17/07)", () => {
    expect(detectExistingWorkProblem("Mas iria precisar desgastar os dentes?")).toBeNull();
    expect(detectExistingWorkProblem("Esse procedimento não desgasta meu dente, não vai ficar parecendo um palitinho, né?"))
      .toBeNull();
  });

  it("dano sem nada odontológico por perto não dispara", () => {
    expect(detectExistingWorkProblem("caiu a ficha agora, obrigada!")).toBeNull();
    expect(detectExistingWorkProblem("o link que vocês mandaram quebrou")).toBeNull();
  });
});

describe("detectSelfDeclaredPastWork — vínculo declarado pelo lead", () => {
  it("reconhece o paciente que diz ter feito o trabalho na clínica (caso Mô)", () => {
    expect(detectSelfDeclaredPastWork("Eu troquei minhas lentes de resina com vcs lá na av Sabará")).toBe(true);
    expect(detectSelfDeclaredPastWork("vocês fizeram minhas lentes ano passado")).toBe(true);
    expect(detectSelfDeclaredPastWork("sou paciente de vocês desde 2024")).toBe(true);
  });

  it("responde à pergunta de origem: 'foi aí mesmo'", () => {
    expect(detectSelfDeclaredPastWork("foi aí mesmo, com o Dr. Victor")).toBe(true);
    expect(detectSelfDeclaredPastWork("fiz aqui sim")).toBe(true);
  });

  it("querer refazer COM a clínica não é vínculo passado (caso Felipe, 14/07)", () => {
    // "Queria refazê-la com vocês" é intenção futura — quem fez pode ter sido outro.
    expect(detectSelfDeclaredPastWork("eu tinha uma lente em um dente. E ela quebrou ontem :( Queria refazê-la com vocês"))
      .toBe(false);
    expect(detectSelfDeclaredPastWork("quero fazer as lentes com vocês")).toBe(false);
  });

  it("dano acontecido em casa não vira vínculo", () => {
    expect(detectSelfDeclaredPastWork("a lente quebrou aqui em casa")).toBe(false);
  });
});

describe("shouldEngageDamageRail — quando o trilho assume a resposta", () => {
  const base = {
    target: "work" as const,
    relationship: "unknown" as const,
    askedPrice: false,
    hasActivePipeline: false,
  };

  it("caso Carla: 'dente quebrou' de paciente com consulta anterior assume", () => {
    expect(shouldEngageDamageRail({ ...base, target: "tooth", relationship: "known_patient" })).toBe(true);
  });

  it("'dente quebrou' de quem nunca veio segue para a triagem de caso clínico novo", () => {
    expect(shouldEngageDamageRail({ ...base, target: "tooth" })).toBe(false);
  });

  it("caso Ana Paula: dente lascado dentro de pergunta de preço não sequestra a venda", () => {
    expect(
      shouldEngageDamageRail({
        ...base,
        target: "tooth",
        relationship: "known_patient",
        askedPrice: true,
      }),
    ).toBe(false);
  });

  it("lente/faceta quebrada assume mesmo sem vínculo — é a pergunta de origem", () => {
    expect(shouldEngageDamageRail(base)).toBe(true);
  });

  it("caso Amanda: preço de reparo com lente quebrada continua sendo relato", () => {
    // Ela perguntou "quanto fica a manutenção e um reparo pois minha lente quebrou".
    // Cotar antes de saber se é garantia é exatamente o que não pode acontecer.
    expect(shouldEngageDamageRail({ ...base, askedPrice: true })).toBe(true);
  });

  it("sem vínculo, cede a um pipeline de tratamento em curso", () => {
    expect(shouldEngageDamageRail({ ...base, hasActivePipeline: true })).toBe(false);
  });

  it("com vínculo, o relato ganha do pipeline em curso", () => {
    expect(
      shouldEngageDamageRail({ ...base, relationship: "self_declared", hasActivePipeline: true }),
    ).toBe(true);
  });
});

describe("resolveMaintenancePriceLabel — preço da manutenção sai do catálogo", () => {
  // Catálogo real da Ximendes. Em 16/07 a IA respondeu "manutenção sai a partir de
  // R$ 100" — R$100 é o preço da Avaliação. O template mandava a LLM buscar o valor.
  const ximendes = [
    treatment("Manutenção periódicas lentes", { priceCents: 50000, priceKind: "from" }),
    treatment("Conserto lentes", { priceCents: 20000, priceKind: "from" }),
    treatment("Avaliação", { priceCents: 10000, priceKind: "fixed" }),
    treatment("Lentes de resina composta estratificada", { priceCents: 400000, aliases: ["lentes"] }),
  ];

  it("devolve o valor do serviço que o lead citou", () => {
    expect(resolveMaintenancePriceLabel("Manutenção e uma lente quebrada", ximendes)).toBe(
      "Manutenção periódicas lentes: a partir de R$ 500",
    );
  });

  it("nunca devolve o preço da avaliação nem do tratamento base", () => {
    const label = resolveMaintenancePriceLabel("quanto fica a manutenção?", ximendes);
    expect(label).not.toContain("R$ 100");
    expect(label).not.toContain("R$ 4.000");
  });

  it("cada serviço citado devolve o seu próprio valor", () => {
    expect(resolveMaintenancePriceLabel("quanto custa o conserto?", ximendes)).toBe(
      "Conserto lentes: a partir de R$ 200",
    );
  });

  it("sem serviço de manutenção no catálogo, não há valor para informar", () => {
    const semManutencao = [treatment("Lentes de resina", { priceCents: 400000 })];
    expect(resolveMaintenancePriceLabel("quanto fica a manutenção?", semManutencao)).toBeNull();
  });

  it("respeita a clínica que decidiu não cotar aquele serviço no chat", () => {
    const naoCotavel = [
      treatment("Manutenção periódicas lentes", { priceCents: 50000, priceQuotableInChat: false }),
    ];
    expect(resolveMaintenancePriceLabel("quanto fica a manutenção?", naoCotavel)).toBeNull();
  });

  it("preço fixo não vira 'a partir de' (caso Vitalli: manutenção R$400 fechado)", () => {
    const vitalli = [
      treatment("Manutenção Preventiva de lentes", { priceCents: 40000, priceKind: "fixed" }),
    ];
    expect(resolveMaintenancePriceLabel("Quanto fica a manutenção?", vitalli)).toBe(
      "Manutenção Preventiva de lentes: R$ 400",
    );
  });
});
