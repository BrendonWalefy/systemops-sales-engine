import { describe, expect, it } from "vitest";
import { inferReceptionistNameFromGreeting } from "@/core/intelligence/receptionist-name";

describe("inferReceptionistNameFromGreeting", () => {
  it("extrai o nome após 'Sou a'", () => {
    expect(
      inferReceptionistNameFromGreeting(
        "Seja bem-vindo à Ximendes Odontologia. Sou a Marina, assistente do Dr. Gregorie.",
      ),
    ).toBe("Marina");
  });

  it("extrai o nome após 'Meu nome é'", () => {
    expect(
      inferReceptionistNameFromGreeting("Olá! Meu nome é Clara e vou te ajudar."),
    ).toBe("Clara");
  });

  it("retorna null quando não encontra um nome claro", () => {
    expect(
      inferReceptionistNameFromGreeting("Seja bem-vindo à clínica. Como posso ajudar?"),
    ).toBeNull();
  });
});
