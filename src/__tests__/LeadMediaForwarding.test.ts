// Testes para o fluxo de mídia inbound (foto/vídeo/documento):
//   1. buildActionContext("media_received") — template correto por tipo de mídia
//   2. Regras de negócio do template — sem diagnóstico, sem prazo, sem pedido de mais fotos

import { describe, it, expect } from "vitest";
import { buildActionContext } from "@/core/intelligence/ResponseComposer";
import type { ActionResult } from "@/core/intelligence/ResponseComposer";

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
