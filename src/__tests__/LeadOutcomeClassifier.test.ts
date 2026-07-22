import { describe, expect, it } from "vitest";
import {
  buildLeadOutcomePrompt,
  parseLeadOutcomeResponse,
  UNVERIFIED_EVIDENCE_CONFIDENCE_CAP,
  MAX_CLASSIFIER_MESSAGES,
  type ClassifierMessage,
} from "@/core/intelligence/LeadOutcomeClassifier";

const messages: ClassifierMessage[] = [
  { id: "m1", author: "agent", body: "Oi Ana! Como posso ajudar?" },
  { id: "m2", author: "lead", body: "Queria saber o valor das lentes de contato dental" },
  { id: "m3", author: "agent", body: "O investimento fica a partir de R$ 1.200 por dente." },
  { id: "m4", author: "lead", body: "Nossa, tá bem acima do que eu posso pagar agora" },
];

function response(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

describe("LeadOutcomeClassifier — parse", () => {
  it("aceita classificação com trecho copiado literalmente do lead", () => {
    const result = parseLeadOutcomeResponse(
      response({
        reason: "price",
        evidence_excerpt: "tá bem acima do que eu posso pagar agora",
        confidence: 95,
      }),
      messages,
    );

    expect(result).toEqual({
      reason: "price",
      evidenceExcerpt: "tá bem acima do que eu posso pagar agora",
      evidenceMessageId: "m4",
      confidence: 95,
    });
  });

  it("casa o trecho ignorando acento, caixa e espaço extra", () => {
    const result = parseLeadOutcomeResponse(
      response({
        reason: "price",
        evidence_excerpt: "TA BEM   ACIMA do que eu posso pagar",
        confidence: 90,
      }),
      messages,
    );

    expect(result?.evidenceMessageId).toBe("m4");
    expect(result?.confidence).toBe(90);
  });

  it("rebaixa a confiança quando o trecho não existe em nenhuma mensagem do lead", () => {
    const result = parseLeadOutcomeResponse(
      response({
        reason: "price",
        evidence_excerpt: "o paciente demonstrou preocupação com o orçamento",
        confidence: 98,
      }),
      messages,
    );

    expect(result?.evidenceMessageId).toBeNull();
    expect(result?.confidence).toBe(UNVERIFIED_EVIDENCE_CONFIDENCE_CAP);
  });

  it("rebaixa a confiança quando o trecho veio de uma mensagem da clínica", () => {
    const result = parseLeadOutcomeResponse(
      response({
        reason: "price",
        evidence_excerpt: "O investimento fica a partir de R$ 1.200 por dente.",
        confidence: 99,
      }),
      messages,
    );

    expect(result?.evidenceMessageId).toBeNull();
    expect(result?.confidence).toBe(UNVERIFIED_EVIDENCE_CONFIDENCE_CAP);
  });

  it("aceita no_response sem evidência mantendo a confiança", () => {
    const result = parseLeadOutcomeResponse(
      response({ reason: "no_response", evidence_excerpt: null, confidence: 85 }),
      messages,
    );

    expect(result).toEqual({
      reason: "no_response",
      evidenceExcerpt: null,
      evidenceMessageId: null,
      confidence: 85,
    });
  });

  it("rebaixa motivo sem evidência que não seja no_response", () => {
    const result = parseLeadOutcomeResponse(
      response({ reason: "competitor", evidence_excerpt: null, confidence: 90 }),
      messages,
    );

    expect(result?.confidence).toBe(UNVERIFIED_EVIDENCE_CONFIDENCE_CAP);
  });

  it("extrai o JSON mesmo quando o modelo escreve texto ao redor", () => {
    const raw = `Claro! Segue a análise:\n\`\`\`json\n{"reason":"schedule","evidence_excerpt":null,"confidence":70}\n\`\`\``;
    expect(parseLeadOutcomeResponse(raw, messages)?.reason).toBe("schedule");
  });

  it("recusa motivo fora do enum", () => {
    const result = parseLeadOutcomeResponse(
      response({ reason: "achou_caro", evidence_excerpt: null, confidence: 90 }),
      messages,
    );
    expect(result).toBeNull();
  });

  it("recusa resposta sem JSON", () => {
    expect(parseLeadOutcomeResponse("não consegui analisar", messages)).toBeNull();
  });

  it("normaliza confiança fora da faixa 0-100", () => {
    const acima = parseLeadOutcomeResponse(
      response({ reason: "no_response", evidence_excerpt: null, confidence: 250 }),
      messages,
    );
    expect(acima?.confidence).toBe(100);

    const abaixo = parseLeadOutcomeResponse(
      response({ reason: "no_response", evidence_excerpt: null, confidence: -10 }),
      messages,
    );
    expect(abaixo?.confidence).toBe(0);

    const ausente = parseLeadOutcomeResponse(
      response({ reason: "no_response", evidence_excerpt: null }),
      messages,
    );
    expect(ausente?.confidence).toBe(0);
  });
});

describe("LeadOutcomeClassifier — prompt", () => {
  const input = {
    clinicName: "Clínica Exemplo",
    specialty: "odontologia estética",
    leadName: "Ana",
    treatmentInterest: "Lentes de contato dental",
    messages,
  };

  it("inclui a conversa, o nome do lead e o interesse", () => {
    const prompt = buildLeadOutcomePrompt(input);

    expect(prompt).toContain("Clínica Exemplo");
    expect(prompt).toContain("Ana");
    expect(prompt).toContain("Lentes de contato dental");
    expect(prompt).toContain("tá bem acima do que eu posso pagar agora");
    expect(prompt).toContain("LEAD:");
    expect(prompt).toContain("CLÍNICA:");
  });

  it("limita a janela às últimas mensagens para não estourar custo", () => {
    const muitas: ClassifierMessage[] = Array.from({ length: 60 }, (_, i) => ({
      id: `m${i}`,
      author: i % 2 === 0 ? "lead" : "agent",
      body: `mensagem numero ${i}`,
    }));

    const prompt = buildLeadOutcomePrompt({ ...input, messages: muitas });

    expect(prompt).toContain("mensagem numero 59");
    expect(prompt).not.toContain("mensagem numero 0 ");
    const linhas = prompt.split("\n").filter((l) => /^\[\d+\] (LEAD|CLÍNICA):/.test(l));
    expect(linhas).toHaveLength(MAX_CLASSIFIER_MESSAGES);
  });

  it("ignora mensagens vazias", () => {
    const prompt = buildLeadOutcomePrompt({
      ...input,
      messages: [
        { id: "a", author: "lead", body: null },
        { id: "b", author: "lead", body: "   " },
        { id: "c", author: "lead", body: "quanto custa?" },
      ],
    });

    const linhas = prompt.split("\n").filter((l) => /^\[\d+\] (LEAD|CLÍNICA):/.test(l));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain("quanto custa?");
  });
});
