// Garantia responde pelo cadastro da clínica. Bug medido em produção: a objeção
// da Vitalli existe desde 07/07 22:04 e em 18/07 a Giuliana perguntou "tempo de
// garantia" e recebeu uma descrição das técnicas de lente. O matcher funcionava —
// só nunca era chamado, porque a pergunta cai em `general_question` e o matcher
// vivia dentro do ramo `needs_human`.
import { describe, expect, it } from "vitest";
import {
  matchRegisteredObjection,
  resolveWarrantyAnswer,
} from "@/core/pipeline/ConversationOrchestrator";

// Objeção real da Vitalli (playbook ativo).
const VITALLI_OBJECTIONS = [
  {
    objection: "Quanto tempo dura? Tem garantia e como é a manutenção?",
    response:
      "Nós damos uma garantia de 2 anos caso a lente descole por completo (é só trazer a lente descolada), " +
      "e de 30 dias contra pigmentação ou quebra por descuido.",
  },
  {
    objection: "Como funciona a troca de facetas antigas por novas?",
    response: "Removemos as antigas e confeccionamos as novas no mesmo atendimento.",
  },
  {
    objection: "Posso cancelar ou remarcar meu horário?",
    response: "Pode sim, com 24 horas de antecedência.",
  },
];

const VITALLI_TREATMENTS = ["Lentes de resina composta estratificada", "Manutenção Preventiva de lentes"];

describe("resolveWarrantyAnswer — a config manda", () => {
  it("caso Giuliana (18/07): 'tempo de garantia' devolve a resposta cadastrada", () => {
    const answer = resolveWarrantyAnswer({
      message: "tempo de garantia",
      objections: VITALLI_OBJECTIONS,
      treatmentNames: VITALLI_TREATMENTS,
    });
    expect(answer?.kind).toBe("registered");
    expect(answer?.clinicContext).toContain("garantia de 2 anos");
    expect(answer?.clinicContext).toContain("30 dias");
  });

  it("caso Tatiana (06/07): a resposta cadastrada proíbe o pivô para avaliação", () => {
    // A resposta real foi "depende do tipo de procedimento […] o ideal é passar
    // por uma avaliação". A diretiva bloqueia exatamente isso.
    const answer = resolveWarrantyAnswer({
      message: "Bom noite qual o tempo de garantia?",
      objections: VITALLI_OBJECTIONS,
      treatmentNames: VITALLI_TREATMENTS,
    });
    expect(answer?.kind).toBe("registered");
    expect(answer?.clinicContext).toContain("depende de avaliação presencial");
    expect(answer?.clinicContext).toContain("NÃO substitua");
  });

  it("variações reais das duas clínicas casam com a mesma objeção", () => {
    for (const message of [
      "Tem garantia essas lentes?",
      "Como funciona a garantia?",
      "A garantia cobre o que?",
      "Tem garantia essa resina",
    ]) {
      expect(resolveWarrantyAnswer({
        message,
        objections: VITALLI_OBJECTIONS,
        treatmentNames: VITALLI_TREATMENTS,
      })?.kind).toBe("registered");
    }
  });

  it("caso Adriano (10/07): 'Garantias' no plural encontra a política cadastrada", () => {
    // Ele listou dúvidas: "Formas de pagamento / Garantias / Tipo de material".
    // Sem tolerância a plural, a clínica TEM a resposta e o sistema concluía que não.
    const answer = resolveWarrantyAnswer({
      message: "Busco orçamento mesmo que estimado\nFormas de pagamento\nGarantias\n\nTipo de material",
      objections: VITALLI_OBJECTIONS,
      treatmentNames: VITALLI_TREATMENTS,
    });
    expect(answer?.kind).toBe("registered");
  });

  it("sem política cadastrada (Ximendes hoje), a IA não inventa e não vende", () => {
    const answer = resolveWarrantyAnswer({
      message: "qual o tempo de garantia?",
      objections: [{ objection: "Não quero pagar a avaliação", response: "A avaliação é abatida do tratamento." }],
      treatmentNames: ["Lentes de resina composta estratificada"],
    });
    expect(answer?.kind).toBe("no_policy");
    expect(answer?.clinicContext).toContain("NÃO invente prazo");
    expect(answer?.clinicContext).toContain("confirmar essa informação com a equipe");
    expect(answer?.clinicContext).toContain("NÃO conduza para avaliação");
    // Não pode engolir o resto da mensagem: quem pergunta garantia costuma
    // perguntar preço e material junto (caso Adriano, Authentic Dogs).
    expect(answer?.clinicContext).toContain("responda essas partes normalmente");
  });

  it("clínica sem objeção nenhuma também cai no caminho seguro", () => {
    const answer = resolveWarrantyAnswer({
      message: "vocês dão garantia?",
      objections: [],
      treatmentNames: [],
    });
    expect(answer?.kind).toBe("no_policy");
  });

  it("pergunta que não é sobre garantia não entra no trilho", () => {
    for (const message of [
      "Quanto custa as lentes?",
      "Vocês atendem aos sábados?",
      "Posso remarcar meu horário?",
      // "cobre" solto é ambíguo — cobrança, não cobertura.
      "Quanto vocês cobrem pela avaliação?",
      "Quero descobrir qual técnica combina comigo",
    ]) {
      expect(resolveWarrantyAnswer({
        message,
        objections: VITALLI_OBJECTIONS,
        treatmentNames: VITALLI_TREATMENTS,
      })).toBeNull();
    }
  });
});

describe("matchRegisteredObjection — token fraco não decide objeção", () => {
  it("'Posso ver os horários de sexta?' não vira a objeção de remarcação", () => {
    // Falso positivo medido: casava por "posso", 5 letras, presente no gatilho
    // "Posso cancelar ou remarcar meu horário?".
    expect(matchRegisteredObjection("Posso ver os horários de sexta?", VITALLI_OBJECTIONS, VITALLI_TREATMENTS))
      .toBeNull();
    expect(matchRegisteredObjection("Olá! Posso ter mais informações sobre isso?", VITALLI_OBJECTIONS, VITALLI_TREATMENTS))
      .toBeNull();
  });

  it("a objeção certa continua casando pela palavra que a distingue", () => {
    expect(matchRegisteredObjection("Posso remarcar meu horário?", VITALLI_OBJECTIONS, VITALLI_TREATMENTS)?.objection)
      .toBe("Posso cancelar ou remarcar meu horário?");
    expect(matchRegisteredObjection("tem garantia?", VITALLI_OBJECTIONS, VITALLI_TREATMENTS)?.objection)
      .toBe("Quanto tempo dura? Tem garantia e como é a manutenção?");
  });
});
