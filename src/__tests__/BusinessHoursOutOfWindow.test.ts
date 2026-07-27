// Pergunta de horário FORA do expediente não pode virar beco sem saída.
//
// Caso real (19/07, Ximendes): o lead escreveu "dependendo do horário que vocês
// atendem, posso ir após as 18h na semana" e recebeu "Nosso horário de atendimento
// é: Seg-Sáb 8h-18h." — tecnicamente correto, comercialmente morto. A conversa
// acabou ali.
//
// O operador humano nunca faz isso: informa o limite e emenda a alternativa
// ("Vou te encaminhar os dias disponíveis"). Ver
// docs/product/plano-correcao-conversacional.md item #5.

import { describe, expect, it } from "vitest";
import {
  buildBusinessHoursAnswer,
  extractRequestedTimeBoundary,
  isRequestedTimeOutsideBusinessHours,
  requiresTeamCheckForHours,
} from "@/core/pipeline/ConversationOrchestrator";
import { parseBusinessHours } from "@/core/scheduling/ClinicTimezone";

const HOURS = "Seg-Sáb 8h-18h";
const parsed = parseBusinessHours(HOURS);

describe("extractRequestedTimeBoundary", () => {
  it.each([
    ["posso ir após as 18h na semana", 18 * 60, "after"],
    ["consigo depois das 19:30", 19 * 60 + 30, "after"],
    ["atendem a partir das 7h?", 7 * 60, "after"],
    ["só consigo antes das 9h", 9 * 60, "before"],
    ["dá até as 10:30?", 10 * 60 + 30, "before"],
  ])("extrai %s", (msg, minutes, direction) => {
    expect(extractRequestedTimeBoundary(msg)).toEqual({ minutes, direction });
  });

  it("devolve null quando não há pedido de horário", () => {
    expect(extractRequestedTimeBoundary("qual o horário de funcionamento?")).toBeNull();
    expect(extractRequestedTimeBoundary("quanto custa a lente?")).toBeNull();
  });
});

describe("isRequestedTimeOutsideBusinessHours", () => {
  it("18h com expediente até 18h está fora", () => {
    expect(isRequestedTimeOutsideBusinessHours({ minutes: 18 * 60, direction: "after" }, parsed)).toBe(true);
  });

  it("14h está dentro", () => {
    expect(isRequestedTimeOutsideBusinessHours({ minutes: 14 * 60, direction: "after" }, parsed)).toBe(false);
  });

  it("antes das 8h está fora", () => {
    expect(isRequestedTimeOutsideBusinessHours({ minutes: 7 * 60, direction: "before" }, parsed)).toBe(true);
  });
});

describe("buildBusinessHoursAnswer — política explícita por clínica", () => {
  const CASO_REAL = "Porque dependendo do horário que vocês atendem, posso ir após as 18h na semana";

  it("não promete exceção quando a clínica não habilitou essa política", () => {
    const answer = buildBusinessHoursAnswer(HOURS, CASO_REAL);
    expect(answer).toContain("dentro do nosso horário");
    expect(answer).not.toContain("exceção");
    expect(answer).not.toContain("verificar com a equipe");
  });

  it("escala somente com opt-in explícito do tenant", () => {
    const answer = buildBusinessHoursAnswer(HOURS, CASO_REAL, true);
    expect(answer).toContain("permite solicitar uma análise de exceção");
    expect(answer).toContain("verificar com a equipe");
    expect(requiresTeamCheckForHours(CASO_REAL, HOURS, true)).toBe(true);
    expect(requiresTeamCheckForHours(CASO_REAL, HOURS, false)).toBe(false);
    expect(requiresTeamCheckForHours("posso ir depois das 14h?", HOURS, true)).toBe(false);
  });

  it("sábado fora da agenda padrão não inventa possibilidade", () => {
    const answer = buildBusinessHoursAnswer("Seg-Sex 8h-18h", "vocês atendem sábado?");
    expect(answer).toContain("não consta na agenda padrão");
    expect(answer).not.toContain("verificar com a equipe");
  });

  it("sábado fora da agenda pode escalar quando o tenant habilita exceção", () => {
    const answer = buildBusinessHoursAnswer("Seg-Sex 8h-18h", "vocês atendem sábado?", true);
    expect(answer).toContain("verificar com a equipe");
  });

  it("sábado COM atendimento responde direto, sem escalar à toa", () => {
    const answer = buildBusinessHoursAnswer(HOURS, "vocês atendem sábado?");
    expect(answer).toContain("Sim, atendemos aos sábados");
    expect(answer).not.toContain("verificar com a equipe");
  });

  it("pergunta institucional pura mantém a resposta enxuta", () => {
    // Sem pedido de horário específico não há o que oferecer — não inflar.
    expect(buildBusinessHoursAnswer(HOURS, "qual o horário de funcionamento?"))
      .toBe(`Nosso horário de atendimento é: ${HOURS}.`);
  });

  it("horário DENTRO da janela não escala", () => {
    const answer = buildBusinessHoursAnswer(HOURS, "posso ir depois das 14h?");
    expect(answer).not.toContain("verificar com a equipe");
  });
});
