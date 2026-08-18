// O teto de tokens tem que acompanhar o orçamento de caracteres.
//
// Medido em 13/08: CHAT_MAX_TOKENS=350 (~1.200 chars) e
// RESPONSES_MAX_OUTPUT_TOKENS=700 (~2.500 chars) contra um orçamento cobrado de
// 280. A trava dura ficava 4 a 9x acima do alvo, então o modelo tinha espaço de
// sobra e a instrução de brevidade era só um pedido. Dizer o número no prompt
// não reduziu violação nenhuma (57% antes, 57% depois).
//
// Resposta grande demais é a reclamação recorrente dos clientes, então o
// caminho é apertar a trava, não afrouxar o limite.

import { describe, expect, it } from "vitest";
import { resolveComposerMaxTokens } from "@/core/intelligence/ResponseComposer";

describe("resolveComposerMaxTokens", () => {
  it("deriva o teto do orçamento de caracteres", () => {
    // ~3,5 chars por token em português, com folga para fechar a frase.
    const teto = resolveComposerMaxTokens(280);
    expect(teto).toBeGreaterThan(70);
    expect(teto).toBeLessThan(140);
  });

  it("acompanha um orçamento maior", () => {
    expect(resolveComposerMaxTokens(1_200)).toBeGreaterThan(resolveComposerMaxTokens(280));
  });

  it("nunca desce abaixo do mínimo que fecha uma frase", () => {
    expect(resolveComposerMaxTokens(20)).toBeGreaterThanOrEqual(60);
  });

  it("mantém um teto de segurança quando não há orçamento", () => {
    expect(resolveComposerMaxTokens(undefined)).toBe(350);
  });
});
