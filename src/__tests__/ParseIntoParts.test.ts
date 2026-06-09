import { describe, it, expect } from "vitest";
import { parseIntoParts } from "@/core/intelligence/ResponseComposer";

describe("parseIntoParts — extração de partes text/media do output do LLM", () => {
  it("texto puro sem tags retorna uma única parte de texto", () => {
    const parts = parseIntoParts("Olá, como posso ajudar?");
    expect(parts).toEqual([{ type: "text", content: "Olá, como posso ajudar?" }]);
  });

  it("string vazia retorna array vazio", () => {
    expect(parseIntoParts("")).toEqual([]);
  });

  it("string somente com espaços retorna array vazio", () => {
    expect(parseIntoParts("   ")).toEqual([]);
  });

  it("tag de mídia isolada retorna uma parte de media", () => {
    const parts = parseIntoParts("[MEDIA:abc123]");
    expect(parts).toEqual([{ type: "media", id: "abc123" }]);
  });

  it("tag de mídia no início seguida de texto — media antes de texto", () => {
    const parts = parseIntoParts("[MEDIA:vid-1]\nA Técnica Simplificada usa resina.");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "media", id: "vid-1" });
    expect(parts[1]).toEqual({ type: "text", content: "A Técnica Simplificada usa resina." });
  });

  it("texto antes da tag — texto antes de media", () => {
    const parts = parseIntoParts("Veja o vídeo:\n[MEDIA:vid-2]");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", content: "Veja o vídeo:" });
    expect(parts[1]).toEqual({ type: "media", id: "vid-2" });
  });

  it("formato intercalado completo: media→texto→media→texto (fluxo lentes)", () => {
    // Após a última [MEDIA:] tag, todo o texto restante vira um único bloco.
    // Isso é correto: explicação da estratificada + pergunta de qualificação chegam juntas.
    const raw = `[MEDIA:simplificada-id]
A Técnica Simplificada usa resina de alta qualidade.

[MEDIA:estratificada-id]
A Técnica Estratificada usa resina premium em múltiplas camadas.

Qual dessas combina mais com o que você busca?`;

    const parts = parseIntoParts(raw);
    expect(parts).toHaveLength(4);
    expect(parts[0]).toEqual({ type: "media", id: "simplificada-id" });
    expect(parts[1]).toEqual({ type: "text", content: "A Técnica Simplificada usa resina de alta qualidade." });
    expect(parts[2]).toEqual({ type: "media", id: "estratificada-id" });
    // texto restante inclui explicação + pergunta de qualificação no mesmo bloco
    expect(parts[3].type).toBe("text");
    expect((parts[3] as { type: "text"; content: string }).content).toContain("A Técnica Estratificada");
    expect((parts[3] as { type: "text"; content: string }).content).toContain("Qual dessas combina mais");
  });

  it("dois blocos media+texto sem texto final", () => {
    const raw = "[MEDIA:id-a]\nTexto A.\n[MEDIA:id-b]\nTexto B.";
    const parts = parseIntoParts(raw);
    expect(parts).toHaveLength(4);
    expect(parts[0]).toEqual({ type: "media", id: "id-a" });
    expect(parts[1]).toEqual({ type: "text", content: "Texto A." });
    expect(parts[2]).toEqual({ type: "media", id: "id-b" });
    expect(parts[3]).toEqual({ type: "text", content: "Texto B." });
  });

  it("ID com hífens e underscores é preservado corretamente", () => {
    const parts = parseIntoParts("[MEDIA:video_lentes-simplificada-2026]");
    expect(parts[0]).toEqual({ type: "media", id: "video_lentes-simplificada-2026" });
  });

  it("múltiplas tags consecutivas sem texto entre elas", () => {
    const parts = parseIntoParts("[MEDIA:id-1][MEDIA:id-2]");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "media", id: "id-1" });
    expect(parts[1]).toEqual({ type: "media", id: "id-2" });
  });

  it("mediaIds extraídos correspondem à ordem das tags no texto", () => {
    const raw = "[MEDIA:first]\nTexto.\n[MEDIA:second]\nOutro texto.";
    const parts = parseIntoParts(raw);
    const mediaIds = parts
      .filter((p): p is { type: "media"; id: string } => p.type === "media")
      .map((p) => p.id);
    expect(mediaIds).toEqual(["first", "second"]);
  });

  it("texto concatenado (campo text do ComposedResponse) não contém tags [MEDIA:]", () => {
    const raw = "[MEDIA:vid-1]\nTexto A.\n[MEDIA:vid-2]\nTexto B.";
    const parts = parseIntoParts(raw);
    const textContent = parts
      .filter((p): p is { type: "text"; content: string } => p.type === "text")
      .map((p) => p.content)
      .join(" ");
    expect(textContent).not.toContain("[MEDIA:");
    expect(textContent).toContain("Texto A.");
    expect(textContent).toContain("Texto B.");
  });
});
