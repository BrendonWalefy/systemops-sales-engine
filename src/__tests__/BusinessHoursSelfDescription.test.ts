// Lead descrevendo a própria operação não é pergunta de expediente.
//
// Caso real, SystemOps 13/08/2026: "Tenho uma operação funcionando hoje, que meu
// problema maior é em responder o WhatsApp, durante o dia chega muita mensagem
// mas normalmente estou ocupado" recebeu "Nosso horário de atendimento é:
// Seg-Sáb 8h-18h". O lead abriu a dor dele e levou uma tabela de horário.
//
// Mecanismo: isBusinessHoursQuestion combina dois conjuntos de palavras soltos
// com E — um verbo de operação e um marcador de período. "funciona" casa dentro
// de "funcionando" (hasAnyKeyword é substring) e "dia" casa em "durante o dia".
// Nenhum dos dois pedaços sozinho dispara; juntos, sim. E nada exigia que a
// frase fosse pergunta dirigida à clínica.

import { describe, expect, it } from "vitest";
import { isBusinessHoursQuestion } from "@/core/pipeline/ConversationOrchestrator";

const CASO_REAL =
  "Tenho uma operação funcionando hoje, que meu problema maior é em responder o " +
  "WhatsApp, durante o dia chega muita mensagem mas normalmente estou ocupado";

describe("isBusinessHoursQuestion — lead falando de si", () => {
  it("não trata a dor do lead como pergunta de expediente", () => {
    expect(isBusinessHoursQuestion(CASO_REAL)).toBe(false);
  });

  it("não dispara com 'funcionando' e 'dia' na mesma frase declarativa", () => {
    // O par mínimo que reproduz, isolado por bisseção da mensagem real.
    expect(isBusinessHoursQuestion("funcionando hoje durante o dia")).toBe(false);
  });

  it("não confunde equipamento que funciona bem com expediente", () => {
    expect(isBusinessHoursQuestion("o aparelho funciona bem no dia a dia?")).toBe(false);
  });

  it("distingue pelo sujeito, não pelo verbo", () => {
    // Mesmo verbo, decisões opostas: quem funciona é que decide.
    expect(isBusinessHoursQuestion("a clínica funciona de manhã?")).toBe(true);
    expect(isBusinessHoursQuestion("o aparelho funciona de manhã?")).toBe(false);
  });

  it("continua reconhecendo as perguntas reais de expediente", () => {
    // Regressão: estas passavam antes e não podem parar de passar.
    expect(isBusinessHoursQuestion("qual o horário de funcionamento?")).toBe(true);
    expect(isBusinessHoursQuestion("que horário vocês abrem?")).toBe(true);
    expect(isBusinessHoursQuestion("atendem de manhã?")).toBe(true);
    expect(isBusinessHoursQuestion("vocês funcionam aos domingos?")).toBe(true);
    expect(isBusinessHoursQuestion("qual o expediente de vocês?")).toBe(true);
    expect(isBusinessHoursQuestion("atendem à tarde?")).toBe(true);
  });
});
