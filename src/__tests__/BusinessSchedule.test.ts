// Escala de atendimento por dia da semana. Ver
// docs/superpowers/specs/2026-08-13-per-day-business-hours-design.md
//
// O texto livre de businessHours só consegue expressar uma faixa de horário mais
// uma exceção de sábado, e alimenta o SlotEngine — então o que ele não consegue
// guardar virava disponibilidade errada, não apenas frase errada.
import { describe, expect, it } from "vitest";
import {
  resolveBusinessSchedule,
  scheduleFromParsedBusinessHours,
  windowsForWeekday,
  isOpenOnWeekday,
  type BusinessSchedule,
} from "@/core/scheduling/BusinessSchedule";
import { parseBusinessHours } from "@/core/scheduling/ClinicTimezone";

const SEG_A_SEX_8_18: BusinessSchedule = {
  days: {
    1: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
    2: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
    3: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
    4: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
    5: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
  },
};

describe("resolveBusinessSchedule — porta única de leitura", () => {
  it("usa a escala estruturada quando ela existe", () => {
    const schedule = resolveBusinessSchedule({
      businessSchedule: SEG_A_SEX_8_18,
      businessHours: "isso deve ser ignorado",
    });
    expect(windowsForWeekday(schedule, 1)).toEqual([
      { startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 },
    ]);
    expect(isOpenOnWeekday(schedule, 6)).toBe(false);
  });

  it("deriva do texto legado quando não há escala", () => {
    const schedule = resolveBusinessSchedule({
      businessSchedule: null,
      businessHours: "seg-sex 9h-17h",
    });
    expect(windowsForWeekday(schedule, 3)).toEqual([
      { startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 },
    ]);
    expect(isOpenOnWeekday(schedule, 6)).toBe(false);
    expect(isOpenOnWeekday(schedule, 0)).toBe(false);
  });

  it("cai no padrão de segunda a sexta 8h-18h quando não há nem escala nem texto", () => {
    const schedule = resolveBusinessSchedule({ businessSchedule: null, businessHours: null });
    expect(isOpenOnWeekday(schedule, 1)).toBe(true);
    expect(isOpenOnWeekday(schedule, 5)).toBe(true);
    expect(isOpenOnWeekday(schedule, 6)).toBe(false);
    expect(windowsForWeekday(schedule, 1)).toEqual([
      { startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 },
    ]);
  });
});

describe("scheduleFromParsedBusinessHours — equivalência com o parser legado", () => {
  it("preserva a faixa geral nos dias de operação", () => {
    const schedule = scheduleFromParsedBusinessHours(parseBusinessHours("seg a sex das 8h30 às 18h"));
    expect(windowsForWeekday(schedule, 2)).toEqual([
      { startHour: 8, startMinute: 30, endHour: 18, endMinute: 0 },
    ]);
  });

  it("aplica o horário específico de sábado quando o texto o declara", () => {
    const schedule = scheduleFromParsedBusinessHours(
      parseBusinessHours("seg-sex 8h-18h, sáb 8h-13h"),
    );
    expect(windowsForWeekday(schedule, 5)).toEqual([
      { startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 },
    ]);
    expect(windowsForWeekday(schedule, 6)).toEqual([
      { startHour: 8, startMinute: 0, endHour: 13, endMinute: 0 },
    ]);
  });

  it("sábado sem horário próprio herda a faixa geral — comportamento de hoje, preservado", () => {
    const schedule = scheduleFromParsedBusinessHours(parseBusinessHours("seg a sáb 8h-18h"));
    expect(windowsForWeekday(schedule, 6)).toEqual([
      { startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 },
    ]);
  });

  it("dia fora da lista de operação fica sem janela", () => {
    const schedule = scheduleFromParsedBusinessHours(parseBusinessHours("seg-sex 8h-18h"));
    expect(windowsForWeekday(schedule, 0)).toEqual([]);
    expect(isOpenOnWeekday(schedule, 0)).toBe(false);
  });
});

describe("escalas que o texto livre nunca conseguiu expressar", () => {
  it("clínica fechada no meio da semana", () => {
    const schedule: BusinessSchedule = {
      days: {
        1: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
        2: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
        4: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
        5: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
      },
    };
    expect(isOpenOnWeekday(schedule, 3)).toBe(false);
    expect(isOpenOnWeekday(schedule, 4)).toBe(true);
  });

  it("dois turnos no mesmo dia com intervalo de almoço", () => {
    const schedule: BusinessSchedule = {
      days: {
        1: [
          { startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 },
          { startHour: 14, startMinute: 0, endHour: 18, endMinute: 0 },
        ],
      },
    };
    const windows = windowsForWeekday(schedule, 1);
    expect(windows).toHaveLength(2);
    expect(windows[0].endHour).toBe(12);
    expect(windows[1].startHour).toBe(14);
  });

  it("janelas de um dia saem ordenadas por horário, mesmo declaradas fora de ordem", () => {
    const schedule: BusinessSchedule = {
      days: {
        1: [
          { startHour: 14, startMinute: 0, endHour: 18, endMinute: 0 },
          { startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 },
        ],
      },
    };
    expect(windowsForWeekday(schedule, 1).map((w) => w.startHour)).toEqual([8, 14]);
  });
});
