// "Vocês atendem aos sábados?" precisa responder pela AGENDA, não pelo cadastro.
//
// Medido em produção (Vitalli): sábado é o dia mais movimentado da clínica — 17
// agendamentos em 120 dias, mais que qualquer dia útil, com atendimentos das
// 08:30 às 17:30. Ainda assim a IA respondia "Sim, atendemos aos sábados.
// Horário cadastrado: Seg-Sáb 8h-18h." e a conversa morria ali.
//
// A causa era gramatical: no singular a mensagem já ia para o caminho de
// agendamento (que consulta a agenda real), no plural não. Duas respostas
// opostas para a mesma pergunta, com um dia de diferença:
//   18/07 "Sábado. Atende?"  → "não temos horários... posso oferecer Seg 20/07 às 9h"
//   19/07 "Sabado atende?"   → "Sim, atendemos aos sábados. Horário cadastrado: ..."
//
// O operador humano — o modelo que estamos automatizando — responde
// "Próximo horário disponível no sábado seria 01.08 às 8:00 tudo bem ?".
// Ver docs/architecture/current.md (Agenda).

import { describe, expect, it } from "vitest";
import {
  buildSaturdayAvailabilityAnswer,
  isBusinessHoursQuestion,
  isSaturdayQuestionForOperatingClinic,
} from "@/core/pipeline/ConversationOrchestrator";
import { parseBusinessHours } from "@/core/scheduling/ClinicTimezone";

// Configurações reais em produção.
const VITALLI = parseBusinessHours("Seg-Sáb 8h-18h");
const XIMENDES = parseBusinessHours("Segunda a sexta das 8h às 19h. Sábado das 8h às 13h.");
const SEM_SABADO = parseBusinessHours("Seg-Sex 8h-18h");

const slot = (index: number, label: string) => ({ index, label });

describe("isSaturdayQuestionForOperatingClinic", () => {
  it.each([
    "Vocês atendem aos sábados ?",
    "Vc atende aos sábados?",
    "Vocês estão atendendo aos sábados?",
  ])("reconhece o plural que escapava: %s", (frase) => {
    expect(isSaturdayQuestionForOperatingClinic(frase, VITALLI)).toBe(true);
  });

  it("reconhece também o singular, mantendo as duas formas equivalentes", () => {
    expect(isSaturdayQuestionForOperatingClinic("Vocês atendem dia de sábado ?", VITALLI)).toBe(true);
  });

  it("vale para a Ximendes, que tem sábado com horário próprio", () => {
    expect(isSaturdayQuestionForOperatingClinic("atendem aos sábados?", XIMENDES)).toBe(true);
  });

  it("é falso quando a clínica NÃO abre sábado — lá quem responde é a escalação", () => {
    // Sem isso, ofertaríamos horários de sábado numa clínica que fecha sábado.
    expect(isSaturdayQuestionForOperatingClinic("vocês atendem sábado?", SEM_SABADO)).toBe(false);
  });

  it("é falso quando sábado não foi mencionado", () => {
    expect(isSaturdayQuestionForOperatingClinic("qual o horário de funcionamento?", VITALLI)).toBe(false);
    expect(isSaturdayQuestionForOperatingClinic("atendem aos domingos?", VITALLI)).toBe(false);
  });

  it("NÃO se estende aos dias úteis — o parser não sabe quais são", () => {
    // parseBusinessHours só decide o sábado: seg-sex é sempre assumido [1..5] e
    // domingo nunca é representável. A NC Beauty cadastra "Terça a sexta" e o
    // parser devolve [1..6] — afirmar "atendemos às segundas" seria inventar.
    const ncBeauty = parseBusinessHours("Terça a sexta das 13h às 19h. Sábado das 10h às 17h.");
    expect(ncBeauty.days).toContain(1); // segunda entra mesmo sem constar no cadastro
    expect(ncBeauty.days).not.toContain(0); // domingo nunca entra, mesmo se cadastrado
    expect(parseBusinessHours("Dom-Sáb 8h-18h").days).not.toContain(0);
  });
});

describe("buildSaturdayAvailabilityAnswer", () => {
  it("sábado com vaga: confirma e oferta os horários reais", () => {
    const answer = buildSaturdayAvailabilityAnswer({
      slots: [slot(1, "Sáb 25/07 às 9h"), slot(2, "Sáb 25/07 às 16h")],
      dayIsFull: false,
    });
    expect(answer).toContain("Sim, atendemos aos sábados!");
    expect(answer).toContain("1. Sáb 25/07 às 9h");
    expect(answer).toContain("2. Sáb 25/07 às 16h");
    expect(answer).toContain("Responda apenas com o número");
    // O que quebrava: recitar o cadastro e parar.
    expect(answer).not.toContain("Horário cadastrado");
  });

  it("sábado lotado: diz que as vagas acabaram antes de oferecer outro dia", () => {
    // Sem essa ressalva o lead lê "Sim, atendemos aos sábados" seguido de uma
    // segunda-feira e acha que a IA ignorou o pedido.
    const answer = buildSaturdayAvailabilityAnswer({
      slots: [slot(1, "Seg 27/07 às 9h")],
      dayIsFull: true,
    });
    expect(answer).toContain("Atendemos aos sábados");
    expect(answer).toContain("já foram preenchidas");
    expect(answer).not.toContain("Sim, atendemos aos sábados!");
    expect(answer).toContain("1. Seg 27/07 às 9h");
  });
});

describe("roteamento — a pergunta precisa chegar ao ramo certo", () => {
  it("o plural continua sendo pergunta de horário (é lá que a agenda é consultada)", () => {
    expect(isBusinessHoursQuestion("Vocês atendem aos sábados ?")).toBe(true);
  });

  it("o singular segue direto para o caminho de agendamento, como já fazia", () => {
    // Regressão a vigiar: se isto virar true, a mensagem passa a ser tratada
    // como institucional e perde o fluxo de agendamento completo.
    expect(isBusinessHoursQuestion("Sábado. Atende?")).toBe(false);
    expect(isBusinessHoursQuestion("Vocês tem horário para sábado")).toBe(false);
  });
});
