import { describe, it, expect } from "vitest";
import { lintPersonaCoherence } from "@/application/config/playbook-lint";

/**
 * O `greetingMessage` é o OPENER do primeiro contato (concierge); o `receptionistName`
 * é quem a LLM diz ser nas respostas seguintes. Quando divergem, o lead conhece dois
 * personagens. Caso real (Ximendes, jul/2026): 62 mensagens diziam "Marina" e 31
 * "recepcionista virtual" — descoberto lendo conversa, não pelo produto.
 */
describe("lintPersonaCoherence", () => {
  it("avisa quando o nome configurado não aparece na saudação (caso Ximendes)", () => {
    const w = lintPersonaCoherence(
      "Olá! Sou a recepcionista virtual da Ximendes Odontologia. Como posso ajudar?",
      "Marina",
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("Marina");
    expect(w[0]).toMatch(/dois personagens/i);
  });

  it("não avisa quando a saudação nomeia a recepcionista (caso Vitalli)", () => {
    const w = lintPersonaCoherence(
      "Olá, tudo bem? Me chamo Gleice, sou da Clínica Vitalli. Vi que você se interessou pelas lentes.",
      "Gleice",
    );
    expect(w).toEqual([]);
  });

  it("não avisa após o conserto da Ximendes (saudação passou a nomear a Marina)", () => {
    const w = lintPersonaCoherence(
      "Olá! Me chamo Marina, sou a recepcionista da Ximendes Odontologia. Me conta o que você precisa: valores, agendamento ou tirar uma dúvida?",
      "Marina",
    );
    expect(w).toEqual([]);
  });

  it("é insensível a acento e caixa", () => {
    expect(lintPersonaCoherence("Olá! Aqui é a TÂNIA da clínica.", "Tânia")).toEqual([]);
    expect(lintPersonaCoherence("Olá! Aqui é a tania da clínica.", "Tânia")).toEqual([]);
  });

  it("não avisa quando falta um dos dois lados (nada a comparar)", () => {
    expect(lintPersonaCoherence(null, "Marina")).toEqual([]);
    expect(lintPersonaCoherence("Olá! Como posso ajudar?", null)).toEqual([]);
    expect(lintPersonaCoherence("", "")).toEqual([]);
    expect(lintPersonaCoherence("   ", "Marina")).toEqual([]);
  });

  it("nunca bloqueia — é sempre aviso (retorna lista, não lança)", () => {
    expect(() => lintPersonaCoherence("saudação sem nome", "Marina")).not.toThrow();
    expect(Array.isArray(lintPersonaCoherence("saudação sem nome", "Marina"))).toBe(true);
  });
});
