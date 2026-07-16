import { describe, it, expect } from "vitest";
import { extractFirstName } from "@/core/pipeline/ConversationOrchestrator";

// A8 — O nome de exibição do WhatsApp é livre; leads reais aparecem como status,
// frases ou decoração. Saudar "Boa tarde, ocupado" soa robótico — melhor saudar sem
// nome. Casos reais extraídos do histórico da Vitalli (15/07).
describe("extractFirstName — sanitização de nome de exibição do WhatsApp", () => {
  it("retorna o primeiro nome de nomes próprios normais", () => {
    expect(extractFirstName("Alex Santana")).toBe("Alex");
    expect(extractFirstName("Andrea Almeida")).toBe("Andrea");
    expect(extractFirstName("Thyago 🤓")).toBe("Thyago");
    expect(extractFirstName("Gleice")).toBe("Gleice");
  });

  it("rejeita palavra comum / status ('ocupado')", () => {
    expect(extractFirstName("ocupado")).toBeNull();
    expect(extractFirstName("Ocupado")).toBeNull();
  });

  it("rejeita frase de status começando com palavra comum ('Seja Forte E Corajoso 🌻✨')", () => {
    expect(extractFirstName("Seja Forte E Corajoso 🌻✨")).toBeNull();
  });

  it("rejeita token decorativo / só emoji / caracteres estilizados", () => {
    expect(extractFirstName("➢ ‘ 𝙳̷𝚒̷𝚒̷𝚒̷𝚑̷𝟸̷𝚔̷ ~★")).toBeNull();
    expect(extractFirstName("🌻✨")).toBeNull();
    expect(extractFirstName("★")).toBeNull();
  });

  it("rejeita nomes com número (perfis/lojas)", () => {
    expect(extractFirstName("2D")).toBeNull();
    expect(extractFirstName("LOJA123")).toBeNull();
  });

  it("mantém o guard existente de prefixos de negócio/título", () => {
    expect(extractFirstName("Dr. Victor")).toBeNull();
    expect(extractFirstName("Clínica Vitalli")).toBeNull();
  });

  it("aceita apelido curto legítimo (2+ letras)", () => {
    expect(extractFirstName("Be 🧿")).toBe("Be");
  });

  it("retorna null para entrada vazia/nula", () => {
    expect(extractFirstName(null)).toBeNull();
    expect(extractFirstName(undefined)).toBeNull();
    expect(extractFirstName("")).toBeNull();
  });
});
