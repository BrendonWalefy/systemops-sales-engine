import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { deduplicateGreetings } from "@/core/intelligence/ResponseComposer";
import { prependFirstMessageSalutation, prependPipelineIntroGreeting } from "@/core/pipeline/ConversationOrchestrator";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import type { ResponsePart } from "@/core/intelligence/ResponseComposer";

const SAO_PAULO = new ClinicTimezone("America/Sao_Paulo");

// getDayGreeting deriva a saudação da hora ATUAL (new Date()). Fixamos o relógio
// numa noite determinística (20h em São Paulo → "Boa noite") para que as asserções
// de saudação não sejam flaky conforme a hora em que a suíte roda.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-15T23:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

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

describe("P0.7 (pipeline) — saudação ÚNICA quando pipeline de conteúdo dispara na 1ª msg", () => {
  // Blocos crus do playbook da Vitalli (técnicas de lente), exatamente como o
  // pipeline monta antes de saudar. NÃO contêm saudação.
  const lentesBlocks: ResponsePart[] = [
    { type: "text", content: "Nós somos especialistas em lentes de resina composta e trabalhamos com opções personalizadas, como a técnica simplificada e a estratificada. Vou te explicar rapidinho como funciona:" },
    { type: "text", content: "A Técnica Simplificada é feita com resina de altíssima qualidade..." },
    { type: "media", id: "5ffd33e9" },
    { type: "text", content: "Já a Técnica Estratificada é feita com resina premium em várias camadas..." },
    { type: "media", id: "0c771e1b" },
  ];

  it("prependPipelineIntroGreeting adiciona EXATAMENTE uma saudação aos blocos do pipeline", () => {
    const parts = prependPipelineIntroGreeting(lentesBlocks, SAO_PAULO, "Clínica Vitalli", "RR", "Gleice");
    const fullText = parts.filter((p): p is Extract<ResponsePart, { type: "text" }> => p.type === "text").map((p) => p.content).join("\n\n");

    expect((fullText.match(/boa (?:dia|tarde|noite)/gi) || []).length).toBe(1);
    expect(fullText).toContain("Tudo bem?");
    // Persona humana: nunca "assistente virtual" (A2).
    expect(fullText).toContain("Sou a Gleice, da Clínica Vitalli");
    expect(fullText).not.toMatch(/assistente virtual/i);
    expect(fullText).toContain("Nós somos especialistas em lentes de resina composta");
  });

  it("preserva os blocos de mídia intactos (não engole os vídeos)", () => {
    const parts = prependPipelineIntroGreeting(lentesBlocks, SAO_PAULO, "Clínica Vitalli", "RR", "Gleice");
    const mediaIds = parts.filter((p): p is Extract<ResponsePart, { type: "media" }> => p.type === "media").map((p) => p.id);
    expect(mediaIds).toEqual(["5ffd33e9", "0c771e1b"]);
  });

  it("defensivo: se o primeiro bloco já abrir com saudação, ainda assim NÃO duplica", () => {
    const blocksComSaudacao: ResponsePart[] = [
      { type: "text", content: "Boa noite, RR! Nós somos especialistas em lentes." },
    ];
    const parts = prependPipelineIntroGreeting(blocksComSaudacao, SAO_PAULO, "Clínica Vitalli", "RR", "Gleice");
    const fullText = (parts[0] as Extract<ResponsePart, { type: "text" }>).content;
    // Período-agnóstico: getDayGreeting depende da hora atual, então conta QUALQUER
    // saudação (a do bloco foi limpa e substituída pela canônica) — nunca duas.
    expect((fullText.match(/boa (?:dia|tarde|noite)/gi) || []).length).toBe(1);
    expect(fullText).toContain("Nós somos especialistas em lentes");
  });

  it("REGRESSÃO do bug real: mesmo re-aplicado sobre parts já saudadas, resulta em UMA saudação", () => {
    // ANTES (bug): o caminho de pipeline chamava prependFirstMessageSalutation
    // ("Boa noite, RR!") e DEPOIS o pós-switch somava o prefixo rico → DUAS saudações
    // (exatamente o print da Vitalli). Reproduzimos essa entrada já-saudada e provamos
    // que a defesa (stripLeadingGreeting dentro de prependPipelineIntroGreeting) a colapsa
    // para uma só — dupla proteção além do fix estrutural (pipeline não sauda mais lá).
    const preSaluted = prependFirstMessageSalutation(lentesBlocks, SAO_PAULO, "RR");
    expect((preSaluted[0] as Extract<ResponsePart, { type: "text" }>).content).toMatch(/^Boa (?:dia|tarde|noite)/);

    const collapsed = prependPipelineIntroGreeting(preSaluted, SAO_PAULO, "Clínica Vitalli", "RR", "Gleice");
    const collapsedFirst = (collapsed[0] as Extract<ResponsePart, { type: "text" }>).content;
    expect((collapsedFirst.match(/boa (?:dia|tarde|noite)/gi) || []).length).toBe(1);

    // E o caminho de produção pós-fix (blocos crus) também dá exatamente uma.
    const fixed = prependPipelineIntroGreeting(lentesBlocks, SAO_PAULO, "Clínica Vitalli", "RR", "Gleice");
    const fixedFirst = (fixed[0] as Extract<ResponsePart, { type: "text" }>).content;
    expect((fixedFirst.match(/boa (?:dia|tarde|noite)/gi) || []).length).toBe(1);
  });

  it("sem nome do lead: sauda sem vírgula-nome mas mantém o intro", () => {
    const parts = prependPipelineIntroGreeting(lentesBlocks, SAO_PAULO, "Clínica Vitalli", null, "Gleice");
    const first = (parts[0] as Extract<ResponsePart, { type: "text" }>).content;
    expect(first).toMatch(/^Boa (?:dia|tarde|noite)\. Tudo bem\?/);
    expect(first).toContain("Sou a Gleice, da Clínica Vitalli.");
  });
});
