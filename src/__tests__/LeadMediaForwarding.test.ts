// Testes para:
//   1. buildActionContext("media_received") — template correto por tipo de mídia
//   2. normalizeForTts — limpeza de texto antes de síntese de voz

import { describe, it, expect } from "vitest";
import { buildActionContext } from "@/core/intelligence/ResponseComposer";
import type { ActionResult } from "@/core/intelligence/ResponseComposer";
import { normalizeForTts } from "@/infrastructure/adapters/ai/tts/tts-text-normalizer";

// ─── buildActionContext para media_received ────────────────────────────────────

describe("buildActionContext — media_received", () => {
  it("foto: template menciona recebimento de foto", () => {
    const result = buildActionContext({ type: "media_received", mediaType: "image" } as ActionResult);
    expect(result).toContain("foto");
    expect(result).toContain("AÇÃO EXECUTADA");
  });

  it("vídeo: template menciona recebimento de vídeo", () => {
    const result = buildActionContext({ type: "media_received", mediaType: "video" } as ActionResult);
    expect(result).toContain("vídeo");
    expect(result).toContain("AÇÃO EXECUTADA");
  });

  it("documento: template menciona recebimento de arquivo", () => {
    const result = buildActionContext({ type: "media_received", mediaType: "document" } as ActionResult);
    expect(result).toContain("arquivo");
    expect(result).toContain("AÇÃO EXECUTADA");
  });

  it("proíbe diagnóstico explicitamente", () => {
    const result = buildActionContext({ type: "media_received", mediaType: "image" } as ActionResult);
    expect(result).toContain("NÃO dê diagnóstico");
  });

  it("proíbe pedir mais fotos", () => {
    const result = buildActionContext({ type: "media_received", mediaType: "image" } as ActionResult);
    expect(result).toContain("NÃO peça mais fotos");
  });

  it("proíbe prazo específico", () => {
    const result = buildActionContext({ type: "media_received", mediaType: "image" } as ActionResult);
    expect(result).toContain("NÃO mencione prazo específico");
  });

  it("limita a 2 frases", () => {
    const result = buildActionContext({ type: "media_received", mediaType: "image" } as ActionResult);
    expect(result).toContain("Máximo 2 frases");
  });

  it("instrui o LLM a dizer que equipe retorna em breve", () => {
    const result = buildActionContext({ type: "media_received", mediaType: "image" } as ActionResult);
    expect(result.toLowerCase()).toContain("retorna em breve");
  });

  it("não é idêntico para tipos diferentes (sem template genérico fixo)", () => {
    const photoResult = buildActionContext({ type: "media_received", mediaType: "image" } as ActionResult);
    const videoResult = buildActionContext({ type: "media_received", mediaType: "video" } as ActionResult);
    const docResult = buildActionContext({ type: "media_received", mediaType: "document" } as ActionResult);
    expect(photoResult).not.toBe(videoResult);
    expect(photoResult).not.toBe(docResult);
    expect(videoResult).not.toBe(docResult);
  });
});

// ─── normalizeForTts ───────────────────────────────────────────────────────────

describe("normalizeForTts", () => {
  it("remove emojis comuns de respostas da IA", () => {
    expect(normalizeForTts("Olá! 😊 Tudo bem?")).toBe("Olá! Tudo bem?");
    expect(normalizeForTts("Até logo! 👋")).toBe("Até logo!");
    expect(normalizeForTts("Perfeito 🙏")).toBe("Perfeito");
  });

  it("remove formatação WhatsApp bold/italic/strikethrough/code", () => {
    expect(normalizeForTts("*negrito* normal")).toBe("negrito normal");
    expect(normalizeForTts("_itálico_ normal")).toBe("itálico normal");
    expect(normalizeForTts("~tachado~ normal")).toBe("tachado normal");
    expect(normalizeForTts("`código` normal")).toBe("código normal");
  });

  it("transforma quebra de linha dupla em pausa de frase (ponto único)", () => {
    // \n\n → ". " e depois ". ." colapsado em "." — evita ponto duplo no áudio
    const result = normalizeForTts("Primeira frase.\n\nSegunda frase.");
    expect(result).toBe("Primeira frase. Segunda frase.");
  });

  it("transforma quebra simples em espaço (não vírgula)", () => {
    // \n → " " — vírgula causa leitura literal "Linha um vírgula Linha dois" no TTS
    const result = normalizeForTts("Linha um\nLinha dois");
    expect(result).toBe("Linha um Linha dois");
  });

  it("colapsa espaços múltiplos", () => {
    expect(normalizeForTts("texto   com    espaços")).toBe("texto com espaços");
  });

  it("preserva texto sem formatação intacto", () => {
    const plain = "Boa tarde, tudo bem com você? Estou aqui para ajudar.";
    expect(normalizeForTts(plain)).toBe(plain);
  });

  it("mensagem típica da IA: remove emojis + asteriscos", () => {
    const aiMsg = "*Boa tarde*, Karen! 😊\nRecebi sua solicitação e vou verificar os horários disponíveis para você!";
    const result = normalizeForTts(aiMsg);
    expect(result).not.toContain("*");
    expect(result).not.toContain("😊");
    expect(result).toContain("Boa tarde");
    expect(result).toContain("Karen");
  });

  it("converte símbolos de moeda (R$) e valores em texto por extenso", () => {
    expect(normalizeForTts("O valor é R$2.500 para 20 elementos.")).toBe("O valor é 2.500 reais para 20 elementos.");
    expect(normalizeForTts("O valor é R$ 5.000 para 20 elementos.")).toBe("O valor é 5.000 reais para 20 elementos.");
    expect(normalizeForTts("Fica por R$ 150")).toBe("Fica por 150 reais");
    expect(normalizeForTts("Total de R$ 150,00.")).toBe("Total de 150 reais.");
    expect(normalizeForTts("Total de R$ 150,50.")).toBe("Total de 150 reais e 50 centavos.");
    expect(normalizeForTts("Total de R$ 0,50.")).toBe("Total de 50 centavos.");
    expect(normalizeForTts("Valor R$ 1,00.")).toBe("Valor 1 real.");
    expect(normalizeForTts("Valor r$ 100.")).toBe("Valor 100 reais.");
    expect(normalizeForTts("Valor de R$ 0,00")).toBe("Valor de 0 reais");
  });

  it("converte datas abreviadas em texto por extenso", () => {
    expect(normalizeForTts("Agendado para 22/06.")).toBe("Agendado para 22 de junho.");
    expect(normalizeForTts("Será no dia 22/06/2026 às 14h.")).toBe("Será no dia 22 de junho de 2026 às 14 horas.");
    expect(normalizeForTts("Dia 5/5/25 às 9h")).toBe("Dia 5 de maio de 2025 às 9 horas");
    expect(normalizeForTts("Consulta em 01/12/26")).toBe("Consulta em 1 de dezembro de 2026");
    expect(normalizeForTts("Dia 22/6.")).toBe("Dia 22 de junho.");
    expect(normalizeForTts("Dia 5/12.")).toBe("Dia 5 de dezembro.");
    // Frações sem ano não devem ser convertidas
    expect(normalizeForTts("Outro teste com fração 1/2.")).toBe("Outro teste com fração 1/2.");
    expect(normalizeForTts("Fração 3/4.")).toBe("Fração 3/4.");
  });
});
