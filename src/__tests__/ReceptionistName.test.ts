import { describe, expect, it } from "vitest";
import { inferReceptionistNameFromGreeting } from "@/core/intelligence/receptionist-name";

describe("inferReceptionistNameFromGreeting", () => {
  it("extrai o nome após 'Sou a'", () => {
    expect(
      inferReceptionistNameFromGreeting(
        "Seja bem-vindo à Clínica Horizonte. Sou a Marina, assistente do Dr. Silva.",
      ),
    ).toBe("Marina");
  });

  it("extrai o nome após 'Meu nome é'", () => {
    expect(
      inferReceptionistNameFromGreeting("Olá! Meu nome é Clara e vou te ajudar."),
    ).toBe("Clara");
  });

  it("extrai o nome após 'Me chamo' (opener da Aurora)", () => {
    expect(
      inferReceptionistNameFromGreeting(
        "Olá, tudo bem? Me chamo Gleice, sou da Clínica Aurora. Vi que você se interessou pelas lentes.",
      ),
    ).toBe("Gleice");
  });

  it("retorna null quando não encontra um nome claro", () => {
    expect(
      inferReceptionistNameFromGreeting("Seja bem-vindo à clínica. Como posso ajudar?"),
    ).toBeNull();
  });
});
