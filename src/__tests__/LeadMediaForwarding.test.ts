// Testes para:
//   1. buildActionContext("media_received") — template correto por tipo de mídia
//   2. sanitizeForTts — limpeza de texto antes de síntese de voz

import { describe, it, expect } from "vitest";
import { buildActionContext } from "@/core/intelligence/ResponseComposer";
import type { ActionResult } from "@/core/intelligence/ResponseComposer";
import { sanitizeForTts } from "@/infrastructure/adapters/ai/tts/openai-tts-gateway";

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

// ─── sanitizeForTts ───────────────────────────────────────────────────────────

describe("sanitizeForTts", () => {
  it("remove emojis comuns de respostas da IA", () => {
    expect(sanitizeForTts("Olá! 😊 Tudo bem?")).toBe("Olá! Tudo bem?");
    expect(sanitizeForTts("Até logo! 👋")).toBe("Até logo!");
    expect(sanitizeForTts("Perfeito 🙏")).toBe("Perfeito");
  });

  it("remove formatação WhatsApp bold/italic/strikethrough/code", () => {
    expect(sanitizeForTts("*negrito* normal")).toBe("negrito normal");
    expect(sanitizeForTts("_itálico_ normal")).toBe("itálico normal");
    expect(sanitizeForTts("~tachado~ normal")).toBe("tachado normal");
    expect(sanitizeForTts("`código` normal")).toBe("código normal");
  });

  it("transforma quebra de linha dupla em pausa de frase (ponto único)", () => {
    // \n\n → ". " e depois ". ." colapsado em "." — evita ponto duplo no áudio
    const result = sanitizeForTts("Primeira frase.\n\nSegunda frase.");
    expect(result).toBe("Primeira frase. Segunda frase.");
  });

  it("transforma quebra simples em espaço (não vírgula)", () => {
    // \n → " " — vírgula causa leitura literal "Linha um vírgula Linha dois" no TTS
    const result = sanitizeForTts("Linha um\nLinha dois");
    expect(result).toBe("Linha um Linha dois");
  });

  it("colapsa espaços múltiplos", () => {
    expect(sanitizeForTts("texto   com    espaços")).toBe("texto com espaços");
  });

  it("preserva texto sem formatação intacto", () => {
    const plain = "Boa tarde, tudo bem com você? Estou aqui para ajudar.";
    expect(sanitizeForTts(plain)).toBe(plain);
  });

  it("mensagem típica da IA: remove emojis + asteriscos", () => {
    const aiMsg = "*Boa tarde*, Karen! 😊\nRecebi sua solicitação e vou verificar os horários disponíveis para você!";
    const result = sanitizeForTts(aiMsg);
    expect(result).not.toContain("*");
    expect(result).not.toContain("😊");
    expect(result).toContain("Boa tarde");
    expect(result).toContain("Karen");
  });

  it("converte símbolos de moeda (R$) e valores em texto por extenso", () => {
    expect(sanitizeForTts("O valor é R$2.500 para 20 elementos.")).toBe("O valor é 2.500 reais para 20 elementos.");
    expect(sanitizeForTts("O valor é R$ 5.000 para 20 elementos.")).toBe("O valor é 5.000 reais para 20 elementos.");
    expect(sanitizeForTts("Fica por R$ 150")).toBe("Fica por 150 reais");
    expect(sanitizeForTts("Total de R$ 150,00.")).toBe("Total de 150 reais.");
    expect(sanitizeForTts("Total de R$ 150,50.")).toBe("Total de 150 reais e 50 centavos.");
    expect(sanitizeForTts("Total de R$ 0,50.")).toBe("Total de 50 centavos.");
    expect(sanitizeForTts("Valor R$ 1,00.")).toBe("Valor 1 real.");
    expect(sanitizeForTts("Valor r$ 100.")).toBe("Valor 100 reais.");
    expect(sanitizeForTts("Valor de R$ 0,00")).toBe("Valor de 0 reais");
  });
});
