import { describe, it, expect } from "vitest";
import { deduplicateGreetings } from "@/core/intelligence/ResponseComposer";
import { prependFirstMessageSalutation } from "@/core/pipeline/ConversationOrchestrator";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

const SAO_PAULO = new ClinicTimezone("America/Sao_Paulo");

describe("P0.7 — Deduplicação de saudação repetida", () => {
  it("remove a segunda saudação quando o texto real da Vitalli (Ariana) é processado", () => {
    // Texto real capturado em produção (shadow mode) pós-deploy P0.1-P0.6 —
    // a LLM abriu DOIS parágrafos com saudação para a mesma resposta.
    const raw = `Boa noite, Ariana. Tudo bem?
Sou a assistente virtual da Clínica Vitalli.

Boa noite, Ariana! Nós somos especialistas em lentes de resina composta e trabalhamos com opções personalizadas, como a técnica simplificada e a estratificada. Vou te explicar rapidinho como funciona:

A Técnica Simplificada é feita com resina de altíssima qualidade para entregar um sorriso bem harmonioso e natural, com um investimento mais acessível.`;

    const result = deduplicateGreetings(raw);

    const greetingCount = (result.match(/boa noite/gi) || []).length;
    expect(greetingCount).toBe(1);
    expect(result).toContain("Nós somos especialistas em lentes de resina composta");
    expect(result).not.toMatch(/boa noite,?\s*ariana!/i);
  });

  it("mesmo padrão com Bom dia / Boa tarde e outros nomes (Karolyne, Grazi, Ana Ju)", () => {
    const cases = [
      { greeting: "Boa noite", name: "Karolyne" },
      { greeting: "Boa tarde", name: "Grazi" },
      { greeting: "Boa tarde", name: "Ana" },
    ];

    for (const { greeting, name } of cases) {
      const raw = `${greeting}, ${name}. Tudo bem?\nSou a assistente virtual da Clínica Vitalli.\n\n${greeting}, ${name}! Nós somos especialistas em lentes de resina composta.`;
      const result = deduplicateGreetings(raw);

      const count = new RegExp(greeting, "gi");
      expect((result.match(count) || []).length).toBe(1);
    }
  });

  it("não remove nada quando há apenas uma saudação", () => {
    const raw = `Boa noite, Ariana! Nós somos especialistas em lentes de resina composta.`;
    const result = deduplicateGreetings(raw);
    expect(result).toBe(raw);
  });

  it("não afeta texto sem nenhuma saudação", () => {
    const raw = `O investimento depende do procedimento e do que o dentista avaliar no seu caso.`;
    const result = deduplicateGreetings(raw);
    expect(result).toBe(raw);
  });

  it("preserva conteúdo de negócio após remover a saudação duplicada", () => {
    const raw = `Boa tarde, Fernandoeng! Nós somos especialistas em lentes de resina composta e trabalhamos com opções personalizadas.

Boa tarde, Fernandoeng! A técnica simplificada custa a partir de R$ 800 por dente.`;

    const result = deduplicateGreetings(raw);
    expect(result).toContain("A técnica simplificada custa a partir de R$ 800 por dente");
    expect((result.match(/boa tarde/gi) || []).length).toBe(1);
  });

  it("stripLeadingGreeting (via prependFirstMessageSalutation) remove saudação com nome intercalado", () => {
    // Bug original: LEADING_GREETING_RE não contemplava nome entre a saudação
    // e a pontuação, então "Boa noite, Ariana! ..." sobrevivia à limpeza.
    const parts = prependFirstMessageSalutation(
      [{ type: "text", content: "Boa noite, Ariana! Nós somos especialistas em lentes de resina." }],
      SAO_PAULO,
      "Ariana",
    );

    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual(
      expect.objectContaining({ type: "text" }),
    );
    const content = (parts[0] as { type: "text"; content: string }).content;
    const greetingCount = (content.match(/boa noite/gi) || []).length;
    expect(greetingCount).toBe(1);
    expect(content).toContain("Nós somos especialistas em lentes de resina");
  });

  it("prependFirstMessageSalutation limpa saudação de parts subsequentes (multi-part)", () => {
    const parts = prependFirstMessageSalutation(
      [
        { type: "text", content: "Sou a assistente virtual da Clínica Vitalli." },
        { type: "media", id: "abc123" },
        { type: "text", content: "Boa noite, Ariana! Aqui está o resultado." },
      ],
      SAO_PAULO,
      "Ariana",
    );

    const lastPart = parts[parts.length - 1];
    expect(lastPart.type).toBe("text");
    if (lastPart.type === "text") {
      expect(lastPart.content).not.toMatch(/boa noite/i);
      expect(lastPart.content).toContain("Aqui está o resultado");
    }
  });
});
