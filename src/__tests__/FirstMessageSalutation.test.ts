import { describe, expect, it } from "vitest";
import { prependFirstMessageSalutation } from "@/core/pipeline/ConversationOrchestrator";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import type { ResponsePart } from "@/core/intelligence/ResponseComposer";

const saoPaulo = new ClinicTimezone("America/Sao_Paulo");

// Bug: primeira mensagem do lead já vem com pergunta real (ex: "Olá, quero saber
// mais sobre as lentes em resina!"). O IntentClassifier corretamente deixa de
// classificar isso como "greeting" puro (P2, evita engolir a pergunta com o menu
// genérico) — mas isso também tirava a mensagem do único caminho que produzia
// saudação, fazendo o pipeline de tratamento e a resposta da LLM saírem "secos",
// direto para o conteúdo, sem "Bom dia/Boa tarde/Boa noite".
describe("prependFirstMessageSalutation", () => {
  it("prefixa a saudação no primeiro bloco de texto do step de pipeline (caso Aurora/Davi)", () => {
    const pipelineParts: ResponsePart[] = [
      {
        type: "text",
        content:
          "Nós somos especialistas em lentes de resina composta e trabalhamos com opções personalizadas, como a técnica simplificada e a estratificada. Vou te explicar rapidinho como funciona:",
      },
      { type: "text", content: "A Técnica Simplificada é feita com resina de altíssima qualidade..." },
    ];

    const result = prependFirstMessageSalutation(pipelineParts, saoPaulo, "Davi");

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("text");
    expect((result[0] as { type: "text"; content: string }).content).toMatch(
      /^(Bom dia|Boa tarde|Boa noite), Davi! Nós somos especialistas/,
    );
    // Segundo bloco permanece intacto.
    expect(result[1]).toEqual(pipelineParts[1]);
  });

  it("sem nome do lead, omite a vírgula e usa só a saudação", () => {
    const result = prependFirstMessageSalutation(
      [{ type: "text", content: "Como posso ajudar?" }],
      saoPaulo,
      null,
    );
    expect((result[0] as { type: "text"; content: string }).content).toMatch(
      /^(Bom dia|Boa tarde|Boa noite)! Como posso ajudar\?$/,
    );
  });

  it("se o primeiro bloco já for mídia, insere a saudação como um novo bloco de texto antes dela", () => {
    const parts: ResponsePart[] = [{ type: "media", id: "vid-1" }];
    const result = prependFirstMessageSalutation(parts, saoPaulo, "Ana");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: "text",
      content: expect.stringMatching(/^(Bom dia|Boa tarde|Boa noite), Ana!$/),
    });
    expect(result[1]).toEqual(parts[0]);
  });

  it("lista vazia produz só a saudação", () => {
    const result = prependFirstMessageSalutation([], saoPaulo, "Ana");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });

  // Regressão: clínica em produção real (não-shadow) cujo pipeline JÁ tem mídia
  // corretamente configurada em múltiplos pontos (Clínica Horizonte — Dr. Silva).
  // O fix só deve tocar o bloco[0]; os outros 4 blocos, incluindo as duas mídias em
  // posições específicas, têm que sair byte-a-byte idênticos.
  it("não bagunça pipeline com mídia já configurada em múltiplos blocos (caso Horizonte)", () => {
    const horizonteBlocks: ResponsePart[] = [
      { type: "text", content: "Trabalhamos com duas técnicas de lentes em resina: a Simplificada e a Estratificada." },
      { type: "text", content: "A Técnica Simplificada usa resina de alta qualidade e entrega um sorriso natural." },
      { type: "media", id: "1cd64101-9a82-4891-b091-0283237cf46d" },
      { type: "text", content: "A Técnica Estratificada usa resina premium em múltiplas camadas, reproduzindo o brilho natural." },
      { type: "media", id: "b220b903-fa8d-4c4b-a765-defd10246ec4" },
    ];

    const result = prependFirstMessageSalutation(horizonteBlocks, saoPaulo, "Carla");

    expect(result).toHaveLength(5);
    expect((result[0] as { type: "text"; content: string }).content).toMatch(
      /^(Bom dia|Boa tarde|Boa noite), Carla! Trabalhamos com duas técnicas/,
    );
    // Blocos 1-4 idênticos aos originais — nenhuma mídia foi movida, removida ou duplicada.
    expect(result.slice(1)).toEqual(horizonteBlocks.slice(1));
  });

  // Defesa de profundidade: a instrução nova em ResponseComposer.ts pede pra LLM não
  // se auto-saudar quando isFirstMessage=true, mas essa é a MESMA classe de instrução
  // que a LLM já ignorou no bug original (regra 7 de mirror de saudação). Não dá pra
  // confiar só no prompt — o código tem que limpar se a LLM abrir com saudação mesmo assim.
  it("remove saudação redundante que a LLM tenha aberto sozinha (defesa contra prompt ignorado)", () => {
    const result = prependFirstMessageSalutation(
      [{ type: "text", content: "Boa tarde! Vocês fazem lentes estratificadas?" }],
      saoPaulo,
      "Davi",
    );
    const content = (result[0] as { type: "text"; content: string }).content;
    expect(content).toMatch(/^(Bom dia|Boa tarde|Boa noite), Davi! Vocês fazem lentes estratificadas\?$/);
    // Garante que não sobrou um "Boa tarde" duplicado no meio da frase.
    expect(content.match(/bom dia|boa tarde|boa noite/gi)).toHaveLength(1);
  });

  it("remove saudação redundante em variações (olá, oi, com/sem vírgula)", () => {
    const cases = ["Olá! Quero saber mais.", "Oi, tudo bem?", "Bom dia, gostaria de um orçamento."];
    for (const original of cases) {
      const result = prependFirstMessageSalutation([{ type: "text", content: original }], saoPaulo, null);
      const content = (result[0] as { type: "text"; content: string }).content;
      expect(content.match(/bom dia|boa tarde|boa noite/gi)?.length ?? 0).toBeLessThanOrEqual(1);
      expect(content.toLowerCase()).not.toMatch(/(olá|oi,)/);
    }
  });
});
